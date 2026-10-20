# Architecture

## Decisions (Phase 0)

The repository started as an empty `create-next-app` scaffold (Next.js 16 + React 19 + Tailwind v4).
That stack is production-capable for a transactional marketplace, so it was **retained** and extended
with the components a money-handling system needs:

| Concern | Decision | Why |
|---|---|---|
| Web/UI | Next.js 16 App Router, React Server Components, Server Actions | One deployable; server-rendered Arabic pages (SEO); forms work without JS (progressive enhancement) |
| Database | PostgreSQL 16 | ACID transactions, row locks (`FOR UPDATE`, `SKIP LOCKED`), CHECK constraints, triggers, `pg_trgm` for Arabic fuzzy search |
| ORM | Drizzle (SQL-first, typed) | Explicit SQL and transactions, no hidden lazy loading; generated SQL migrations are reviewed and committed |
| Money | Integer piasters (`bigint`), basis points for rates | No floating point anywhere in money paths |
| Jobs | PostgreSQL-backed queue (`jobs` table + worker process) | No extra infrastructure; `FOR UPDATE SKIP LOCKED` for safe concurrency; dedupe keys |
| Files | Storage driver interface, local-disk driver | Private/public separation, authorization-checked streaming; an S3 driver can be added behind the same interface |
| Auth | Own implementation (scrypt, DB sessions, TOTP) | Full control over admin 2FA, step-up, session revocation and audit; no third-party identity provider dependency |
| i18n | Arabic-first strings with a label/format layer (`src/lib/i18n`, `src/lib/format.ts`) | RTL by default, English-ready without a full i18n framework on day one |

## Layering

```
src/
  app/                 Next.js routes (thin): pages, layouts, route handlers
    (shop)/            customer storefront + account area
    seller/            Seller Center
    admin/             Admin Operations Center ((console) group = authenticated + 2FA)
    _actions/          Server Actions: parse FormData → call ONE domain function → revalidate/redirect
    _components/       app-specific UI pieces
    api/               route handlers: health/ready, private file streaming, CSV export, card fragments
  domain/              pure domain: state machines (no I/O)
  server/
    core/              env validation, money, errors, actor/permissions, crypto, logger, Arabic text utils
    db/                Drizzle client, schema (one file per bounded context), seeds
    auth/              passwords, sessions, TOTP, rate limits, actor builders
    rbac/              permission catalogue, default roles, seller staff roles
    audit/             append-only audit writer
    storage/           storage driver, upload validation/re-encoding, access policy
    jobs/              queue + worker + schedules
    modules/           DOMAIN SERVICES (the only place business rules live)
      sellers, catalog, commerce, payments, finance, postpurchase, deals,
      reviews, support, cms, notifications, reports, customers, settings
    web/               request helpers: session cookies, action runner, request context
  ui/                  design-system components (buttons, forms, tables, feedback, commerce cards)
  lib/                 formatting (ar-EG, Western digits), labels, class helpers
scripts/               CLI: migrate, seed, reset, worker, ledger check, admin bootstrap/TOTP, env check
drizzle/               SQL migrations (incl. hand-written integrity triggers)
tests/                 unit/, integration/ (real PostgreSQL), e2e/ (Playwright)
```

Rules enforced in code review and by structure:

1. **Routes never contain business rules.** A Server Action authenticates (via `src/server/web/session.ts`),
   parses input, calls one domain function with an `Actor`, and maps `DomainError`s to form errors
   (`src/server/web/action.ts`).
2. **Every domain function receives an `Actor`** (`src/server/core/actor.ts`) and authorizes itself
   (`requirePermission`, `requireSeller`, ownership checks). Hiding a link is never the control.
3. **Status fields change only through `transition()`** (`src/domain/state-machine.ts`), which validates
   the move against the machine and writes `status_history` in the same transaction.
4. **Money moves only through `postEntry()`** (`src/server/modules/finance/ledger.ts`): balanced,
   idempotent, append-only journal entries; balances are projections locked `FOR UPDATE`.
