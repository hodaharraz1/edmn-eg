# EDMN Mobile: API & Backend Gap Matrix v2

| | |
|---|---|
| **Status** | Phase 0 v2, read-only. **Supersedes** `MOBILE_API_GAP_MATRIX.md` (v1, which audited the marketing site). |
| **Source of truth** | `hodaharraz1/edmn-eg` · `claude/great-tesla-nor0wt` · `48ae40c` |
| **Per-endpoint specification** | [`MOBILE_API_EXTRACTION_PLAN.md`](./MOBILE_API_EXTRACTION_PLAN.md) §7 (method, path, role, reused service, DTOs, authorization, validation, idempotency, concurrency, rate limit, fresh 2FA, maker/checker, audit, financial effect, tests) |

---

## 1. Counting method and totals

- **Unit.** One *mobile-required operation* equals one `/api/v1` endpoint. Each one maps to an existing service function, or to a documented gap.
- **Classes.**

| Class | Meaning |
|---|---|
| **READY_SERVICE** | An existing Actor-based service already enforces authorization, state, locking, idempotency and audit. The API adapter only translates transport |
| **SERVICE_NEEDS_REFACTOR** | The domain logic exists, but part of it lives in a page or Server Action (reads, authorization, a projection), or it is session/cookie-bound |
| **MISSING_DOMAIN_CAPABILITY** | No implementation exists |
| **SECURITY_BLOCKER** | The logic exists, but exposing it as-is is unsafe |

| Audience | Endpoints | READY_SERVICE | SERVICE_NEEDS_REFACTOR | MISSING_DOMAIN_CAPABILITY | SECURITY_BLOCKER |
|---|---|---|---|---|---|
| Customer (incl. 18 public/auth) | 116 | 91 | 20 | 5 | 0 |
| Seller | 56 | 49 | 7 | 0 | 0 |
| Admin | 76 | 48 | 24 | 3 | 1 |
| Finance | 45 | 31 | 14 | 0 | 0 |
| **Total** | **293** | **219 (74.7 %)** | **65 (22.2 %)** | **8 (2.7 %)** | **1 (0.3 %)** |

**Verified backend reuse.**

- 74.7 % of operations reuse an existing service unchanged.
- 96.9 % reuse existing domain logic, unchanged or after extraction.
- No mobile-specific users, orders, deals, wallets, ledger, payments, sellers, disputes or withdrawals are required.

**Existing HTTP surface.** There are 16 route handlers. None is a usable mobile API as-is:

| Route | Purpose | Mobile suitability |
|---|---|---|
| `GET /api/health`, `GET /api/ready` | Liveness and readiness | Ops only |
| `GET/POST /api/cron/tick` | Due-based scheduler trigger (secret) | Internal |
| `GET /api/files/[id]` | Private file download | Cookie-only. Logic `readPrivateFile(actor,id)` reusable → C-FILE-01 |
| `GET /api/live`, `POST /api/live/read` | Live badges and messages (polling) | Cookie-only → C-MSG-05 |
| `POST /api/notifications/opened`, `GET …/notifications/open/[id]` (account and seller) | Delivery tracking, deep link | Web |
| `POST/DELETE /api/push/subscription` | Web Push VAPID | Web only. FCM/APNs missing |
| `GET /api/products/cards` | Product cards fragment | Web |
| `GET /api/admin/export`, `GET /api/admin/profitability-export` | CSV export (admin cookie) | Service `exportDataset(actor)` reusable |
| `POST /api/webhooks/payments/[provider]` | PSP callback (evidence only, 503 without secret) | Internal |
| `POST /api/webhooks/email/[provider]` | Email delivery events (signed) | Internal |
| `GET /media/[...key]` | Public media | Reusable for images |

---

## 2. Feature reuse matrix by area

Generated from the endpoint catalogue.

