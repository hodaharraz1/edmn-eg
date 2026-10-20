# EDMN Mobile Ecosystem: Phase 0 Audit & Implementation Plan

| | |
|---|---|
| **Status** | Phase 0, read-only audit and planning. No application code, schema, API, deployment or financial logic was changed. |
| **Date** | 2026-10-20 |
| **Workstream** | EDMN Mobile (Customer App + Admin App). Separate from the website, SEO and staging work. |
| **Companion documents** | [`MOBILE_API_GAP_MATRIX.md`](./MOBILE_API_GAP_MATRIX.md), [`MOBILE_SCREEN_MAP.md`](./MOBILE_SCREEN_MAP.md), [`MOBILE_BACKLOG.md`](./MOBILE_BACKLOG.md) |
| **Next gate** | Explicit owner approval before Phase 1. |

---

## 0. Executive summary

### 0.1 The finding that changes the plan

**The code available to this audit has no backend, database, marketplace, Protected Deal engine, ledger, seller system or Admin system.**

The brief said these existed and could be reused. I checked the code itself, not the documentation or the website copy. Every repository this session can reach that is named EDMN is a **marketing website**:

| Repository | Branch / commit inspected | What it actually is |
|---|---|---|
| `hodaharraz1/edmn-eg` (session repo) | `claude/awesome-davinci-ojxuul` @ `f70d40b` (identical to `main`) | Next.js 16 marketing site. 69 files, about 3.4k lines of TS/TSX. Static pages plus one `POST /api/contact` that forwards to Formspree. |
| `hodaharraz1/edmn-eg-nextjs` (private) | `main` @ `4a87884`; `backup/old-design` (same layout) | A newer version of the same marketing site. Adds Sentry, Upstash rate limiting, Airtable lead capture, a `/register` **lead form** (not account registration), `GET /api/health`, Vitest and Playwright. |

What I checked to confirm this:

- **Dependencies.** Neither `package.json` has a database driver or ORM (no `pg`, Prisma, Drizzle, Supabase or Mongoose), no auth library, no payment SDK and no queue.
- **Routes.** No auth, session, user, order, deal, payment, ledger or admin route exists anywhere.
- **Code search.** `ledger`, `escrow`, `wallet` and `otp` have no code hits in `edmn-eg-nextjs`. In `edmn-eg` they appear only in marketing copy, such as the hero mock-up "Escrow Balance" card in `src/components/sections/Hero.tsx`.
- **Persistence.** The only data stores are Formspree (email relay) and an optional Airtable `Leads` table.
- **Other repositories** on the account (`aqar-system`, `tucomida-pos`, `clinic-reminder-system` and others) are unrelated products by name. They were not opened.

> **Implication.** The "reuse the existing backend" strategy (Phase 0K) cannot run as written. **There is nothing financial or transactional to reuse.** One of two things is true:
> 1. **The EDMN platform backend exists somewhere this session cannot see.** Examples: another Git host, a private repo not on this GitHub account, a Supabase or Firebase project, or a vendor system. If so, Phase 0A–0E must be **re-run against that code** before Phase 1. **Please provide access.**
> 2. **The platform has not been built yet.** Then Phase 1 is **not** "build the mobile apps". It is "build the canonical backend": identity, RBAC, audit, a double-entry ledger, the Protected Transaction state machine, payments in sandbox, and an OpenAPI 3.1 contract. The mobile apps and a Web Admin are then built on that backend. The backlog in `MOBILE_BACKLOG.md` is ordered for this case.
>
> This is **decision D-01** (§13). It blocks everything else.

### 0.2 Headline numbers

| # | Metric | Value | Basis |
|---|---|---|---|
| 1 | **Current mobile readiness** | **≈ 2 %** | Only the brand tokens, Arabic and English copy, legal text and the RTL conventions can be reused. No API, identity, data or business logic exists. |
| 2 | **Backend reuse** | **0 %** of transactional and financial domains | Nothing exists to reuse. The reusable non-backend assets are listed in §11. |
| 3 | **Existing APIs usable by mobile as-is** | **0** | There are 3 endpoints in total across both repos: 2× `POST /api/contact` and `GET /api/health`. None is suitable for mobile (§4). |
| 4 | **Existing APIs needing modification** | **1** | The contact pattern can become a pre-auth support ticket, replaced by `API-SUP-01` and `API-SUP-02`. |
| 5 | **Missing APIs** | **204** endpoint IDs (211 method-level operations) | Every API the two apps need. Enumerated in `MOBILE_API_GAP_MATRIX.md` §3. |
| 6 | **P0 blockers** | **9** | §0.3 |
| 7 | **P1 blockers** | **7** | §0.3 |
| 8 | **Financial safety findings** | **No ledger exists.** 0 operations to verify. 12 invariants must be designed in from day one. | §6 |
| 9 | **Security findings** | 9 on existing code (0 critical, 2 medium, 7 low/informational) plus 6 design-level requirements | §12 |
| 10 | **Recommended first sprint** | **Sprint 1, "Canonical Core".** Backend identity, RBAC, audit, idempotency and ledger kernel with invariant tests, plus the OpenAPI contract skeleton. In parallel, the mobile monorepo shell. No business UI and no real money. | §14, `MOBILE_BACKLOG.md` |

### 0.3 Blockers

**P0 blockers.** Each one prevents any safe mobile build.

1. **D-01:** The backend's location or existence must be confirmed. It does not exist in the audited code.
2. No identity system: users, sessions or OTP login.
3. No RBAC or permission model, and no staff accounts.
4. No double-entry ledger or chart of accounts, so any money movement would be unsafe.
5. No Protected Deal state machine in code. Only a 4-step marketing description exists.
6. No immutable audit trail.
7. No idempotency or concurrency framework for mutations.
8. No API contract (OpenAPI) to generate typed mobile models from.
9. **Regulatory and licensing position for holding buyer funds in Egypt is undocumented.** This covers the CBE payment-services regime and safeguarding, and who legally holds the funds: a partner bank or PSP versus EDMN. It decides how the ledger maps to real bank accounts. It is a legal decision, not an engineering one (D-03).

**P1 blockers.** Each one prevents launch.

1. No payment service provider (PSP) integration or sandbox. The website names Fawry, ValU and Banque Misr, but no integration exists. Partnership status is unverified.
2. No KYC flow, provider or private document storage.
3. No catalog, inventory, cart or checkout.
4. No dispute, return or replacement workflow.
5. No withdrawal and payout flow, and no maker/checker.
6. No notification infrastructure (FCM/APNs, SMS, email templates).
7. No Web Admin. The brief says "the existing Web Admin should remain available", but **none exists** in the audited code.

---

## 1. Scope, method and evidence

**Method.**
- I read every source file in `edmn-eg` locally (`find`, `grep`, file reads).
- `edmn-eg-nextjs` was attached read-only. A local `git clone` was blocked by the session's permission policy, so I inspected it through the GitHub contents and code-search API. I read the root, `src/`, `src/app`, `src/app/api/**`, `src/lib/**`, `src/env.ts`, `package.json`, `.github/workflows/ci.yml`, `DESIGN_SYSTEM.md`, the register flow, and the branch list.
- Claims in website copy (the hero card, "How it works", the refund policy, the terms) were treated as **product intent, not implementation**.