5. **Sensitive operations write an audit record in the same transaction** (`src/server/audit/audit.ts`).
6. **Side effects are outbox-style:** notifications are inserted in the business transaction and
   delivered by the worker (`outbound_messages`), so a failed SMS never rolls back a payment.

## Request flow example — confirming a manual payment

```
Admin clicks "تأكيد الدفع" (ConfirmSubmit asks for confirmation)
 → paymentDecisionAction (src/app/_actions/admin.ts)
     requireAdmin()  → staff session + completed TOTP challenge
     runAction(() => confirmPayment(actor, paymentId, submissionId, note))
 → confirmPayment (src/server/modules/payments/service.ts)
     requirePermission(actor, 'payments.verify'); requireStepUp(actor)
     BEGIN
       SELECT payment FOR UPDATE            -- serializes double-clicks / retries
       if already CONFIRMED → return { alreadyConfirmed: true }   (idempotent)
       transition(payment → CONFIRMED), transition(order/seller orders → PAID)
       postEntry(ORDER_PAYMENT per seller order, idempotencyKey = pay:<payment>:<so>)
       audit('payment.confirmed'); notify(customer + sellers)   -- outbox rows
     COMMIT
 → revalidatePath, success message
```

## Hosts and surfaces

`src/proxy.ts` (Next 16 replacement for `middleware.ts`) rewrites `seller.<domain>/*` to `/seller/*`
and `admin.<domain>/*` to `/admin/*`. With `ENFORCE_HOSTS=true` the admin/seller paths are refused on
other hosts. Admin sessions use a separate cookie (`edmn_admin_sid`) and session scope (`ADMIN`) from
customer/seller sessions (`edmn_sid`, scope `WEB`).

## Background processing

`npm run worker` runs `scripts/worker.ts`, which polls the `jobs` table and runs the schedule in
`src/server/jobs/worker.ts`:

| Task | Interval | Purpose |
|---|---|---|
| `outbound.flush` | 1 min | deliver queued email/SMS with retries |
| `orders.expire_overdue` | 5 min | expire unpaid orders past the payment window; release reserved stock |
| `orders.flag_unconfirmed` | 1 h | follow up shipped orders without buyer confirmation |
| `orders.complete_delivered` | 1 h | mark delivered orders COMPLETED after the completion window |
| `deals.flag_unconfirmed` | 1 h | follow up delivered external deals |
| `settlement.scheduled` | 1 h | create scheduled-settlement withdrawals on configured days (idempotent per day) |
| `rate_limits.prune` | 6 h | housekeeping |

All tasks are idempotent, so running two workers or a crashed/restarted worker is safe.

## Configuration philosophy

- **Environment** (`src/server/core/env.ts`, validated with zod at startup, with production safety
  checks): infrastructure only — URLs, database, secrets, storage, mail/SMS drivers, logging.
- **Database settings** (`system_settings`, typed by `SETTINGS_SCHEMA` in `src/server/modules/settings.ts`):
  business rules admins can change at runtime with audit — payment window, withdrawal minimum and SLA,
  dual-control threshold, settlement mode/days, payout change hold, moderation, upload limits,
  statutory return window, deal fee, etc.
- **Dedicated tables** for richer configuration: `commission_rules` (versioned), `payment_methods`,
  `payment_destinations`, `listing_policy_rules`, `notification_templates`, `cms_blocks`,
  `legal_documents` (versioned).

## Extensibility points

- `PaymentProvider` abstraction (`src/server/modules/payments/providers.ts`) — manual providers today;
  a card/wallet PSP can be added without touching orders or the ledger.
- `StorageDriver` (`src/server/storage/storage.ts`) — local disk today; S3-compatible driver later.
- Notification providers (`src/server/modules/notifications/providers.ts`) — log/SMTP email,
  log/HTTP SMS.
- Labels/formatting (`src/lib/i18n`) — English strings can be added without restructuring pages.
