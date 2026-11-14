# EDMN Mobile: Implementation Backlog

> **⚠️ SUPERSEDED (2026-10-20).** This v1 document audited the marketing-site `main` branch and wrongly concluded that no EDMN backend exists. The EDMN Marketplace platform lives on branch `claude/great-tesla-nor0wt` (baseline `48ae40c`). Use [`MOBILE_BACKLOG_V2.md`](./MOBILE_BACKLOG_V2.md) and [`MOBILE_API_EXTRACTION_PLAN.md`](./MOBILE_API_EXTRACTION_PLAN.md). This file is kept unchanged below for audit history.

Companion to `MOBILE_PHASE_0_AUDIT.md` (Phase 0J). Ordered by dependency. **Nothing here is approved or started.**

Phase 1 starts only after explicit owner approval and answers to **D-01** (backend location), **D-02** (stack) and **D-08** (repo layout).

**Assumption.** D-01 confirms that no backend exists elsewhere. If an existing backend is found, the BE-*, FIN-* and PT-* tickets become "audit, expose and harden" tickets, and this backlog will be re-planned.

**Ticket prefixes:**

| Prefix | Area |
|---|---|
| GOV | Governance |
| BE | Backend platform |
| FIN | Ledger and finance |
| PT | Protected Transaction |
| MKT | Marketplace |
| SEL | Seller |
| ADM | Admin backend |
| MOB | Mobile foundation |
| DS | Design system |
| CUS | Customer App |
| SC | Seller Center |
| ADA | Admin App |
| WEB | Web Admin |
| OPS | DevOps / release |
| SEC | Security |

**Risk:** H = high, M = medium, L = low.

**Rules that apply to every ticket** (Definition of Done):

- Code reviewed.
- OpenAPI updated, with the breaking-change check passing.
- Tests listed in the ticket are green in CI.
- No secrets in the repo.
- Logs redact the SD-6 field list.
- ar and en strings are present.
- RTL golden tests pass for any UI.
- Real money stays OFF.

---

## P0: Foundation, security and financial safety

