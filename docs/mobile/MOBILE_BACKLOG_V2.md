# EDMN Mobile: Implementation Backlog v2

| | |
|---|---|
| **Status** | Phase 0 v2 planning. **Supersedes** `MOBILE_BACKLOG.md` (v1, which assumed a greenfield backend). Nothing here is approved or started. |
| **Source of truth** | `hodaharraz1/edmn-eg` · `claude/great-tesla-nor0wt` · `48ae40c` |
| **Principle** | Reuse the existing domain services. **No business logic in route handlers.** One canonical database, ledger and state machine. Real money OFF. System A is out of scope. |

**Definition of Done for every ticket:**

- The existing Vitest suite stays green.
- New API tests use the codes from the extraction plan (CT, AZ, PR, RP, CC, SU, MC, LB, SEC).
- The OpenAPI diff is reviewed.
- The lint rule "no DB in `src/app/api/v1/**`" passes.
- No secrets, OTPs or tokens appear in logs or Sentry.
- Every migration is **additive only**. The repo's migration preflight (`B1`) flags destructive statements.

**Risk:** H high · M medium · L low.

---

## P0: Foundation, security and financial safety

These must be done before any endpoint is exposed.

| ID | Title | Scope | Deps | Acceptance criteria | Risk | Tests required |
|---|---|---|---|---|---|---|
| GOV-01 | Platform mainline decision (D-1) | Make `claude/great-tesla-nor0wt` the mainline; decide where the marketing site lives | — | Written decision; Phase 1 branches cut from the platform line | H | — |
| GOV-02 | Product decisions D-3..D-10 | OTP in-app reveal, deal expiry, return of goods, marketplace OTP and replacement, step-up model, real-money dual control, English, store accounts | GOV-01 | `docs/mobile/DECISIONS.md` approved | M | — |
| API-001 | Bearer auth and device sessions | Additive migration: `MOBILE` / `ADMIN_MOBILE` scopes, `devices`, `refresh_tokens` (family). Access-token issue and verify. Reuse `createSession`, `resolveSession`, `login`, `verifyTotpForUser`, `elevateSession`, actor builders | GOV-01 | Mobile actors are identical in shape to web actors. Customer tokens are rejected on admin routes and vice versa. Refresh reuse revokes the family. Disabled user → 401 | **H** | SEC (scope separation, reuse detection, expiry), AZ, unit |
| API-002 | Adapter skeleton | `src/server/api/{http,errors,dto}`, problem+json from `DomainError`, request context (ip, device, channel), lint rule, parity-test harness | API-001 | One sample READY endpoint (`GET /api/v1/catalog/categories`) passes CT + PR. Lint fails on DB imports in `api/v1` | M | CT, PR, lint test |
| API-003 | OpenAPI 3.1 generation | DTO zod schemas → `openapi/mobile.v1.yaml`, `openapi/admin.v1.yaml`; CI diff check | API-002 | Spec validates; breaking change fails CI | M | Contract CI |
| SEC-01 | Fix S-H1 (T-1) | `resolveRiskFlag(actor, …)` service: party check (same rule as `setDealFinancialHold`), step-up, reason, one transaction; web action calls it | — | A party to the deal cannot resolve its delivery-review flag; audit atomic | **H** | AZ, SU, unit; regression on deal release blockers |
| SEC-02 | Session management (X-6) | Self-service list and revoke (one, others); admin revoke-all for user X; audit; transactional `revokeAllSessions` | API-001 | Revoked access stops within the token TTL; actions audited | H | SEC, AZ |
| SEC-03 | Audit channel attribution (X-9) | `Actor.channel`, `Actor.deviceId`; written to audit | API-001 | Every mobile mutation shows channel and device in `audit_logs` | L | Unit |
| SEC-04 | Mobile rate-limit tiers (X-10, S-M3) | Per-device and per-account tiers in the adapter; keep service limits; verify the trusted-proxy setup | API-002 | A CGNAT simulation (many accounts, one IP) is not globally throttled; brute force still limited per account | M | SEC |
| SEC-05 | Generic idempotency (X-5) | Middleware on the existing `idempotency_keys` table for **H** endpoints | API-002 | Same key → same response; different payload → 422 | M | RP, CC |
| RM-01 | Read-model extraction wave 1 (T-6) | Query services with `Actor` + `requirePermission` for: me, orders (customer), deal detail, seller orders, notifications. Pages switched to the same functions (web behaviour unchanged) | API-002 | No page-level-only authorization for these reads; web E2E unchanged | M | AZ (IDOR suite), PR |
| RM-02 | `allowedActions` projection (T-7, X-4) | `allowedActionsFor(actor, entity)` for seller order, order, deal, return, dispute, withdrawal; derived from `machines.ts` and service guards; web pages use it | RM-01 | For every state × role, the projection matches what the service would accept (exhaustive test) | **H** | Model-based test: action allowed ⇔ service call succeeds |

## P1: Launch-critical