**Not inspected.**
- Any infrastructure outside GitHub, such as Vercel project settings or any database.
- Repos with unrelated names.
- The full UI component tree of `edmn-eg-nextjs`. It is marketing UI and irrelevant to backend reuse.

**Change verification** (see §15). The only change in this workstream is the new `docs/mobile/` folder (4 Markdown files).

---

## 2. Repository audit (Phase 0)

| Area | Status | Evidence |
|---|---|---|
| Project structure | Marketing site only | `src/app/[locale]/*` pages: about, blog, contact, faq, how-it-works, privacy-policy, refund-policy, terms, why-us (+ `register` in `edmn-eg-nextjs`) |
| Frontend | EXISTS (web marketing) | Next.js 16.2.6, React 19.2, Tailwind v4, next-intl (ar default, en), framer-motion |
| Backend | **MISSING** | Only `src/app/api/contact/route.ts` (both repos) and `src/app/api/health/route.ts` (`edmn-eg-nextjs`) |
| Database | **MISSING** | No driver, ORM, migrations or schema. External: Formspree, Airtable `Leads` |
| Authentication | **MISSING** | No auth library. The navbar "register" CTA in `edmn-eg` is `href="#"`. `manifest.ts` declares a `/login` shortcut to a page that does not exist |
| Users | **MISSING** | `/register` collects `name, email, phone, type(individual\|merchant)` as a *lead* sent to Formspree and Airtable. No account is created |
| Sellers / stores | **MISSING** | Only the "merchant" lead type |
| Marketplace / products / inventory | **MISSING** | — |
| Cart / checkout / orders | **MISSING** | — |
| Protected Deals / invitations / offers / frozen agreements | **MISSING** | 4-step copy only: *Agree → Pay → Receive → Seller paid* (`locales/*.json → howItWorks`) |
| Payment flow | **MISSING** | Copy claims Fawry/ValU integration (`features.f4Desc`). Partner logos in `public/partners/` |
| Delivery OTP | **MISSING** | — |
| Disputes / returns | **MISSING** | Policy text only: 48 h evidence window per party (`terms`). Refund timeframes in `refund-policy/page.tsx` |
| Withdrawals / ledger / reconciliation | **MISSING** | — |
| Notifications | **MISSING** | — |
| KYC | **MISSING** | Privacy policy states KYC/AML documents "may be requested" |
| Support | PARTIAL (web form) | Contact form → Formspree e-mail (+ Airtable in `edmn-eg-nextjs`). No ticket IDs, status or threading |
| Admin / roles / permissions / audit logs / settings | **MISSING** | — |
| Tests | Web only | `edmn-eg`: none. `edmn-eg-nextjs`: Vitest + Playwright for marketing pages |
| Deployment config | Web only | Vercel implied (README, `.vercel` in `.gitignore`). `edmn-eg-nextjs` has GitHub Actions CI (typecheck → unit → build → e2e) |
| Observability | Web only | `edmn-eg-nextjs`: Sentry (client/edge/server), a structured logger |
| Localization | EXISTS (web) | `src/locales/ar.json`, `en.json`. `localePrefix: 'as-needed'`, default `ar`, RTL |
| Market identity | OK | Egyptian (EGP, ar-EG dates, Egyptian law and courts in terms). **No SAR/AED or Gulf references found** |

**Business rules stated in website copy.** These are candidates for the backend, and each needs owner confirmation (D-05):
- Fees: **5 % individuals / 3 % merchants**. It is not stated who pays: buyer, seller or split.
- Two products: **Delivery Guarantee** for physical goods, and **Payment Guarantee** for services and rentals.
- Refund eligibility and SLAs:
  - non-receipt: 5–7 working days, 100 %
  - item not as agreed: 7–10 days, 100 %
  - proven fraud: 3–5 days, 100 %
  - material defect: 10–14 days, partial or full
- Refund review: 48 h. Refund processing: 5–10 working days. No refunds 30 days after receipt confirmation.
- Disputes: EDMN reviews evidence, each party gets 48 h to submit, then EDMN decides.
- "Funds instantly transferred to seller after receipt confirmation." This conflicts with maker/checker and any settlement delay (§7.4).

---

## 3. Backend reuse audit (Phase 0A)

The full per-feature matrix is in `MOBILE_API_GAP_MATRIX.md` §1. Summary:

| Classification | Count of mobile features (of 73) |
|---|---|
| EXISTS | 0 |
| PARTIAL | 3 (support contact form, static legal and FAQ content, web health check) |
| MISSING | 70 |
| NEEDS REFACTOR | 0 (applies to the 3 partials once a backend exists) |
| UNSAFE FOR MOBILE EXPOSURE | 0 backend features. The existing `/api/contact` and `/api/health` endpoints *would be* unsafe to expose as mobile APIs (§4) |

---

## 4. API audit (Phase 0B)

### 4.1 Every existing endpoint

| # | Repo | Method | Route | Class | AuthN | AuthZ | Request | Response | Side effects | Idempotency | Rate limit | Validation | Audit log | Mobile suitability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E1 | `edmn-eg` | POST | `/api/contact` | PUBLIC | none | none | `{name,email,phone?,subject,message,website(honeypot)}` | `200 {success}` / `400` / `429` / `500` | Sends an e-mail through Formspree | **None.** A retry sends a duplicate e-mail | In-memory `Map`, 3 per 15 min per IP. **Ineffective on serverless or multiple instances.** Keyed on the first `X-Forwarded-For` value | zod | none (`console.error`) | **Not suitable.** Lives on the marketing-site origin, has no ticket identity, and a third-party relay holds PII |
| E2 | `edmn-eg-nextjs` | POST | `/api/contact` | PUBLIC | none | none | same | `200` / `400` / `429` / `502` | Formspree e-mail plus Airtable `Leads` row | None | Upstash sliding window, 3 per 15 min per IP. **Fails open** when Upstash is not configured | zod | Structured logger. **Logs the full e-mail address** | Not suitable. Same reasons as E1. **Pattern reusable** |
| E3 | `edmn-eg-nextjs` | GET | `/api/health` | PUBLIC/INTERNAL | none | none | — | `{status,version,environment,services{formspree,redis}}` | **Makes outbound HEAD and PING calls on every request** | n/a | none | n/a | Error log | Not suitable. Unauthenticated, discloses configuration state, and can be used to amplify outbound traffic |

**Endpoint counts:** PUBLIC 3 · CUSTOMER 0 · SELLER 0 · ADMIN 0 · FINANCE 0 · INTERNAL 0 (E3 is effectively internal).

### 4.2 Missing APIs

`MOBILE_API_GAP_MATRIX.md` §3 lists **204 required endpoint IDs** (211 method-level operations). Each one has its class, auth, authorization, idempotency, rate limit, audit, fresh-2FA and maker/checker requirements.