| Audience | Area | Endpoints | READY_SERVICE | SERVICE_NEEDS_REFACTOR | MISSING_DOMAIN_CAPABILITY | SECURITY_BLOCKER |
|---|---|---|---|---|---|---|
| Customer | Authentication & sessions | 12 | 5 | 5 | 2 | 0 |
| Customer | Catalog & content (public) | 11 | 8 | 3 | 0 | 0 |
| Customer | App config | 1 | 0 | 0 | 1 | 0 |
| Customer | Cart | 4 | 4 | 0 | 0 | 0 |
| Customer | Wishlist | 2 | 0 | 2 | 0 | 0 |
| Customer | Addresses | 3 | 3 | 0 | 0 | 0 |
| Customer | Checkout | 2 | 1 | 1 | 0 | 0 |
| Customer | Orders | 3 | 2 | 1 | 0 | 0 |
| Customer | Payments | 2 | 1 | 1 | 0 | 0 |
| Customer | Seller-order buyer actions | 3 | 3 | 0 | 0 | 0 |
| Customer | Returns | 5 | 5 | 0 | 0 | 0 |
| Customer | Replacements | 1 | 0 | 0 | 1 | 0 |
| Customer | Disputes | 4 | 4 | 0 | 0 | 0 |
| Customer | Reviews | 3 | 3 | 0 | 0 | 0 |
| Customer | Protected Deals (buyer) | 17 | 16 | 1 | 0 | 0 |
| Customer | Seller invitations | 3 | 3 | 0 | 0 | 0 |
| Customer | Protected Deals (deal seller) | 4 | 4 | 0 | 0 | 0 |
| Customer | Used / condition reports | 2 | 2 | 0 | 0 | 0 |
| Customer | Identity (KYC) | 2 | 2 | 0 | 0 | 0 |
| Customer | Receiving destinations | 3 | 3 | 0 | 0 | 0 |
| Customer | Earnings & account withdrawals | 4 | 3 | 1 | 0 | 0 |
| Customer | Refunds | 1 | 1 | 0 | 0 | 0 |
| Customer | Account | 6 | 4 | 2 | 0 | 0 |
| Customer | Notifications & push | 6 | 4 | 1 | 1 | 0 |
| Customer | Messaging | 5 | 4 | 1 | 0 | 0 |
| Customer | Support | 6 | 6 | 0 | 0 | 0 |
| Customer | Private files | 1 | 0 | 1 | 0 | 0 |
| Seller | Seller onboarding & approval | 7 | 6 | 1 | 0 | 0 |
| Seller | Seller context | 1 | 1 | 0 | 0 | 0 |
| Seller | Dashboards | 1 | 1 | 0 | 0 | 0 |
| Seller | Products & moderation | 9 | 8 | 1 | 0 | 0 |
| Seller | Seller invitations | 1 | 1 | 0 | 0 | 0 |
| Seller | Used / condition reports | 1 | 1 | 0 | 0 | 0 |
| Seller | Orders | 11 | 10 | 1 | 0 | 0 |
| Seller | Returns | 4 | 4 | 0 | 0 | 0 |
| Seller | Disputes | 1 | 1 | 0 | 0 | 0 |
| Seller | Reviews | 1 | 1 | 0 | 0 | 0 |
| Seller | Shipping rates | 2 | 1 | 1 | 0 | 0 |
| Seller | Store settings | 2 | 1 | 1 | 0 | 0 |
| Seller | Payments | 2 | 1 | 1 | 0 | 0 |
| Seller | Seller finance & withdrawals | 6 | 5 | 1 | 0 | 0 |
| Seller | Staff (store / admin) | 4 | 4 | 0 | 0 | 0 |
| Seller | Seller 2FA | 2 | 2 | 0 | 0 | 0 |
| Seller | Messaging | 1 | 1 | 0 | 0 | 0 |
| Admin | Authentication & sessions | 7 | 2 | 3 | 2 | 0 |
| Admin | Dashboards | 1 | 1 | 0 | 0 | 0 |
| Admin | Approvals queue | 1 | 0 | 1 | 0 | 0 |
| Admin | Customers (admin) | 4 | 0 | 3 | 1 | 0 |
| Admin | Account closures | 2 | 1 | 1 | 0 | 0 |
| Admin | Identity review (admin) | 4 | 4 | 0 | 0 | 0 |
| Admin | Receiving destinations | 3 | 2 | 1 | 0 | 0 |
| Admin | Sellers (admin) | 6 | 4 | 2 | 0 | 0 |
| Admin | Products & moderation | 3 | 2 | 1 | 0 | 0 |
| Admin | Orders | 8 | 6 | 2 | 0 | 0 |
| Admin | Payments | 5 | 3 | 2 | 0 | 0 |
| Admin | Protected Deals (admin) | 3 | 2 | 1 | 0 | 0 |
| Admin | Risk flags | 1 | 0 | 0 | 0 | 1 |
| Admin | Disputes | 6 | 5 | 1 | 0 | 0 |
| Admin | Returns | 2 | 1 | 1 | 0 | 0 |
| Admin | Support | 3 | 2 | 1 | 0 | 0 |
| Admin | Messaging | 3 | 3 | 0 | 0 | 0 |
| Admin | Reviews | 1 | 1 | 0 | 0 | 0 |
| Admin | Used / condition reports | 1 | 1 | 0 | 0 | 0 |
| Admin | Staff (store / admin) | 5 | 4 | 1 | 0 | 0 |
| Admin | Audit trail | 1 | 0 | 1 | 0 | 0 |
| Admin | Settings | 2 | 1 | 1 | 0 | 0 |
| Admin | System health & ops | 2 | 1 | 1 | 0 | 0 |
| Admin | Reports | 1 | 1 | 0 | 0 | 0 |
| Admin | CMS / legal | 1 | 1 | 0 | 0 | 0 |
| Finance | Finance overview & controls | 3 | 2 | 1 | 0 | 0 |
| Finance | Ledger | 3 | 1 | 2 | 0 | 0 |
| Finance | Maker/checker requests | 3 | 3 | 0 | 0 | 0 |
| Finance | Approvals queue | 2 | 1 | 1 | 0 | 0 |
| Finance | Releases (settlement of escrow) | 3 | 2 | 1 | 0 | 0 |
| Finance | Refunds | 8 | 6 | 2 | 0 | 0 |
| Finance | Withdrawals & payouts | 11 | 9 | 2 | 0 | 0 |
| Finance | Adjustments | 3 | 2 | 1 | 0 | 0 |
| Finance | Scheduled settlements | 2 | 0 | 2 | 0 | 0 |
| Finance | Reconciliation | 4 | 3 | 1 | 0 | 0 |
| Finance | Fees / pricing | 2 | 1 | 1 | 0 | 0 |
| Finance | Payment destinations | 1 | 1 | 0 | 0 | 0 |

