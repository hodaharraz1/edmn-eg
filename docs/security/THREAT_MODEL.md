# EDMN Marketplace — Threat Model

**Scope:**
- Repository `hodaharraz1/edmn-eg`, branch `claude/great-tesla-nor0wt`.
- Staging deployment https://edmn-staging.vercel.app and its Neon database `edmn_staging`.

**Out of scope:** the legacy EDMN system and `api.edmneg.com`.

**Method:** STRIDE per trust boundary, plus financial-abuse analysis ("how could an attacker create, move or withhold money?").

## 1. Assets

| Asset | Where | Sensitivity |
|---|---|---|
| Identities (users, password hashes) | `users` | High |
| Sessions (web + admin) | `sessions` (token hash only); cookies `edmn_sid` / admin cookie | Critical (account takeover) |
| Admin privileges, TOTP secrets | `user_roles`, `role_permissions`, `users.totp_secret_enc` (AES-GCM) | Critical |
| Seller KYC/KYB data | `sellers` (national ID AES-GCM + last 4), `seller_documents` → private files | Critical (legal / identity theft) |
| Payout destinations | `seller_payout_methods.details_enc` (AES-GCM) + masked label | Critical (payout redirection) |
| Payment proofs | `payment_submissions` → private files | High |
| Orders, addresses, shipments, waybills | `orders`, `seller_orders`, `addresses`, `shipments`, `shipment_documents` | High (PII) |
| Returns / disputes / evidence | `returns`, `disputes`, `*_evidence` → private files | High |
| Seller balances | `ledger_accounts` projection (SELLER_PENDING / AVAILABLE / WITHDRAWAL_RESERVED) | Critical (money) |
| Double-entry ledger | `journal_entries`, `journal_lines` (append-only triggers) | Critical (financial truth) |
| Withdrawals / refunds / deal payouts | `withdrawal_requests`, `refunds`, `deal_payouts` | Critical (money leaving) |
| Payment destinations (where buyers pay) | `payment_destinations` | Critical (redirection fraud) |
| Audit logs | `audit_logs` (append-only) | High (non-repudiation) |
| Secrets | Vercel encrypted env: `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, `STAGING_*`, `DATABASE_URL` | Critical |

## 2. Actors

| Actor | Capability | Goals of a malicious instance |
|---|---|---|
| Anonymous visitor | Public pages, registration, login, invitation links | Enumerate accounts, brute force, read private files, XSS |
| Customer | Own cart, orders, payments, returns, disputes, deals | Read others' orders/files (IDOR); fake payment; refund twice; tamper with totals |
| Seller (honest / malicious / compromised) | Own store, products, orders, shipments, balance, withdrawals | Self-approve; credit their own balance; withdraw twice; withdraw before receipt; read other sellers' data; redirect payouts |
| Admin / staff role (SUPER_ADMIN, OPERATIONS, SELLER_REVIEWER, CATALOG_REVIEWER, PAYMENT_REVIEWER, FINANCE_OPERATOR, FINANCE_CHECKER, DISPUTE_OFFICER, CUSTOMER_SUPPORT) | Permission-scoped operations | Exceed their role; act as maker and checker at once; silently alter money or logs |
| Compromised admin | Valid password, maybe a phished TOTP | Change payment destinations; approve their own payouts; erase traces |
| External attacker | Network, public repository (source is public) | Use known default credentials; exploit secrets in Git; CSRF; supply-chain |
| Background worker / cron | System actor | Run the same job twice; race with user actions |

## 3. Trust boundaries

```
 Browser (customer / seller / admin)
   │  HTTPS (Vercel edge, HSTS)          ← TB1: untrusted input, cookies, CSRF
   ▼
 Next.js app (proxy.ts → pages / server actions / route handlers)
   │  actor resolution: customerActor / sellerActor / adminActor (+TOTP, step-up)   ← TB2: authN → authZ
   ▼
 Domain services (src/server/modules/**): validation, state machines, RBAC, ownership checks   ← TB3: business rules
   │  SQL over TLS (pooled)
   ▼
 PostgreSQL (Neon): constraints, FKs, unique and partial indexes, append-only triggers   ← TB4: last line of integrity
   │
   ├─ File storage (stored_objects in PostgreSQL; PUBLIC vs PRIVATE split)   ← TB5: private files only via /api/files/[id] + per-purpose rule
   ├─ Background work (after-response tick, /api/cron/tick with CRON_SECRET)   ← TB6: system actor, retries
   └─ External: SMS/e-mail providers (log driver on staging), future PSP   ← TB7
```

**Surface isolation.** The marketplace, Seller Center (`/seller`) and Admin (`/admin`) share one origin on staging. In production, `ENFORCE_HOSTS=true` puts them on separate hosts with host-only cookies. Admin sessions use a separate cookie and a separate session kind (`ADMIN`) and need a completed TOTP challenge.

## 4. Top threats and their controls

| # | Threat (STRIDE) | Control(s) | Verified by |
|---|---|---|---|
| T1 | Spoofing: default/demo credentials from the public repo | Staging refuses repo defaults; secrets come only from env | E2E + public probe |
| T2 | Spoofing: brute force / credential stuffing on login and 2FA | DB-backed rate limits per IP and per identifier; TOTP limit; replay guard | `tests/integration/auth.test.ts`, security suite |
| T3 | Elevation: customer/seller → admin | Separate admin cookie + session kind; `requireAdmin` + permission per action | `tests/integration/security-gate.test.ts`, E2E security |
| T4 | IDOR on orders, files, deals, withdrawals | Ownership-scoped queries; per-purpose file rules; uniform 404 | privacy-idor + security-gate suites |
| T5 | Tampering: client-submitted totals or status | Server-side pricing; zod allowlists; state machines | integration suites |
| T6 | Financial: double confirm / double credit / double withdrawal | Row locks (`FOR UPDATE`), idempotency keys, unique source references, exactly-once ledger posting | fulfilment-finance + security-gate suites |
| T7 | Repudiation: admin denies an action | Append-only audit log, DB trigger | integration |
| T8 | Information disclosure: KYC/PII | AES-256-GCM at rest, masking, private storage, audited reveal | privacy-idor |
| T9 | Ledger corruption | Balanced-entry check + append-only triggers + reconciliation | ledger tests + reconciliation |
| T10 | Payment-destination swap by a compromised admin | Step-up 2FA, audit, TEST flag, real-money switch blocked on staging | pilot-safety suite |
| T11 | XSS / injection | React escaping, no `dangerouslySetInnerHTML` with user data, parameterized SQL, CSP | code review + probe |
| T12 | Secrets exposure (public repo) | No secrets in Git history; Vercel encrypted env | `SECRET_EXPOSURE_REGISTER.md` |

Detailed findings are in `SECURITY_FINDINGS.md`. The results summary is in `FINAL_SECURITY_REPORT.md`.