| Class | Count |
|---|---|
| PUBLIC | 18 |
| CUSTOMER | 67 |
| SELLER | 38 |
| ADMIN | 57 |
| FINANCE | 18 |
| INTERNAL | 6 |

---

## 5. Database audit (Phase 0C)

**Actual schema: none.** The only persisted data in the audited code:

| Store | Entity | Fields | Notes |
|---|---|---|---|
| Formspree | e-mail message | name, email, phone, subject, message | Third-party. Not queryable as a system of record |
| Airtable (optional) | `Leads` | Name, Email, Phone, Type, Source, Subject, Message, Created At | Holds PII in a third-party SaaS. Treat it as a marketing CRM only. **It must not be migrated as "users".** These people never created accounts or consented to account terms |

### 5.1 Target canonical schema

This compares the actual schema (none) against the intended architecture. It is a **design proposal only. No migration has been created.**

PostgreSQL is recommended (D-02). All money is stored as `BIGINT` piastres (1 EGP = 100 piastres), never float. All tables carry `created_at`. Mutable aggregates carry `version` for optimistic concurrency.

| Domain | Tables (proposed) | Key constraints |
|---|---|---|
| Identity | `users`, `user_phones`, `user_emails`, `auth_otp_challenges`, `sessions`, `refresh_tokens`, `devices`, `push_tokens` | Unique verified phone. OTP stored as an HMAC, never plaintext. Refresh-token rotation with a `family_id` for reuse detection |
| KYC | `kyc_cases`, `kyc_documents` (object-store keys only), `kyc_decisions` | Documents in a private bucket, served through short-lived signed URLs, with an access-log row per view |
| Sellers / stores | `seller_profiles`, `stores`, `store_members`, `payout_accounts` (encrypted IBAN or wallet number), `seller_status_history` | A seller can only list when `kyc_status=approved`. Payout account changes need step-up auth and a cooling-off period |
| Catalog | `categories`, `products`, `product_variants`, `product_media`, `product_condition` (new/used), `product_moderation` | `price_piastres > 0`. Moderation state machine |
| Inventory | `inventory_levels`, `inventory_reservations` | `available >= 0` CHECK. Reservation TTL. `SELECT … FOR UPDATE` on decrement |
| Shipping | `governorates` (27 Egyptian governorates, seed), `seller_shipping_rates (store_id, governorate_id, price, min_days, max_days)` | Unique `(store_id, governorate_id)` |
| Cart / checkout | `carts`, `cart_items`, `checkouts`, `checkout_seller_groups` | Server recomputes totals. The client never sends authoritative prices |
| Orders | `orders` (one per seller group), `order_items`, `order_status_history`, `shipments`, `shipment_evidence` | Each order is backed by one `protected_transactions` row |
| Protected Deals | `deals`, `deal_invitations` (hashed token), `deal_offers` (versioned), `deal_agreements` (frozen snapshot plus SHA-256), `deal_events` | Exactly one accepted offer per agreement. The agreement row is immutable (trigger) |
| Protected Transaction core | `protected_transactions`, `pt_state_history`, `pt_holds`, `pt_deadlines` | One state machine shared by Marketplace orders and Protected Deals (§7.3) |
| Delivery OTP | `delivery_otps (pt_id, otp_hmac, expires_at, attempts, max_attempts, consumed_at, issued_by_event)` | Single active OTP per PT (partial unique index). Atomic consume |
| Payments | `payment_intents`, `payment_attempts`, `psp_webhook_events` (raw, deduplicated by provider event ID), `payment_verifications` | Unique `(provider, provider_event_id)` |
| Disputes / returns / replacements | `disputes`, `dispute_evidence`, `dispute_decisions`, `returns`, `replacements` | A decision posts a ledger journal through the finance service only |
| Ledger | `ledger_accounts`, `journals`, `journal_lines`, `account_balances` (projection) | Every journal sums to zero (deferred constraint trigger). `journals` and `journal_lines` are **INSERT-only**: UPDATE and DELETE are revoked and blocked by trigger. Reversals reference `reverses_journal_id` |
| Wallet projections | `account_balances`, `seller_balance_view`, `buyer_refund_view` | Derived from `journal_lines` only. Rebuildable. Never written by clients |
| Withdrawals / settlements | `withdrawal_requests`, `settlement_batches`, `settlement_items`, `payouts` | Maker/checker columns `created_by` and `approved_by` with CHECK `approved_by <> created_by` |
| Maker / checker | `approval_requests (action_type, payload_hash, maker_id, checker_id, status, expires_at)` | CHECK `checker_id <> maker_id`. Approval binds to `payload_hash` |
| Reconciliation | `recon_runs`, `recon_statement_lines`, `recon_matches`, `recon_breaks` | Statement import is immutable. Breaks need a resolution journal |
| Fees | `fee_schedules` (effective-dated), `fee_quotes` (frozen into the agreement) | Fee rules are versioned. Agreements reference the quote, not the live schedule |
| Chargebacks / adjustments | `chargebacks`, `financial_adjustments` (always maker/checker) | — |
| Notifications | `notifications`, `notification_preferences`, `outbox_events` | Transactional outbox for exactly-once publish |
| Support | `support_tickets`, `ticket_messages`, `ticket_attachments` | — |
| Staff / RBAC | `staff_users`, `staff_mfa_factors`, `roles`, `permissions`, `role_permissions`, `staff_role_assignments`, `staff_sessions` | Staff live in a separate table and token audience from customers |
| Audit | `audit_events` (append-only, hash-chained: `prev_hash`, `hash`) | INSERT-only. Exported daily to WORM storage |
| Idempotency | `idempotency_keys (actor_id, key, request_hash, response, status, expires_at)` | Unique `(actor_id, key)`. Same key with a different payload returns `422` |
| Settings / CMS | `platform_settings` (versioned and audited), `cms_pages`, `cms_banners` | Sensitive settings (fees, limits, real-money toggle) need maker/checker |

---

## 6. Financial safety audit (Phase 0D)

### 6.1 Verification results against existing code

| Control | Result |
|---|---|
| Double-entry ledger | **Not present** |
| Debits = credits | Not applicable. No ledger |
| Immutable posted entries | Not applicable |
| Wallet projections | Not present |
| Payment verification | Not present |
| Settlement logic | Not present |
| Withdrawal logic | Not present |
| Maker / Checker | Not present |
| Idempotency | **Absent even on the contact endpoint** |
| Concurrency protection | Not present |
| Reconciliation | Not present |
| Dispute holds | Not present |
| Refunds / chargebacks | Policy text only |
| Financial audit trail | Not present |

**Operations that could duplicate money, lose money, release money incorrectly, allow self-approval, bypass the ledger or create inconsistent balances: none exist today.** No money code exists, so there are no such operations. This is the only good news in this section. The risk shifts entirely to **how the system is built**.

### 6.2 Mandatory financial invariants for the new build