---

## 3. Cross-cutting capability gaps

These are not counted in §1, but every endpoint depends on them.

| # | Capability | Status | Evidence | Required work |
|---|---|---|---|---|
| X-1 | Bearer auth: mobile session scopes, access and refresh tokens, device binding | **MISSING (SECURITY_BLOCKER SB-1)** | `web/session.ts` reads cookies only; `sessions_scope_chk` = WEB, ADMIN | Additive migration + `src/server/api/auth`, reusing `createSession` / `resolveSession` / actor builders |
| X-2 | `/api/v1` adapter, problem+json, no-DB-in-handler lint | MISSING (by design) | — | API-002 |
| X-3 | OpenAPI 3.1 contract | MISSING | — | Generate from DTO zod schemas (zod v4 present) |
| X-4 | `allowedActions` / `nextDeadline` server projection | MISSING | Derived in page components | Query functions per aggregate, built on `src/domain/machines.ts` + service guards |
| X-5 | Generic `Idempotency-Key` | REFACTOR | `idempotency_keys(scope,key,result_ref)` table exists, **unused** | Middleware storing the result reference |
| X-6 | Session and device management, remote revoke | MISSING | `revokeAllSessions` has 0 callers; the security page is read-only | Self-service + admin revoke + audit |
| X-7 | FCM / APNs push | MISSING | `notifications/push.ts` is Web Push (VAPID) only | New channel in the existing notification fan-out; lock-screen-safe payloads (mirror `SECRET_EVENTS`) |
| X-8 | Read models with authorization inside query services | REFACTOR | 92/162 pages read the DB directly; admin queries without `Actor` | T-6 (extraction plan §6) |
| X-9 | Audit channel / device attribution | REFACTOR | `audit_logs` has ip, ua, request_id only | Add channel + deviceId to `Actor` and audit |
| X-10 | Mobile-tolerant rate limits | REFACTOR | Per-IP buckets; CGNAT (S-M3) | Per-device and per-account API tiers |
| X-11 | Optimistic concurrency on edits | REFACTOR | Product, store and profile updates are last-write-wins | `If-Match` / version |
| X-12 | Action-scoped step-up | REFACTOR | `requireStepUp` = 10-minute session window | Step-up grants per action class |
| X-13 | App config / forced update | MISSING | — | `GET /api/v1/app/config` |
| X-14 | English locale | MISSING | Arabic-only UI; labels in `src/lib/i18n/labels.ts` | ARB export ar + new en |