| ID | Title | Scope | Deps | Acceptance criteria | Risk | Tests required |
|---|---|---|---|---|---|---|
| GOV-01 | Confirm backend existence and location (D-01) | Owner provides access to any existing platform code, or confirms greenfield | — | Written decision recorded in `docs/mobile/DECISIONS.md` | **H** (all work depends on it) | — |
| GOV-02 | Legal and regulatory model for held funds (D-03, D-04) | Counsel opinion on CBE licensing and safeguarding, PSP or bank partner selection, data residency under PDPL 151/2020 | GOV-01 | Signed-off memo. Bank account structure mapped to ledger accounts 1010/1020 | **H** | — |
| GOV-03 | Business rules sign-off (D-05, D-07, D-17) | Fees (5 %/3 %, payer, rounding, VAT), all timeouts and thresholds, multi-seller payment model | GOV-01 | `BUSINESS_RULES.md` approved, with every value referenced as a setting key | H | — |
| GOV-04 | ADRs for stack and repo layout (D-02, D-08) | ADR-001 backend stack, ADR-002 monorepo, ADR-003 single PT core, ADR-004 ledger design | GOV-01 | ADRs merged and approved | M | — |
| BE-01 | Platform repo and CI skeleton | Create `edmn-platform` monorepo, backend service skeleton, Postgres via docker-compose, lint, typecheck and test pipelines, CODEOWNERS (finance paths need 2 reviewers) | GOV-04 | CI green on an empty service. Branch protection on `main` | L | CI smoke |
| BE-02 | Error model, request context, logging redaction | problem+json, `trace_id` propagation, structured logger with redaction list (SD-6) | BE-01 | Every error carries `code` and `trace_id`. Redaction covers the listed keys | M | Unit tests: redaction of nested `otp`, `token`, `iban` keys. Snapshot of error shape |
| BE-03 | OpenAPI 3.1 generation and contract CI | Schema-first route definitions, generated `customer.v1.yaml` and `admin.v1.yaml`, breaking-change diff check (e.g. oasdiff) | BE-01 | CI fails on an unannounced breaking change. Two specs are physically separate | M | Contract test that the spec validates. Diff check job |
| BE-04 | Idempotency middleware | `Idempotency-Key` table, request-hash match, response replay, `422` on payload mismatch, TTL purge | BE-01 | The same key gives the same response. A different payload gives `422`. Concurrent duplicates execute once | **H** | Concurrency test (N parallel identical requests → 1 execution). Property test |
| BE-05 | Optimistic concurrency helpers | `version` columns, `If-Match` / `412` handling | BE-01 | Stale update gives `412` and no write | M | Unit and integration tests |
| BE-06 | Transactional outbox and job runner | Outbox table, dispatcher with exactly-once semantics, scheduled jobs framework | BE-01 | An event written in the same transaction as the state change. A dispatcher crash causes no loss or duplicates | H | Crash-recovery integration test |
| SEC-01 | Customer identity: phone OTP login | API-AUTH-01..05. HMAC'd OTP, per-phone, IP and device rate limits (fail closed), SMS provider adapter (sandbox) | BE-02, BE-04 | Enumeration-safe responses. Max 5 attempts. Rate limits enforced via Redis. OTP never in logs | **H** | Brute-force test, rate-limit test, log-scan test |
| SEC-02 | Sessions, refresh rotation, device registry | JWT access (≤ 10 min), opaque refresh rotation with family reuse detection, sessions and devices, revoke APIs (API-AUTH-06..08) | SEC-01 | A reused refresh token revokes the family. Revoke is effective at most 10 min later (access TTL) | **H** | Token reuse test, revoke propagation test |
| SEC-03 | Staff identity with mandatory MFA | Separate staff table, audience and keys. Password (argon2id) plus TOTP and passkey. Enrollment is enforced. No SMS. API-ADM-AUTH-01..07 | BE-02 | A staff token is rejected on customer routes and the reverse. Login without MFA is impossible | **H** | Cross-audience negative tests. MFA bypass tests |
| SEC-04 | Step-up (fresh auth) framework | Action-scoped step-up tokens (≤ 5 min, single action class), `401 step_up_required` contract, for customers and staff | SEC-02, SEC-03 | A sensitive endpoint rejects without a fresh grant, and rejects a grant for a different action | H | Negative tests per sensitive endpoint (generated from the route registry) |
| SEC-05 | RBAC and ownership authorization | Permission registry, deny-by-default guard, role → permission tables, row-level ownership helpers (buyer, seller, store member) | SEC-02, SEC-03 | Every route declares a permission or ownership rule. CI fails if a route is undeclared | **H** | Route-coverage test. IDOR test suite (user A cannot read B's resources) |
| SEC-06 | Immutable, hash-chained audit trail | `audit_events` INSERT-only (DB grants plus trigger), hash chain, daily WORM export job | BE-01 | UPDATE and DELETE fail at DB level. Chain verification detects tampering | H | Tamper test. Grant test |
| SEC-07 | Private object storage and signed URLs | Purpose-scoped upload URLs (API-UPL-01), MIME and size allow-list, malware scan hook, signed GET ≤ 5 min, access-log rows | BE-01 | No public bucket access. Expired URL gives `403`. Each view is logged | H | Integration tests against MinIO. Expiry test |
| FIN-01 | Ledger kernel | Chart of accounts (audit §6.3), journals and lines, `ledger.post(cmd)` sole writer, deferred balance trigger, INSERT-only grants, `posting_key` uniqueness, reversal API | BE-04, BE-05 | Invariants I-1 to I-6 hold. An unbalanced journal is rejected by the DB even when application checks are bypassed | **H** | **Property-based tests** (random postings keep Σ = 0 and never mutate). Direct-SQL bypass tests. Concurrency (parallel postings on one account) |
| FIN-02 | Balance projections and verifier | `account_balances` updated in the same transaction. Nightly recompute and drift alert (API-INT-06) | FIN-01 | Drift = 0 after a 10k random-posting simulation | H | Simulation test |
| FIN-03 | Maker/checker framework | `approval_requests`, payload-hash binding, DB CHECK maker ≠ checker, expiry, step-up on decision (API-ADM-03) | SEC-04, SEC-05, SEC-06 | Self-approval is impossible (DB and service). Payload edits invalidate the approval | **H** | Self-approval negative tests (API and direct SQL). Payload-tamper test |
| FIN-04 | Real-money kill switch | `real_money_enabled` setting (default false), dual super-admin plus checker to change, PSP live credentials only loadable when true, app-config exposure | FIN-03 | With the switch OFF, live PSP calls are impossible (adapter refuses). The switch change is audited | **H** | Tests that the adapter refuses live mode. Approval-flow tests |
| PT-01 | Protected Transaction state machine core | States and transitions per audit §7.3, guard functions, `allowed_actions` projection per actor, `pt_state_history`, deadlines table | FIN-01, BE-06 | Every transition is table-driven and tested. Illegal transitions give `409`. Clients get `allowed_actions` | **H** | Exhaustive transition-matrix tests (every state × action × actor). Model-based tests |
| PT-02 | Delivery OTP service | Audit §7.4: CSPRNG, KMS-peppered HMAC, TTL, atomic single use, attempt and rate limits, buyer reveal and re-issue, admin force re-issue, no read path for seller or admin | PT-01, SEC-04 | All §7.4 requirements verified. No OTP in logs, Sentry or push payloads | **H** | Brute-force, race (two parallel verifies → one success), log-scan and expiry tests |
| PT-03 | PT ↔ ledger integration | Funding, settlement, refund, split and hold postings with deterministic posting keys. I-5 and I-7 guards under row lock | PT-01, FIN-01 | A double webhook or double confirm posts once. Release while disputed is impossible | **H** | Replay tests. Concurrent confirm-vs-dispute race test |
| MOB-001 | Mobile monorepo and toolchain | `mobile/` workspace (pub workspaces or melos), pinned Flutter (FVM), analysis options (strict), very_good_analysis or equivalent | GOV-04 | `flutter analyze` and `flutter test` run in CI for all packages | L | CI |
| MOB-002 | Two app shells with flavors and identities | `customer_mobile` and `admin_mobile`, dev/staging/prod flavors, distinct bundle IDs (D-09), app names and icons, separate Firebase and Sentry config files (not committed for prod) | MOB-001 | Four distinct installable identities per platform. Admin and customer can co-exist on one device | M | Build matrix in CI |
| MOB-003 | Security package | Secure storage wrapper (Keychain `first_unlock_this_device`, Keystore), token store, logout wipe, biometric gate, screen-protect helpers, log redaction | MOB-001 | Tokens never in SharedPreferences or files. Logout wipes everything | H | Unit tests with platform fakes. Integration test on emulator |
| MOB-004 | OpenAPI client generation spike | Evaluate `openapi-generator dart-dio` vs. `swagger_parser`+`freezed` against `customer.v1.yaml` (enums, oneOf, nullable, problem+json) | BE-03, MOB-001 | Written recommendation. Generated clients compile. Admin client is a separate package not depended on by the customer app | M | Generated-code compile and test in CI |
| MOB-005 | Networking core | Dio setup: auth interceptor with refresh mutex, Idempotency-Key per intent, If-Match, correlation ID, retry policy (GET only), problem+json mapping, `step_up_required` hook | MOB-003, MOB-004 | Parallel 401s cause one refresh. Mutations never auto-retry without the same key | H | Unit tests with mock adapter |
| MOB-006 | Observability package | Sentry init with scrubbing (`beforeSend` and breadcrumbs), no HTTP bodies, release and environment tags, consent-gated analytics facade (no-op) | MOB-001 | A scan test proves redacted keys never leave the device | M | Unit test on event scrubbing |
| DS-001 | Design tokens and themes | Port web tokens (audit §10) to `ThemeExtension`. Typography with chosen font (D-13). Light and dark | MOB-001 | Tokens match the spec. Contrast checks pass | L | Golden tests (ar RTL, en LTR, light and dark) |
| DS-002 | Localization package | ARB ar (default) and en, ICU plurals, EGP money formatter (display only), digit policy (D-14), directional helpers | MOB-001 | No hardcoded user-facing strings (lint). Money formatting matches the spec | L | Unit tests for formatter. Lint rule |
| OPS-01 | Mobile CI/CD | GitHub Actions: analyze, test and build per app and flavor. Fastlane lanes. Signing via CI secrets. Separate secret scopes per app | MOB-002 | Tagged builds produce signed artifacts for internal tracks only | M | Pipeline dry runs |

## P1: Launch-critical

| ID | Title | Scope | Deps | Acceptance criteria | Risk | Tests required |
|---|---|---|---|---|---|---|
| BE-10 | Accounts, addresses, governorates | API-ACC-*, API-CAT-07, seed of the 27 governorates | SEC-05 | CRUD with ownership and versioning | L | API and IDOR tests |
| SEL-01 | Seller application and KYC | API-SEL-01..02, API-KYC-01..04, private documents, status machine | SEC-07 | No document readable by the applicant after submit. Statuses audited | H | Authorization and storage tests |
| SEL-02 | Stores, members, shipping rates | API-SEL-03..06, API-SHP-01..03 | SEL-01 | Rates unique per governorate. Member permissions enforced | M | API tests |
| MKT-01 | Catalog and moderation | Products, variants, media, new/used condition, moderation states, search index. API-CAT-*, API-SPR-* | SEL-02 | Unmoderated products are never public | M | API and search tests |
| MKT-02 | Inventory and reservations | Levels, reservations with TTL, oversell protection | MKT-01 | Concurrent checkouts never oversell | **H** | Concurrency test |
| MKT-03 | Cart and multi-seller checkout | API-CART-*, API-CHK-*, server pricing, fee quote freeze, seller-group split into N orders/PTs (D-17) | MKT-02, PT-01, GOV-03 | Totals are server-computed. A client price is ignored. An expired checkout releases stock | **H** | Price-tamper tests. Expiry job tests |
| PAY-01 | PSP adapter (sandbox) and webhooks | Payment intents, hosted checkout, webhook verify and dedup, provider re-fetch, API-PAY-*, API-INT-01 | PT-03, FIN-04, GOV-02 | Forged or replayed webhooks are rejected. An amount mismatch goes to manual verification | **H** | Signature, replay and amount-mismatch tests |
| PT-10 | Protected Deal negotiation | API-DEAL-*, API-SDEAL-*, invitations (hashed, single use), versioned offers, frozen agreement with hash | PT-01 | A stale offer cannot be accepted. The agreement is immutable at DB level | H | Transition, race and immutability tests |
| PT-11 | Fulfilment, OTP, receipt and auto-confirm | API-SOR-04..06, API-PT-*, deadline jobs | PT-02, PT-03 | Ship-by and inspection-window timeouts behave per GOV-03 | H | Time-travel tests for deadlines |
| PT-12 | Disputes, returns and replacements | API-DSP-*, API-RET-*, API-SOR-07..09, holds, 48 h evidence clocks | PT-11, FIN-03 | Opening a dispute blocks settlement atomically. Decisions post the correct journals | **H** | Race (confirm vs. dispute), posting-correctness tests |
| FIN-10 | Settlement runner | Auto below threshold, maker/checker above. API-INT-03, API-FIN-08..10 | PT-03, FIN-03 | No double settlement. I-7 enforced | **H** | Replay and concurrency tests |
| FIN-11 | Seller balance, withdrawals and payouts | API-SBAL-*, API-FIN-11..13, payout account cooling-off, maker/checker | FIN-10, SEC-04 | Withdrawal ≤ available under lock. Self-approval impossible | **H** | Overdraw race test. Self-approval tests |
| FIN-12 | Reconciliation v1 | Statement import, matcher, breaks, payout auto-pause. API-FIN-14..16, API-INT-05 | PAY-01, FIN-11 | An aged break pauses payouts | H | Fixture-based recon tests |
| FIN-13 | Finance read APIs | API-FIN-01, API-FIN-04..07, API-WAL-* | FIN-02 | Read-only. Projections match the ledger | M | Consistency tests |
| BE-11 | Notifications | Outbox to FCM/APNs, SMS and e-mail. Templates in ar and en. Lock-screen-safe payloads (D-12). API-NTF-* | BE-06 | No OTP, amount or PII in push payloads | M | Payload lint test |
| BE-12 | Support tickets | API-SUP-* (replaces the website contact relay for app users), API-ADM-SUP-* | SEC-05 | Ticket IDs. `trace_id` linkage | L | API tests |
| ADM-01 | Admin backend: queues and 360 views | API-ADM-01..03, USR, KYC, SEL, PRD, ORD, PT, DSP | FIN-03, SEC-06 | Every sensitive action enforces step-up and audit. PII masked by default | H | Permission matrix tests. Audit-presence tests |
| ADM-02 | Admin backend: staff, roles, settings, audit, system health | API-ADM-STF-*, SET-*, AUD-*, SYS-01 | ADM-01 | Role grants need a checker. Real-money change needs 2 super-admins | H | Governance tests |
| CUS-01 | Auth and onboarding screens | APP-01, AUTH-01..05, LEG-01 | MOB-005, DS-001/002, SEC-01/02 | Full flow on device in ar and en | M | Widget, golden and integration tests (mock server) |
| CUS-02 | Browse | HOME-01, CAT-01/02, SRCH-01/02, PRD-01, STR-01 (Drift cache) | CUS-01, MKT-01 | O1 offline behaviour works | L | Widget and golden tests |
| CUS-03 | Cart, checkout and payment | CART-01, CHK-01..03, PAY-01..03 (with test-mode banner) | CUS-02, MKT-03, PAY-01 | No client totals. Idempotent pay. Banner shown when real money is OFF | H | Integration tests: double-tap pay creates one intent |
| CUS-04 | Orders and PT views | ORD-01/02, PT-01..03 | CUS-03, PT-11 | Actions rendered only from `allowed_actions`. OTP screen protected (X1/X2/X3) | H | Golden tests per state. Screenshot-flag test |
| CUS-05 | Protected Deals (buyer) and invitation deep links | DEAL-01..06, INV-01, Universal and App Links | PT-10 | Invitation links open the app or fall back to store pages | H | Deep-link integration tests |
| CUS-06 | Returns, replacements and disputes | RET-01..03, DSP-01..03 | PT-12 | Evidence upload strips EXIF | M | Widget tests. EXIF test |
| CUS-07 | Account, security, notifications, support, balances | ACC-01..08, NTF-01/02, SUP-01..03, WAL-01/02 | BE-10, BE-11, BE-12, FIN-13 | Logout wipes. Revoke-all works | M | Integration tests |
| SC-01 | Seller onboarding | SC-00..03 | SEL-01 | KYC capture protected. Temp files deleted | H | Widget tests. File-cleanup test |
| SC-02 | Seller catalog, store and shipping | SC-20..23, SC-60..62 | SEL-02, MKT-01 | 27-governorate bulk edit | M | Widget and golden tests |
| SC-03 | Seller orders, fulfilment and OTP entry | SC-30..35 | PT-11, PT-12 | The seller never sees the OTP | H | Widget tests. API-contract test |
| SC-04 | Seller deals and offers | SC-40..42 | PT-10 | Offer version conflicts are handled (R3) | M | Widget tests |
| SC-05 | Seller money | SC-50..54 | FIN-11 | Step-up and cooling-off displayed. No client balance math | H | Widget tests |
| ADA-01 | Admin App auth, MFA and step-up | ADM-01..03, ADM-SU, ADM-90/91 | SEC-03, SEC-04, MOB-005 | MFA enforced. Auto-lock. X1 on all PII screens | H | Integration tests |
| ADA-02 | Admin queues and 360 views | ADM-10, 11, 20–25, 30–33, 40–45 | ADM-01, ADA-01 | Launch-critical ops completable on a phone | H | E2E against staging |
| ADA-03 | Admin finance | ADM-50–59 | FIN-10..13, ADA-01 | Maker/checker flows and step-up | **H** | E2E with two staff accounts |
| ADA-04 | Admin governance and platform | ADM-60–63, 70–75, 80, 81 | ADM-02, ADA-01 | The real-money switch requires a dual approval flow | H | E2E |
| SEC-10 | Security review and pentest before beta | Threat model (STRIDE) for auth, PT, OTP, ledger and admin. External pentest of API and both apps (MASVS L2 for admin) | All P1 backend | No open high or critical findings | **H** | Pentest report |
| OPS-10 | Store readiness | Privacy labels, data-safety form, account deletion, Arabic store listings, private distribution for the Admin App (D-10) | CUS-*, ADA-* | Internal and beta tracks approved | M | — |
| GOV-10 | Real-money go-live checklist (D-11) | Recon running ≥ 2 weeks in sandbox, runbooks, on-call, legal sign-off | FIN-12, SEC-10 | Explicit written authorization recorded. **Until then real money stays OFF** | **H** | Dry-run report |

## P2: Operational improvement

| ID | Title | Scope | Deps | Acceptance criteria | Risk | Tests |
|---|---|---|---|---|---|---|
| WEB-01 | Web Admin (desktop) | Next.js admin on the same admin API. Parity for queues and finance. Better bulk recon and reports | ADM-01/02 | Same permissions and audit as mobile | M | E2E (Playwright) |
| FIN-20 | Chargebacks and adjustments workflow | API-FIN-18 full workflow, PSP dispute ingestion | FIN-12 | Compensating journals only | H | Posting tests |
| ADM-20 | Reports and exports | API-ADM-RPT-*, async, watermarked | ADM-02 | Exports audited | M | — |
| ADM-21 | CMS and broadcast | API-ADM-CMS-*, API-ADM-NTF-01 | ADM-02 | HTML sanitized. Broadcasts need a checker | M | XSS tests |
| SEC-20 | Device attestation and app integrity | Play Integrity, App Attest signals to the server (risk scoring, admin login policy) | SEC-10 | Signals logged and enforced for admin | M | — |
| SEC-21 | Certificate pinning (Admin) | SPKI pins with backup pins and a rotation runbook | ADA-01 | Rotation drill passes | M | — |
| MOB-020 | Offline improvements | Larger catalog cache, draft sync | CUS-02 | — | L | — |
| OPS-20 | Observability dashboards and alerts | Queue lag, outbox backlog, recon freshness, projection drift, OTP lockout spikes | FIN-12 | Alerts routed to on-call | M | — |

## P3: Future enhancement

| ID | Title | Notes |
|---|---|---|
| FUT-01 | ValU / BNPL integration | Depends on partner agreement (website claims it; unverified) |
| FUT-02 | In-app buyer–seller chat | Moderation and retention policy needed |
| FUT-03 | Ratings and reviews | Abuse controls |
| FUT-04 | Courier API integrations (live tracking) | Replaces manual evidence where possible |
| FUT-05 | Recommendations and personalisation | Consent-gated analytics |
| FUT-06 | Tablet-optimised Admin layouts | Two-pane everywhere |
| FUT-07 | Customer stored-value wallet / top-up | **Needs separate regulatory approval.** Not assumed |

---

## Proposed sprints

Two-week sprints, assuming the decisions are answered before Sprint 1. Backend and mobile tracks run in parallel. Mobile UI never runs ahead of the API contract: every screen is built against the generated client and a mock server built from the same OpenAPI spec.

| Sprint | Theme | Tickets | Exit criteria |
|---|---|---|---|
| **S0** (pre-approval, decisions only) | Decisions | GOV-01..04 | D-01, D-02, D-03 (initial), D-05, D-07 and D-08 answered |
| **S1** | **Canonical Core** | BE-01..05, SEC-06, FIN-01 · MOB-001, MOB-002, MOB-003, DS-001, DS-002 | Ledger invariants proven by property tests. Contract CI live. Two app shells build |
| S2 | Identity and authorization | SEC-01..05, BE-06, FIN-02 · MOB-004, MOB-005, MOB-006, OPS-01 | Customer OTP login and staff MFA login work end-to-end against the dev backend. IDOR suite green |
| S3 | Maker/checker and the PT core | FIN-03, FIN-04, PT-01, PT-02, SEC-07 · CUS-01, ADA-01 | Self-approval impossible. OTP service passes the abuse tests. Apps can log in |
| S4 | Sellers and catalog | BE-10, SEL-01, SEL-02, MKT-01 · SC-01, SC-02, CUS-02 | Seller can apply, pass KYC (admin via API) and list products |
| S5 | Checkout and payments (sandbox) | MKT-02, MKT-03, PAY-01, PT-03 · CUS-03, ADA-02 (KYC, seller and moderation queues) | Sandbox purchase funds a PT with a correct journal |
| S6 | Protected Deals | PT-10, PT-11 · CUS-04, CUS-05, SC-03, SC-04 | Full deal: request → offer → agreement → pay → OTP → receipt (sandbox) |
| S7 | Disputes and settlement | PT-12, FIN-10 · CUS-06, ADA-02 (disputes, PT 360) | Dispute holds and decisions post correctly. Settlement runs |
| S8 | Withdrawals and reconciliation | FIN-11, FIN-12, FIN-13 · SC-05, ADA-03 | Maker/checker payout in sandbox. Recon matches |
| S9 | Notifications, support and governance | BE-11, BE-12, ADM-02 · CUS-07, ADA-04 | Admin can run every launch-critical operation from a phone |
| S10 | Hardening | SEC-10, OPS-10, bug-bash, performance, accessibility audit | Pentest clean. Store tracks ready |
| S11+ | Closed beta (sandbox money) → GOV-10 | GOV-10, then P2 items | Real money only after explicit written authorization |

---

## Recommended first implementation sprint

**S1, "Canonical Core".** This is the smallest slice that de-risks everything after it:

- **Backend:** repo and CI (BE-01), errors, redaction and `trace_id` (BE-02), OpenAPI 3.1 contract CI (BE-03), idempotency (BE-04), optimistic concurrency (BE-05), immutable audit (SEC-06), **ledger kernel with DB-enforced invariants and property-based tests (FIN-01)**.
- **Mobile:** workspace (MOB-001), two separate app identities with flavors (MOB-002), secure storage and wipe (MOB-003), design tokens (DS-001), ar/en localization (DS-002).
- **Explicitly excluded:** any business UI, any PSP integration, any real money, any change to the marketing website.