These become acceptance criteria in `MOBILE_BACKLOG.md` (FIN-* tickets).

1. **I-1 Balanced journals.** `SUM(debit) = SUM(credit)` per journal, enforced by a DB deferred constraint trigger, not only application code.
2. **I-2 Immutability.** `journals` and `journal_lines` are INSERT-only for the application role. A correction is a new reversing journal that references the original.
3. **I-3 Single writer.** Only the Ledger service module posts journals. Domain services (deals, disputes, withdrawals) request postings through `ledger.post(command)` with a deterministic `posting_key`. Mobile and admin clients **never** submit amounts to be posted. They submit *intents*, and the server derives the amounts.
4. **I-4 Idempotent postings.** Unique `posting_key`, for example `pt:{id}:fund:{psp_event_id}`. A replayed webhook or retried request posts at most once.
5. **I-5 No negative liability.** Per-deal held balance and seller payable may never go below 0. This is checked inside the same transaction under a row lock on the account balance.
6. **I-6 Projections are derived.** `account_balances` is updated in the same DB transaction as the journal lines. A nightly job recomputes from lines and alerts on any drift.
7. **I-7 Release requires state.** Escrow release is only possible from `RECEIPT_CONFIRMED` (or an auto-confirm deadline) with **no active hold or dispute**. The guard is evaluated under a row lock on the PT.
8. **I-8 Maker ≠ checker.** This is a DB CHECK plus a service check. The approval binds to a hash of the exact payload. Any edit invalidates the approval.
9. **I-9 Fresh 2FA** for every checker approval and every payout-affecting admin action. Step-up token TTL is 5 min or less, scoped to the action.
10. **I-10 Money type.** Integer piastres everywhere. Currency is fixed to `EGP` with a CHECK. Rounding rules for fees are explicit (banker's rounding or always-floor; D-05). Every rounding remainder is posted to an explicit account.
11. **I-11 Real-money kill switch.** `platform_settings.real_money_enabled=false` by default. Changing it needs maker/checker, fresh 2FA and two distinct super-admins. PSP credentials are sandbox-only in all non-production environments.
12. **I-12 Reconciliation.** Daily three-way match: PSP settlement report ↔ bank statement ↔ ledger clearing accounts. Unmatched items go to `recon_breaks`. Payouts pause automatically if any break is older than the threshold.

### 6.3 Proposed chart of accounts (minimal)

| Code | Account | Type | Sub-ledger |
|---|---|---|---|
| 1010 | PSP clearing: {provider} | Asset | per provider |
| 1020 | Safeguarded bank account | Asset | — |
| 1030 | Payouts in transit | Asset (contra) | per payout batch |
| 1040 | Chargeback receivable | Asset | per case |
| 2010 | Buyer funds held: Protected Transactions | Liability | **per PT** |
| 2020 | Seller payable | Liability | **per seller** |
| 2030 | Buyer refund payable | Liability | per buyer |
| 2090 | Suspense: unmatched receipts | Liability | — |
| 4010 | Platform fee revenue | Revenue | — |
| 5010 | PSP processing fees | Expense | — |
| 5020 | Chargeback losses | Expense | — |

**Standard postings**, all generated server-side:

| Event | Debit | Credit |
|---|---|---|
| Funding verified | 1010 PSP clearing | 2010 Held(PT) |
| Settlement | 2010 Held(PT) | 2020 Seller payable (net) + 4010 Fee revenue |
| Withdrawal approved (checker) | 2020 Seller payable | 1030 Payouts in transit |
| Payout confirmed by bank | 1030 Payouts in transit | 1020 Bank |
| Refund decided | 2010 Held(PT) | 2030 Buyer refund payable |
| Refund paid | 2030 Buyer refund payable | 1010 PSP clearing |
| Partial dispute outcome | 2010 Held(PT) | 2020 + 2030 (+ 4010 if fees are retained) |
| PSP fee recognised | 5010 PSP fees | 1010 PSP clearing |
| Chargeback | 1040 / 5020 | 1010 PSP clearing |
| Correction | Reversal of the original journal, then the corrected journal | |

---

## 7. Protected Deal audit (Phase 0E)

### 7.1 State machine in code

**None.** The only representation is marketing copy, a 4-step list in `locales/*.json → howItWorks`. The hero mock-up in `Hero.tsx` shows the same steps: *Terms Agreement → Funds Deposited → Delivery → Release to Seller*.

### 7.2 Discrepancies against the intended flow

| Intended step | In code | In website copy | Gap |
|---|---|---|---|
| Buyer request | ✗ | ✗ (implied "agree on terms") | Missing |
| Seller invitation / association | ✗ | ✗ | Missing |
| Seller review | ✗ | ✗ | Missing |
| Seller offer (versioned) | ✗ | ✗ | Missing |
| Buyer approval / modification | ✗ | partial ("agree") | Missing |
| Frozen agreement | ✗ | ✗ | Missing |
| Payment | ✗ | ✓ "Pay securely" | Missing |
| Funding verification | ✗ | ✗ | Missing |
| Delivery | ✗ | ✓ | Missing |
| **Mandatory Delivery OTP** | ✗ | ✗ | **Missing, and not in the public copy.** Consider updating the terms (D-06) |
| Receipt confirmation | ✗ | ✓ | Missing |
| Settlement | ✗ | ✓ "instantly transferred" | Missing. "Instant" **conflicts** with maker/checker, dispute windows and reconciliation |
| Rejection / modification / expiration | ✗ | ✗ | Missing |
| Dispute / hold | ✗ | ✓ (terms §5: 48 h evidence) | Missing |
| Return / replacement / refund | ✗ | ✓ (refund policy) | Missing |

### 7.3 Proposed canonical state machine

This is a design for approval. It is **server-owned**. Clients receive `state`, `allowed_actions[]` and `deadlines` and render them. They never derive transitions themselves.

**Single "Protected Transaction" (PT) core.** Marketplace seller-orders and Protected Deals both run through the same PT state machine and the same ledger postings, so there is exactly one money path. A Protected Deal adds a **negotiation pre-phase** (request → offer → agreement). A Marketplace order enters the PT directly at `AGREEMENT_FROZEN`, using the checkout snapshot as the agreement.

**Negotiation phase** (Protected Deal only, no money):

| State | Actor that can act | Allowed actions → next state | Guard | Deadline |
|---|---|---|---|---|
| `DRAFT` | Buyer | `submit` → `AWAITING_SELLER` | Buyer verified phone | — |
| `AWAITING_SELLER` | Seller (through an invitation link or a known store) | `accept_invitation` → `SELLER_REVIEWING`; buyer `cancel` → `CANCELLED` | Invitation token valid, unused and unexpired. Seller KYC is at least basic | Invitation TTL (D-07, e.g. 72 h) → `EXPIRED` |
| `SELLER_REVIEWING` | Seller | `make_offer` → `OFFERED`; `reject` → `REJECTED` | Offer currency is EGP, amount within limits | Review TTL → `EXPIRED` |
| `OFFERED` (v_n) | Buyer | `accept` → `AGREEMENT_FROZEN`; `request_changes` → `MODIFICATION_REQUESTED`; `reject` → `REJECTED` | Offer version = latest (optimistic concurrency) | Offer TTL → `EXPIRED` |
| `MODIFICATION_REQUESTED` | Seller | `revise_offer` → `OFFERED` (v_n+1); `reject` → `REJECTED` | Max revisions (D-07) | TTL → `EXPIRED` |

**Protected Transaction phase** (shared core):

| State | Actor | Actions → next | Guard | Financial effect | Deadline / timeout |
|---|---|---|---|---|---|
| `AGREEMENT_FROZEN` | System | auto → `AWAITING_PAYMENT` | Agreement snapshot hashed. Fee quote frozen | none | — |
| `AWAITING_PAYMENT` | Buyer | `pay` → `PAYMENT_PENDING` | Real-money flag or sandbox | none | Payment TTL → `PAYMENT_EXPIRED` |
| `PAYMENT_PENDING` | PSP webhook / Finance | `funding_verified` → `FUNDED`; `funding_failed` → `AWAITING_PAYMENT` or `PAYMENT_FAILED` | Webhook signature valid. Amount = agreement total. Dedup by event ID | **Dr 1010 / Cr 2010(PT)** on verified | PSP timeout → manual verification queue |
| `FUNDED` | Seller | `mark_shipped` (evidence) → `SHIPPED` | Evidence uploaded | none | Ship-by deadline → `SELLER_OVERDUE`, which allows buyer cancel-for-refund |
| `SHIPPED` | Seller / courier | `out_for_delivery` → `OTP_ISSUED` | — | none | — |
| `OTP_ISSUED` | Seller enters the OTP the buyer gives at handover | `verify_otp` → `DELIVERED` | OTP valid, unexpired, unused, attempts < max | none | OTP TTL → re-issue (buyer-initiated) |
| `DELIVERED` | Buyer | `confirm_receipt` → `RECEIPT_CONFIRMED`; `open_dispute` → `DISPUTED`; `request_return` / `request_replacement` | Within the inspection window | none | Inspection window (D-07, e.g. 72 h) → auto `RECEIPT_CONFIRMED` |
| `RECEIPT_CONFIRMED` | System | → `SETTLEMENT_PENDING` | No active hold | none | — |
| `SETTLEMENT_PENDING` | System / Finance | `settle` → `SETTLED` | I-7. Recon is not blocked. Below the auto-settle threshold, or maker/checker approved above it | **Dr 2010 / Cr 2020 + 4010** | — |
| `SETTLED` → `COMPLETED` | System | — | — | Seller balance becomes withdrawable after the hold period | — |

**Branches.**
- `REJECTED`, `EXPIRED` and `CANCELLED` are terminal before funding and have no financial effect.
- `PAYMENT_EXPIRED`: late funds that arrive after expiry go to suspense, then an auto-refund case.
- `ON_HOLD` is reachable from any funded state. It is set by admin or compliance with a reason, blocks settlement, and needs maker/checker to lift above a threshold.
- `DISPUTED` is reachable from `FUNDED`, `SHIPPED`, `OTP_ISSUED`, `DELIVERED` or `SELLER_OVERDUE`. It goes to an evidence window (48 h per party, per the terms), then a decision, then one of three outcomes:
  - **full refund:** Dr 2010 / Cr 2030
  - **release:** settlement posting
  - **split:** both
- `RETURN_REQUESTED` → `RETURN_APPROVED` → `RETURN_IN_TRANSIT` → `RETURN_RECEIVED` (seller confirms; this can be disputed) → `REFUND_PENDING` → `REFUNDED`.
- `REPLACEMENT_REQUESTED` → `REPLACEMENT_APPROVED` → `REPLACEMENT_SHIPPED` → `OTP_ISSUED` (a new OTP) → `DELIVERED`.
- `PARTIALLY_REFUNDED` and `REFUNDED` are terminal.
- `CHARGEBACK` is an overlay flag handled by Finance.

### 7.4 Delivery OTP design (server-enforced)

| Requirement | Design |
|---|---|
| Cryptographically secure | 6 digits from the CSPRNG (`crypto.randomInt`). Generated only on the `out_for_delivery` transition |
| Storage | `HMAC-SHA256(pepper_from_KMS, pt_id ‖ otp)`. Plaintext is **never persisted**. A 6-digit space is brute-forceable offline, so the pepper lives outside the DB |
| Expiring | `expires_at` (D-07, e.g. 48 h). An expired OTP needs a buyer-initiated re-issue |
| Single use | Atomic `UPDATE … SET consumed_at=now() WHERE id=? AND consumed_at IS NULL AND attempts<max AND expires_at>now()` |
| Attempt-limited | `max_attempts=5`. Exceeding it locks the OTP, alerts ops, and requires buyer re-issue |
| Rate-limited | Per PT, per seller account, per device and per IP (Redis token bucket) |
| Seller cannot view | No endpoint returns the OTP to the seller role. The seller only has `POST …/delivery-otp/verify` |
| Buyer access | Shown once at issue, through a buyer-scoped endpoint. Re-display means re-issue: the old OTP is invalidated and a new one generated. The push notification says "your delivery code is ready" **without the code**, so it never shows on a lock screen |
| Admin cannot retrieve | No admin read endpoint. Admin can only `force_reissue` (audited), which delivers the code to the buyer |
| Never logged | Request and response body logging is disabled on OTP routes. The logger redacts `otp`, `code` and `pin` keys. Sentry `beforeSend` scrubbing. Unit tests assert redaction |

---

## 8. Backend platform recommendation (prerequisite for mobile)

Because no backend exists, the mobile plan depends on one. **D-02** proposes:

| Concern | Recommendation | Reason |
|---|---|---|
| Language / framework | TypeScript (Node 22 LTS) with NestJS or Fastify, modular monolith | Same language as the existing web team. A modular monolith keeps ledger transactions in one DB transaction. Microservices would add distributed-transaction risk for no benefit at launch |
| Database | PostgreSQL 16 (managed) | ACID, `SERIALIZABLE` / row locks, CHECK and trigger constraints for the ledger invariants, partial unique indexes |
| Data access | SQL migrations plus a query builder that exposes explicit transactions (Drizzle or Kysely) | The ledger needs precise SQL control. Avoid ORMs that hide locking |
| Contract | **OpenAPI 3.1** generated from the server schemas (zod-to-openapi or Nest swagger), versioned in-repo, with a breaking-change check in CI | Single source for typed Dart models and Web Admin types |
| Async | Transactional outbox, then a queue (e.g. BullMQ on Redis or pg-boss) | Notifications, deadlines and timeouts, PSP polling |
| Object storage | S3-compatible private buckets, KMS encryption, signed URLs that expire in 5 min or less | KYC and evidence |
| Secrets | Cloud KMS / secret manager | OTP pepper, PSP keys, JWT signing keys |
| Hosting / data residency | **Decision needed (D-04).** Egypt's Personal Data Protection Law (No. 151/2020) restricts cross-border transfer of personal data, and a CBE-regulated partner may require local hosting | Legal review |
| Web Admin | A new Next.js app (`web/admin`) on the same Admin API, separate from the marketing site | The brief requires a desktop admin. None exists today |

---

## 9. Mobile architecture plan (Phase 0F)

### 9.1 Repository layout decision

**Recommendation: create a new platform monorepo, `edmn-platform`. Do not put the mobile apps in `edmn-eg`.**

```
edmn-platform/
  backend/                     # modular monolith (identity, catalog, orders, pt, ledger, finance, admin…)
  contracts/openapi/           # customer.v1.yaml, admin.v1.yaml (generated + committed, diffed in CI)
  web/admin/                   # Web Admin (Next.js), consumes admin.v1
  mobile/
    melos.yaml | pubspec.yaml  # Dart pub workspace (or melos) — decide in MOB-001
    apps/
      customer_mobile/         # Buyer + Seller Center, flavors: dev / staging / prod
      admin_mobile/            # separate bundle IDs, signing keys, Firebase projects
    packages/
      design_system/           # tokens, themes, widgets (RTL-first)
      api_client_customer/     # generated from customer.v1 (Dio)
      api_client_admin/        # generated from admin.v1 — NOT a dependency of customer_mobile
      core/                    # Result types, errors, idempotency-key, pagination, money (display only)
      localization/            # ARB files ar (primary) / en
      security/                # secure storage, step-up, biometric gate, screen-protect, redaction
      observability/           # Sentry init + scrubbing, logging facade, analytics facade (consent-gated)
  .github/workflows/
```

Why this layout:

1. **`edmn-eg` is a marketing site deployed to Vercel**, and the brief says not to mix mobile work into it. Putting backend or financial code in a repo whose CI deploys a public website increases blast radius.
2. **Contract changes stay atomic.** A backend change, the regenerated OpenAPI, and the Dart and TS client updates land in one PR, and CI fails on drift.
3. **Separate admin and customer API clients.** `customer_mobile` cannot even compile against admin endpoints. This is defence in depth on top of server-side authorization, never instead of it.
4. If the owner prefers repo separation (`edmn-backend` plus `edmn-mobile`), the mobile repo consumes `contracts/` as a versioned artifact. This is workable but slower. **D-08.**

### 9.2 App identity and builds

| | Customer App | Admin App |
|---|---|---|
| Bundle / application ID | e.g. `eg.edmn.app` (D-09) | e.g. `eg.edmn.admin` |
| Distribution | App Store + Google Play (public) | **Not public.** Apple Business Manager custom app / TestFlight internal, Google Play private (managed) app or MDM. Decision D-10 |
| API audience | `aud=customer` | `aud=admin`, a separate host (`admin-api.…`), and an IP or device-attestation policy (P2) |
| Signing keys | Separate keystore and certificates | Separate keystore and certificates, held in CI secrets with restricted reviewers |
| Firebase / Sentry projects | Separate | Separate |
| Flavors | dev / staging / prod | dev / staging / prod |
| Real money | Off in dev and staging, always. Off in prod until D-11 | n/a (controls the toggle through maker/checker) |

### 9.3 Layering inside each app

Feature-first layout: `lib/features/<feature>/{data,domain,presentation}`.
- **data:** a repository wrapping the generated client, plus a Drift cache where allowed.
- **domain:** immutable view models and server-provided enums. No business state machine.
- **presentation:** Riverpod providers and widgets.

`go_router` handles the route tree, with redirects driven by an auth-state provider. Deep links:
- `edmn.eg/i/{token}` for seller invitations
- `/deal/{id}`
- `/order/{id}`
- verified App Links (Android) and Universal Links (iOS)

### 9.4 Dependency evaluation

Every dependency must justify itself.

| Package | Decision | Reason / constraint |
|---|---|---|
| Flutter stable / Dart stable | **Adopt.** Pin exact versions in `.fvmrc` or CI | Reproducible builds |
| `flutter_riverpod` (+ `riverpod_generator`) | **Adopt** | Compile-safe DI and state, easy to test with overrides |
| `go_router` | **Adopt** | Declarative routes, redirects for auth, deep links for invitations |
| `dio` | **Adopt** | Interceptors for the auth refresh mutex, `Idempotency-Key`, `If-Match`, correlation IDs and retry policy (GET only) |
| OpenAPI codegen | **Spike first (MOB-004).** Candidates: `openapi-generator` (`dart-dio`) or `swagger_parser` + `freezed`/`json_serializable` | OpenAPI 3.1 support varies by generator. Validate with the real spec, including enums, `oneOf` and nullable fields |
| `freezed` + `json_serializable` | Adopt (if the generator does not emit them) | Immutable models |
| `drift` | **Adopt, limited scope.** Customer: catalog and category cache, drafts (product listing draft, dispute draft), search history. **Never** an authoritative balance, deal state or OTP. Admin: **no disk cache of PII or KYC**; in-memory only | Non-authoritative cache. Stale data is labelled with "updated at" |
| `flutter_secure_storage` | **Adopt** | Keychain (`first_unlock_this_device`, not synced) and Android Keystore-backed storage. Tokens only |
| `local_auth` | Adopt | Biometric gate on app resume and before step-up. **A convenience only.** The server still requires TOTP or OTP for step-up |
| `firebase_messaging` (FCM + APNs) | Adopt | Payloads carry IDs and generic text only. No PII, OTPs or amounts on the lock screen (D-12) |
| `sentry_flutter` | **Adopt** (the web already uses Sentry) | `beforeSend` and `beforeBreadcrumb` scrubbing. No HTTP bodies. Session replay off |
| `intl` + `flutter_localizations` (ARB) | Adopt | ar (default) and en. EGP formatting `ar-EG` / `en-EG` |
| `image_picker` / `camera` + `flutter_image_compress` | Adopt (KYC, evidence) | EXIF and GPS stripped before upload. Direct upload to a signed URL |
| `url_launcher`, `share_plus` | Adopt | Invitation link sharing |
| Certificate pinning (SPKI, with backup pins) | **Admin: adopt. Customer: evaluate** | Pinning can brick clients on certificate rotation. Needs a pin-rotation runbook |
| Screen-capture protection (`FLAG_SECURE`, iOS secure-field overlay) | Admin: KYC, ledger and payout screens. Customer: the OTP display screen | Prevents leaks through screenshots and the app switcher |
| Root/jailbreak detection, Play Integrity / App Attest | **P2, evaluate** | Signal to the server, not a client-side block |
| Fastlane + GitHub Actions | Adopt | Build, sign, upload. Separate lanes and secrets per app |
| State machine, analytics or UI kit packages | **Reject** | The server owns the state machine. Analytics is consent-gated and decided later. The UI kit is our own design system |

### 9.5 Client rules (non-negotiable)

- Clients never compute authoritative totals, fees, balances or state transitions. They display server-provided `amount_piastres`, `fee_piastres`, `allowed_actions` and `deadlines`.
- Every mutating request sends `Idempotency-Key` (a UUIDv4 generated once per user intent and persisted across retries). Aggregate updates send `If-Match: <version>`.
- `409`/`412` responses trigger a refetch and a "this item changed" UX. The client never silently overwrites.
- Admin sensitive actions follow this flow: server returns `401 step_up_required`, the user completes step-up (biometric unlock, then TOTP), the server issues a scoped step-up token, and the client retries with the same idempotency key.
- Logout and remote revoke wipe secure storage and the Drift database (customer) and clear all in-memory providers.

---

## 10. Design system plan (Phase 0I)

Specification only. Widgets are not implemented. The tokens are derived from the existing web `DESIGN_SYSTEM.md` v2.0.0 in `edmn-eg-nextjs`, so brand continuity is preserved.

| Aspect | Specification |
|---|---|
| **Colors** | Brand `#1A57A1` (dark `#0E3A72`, light `#3B82F6`). Accent `#E8341C` (urgency only, never for money). Ink `#060A0F`. Paper `#FFFFFF` / `#F7F8FA` / `#F1F3F6`. Text `#09090B` / `#52525B` / `#A1A1AA`. Success `#16A34A`, warning `#D97706`, error `#DC2626`. Add **info** `#0891B2` and a **neutral-hold** `#7C3AED` for the `ON_HOLD` and `DISPUTED` states. Light and dark `ThemeExtension`s. Every pair is checked at 4.5:1 or better |
| **Typography** | Arabic-first family with full Latin coverage and tabular numerals: **IBM Plex Sans Arabic** or **Cairo** (D-13), bundled offline. Scale: display 32/40, title-lg 22/30, title-md 18/26, body-lg 16/26, body-md 14/22, caption 12/18, overline 11/16. Arabic line-height +10 %. Money uses tabular figures. Digits: Western Arabic (0-9) by default for money and OTP in both locales, with an Eastern Arabic option as a user setting (D-14) |
| **Spacing** | 4 pt grid: 4, 8, 12, 16, 20, 24, 32, 40, 48. Screen gutter 16. Section gap 24 |
| **Radius** | xs 6, sm 10 (inputs), md 14 (sheets, dialogs), lg 16 (cards), full (pills, badges) |
| **Buttons** | primary, secondary (outline), tertiary (text), destructive, plus **financial-confirm** (primary with a hold-to-confirm or explicit confirmation sheet). Sizes 40/48/56. Minimum touch target 48×48 dp. States: loading (spinner, disabled, idempotent), disabled with a reason tooltip |
| **Inputs** | Text, phone (`+20` prefix, Egyptian mobile validation), OTP (6 cells, autofill `oneTimeCode`, paste support, LTR digits inside RTL), money (EGP, integer piastres internally, no negative), governorate picker, date, file/evidence picker. Error text below the field with a semantics label |
| **Cards** | Product, store, order, deal (state badge, counterparty, amount, next-action CTA), ledger line (admin), queue item (admin, SLA timer) |
| **Status badges** | One mapping table from server state to `{label_ar, label_en, color, icon}`, generated from the OpenAPI enum. Unknown states render a neutral "Updated status" badge, never crash. The client never infers meaning beyond the label |
| **Money formatting** | `EGP`/`ج.م` suffix by locale, thousands separators, 2 decimals (piastres). Negative values only appear in admin ledger views, with a sign and color. **Display only.** Values come from the server in piastres |
| **Tables** (admin) | Mobile tables become key-value cards with expandable rows. Landscape or tablet shows a column layout. Sticky header, sort, filter chips, CSV export only through the server (audited) |
| **Timelines** | Deal and order history from `pt_state_history`: actor, time (relative plus absolute on tap), evidence links. RTL mirrors the rail side |
| **Bottom sheets** | Action sheets for `allowed_actions`. Confirmation sheets for money actions show amount, counterparty and consequence text |
| **Dialogs** | Only for destructive or irreversible confirmations, and step-up prompts |
| **Loading** | Skeletons for lists and detail views. Inline spinners on buttons. Never block the whole screen for background refresh |
| **Empty states** | Illustration (optional), a one-line reason and a primary next action |
| **Errors** | Typed from the API problem+json (`type`, `title`, `code`, `trace_id`). Retry for network errors. "Contact support" carries the `trace_id`. Never show stack traces |
| **Arabic RTL / English LTR** | `Directionality` from the locale. Use only `EdgeInsetsDirectional` and `AlignmentDirectional`. Mirror directional icons. Phone numbers, OTPs, IBANs and amounts stay LTR inside RTL text. Golden tests in both directions |
| **Accessibility** | Dynamic type up to 200 % without clipping, TalkBack and VoiceOver labels, Arabic as well as English semantics labels, focus order, reduced motion, haptics on success and failure, color never the only signal |
| **Responsive** | Phone first. Tablet uses a two-pane layout (list/detail) for Seller Center and Admin. Breakpoints 600 / 840 dp. Landscape for admin tables |

---

## 11. Reuse strategy (Phase 0K)

| Asset | Reuse | Action |
|---|---|---|
| Users, orders, Protected Deals, payments, ledger, wallet, withdrawals, disputes, seller data | **Nothing to reuse. None exists.** | Build **once**, in the canonical backend. The mobile apps, the Web Admin and any future channel consume the same APIs. **There will be one source of truth.** No mobile-specific ledger, user store or order store |
| Brand tokens (`edmn-eg-nextjs/DESIGN_SYSTEM.md`, `tokens.css`) | **Reusable unchanged** as values | Port to Dart `ThemeExtension` (DS-001) |
| Arabic and English copy (`src/locales/*.json`) | Partly reusable (marketing, FAQ, legal phrasing) | Copy relevant strings into ARB. The legal pages need review (§12, D-06) |
| Legal pages (terms, privacy, refund) | Reuse by **link**, rendered from a CMS endpoint later | Content needs legal update for OTP, holds and settlement timing |
| Contact form pattern (zod validation, honeypot, Upstash rate limit) | **Pattern reuse only** | Becomes `API-SUP-01` (pre-auth ticket) in the backend |
| Sentry org | Reuse the org, with new projects | Separate DSNs per app |
| CI patterns (GitHub Actions typecheck → test → build) | Pattern reuse | New workflows in `edmn-platform` |
| Airtable leads | **Do not import as users** | Optionally invite leads to sign up, subject to consent (D-15) |

**Classification:**

- **Reusable unchanged:** brand tokens and the Egyptian market identity.
- **Requires API exposure:** none, because there is no backend.
- **Requires hardening:** the contact-pattern rate limiting (fail-closed for abusive volume) and PII logging.
- **Requires refactoring:** `RegisterForm` calling `storeLead` from a client component.
- **Missing:** everything in §2 marked MISSING.

---

## 12. Security findings

### 12.1 Existing code

None of these touch money, because no money code exists.

| ID | Severity | Repo / file | Finding | Recommendation (not applied) |
|---|---|---|---|---|
| S-01 | Medium | `edmn-eg-nextjs/src/app/[locale]/register/RegisterForm.tsx` | A `'use client'` component imports `storeLead` from `src/lib/airtable.ts`, which reads `AIRTABLE_API_KEY`. In the browser that variable is undefined, so **registration leads never reach Airtable** (a silent functional failure). If anyone "fixes" this by renaming the key to `NEXT_PUBLIC_*`, the Airtable token would ship to every visitor | Move the call server-side (the API route already calls it for contact). Add `import 'server-only'` to `airtable.ts` |
| S-02 | Medium | Website copy (both repos) | The site advertises live App Store and Google Play apps, "256-bit bank encryption", "100 % guaranteed protection", "instant" seller payout, and Fawry/ValU/Banque Misr partnerships. None of these is implemented. This is a consumer-protection and regulatory exposure, and a trademark question for the partner logos | Owner and legal review of claims before launch (D-06). Out of scope for mobile changes |
| S-03 | Low | `edmn-eg/src/app/api/contact/route.ts` | The in-memory rate limiter is ineffective on serverless and multi-instance deployments. `edmn-eg-nextjs` already fixed this with Upstash | Retire E1, or port the Upstash limiter |
| S-04 | Low | Both contact routes | Keyed on the first `X-Forwarded-For` value, which can be spoofed unless the edge overwrites it | Use the platform-provided client IP (e.g. `x-vercel-forwarded-for` / `request.ip`) |
| S-05 | Low | `edmn-eg-nextjs/src/lib/rate-limit.ts` | **Fails open** when Upstash is not configured | Acceptable for a marketing form. **Must not be copied** into backend auth or OTP limiters, which must fail closed |
| S-06 | Low | `edmn-eg-nextjs` contact route, `airtable.ts` | Full e-mail addresses in info logs (PII) | Hash or mask e-mails in logs |
| S-07 | Low | `edmn-eg/src/app/api/contact/route.ts` | Hardcoded fallback Formspree endpoint in source | Use env only (as `edmn-eg-nextjs` does) |
| S-08 | Low | `edmn-eg-nextjs/src/app/api/health/route.ts` | Unauthenticated. Makes outbound calls per request and discloses configuration state | Return a shallow `ok` publicly. Move the deep check behind a secret or internal network |
| S-09 | Info | `edmn-eg/next.config.ts` | CSP allows `'unsafe-eval'` and `'unsafe-inline'` scripts | Use nonce-based CSP later. Marketing only |

### 12.2 Design-level security requirements for the new build

These appear in the backlog as P0 tickets.

| ID | Requirement |
|---|---|
| SD-1 | **Separate identity planes.** Customer and staff are separate tables, token audiences, signing keys and API hosts. A customer token can never call `/admin/*`, and the reverse also holds. |
| SD-2 | **Tokens.** Short-lived access JWT (≤ 10 min), opaque rotating refresh token with reuse detection that kills the whole family, and a device-bound session row that can be revoked remotely. |
| SD-3 | **Admin MFA.** TOTP or WebAuthn passkey is mandatory at enrollment. **No SMS for staff.** Fresh step-up (≤ 5 min, action-scoped) for every action marked "Fresh 2FA" in the screen map. |
| SD-4 | **Authorization.** Server-side, deny-by-default permission checks per endpoint, plus row-level ownership checks (buyer, seller or store member) in the service layer. UI hiding is cosmetic only. |
| SD-5 | **Private evidence and KYC.** Private bucket, signed GET URLs (≤ 5 min), an access-audit row per view, a watermark overlay on admin view, and no caching on device. |
| SD-6 | **Logging.** A central redaction list (otp, code, pin, password, token, national_id, iban, card, authorization). No request-body logging on auth, OTP or payout routes. Sentry scrubbing on all three clients. |

---

## 13. Decisions needed from the owner

| ID | Decision | Blocking |
|---|---|---|
| **D-01** | **Where is the EDMN platform backend?** Provide access, or confirm it must be built | **Everything** |
| D-02 | Approve the backend stack (§8) | Sprint 1 |
| D-03 | Legal model for holding funds (CBE licensing; partner bank or PSP safeguarding account), and which PSP(s) | Payments, ledger mapping |
| D-04 | Hosting region and data residency (PDPL 151/2020) | Infrastructure |
| D-05 | Fee rules: 5 %/3 %, who pays, rounding, minimum fee, shipping fee treatment, VAT on fees | Ledger, checkout |
| D-06 | Legal review of website claims, terms (OTP, holds, settlement timing, auto-confirm) | Launch |
| D-07 | Timeouts: invitation, offer, payment, ship-by, OTP TTL, inspection window, dispute evidence window (48 h per terms), auto-settle threshold, seller withdrawable hold period | State machine |
| D-08 | Monorepo (`edmn-platform`) or separate repos | Repo setup |
| D-09 | Bundle IDs, store accounts, developer team ownership | Builds |
| D-10 | Admin App distribution channel (private or MDM) | Admin release |
| D-11 | Real-money go-live criteria. **Stays OFF until explicitly authorized** | Launch |
| D-12 | Notification content policy (lock-screen privacy) | Notifications |
| D-13 / D-14 | Font family; digit style for Arabic UI | Design system |
| D-15 | What to do with existing Airtable leads | Growth |
| D-16 | KYC provider (or manual review only at launch), and which documents (national ID front/back, selfie, commercial registry for merchants) | Seller onboarding |
| D-17 | Whether marketplace checkout supports multi-seller in one payment (one payment split into N PTs) at launch | Checkout |

---

## 14. Recommended first sprint

The full plan is in `MOBILE_BACKLOG.md`.

**Sprint 1, "Canonical Core"** (2 weeks, after D-01, D-02 and D-08 are approved):
- **Backend:** identity skeleton (customer phone-OTP login, staff login with TOTP), sessions and refresh rotation, deny-by-default RBAC, append-only audit, idempotency middleware, problem+json errors, OpenAPI 3.1 generation, plus a breaking-change check in CI.
- **Ledger kernel:** `post(journal)` with invariants I-1 to I-6, DB triggers, and property-based tests (random journals never unbalance and never mutate).
- **Mobile:** create the monorepo shell (two app shells, flavors, separate IDs), the secure storage package, the generated API client spike (MOB-004), design tokens, and ar/en localization scaffolding. **No business screens.**
- **Real money:** OFF. No PSP credentials anywhere.

---

## 15. Change verification

- No production files changed. The website source, `next.config.ts`, `package.json` and `public/` are untouched.
- No database schema or migrations were created. No database exists.
- No deployment configuration changed. No CI workflows were added or modified.
- No existing application behaviour changed.
- `edmn-eg-nextjs` was attached **read-only** and inspected through the GitHub API. Nothing was written to it.
- The only change is the new folder `docs/mobile/` (4 Markdown files) on branch `claude/awesome-davinci-ojxuul`.

**Stop point:** Phase 0 is complete. Phase 1 will not start without explicit approval and answers to at least D-01, D-02 and D-08.