---

## 4. Admin Web → Admin Mobile capability mapping

| Class | Pages |
|---|---|
| MOBILE_READY | 8 |
| API_REQUIRED | 50 |
| DESKTOP_ONLY_JUSTIFIED | 17 |
| **Total** | **75** |

**Class definitions:**

- **MOBILE_READY:** every read and write behind the page is an Actor-based service with authorization inside; only the adapter is needed.
- **API_REQUIRED:** the domain services exist, but a read model, the authorization or a cookie-bound piece must be extracted first.
- **DESKTOP_ONLY_JUSTIFIED:** configuration authoring or analysis that is **not** a normal launch-critical operation; a page is never classed this way merely because it is a web page. Any approve or publish step behind these pages is still exposed on mobile.
- **MISSING:** not available on the web either. Four such capabilities, not counted as pages:
  1. own sessions and devices (A-AUTH-06/07)
  2. revoke a user's sessions (A-CUS-04)
  3. push-delivered admin alerts (X-7)
  4. action-scoped step-up (X-12)

| Web Admin page | Capability | Launch-critical | Mobile class | Mobile endpoints | Notes / justification |
|---|---|---|---|---|---|
| `/admin` | Executive dashboard / KPIs | yes | MOBILE_READY | A-DSH-01 | adminDashboard(actor) enforces dashboard.view |
| `/admin/2fa` | Mandatory TOTP / enrollment | yes | API_REQUIRED | A-AUTH-02, A-AUTH-03 | reuse verifyTotpForUser/elevateSession on bearer session |
| `/admin/alerts` | Operational alerts | yes | API_REQUIRED | A-OPS-01 | alert reads in page; push delivery to admin devices is MISSING |
| `/admin/approvals` | Maker/checker queue | yes | API_REQUIRED | A-APR-01, F-MOV-01..03 | openMovementRequests() has no Actor |
| `/admin/attributes` | Catalog attribute authoring | no | DESKTOP_ONLY_JUSTIFIED | — | configuration authoring of attribute/option sets; not daily operations |
| `/admin/audit` | Audit trail search | yes | API_REQUIRED | A-AUD-01 | query lives in page |
| `/admin/balances` | Control balances | yes | API_REQUIRED | F-OVR-01 | controlBalances() has no Actor |
| `/admin/brands` | Brand authoring (logos) | no | DESKTOP_ONLY_JUSTIFIED | — | low-frequency catalog configuration with image assets; emergency action = product takedown (mobile) |
| `/admin/categories` | Category tree editing | no | DESKTOP_ONLY_JUSTIFIED | — | tree restructuring + cache invalidation; risky on small screens; not launch-critical ops |
| `/admin/closures` | Account closure requests | yes | API_REQUIRED | A-CLS-01, A-CLS-02 | pendingClosures() has no Actor |
| `/admin/cms` | Homepage blocks / pages authoring | no | DESKTOP_ONLY_JUSTIFIED | A-CMS-01 (optional) | content authoring; urgent banner edits possible via A-CMS-01 later (P2) |
| `/admin/commissions` | Legacy commission rules | no | DESKTOP_ONLY_JUSTIFIED | — | superseded by the versioned fee engine; kept for history |
| `/admin/customers` | User search | yes | API_REQUIRED | A-CUS-01 | page query; masked PII |
| `/admin/customers/[id]` | User 360 + suspend | yes | API_REQUIRED | A-CUS-02, A-CUS-03, A-CUS-04 | 10 direct reads; status change logic in action (T-2); session revoke MISSING |
| `/admin/deals` | Protected Deals list | yes | API_REQUIRED | A-DEAL-01 | page query |
| `/admin/deals/[id]` | Deal 360, hold, release, risk flags | yes | API_REQUIRED | A-DEAL-02, A-DEAL-03, F-REL-03, A-RISK-01 | dealGraph ready; risk-flag resolution is a SECURITY_BLOCKER (S-H1) |
| `/admin/disputes` | Dispute queue | yes | API_REQUIRED | A-DSP-01 | page query |
| `/admin/disputes/[id]` | Dispute 360 + decision | yes | MOBILE_READY | A-DSP-02..06 | disputeGraph(actor) + resolveDispute(actor) enforce authorization |
| `/admin/finance-control` | Kill switches, daily close, invariants, go-live gate | yes | API_REQUIRED | F-OVR-01..03, F-LED-03 | reads without Actor; writes ready |
| `/admin/finance/pricing` | Fee versions: approve / publish | yes | API_REQUIRED | F-PRC-01, F-PRC-02 | checker steps fit mobile; reads in page |
| `/admin/finance/pricing/marketplace` | Marketplace fee table drafting | no | DESKTOP_ONLY_JUSTIFIED | — | dense tier/category matrices; drafting is analyst work; approval stays mobile (F-PRC-02) |
| `/admin/finance/pricing/payout-costs` | Payout channel cost tables | no | DESKTOP_ONLY_JUSTIFIED | — | tabular configuration; review/approve via pricing decision |
| `/admin/finance/pricing/protected-deals` | Deal fee drafting | no | DESKTOP_ONLY_JUSTIFIED | — | same as above |
| `/admin/finance/pricing/refund-policy` | Refund-fee policy matrix | no | DESKTOP_ONLY_JUSTIFIED | — | matrix authoring needing legal review |
| `/admin/finance/pricing/simulator` | Pricing simulator | no | DESKTOP_ONLY_JUSTIFIED | — | analysis tool, no operational effect |
| `/admin/finance/profitability` | Profitability analytics | no | DESKTOP_ONLY_JUSTIFIED | — | analytics; KPI summary appears on mobile dashboard |
| `/admin/identity` | Identity (KYC) queue | yes | MOBILE_READY | A-IDN-01 | identityQueue(actor) enforces identity.view |
| `/admin/identity/[id]` | Identity case + decision + reveal | yes | MOBILE_READY | A-IDN-02..04 | identityCase/reviewIdentity/revealIdentityNumber enforce permission + step-up; files via bearer /files (refactor) |
| `/admin/inventory` | Inventory overview | no | API_REQUIRED | A-ORD-01 (filters) | page query; read-only |
| `/admin/ledger` | Ledger explorer + adjustments | yes | API_REQUIRED | F-LED-01, F-LED-02, F-ADJ-01..03 | 7 direct reads; adjustment writes ready |
| `/admin/legal` | Legal text authoring / publish | no | DESKTOP_ONLY_JUSTIFIED | A-CMS-01 (publish) | long-form legal drafting; publish needs legal sign-off |
| `/admin/login` | Staff login | yes | API_REQUIRED | A-AUTH-01 | bearer ADMIN-MOBILE session (SB-1) |
| `/admin/messages` | Message reports queue | yes | MOBILE_READY | A-MSG-01 | reportQueue(actor) enforces messages.view |
| `/admin/messages/[id]` | Conversation (privileged access) + moderation | yes | MOBILE_READY | A-MSG-02, A-MSG-03 | staffThread(actor) + access grants audited |
| `/admin/moderation` | Product moderation queue | yes | API_REQUIRED | A-PRD-01..03 | queue query in page; decisions ready |
| `/admin/movements` | Financial movement requests | yes | API_REQUIRED | F-MOV-01..03 | openMovementRequests() has no Actor |
| `/admin/notifications` | Notification templates + outbox monitor | no | DESKTOP_ONLY_JUSTIFIED | A-OPS-02 | template authoring is desktop; dead-letter requeue on mobile (A-OPS-02) |
| `/admin/operations` | Operations work queues (SLA) | yes | API_REQUIRED | A-OPS-01 | page aggregation |
| `/admin/ops` | System health, jobs, providers, dead letters | yes | API_REQUIRED | A-OPS-01, A-OPS-02 | page aggregation |
| `/admin/orders` | Orders search | yes | API_REQUIRED | A-ORD-01 | page query |
| `/admin/orders/[id]` | Order 360 + interventions | yes | API_REQUIRED | A-ORD-02..08, F-REL-02 | reads in page; all writes ready |
| `/admin/payment-settings` | Payment methods & destinations | yes | API_REQUIRED | F-DST-01 | rare but launch-critical (disable a destination fast) |
| `/admin/payments` | Payment verification queue | yes | API_REQUIRED | A-PAY-01 | permission in page |
| `/admin/payments/[id]` | Verify / reject proof | yes | API_REQUIRED | A-PAY-02..05 | confirmPayment ready (step-up, approval); detail read in page |
| `/admin/policy` | Prohibited-listing policy rules | no | DESKTOP_ONLY_JUSTIFIED | — | rule authoring; enforcement is automatic |
| `/admin/products` | Products search | yes | API_REQUIRED | A-PRD-01 | page query |
| `/admin/products/[id]` | Product 360 + takedown | yes | API_REQUIRED | A-PRD-02, A-PRD-03 | reads in page |
| `/admin/receiving-destinations` | Receiving destination review | yes | API_REQUIRED | A-RCV-01..03 | destinationQueue enforces permission; detail/reveal ready; list page aggregation |
| `/admin/reconciliation` | Statement import + matching | yes | API_REQUIRED | F-REC-01..04 | queries without Actor; large CSV import better on Web Admin |
| `/admin/refunds` | Refund approval / payout | yes | API_REQUIRED | F-RFD-01..08 | refundQueue/refundDetail have no Actor; writes ready |
| `/admin/releases` | Seller release queue | yes | API_REQUIRED | F-REL-01 | page query |
| `/admin/releases/[id]` | Release (checker) | yes | API_REQUIRED | F-REL-02, F-REL-03 | release services ready |
| `/admin/reports` | Bulk data exports | no | DESKTOP_ONLY_JUSTIFIED | A-RPT-01 (optional) | bulk PII exports should not land on phones; summary KPIs on dashboard |
| `/admin/returns` | Returns queue | yes | API_REQUIRED | A-RET-01 | page query |
| `/admin/returns/[id]` | Return decision | yes | API_REQUIRED | A-RET-02 | reads in page; writes ready |
| `/admin/reviews` | Review moderation | no | API_REQUIRED | A-REV-01 | page query |
| `/admin/risk` | Risk flags | yes | API_REQUIRED | A-RISK-01 | SECURITY_BLOCKER until T-1 |
| `/admin/roles` | Staff, roles, permissions | yes | API_REQUIRED | A-STF-01..05 | 4 direct reads; writes ready (privileged guard + step-up) |
| `/admin/seller-verification` | Seller application review | yes | API_REQUIRED | A-SEL-01, A-SEL-03..06 | queue query in page |
| `/admin/sellers` | Sellers list | yes | API_REQUIRED | A-SEL-01 | page query |
| `/admin/sellers/[id]` | Seller 360 | yes | API_REQUIRED | A-SEL-02..06 | 14 direct reads |
| `/admin/settings` | Platform settings (incl. real-money switch) | yes | API_REQUIRED | A-SET-01, A-SET-02 | getAllSettings() has no Actor; updateSetting ready |
| `/admin/settlements` | Scheduled payout batches | yes | API_REQUIRED | F-STL-01, F-STL-02 | authz in action (T-5) |
| `/admin/shipping` | Shipping evidence review | yes | API_REQUIRED | A-ORD-05..07 | page query |
| `/admin/step-up` | Fresh 2FA | yes | API_REQUIRED | A-AUTH-04 | action-scoped grant recommended (S-M1) |
| `/admin/support` | Support queue | yes | API_REQUIRED | A-SUP-01 | ticketQueue() has no Actor |
| `/admin/support/[id]` | Ticket thread + actions | yes | MOBILE_READY | A-SUP-02, A-SUP-03 | ticketThread(actor) + ticket services enforce permission |
| `/admin/transactions` | Transactions overview | yes | API_REQUIRED | F-LED-01 | page query |
| `/admin/used` | Used-commerce overview | no | API_REQUIRED | A-USED-01 | page query |
| `/admin/used/passports` | Product passports | no | API_REQUIRED | A-USED-01 | page query |
| `/admin/used/passports/[id]` | Passport verify / inspection | no | MOBILE_READY | A-USED-01 | verifyPassport/recordInspection enforce permission |
| `/admin/used/policies` | Used-condition policy authoring | no | DESKTOP_ONLY_JUSTIFIED | — | policy design work |
| `/admin/used/score` | Used safety score rules | no | DESKTOP_ONLY_JUSTIFIED | — | rule tuning; sensitive setting |
| `/admin/withdrawals` | Withdrawal queue | yes | API_REQUIRED | F-WD-01 | withdrawalQueue() has no Actor |
| `/admin/withdrawals/[id]` | Withdrawal decisions | yes | API_REQUIRED | F-WD-02..11 | all writes ready; detail read in page |