| ID | Title | Scope | Deps | Acceptance criteria | Risk | Tests required |
|---|---|---|---|---|---|---|
| API-C1 | Public and catalog endpoints | P-CAT-01..11, P-APP-01 (+ extraction for store, brand, governorates) | API-002, API-003 | Parity with web listings | L | CT, PR |
| API-C2 | Auth and account endpoints | C-AUTH-01..12, C-ACC-01..06 (T-3), C-ADDR-* | API-001, SEC-02 | Login/register/refresh/revoke flows end-to-end | H | SEC, AZ, CT |
| API-C3 | Cart, checkout, orders, payments | C-CART-*, C-WISH-* (T-4), C-CHK-01/02, C-ORD-*, C-PAY-*, C-SO-* | RM-01, RM-02 | `placeOrder` via API ≡ Server Action (same order, same reservations); proof idempotent | **H** | RP, CC (last unit), PR, AZ |
| API-C4 | Protected Deals | C-DEAL-*, C-INV-*, C-DSL-*, C-USED-* | RM-02 | Full deal to `BUYER_CONFIRMED_RECEIPT` through the API only (test-mode OTP); no OTP in any log | **H** | CC (double accept, OTP race), SEC (OTP non-disclosure), PR |
| API-C5 | Post-purchase | C-RET-*, C-DSP-*, C-REV-* | RM-02 | Dispute opens a hold that blocks release (existing tests via API) | H | CC (dispute vs release), AZ |
| API-C6 | Identity, destinations, earnings | C-KYC-*, C-RCV-*, C-ERN-* (extract earnings view), C-RFD-01 | RM-01 | Withdrawal request idempotent; step-up enforced | H | RP, CC, SU |
| API-C7 | Notifications, messaging, support, files | C-NTF-01..04, C-MSG-* (bearer live), C-SUP-*, C-FILE-01 (bearer `readPrivateFile`) | API-001 | Private file access parity (uniform 404) | M | AZ, SEC |
| PUSH-01 | FCM/APNs channel (X-7) | Device push tokens (C-NTF-05/06), provider adapter in the notification fan-out, lock-screen-safe templates | API-001 | No OTP, amount or PII in payloads; delivery recorded in `notification_deliveries` | M | Payload lint, unit |
| API-S1 | Seller Center endpoints | S-* (extract onboarding status, shipping and store reads, payout methods, balance view; `If-Match` for product and store edits) | RM-01, RM-02 | Seller isolation: no cross-store access | H | AZ (cross-store), PR, CC |
| RM-03 | Read-model extraction wave 2 (admin) | Query services with `Actor` for every API_REQUIRED admin page (queues: payments, withdrawals, refunds, releases, recon, approvals, closures, support, settings; 360 views) | RM-01 | Each admin read enforces its permission inside the service | H | AZ (function-level), PR |
| API-A1 | Admin auth and governance | A-AUTH-*, A-STF-*, A-AUD-01, A-SET-*, A-OPS-* | API-001, SEC-02, RM-03 | MFA mandatory; step-up on sensitive actions; staff session revoke | **H** | SEC, SU, AZ |
| API-A2 | Admin operations | A-CUS-* (T-2), A-IDN-*, A-RCV-*, A-SEL-*, A-PRD-*, A-ORD-*, A-PAY-*, A-DEAL-*, A-RISK-01 (after SEC-01), A-DSP-*, A-RET-*, A-SUP-*, A-MSG-*, A-REV-01, A-USED-01, A-CLS-* | RM-03 | Every launch-critical admin page has a working mobile path | H | AZ, SU, PR |
| API-F1 | Finance endpoints | F-* (T-5 for settlements) | RM-03, API-A1 | Maker/checker via API: self-approval impossible (service + DB); every flow leaves the ledger balanced with zero drift | **H** | MC, CC, RP, SU, LB |
| SU-01 | Action-scoped step-up (X-12, S-M1) | Step-up grants per action class for ADMIN_MOBILE; web keeps the window (or adopts too) | API-A1 | One TOTP cannot authorize two different sensitive actions | M | SU |
| MOB-001 | Flutter workspace | `mobile/` pub workspace; pinned Flutter; strict analysis; CI | GOV-01 | `flutter analyze` / `flutter test` in CI | L | CI |
| MOB-002 | App identities | `customer_mobile`, `admin_mobile`; flavors dev / staging / prod; separate bundle IDs, Firebase, Sentry | MOB-001 | Both install side by side | M | Build matrix |
| MOB-003 | Security package | Keychain/Keystore token store, refresh mutex, wipe on logout/revoke, biometric gate, `FLAG_SECURE`, redaction | MOB-001, API-001 | Tokens never on plain disk; wipe verified | H | Unit + device test |
| MOB-004 | Generated clients | Dart clients from `mobile.v1` / `admin.v1`; admin client not a customer dependency | API-003 | Compiles; enums and problem+json mapped | M | CI |
| DS-001 | Design tokens | From `src/app/globals.css`: brand-950…50, accent, deal, ink/muted/line, radius card/control, IBM Plex Sans Arabic | MOB-001 | Golden tests RTL/LTR, light | L | Golden |
| L10N-01 | Labels and locales | Export `src/lib/i18n/labels.ts` → ARB ar; add en (D-9) | MOB-001 | No hardcoded strings; status badges from the label map | L | Unit |
| CUS-* | Customer App screens | Screen map §2 (buyer) in waves matching API-C1..C7 | API-C*, MOB-* | Screens render only server `allowedActions`; TEST banner whenever `isTest` | H | Widget, golden, integration vs staging |
| SC-* | Seller Center screens | Screen map §3 | API-S1 | Store isolation, step-up on money and team actions | H | Same |
| ADA-* | Admin App screens | Screen map §5 | API-A*, API-F1 | Every launch-critical operation completable on a phone with two staff accounts (maker and checker) | H | E2E on staging |
| SEC-10 | Pentest | API (OWASP API Top 10) + both apps (MASVS; L2 for admin) | All P1 | No open high or critical | H | Report |