**Launch-critical coverage.** All **53** pages marked launch-critical are MOBILE_READY or API_REQUIRED, and each maps to mobile endpoints. No launch-critical page is DESKTOP_ONLY_JUSTIFIED. After the API_REQUIRED items are delivered, normal launch-critical administration needs no computer.

---

## 5. Items to refactor or fix before exposure

| ID | Item | Class | Blocks |
|---|---|---|---|
| T-1 | `riskFlagAction`: missing party check; non-atomic audit | SECURITY_BLOCKER (S-H1) | A-RISK-01 |
| T-2 | `customerStatusAction`: logic in action, no step-up, sessions not revoked | REFACTOR | A-CUS-03 |
| T-3 | `updateProfileAction`: logic in action, no audit | REFACTOR | C-ACC-02 |
| T-4 | `toggleWishlistAction`: logic in action | REFACTOR | C-WISH-02 |
| T-5 | `runSettlementAction`: authorization and audit in action | REFACTOR | F-STL-02 |
| T-6 | Read models with page-level authorization | REFACTOR | 40+ read endpoints |
| T-7 | `allowedActions` projection | MISSING | C-ORD-02, C-DEAL-08, S-ORD-02 and the matching admin 360 views |

---

## 6. Customer and seller feature checklist against the brief

| Brief item | Covered by | Class |
|---|---|---|
| Registration / login / OTP | C-AUTH-01..12. **Login is email or phone + password.** SMS phone verification depends on an SMS provider. OTP-based login does not exist (product decision) | REFACTOR / MISSING (refresh, revoke) |
| Home, categories, search, product details, store pages | P-CAT-01..10 | READY / REFACTOR (store, brand, governorates) |
| Cart, multi-seller checkout | C-CART-*, C-CHK-01..02 | READY / REFACTOR (quote) |
| Orders, payments | C-ORD-*, C-PAY-*, C-SO-* | READY / REFACTOR (detail projection) |
| Protected Deals, invitations, offer approval, frozen agreement | C-DEAL-*, C-INV-*, C-DSL-* | READY / REFACTOR (detail projection) |
| Delivery tracking, Delivery OTP, receipt confirmation | C-DEAL-13..17, C-DSL-03..04, C-SO-01 | READY (OTP via SMS only, PD-3) |
| Returns, replacements, disputes | C-RET-*, C-REP-01, C-DSP-* | READY / MISSING (marketplace replacement) |
| Wallet / transaction history | C-ERN-01 (earnings), C-RFD-01; no stored-value wallet by design | REFACTOR |
| Notifications, support, account, security/sessions | C-NTF-*, C-SUP-*, C-ACC-*, C-AUTH-10..12 | READY / MISSING (push, revoke) |
| Seller application, KYC, store profile, dashboard | S-ONB-*, C-KYC-*, S-STR-*, S-DSH-01 | READY / REFACTOR |
| Products new/used, inventory | S-PRD-*, S-USED-01, S-INV-01 | READY / REFACTOR (If-Match) |
| Orders, shipping rates per governorate, delivery duration, shipping evidence | S-ORD-*, S-SHP-* | READY / REFACTOR |
| Returns/replacements (seller) | S-RET-* | READY |
| Seller balance, withdrawals | S-FIN-* | READY / REFACTOR (balance view) |
| Protected Deal requests and offers (seller) | C-INV-*, C-DSL-* (deals are user-level, no store needed) | READY |