## P2: Operational improvement

| ID | Title | Notes |
|---|---|---|
| FIN-P2-1 | Reconciliation hardening (S-M4/F-1) | Step-up + second person for `IGNORED_WITH_REASON`; aged-break payout pause; recon alert rule |
| FIN-P2-2 | Real money dual control (F-2) | Two SUPER_ADMINs + checker for `payments.realMoneyEnabled` |
| DOM-P2-1 | Deal and offer expiry (PD-1, D-4) | Job + `EXPIRED` handling; server deadlines in `allowedActions` |
| DOM-P2-2 | Marketplace replacement (F-3) and deal return-of-goods (PD-2) | After D-5 |
| DOM-P2-3 | In-app Delivery OTP reveal (PD-3, D-3) | If approved: step-up, X1/X2/X3, rotate on reveal, never in push |
| SEC-P2-1 | Audit hash chain + WORM export (S-L1) | — |
| SEC-P2-2 | Dedicated HMAC keys for OTP and codes (S-L5, PD-8) | With a rotation plan |
| SEC-P2-3 | Device attestation (Play Integrity / App Attest) for admin | Signal to server |
| OPS-P2-1 | Mobile observability dashboards | API latency, 4xx/5xx by code, push delivery |

## P3: Future

- **PSP integration.** The interface already exists in `payments/providers.ts`; it calls `confirmPaymentInternal` under an approval.
- **Courier integrations** (authoritative `CARRIER_INTEGRATION` delivery events).
- **System A migration track.** Separate; see `docs/integration-audit/*` on the platform branch.
- Chat enhancements and recommendations.
- Tablet layouts for the Admin App.

---

## Proposed sprints (2 weeks)

| Sprint | Theme | Tickets | Exit criteria |
|---|---|---|---|
| S0 | Decisions | GOV-01, GOV-02 | D-1..D-10 answered |
| **S1** | **Mobile API foundations** | API-001, API-002, API-003, SEC-01, SEC-03 · MOB-001, MOB-002, DS-001 | Bearer auth with security tests green; adapter + lint + parity harness; OpenAPI CI; S-H1 fixed; two app shells build |
| S2 | Sessions, limits, idempotency, first reads | SEC-02, SEC-04, SEC-05, RM-01, API-C1 · MOB-003, MOB-004, L10N-01 | Catalog via API with parity; session revoke works; generated client calls staging |
| S3 | Projection + customer core | RM-02, API-C2, API-C3 · CUS wave 1 (auth, browse, cart) | `allowedActions` exhaustive test green; checkout via API ≡ web |
| S4 | Protected Deals + post-purchase | API-C4, API-C5 · CUS wave 2 (deals, orders, disputes) | Deal flow through API in test mode; holds verified |
| S5 | Account, KYC, earnings, push, messaging | API-C6, API-C7, PUSH-01 · CUS wave 3 | Push delivered safely; withdrawals idempotent |
| S6 | Seller Center | API-S1 · SC screens | Store isolation suite green |
| S7 | Admin reads + auth | RM-03, API-A1, SU-01 · ADA wave 1 | Admin MFA + action step-up on device |
| S8 | Admin ops + finance | API-A2, API-F1 · ADA wave 2 | Maker/checker on two phones; LB/MC suites green |
| S9 | Hardening | SEC-10, P2 security items, store readiness | Pentest clean; closed beta (real money OFF) |

---

## Recommended Phase 1 scope (= S1 + S2)

| | |
|---|---|
| **Included** | API-001, API-002, API-003, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, RM-01, API-C1, MOB-001..004, DS-001, L10N-01 |
| **Excluded** | Any money-moving endpoint; any admin endpoint; Flutter business screens; PSP; System A; real money |
| **Why this slice** | It proves the "two transports, one domain" architecture end to end: bearer → `Actor` → existing service → same database, with parity tests. It removes the security blocker (S-H1). It adds session revocation before any device holds a token. And it de-risks the contract pipeline (OpenAPI → Dart). Nothing customer-facing ships until this foundation passes its security tests |
