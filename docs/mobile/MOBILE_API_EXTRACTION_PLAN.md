# EDMN Mobile API Extraction Plan

| | |
|---|---|
| **Status** | Phase 0 v2. Read-only design. **No route, migration, Flutter project or deployment was created.** |
| **Source of truth** | `hodaharraz1/edmn-eg`, branch `claude/great-tesla-nor0wt`, baseline commit `48ae40c` |
| **Companion documents** | [`MOBILE_PHASE_0_AUDIT_V2.md`](./MOBILE_PHASE_0_AUDIT_V2.md) · [`MOBILE_API_GAP_MATRIX_V2.md`](./MOBILE_API_GAP_MATRIX_V2.md) · [`MOBILE_SCREEN_MAP_V2.md`](./MOBILE_SCREEN_MAP_V2.md) · [`MOBILE_BACKLOG_V2.md`](./MOBILE_BACKLOG_V2.md) |
| **Real money** | OFF. `realMoneyEnabled()` is fail-closed, and `goLiveGate()` carries static production blockers. |

---

## 1. Target architecture: one domain, three transports

```
Customer Flutter App ──► /api/v1/...        ─┐
Admin Flutter App    ──► /api/v1/admin/...  ─┼─► mobile API adapter (NEW, thin) ─┐
Existing Web App     ──► Server Actions      ─┘   (src/app/_actions, unchanged)    │
                                                                                   ▼
                          existing domain/application services  src/server/modules/**, src/server/auth, src/server/rbac
                          (every service takes an explicit Actor; authorization, state machines,
                           row locks, idempotency keys and audit live HERE)
                                                                                   ▼
                          existing PostgreSQL (Drizzle, 20 migrations, append-only / two-person triggers)
```

The audit verified two facts that make this architecture viable:

1. **Services are transport-agnostic.**
   - Every write service receives an `Actor` (`src/server/core/actor.ts`) and never reads cookies (stated in the `Actor` doc comment and confirmed in the service files read).
   - The web transport builds the `Actor` in `src/server/web/session.ts` (`customerActor`, `sellerActor`, `adminActor` from `src/server/auth/actors.ts`).
   - A mobile transport only needs to build the **same `Actor`** from a bearer token.
2. **Server Actions are already thin.**
   - 173 exported Server Actions in 17 files parse `FormData`, call one service, and map `DomainError` to `ActionState` (`src/server/web/action.ts`).
   - Only 5 actions hold logic that must move into services first (§6).

**Single source of truth.** There are no mobile-specific users, orders, deals, wallets, ledger, payments, sellers, disputes or withdrawals. The mobile API calls the same functions that the Server Actions call, against the same tables.

---

## 2. Adapter rules

These rules mean a route handler never contains business logic.

Every `/api/v1` handler is exactly:

```
authenticate(bearer) → Actor            // reuses customerActor / sellerActor / adminActor
parse(DTO, zod)                          // request schema = the service's existing zod schema where one exists
result = await service(actor, input)     // the SAME function the Server Action calls
return map(result) | mapDomainError(e)   // problem+json; never stack traces (mirrors runAction)
```

A handler **must not**:

- query the database
- check a status
- compute an amount
- decide an allowed action
- write an audit row

Anything a handler would need beyond this signals a missing service function (§6), not handler code.

Enforcement (Phase 1 ticket API-002):

- A lint rule forbids importing `@/server/db/*` or `drizzle-orm` from `src/app/api/v1/**`.
- A parity test suite runs each endpoint and its Server Action against the same fixture and compares the resulting state.

### 2.1 Error mapping

`DomainError.code` maps to HTTP status as follows. The codes are taken from `src/server/core/errors.ts` usage.

| Domain code | HTTP | Mobile behaviour |
|---|---|---|
| `VALIDATION` (+ `fieldErrors`) | 422 | Inline field errors |
| `UNAUTHENTICATED` | 401 | Refresh, then re-login |
| `STEP_UP_REQUIRED` | 401 + `WWW-Authenticate: step-up` | Step-up sheet, then retry with the same `Idempotency-Key` |
| `FORBIDDEN` | 403 | "No access" |
| `NOT_FOUND` | 404 | "Not available" |
| `INVALID_STATE` | 409 | Refetch, then show the current state |
| `CONFLICT` (stale price, fee or version) | 409 + `code` | Show the new values and ask the user to re-confirm |
| `INSUFFICIENT_BALANCE`, `INSUFFICIENT_STOCK` | 409 | Message |
| `RATE_LIMITED` | 429 + `Retry-After` | Countdown |
| unexpected | 500 + `reference` | Generic message; the support link carries the reference |

---

## 3. Authentication for mobile

This is the security blocker that gates every endpoint (SB-1).

**What exists (verified in `src/server/auth/service.ts`):**

- Opaque 256-bit session tokens. Only the SHA-256 hash is stored, in `sessions`.
- Session scopes `WEB` and `ADMIN`, enforced by DB CHECK `sessions_scope_chk`.
- Password login with an atomic failed-attempt lockout.
- TOTP for staff, with replay-safe single-use steps (`totpLastStep`).
- Admin idle timeout.
- Session invalidation on password change.
- Cookies only. There is no bearer resolution, no refresh token and no device record.

**Required.** This is a new capability, but it reuses `createSession`, `resolveSession`, `login`, `verifyTotpForUser`, `elevateSession` and `stepUp`.

| Item | Design | Reuse |
|---|---|---|
| Session scopes | Add `MOBILE` and `ADMIN_MOBILE` (additive migration to `sessions_scope_chk`; Phase 1) | `createSession(conn,userId,scope,meta)` |
| Access token | Short-lived (≤ 10 min) signed token referencing the session id | New |
| Refresh token | Opaque rotating token, hash stored, `family_id`. Reuse of a rotated token revokes the family | New |
| Device record | `deviceId`, platform, app version, push token, `lastSeenAt` (additive table) | New |
| Bearer resolution | `resolveSession(token, scope)`, then the existing actor builders | `resolveSession`, `customerActor`, `sellerActor`, `adminActor` |
| Admin MFA | Same as web. `mfaVerifiedAt` is required before any admin call | `verifyTotpForUser`, `elevateSession` |
| Step-up | Existing session-wide 10-minute window (`requireStepUp`). **Mobile policy:** an action-scoped grant (≤ 5 min, one action class), plus a biometric gate in the app | `stepUp`, `requireStepUp` |
| Remote revocation | Self-service list and revoke, and admin "revoke all sessions of user X" | `revokeAllSessions` (exists, has no callers, needs audit and a transaction) |
| Token storage | iOS Keychain (`first_unlock_this_device`); Android Keystore-backed storage | Client |

---

## 4. Cross-cutting conventions

| Concern | Existing (verified) | Mobile API rule |
|---|---|---|
| **Idempotency** | Domain keys already exist where money or orders are created: `checkoutKey`, payment-proof `clientKey`, withdrawal `clientKey`, approval `idempotencyKey`, journal `idempotencyKey` (UNIQUE). The `idempotency_keys` table exists **but is unused** | Pass the domain key when the service has one (column **K** below). For other creates, the `Idempotency-Key` header is stored in `idempotency_keys(scope,key,result_ref)` (column **H**). State-guarded commands (**S**) are naturally idempotent under a row lock |
| **Concurrency** | `FOR UPDATE` row locks, advisory locks (`checkout:`, `account:`), conditional stock UPDATE, `expectedTotal` / `expectedPayout` / `expectedAmount`, terms `version` | Forward the expected-value parameters from the client. Add `If-Match` only where the service has none (product edit, store settings, profile) |
| **Rate limiting** | PostgreSQL fixed-window `enforce()` inside services, per account and per IP | Keep the service limits. Add API tiers per user and device: read 120/min, write 30/min, strict 10/15 min. Per-IP buckets must tolerate carrier-grade NAT (S-M3) |
| **Fresh 2FA** | `requireStepUp(actor)` inside services (10-minute session window) | Column **SU** means the existing service enforcement. **SU\*** means mobile policy adds step-up where web does not require it today |
| **Maker/Checker** | `requestMovement` (maker) → `takeMovementRequest` (checker) + `grantApproval` + DB triggers `financial_approvals_two_person`, `financial_approvals_checker_chk`, `financial_movement_requests_checker_chk` | Never re-implemented in the API. The endpoint calls the same service |
| **Audit** | `audit(tx, actor, …)` in the same transaction; `audit_logs` append-only by trigger | Add `channel` (web, mobile, admin-mobile) and `deviceId` to `Actor`, written into `audit_logs.request_id` or a new column (Phase 1) |
| **Files** | Uploads are passed to services as `{data: Buffer, name}`. Private reads go through `readPrivateFile(actor, id)`, which applies purpose-specific record authorization | `multipart/form-data` → the same `{data,name}` shape. `GET /api/v1/files/{id}` resolves the bearer actor and calls `readPrivateFile` |
| **Allowed actions** | Computed in page components from status (no server projection) | **New** query functions `allowedActionsFor(actor, entity)` for order, seller order, deal, return, dispute and withdrawal. They are derived from the existing machines in `src/domain/machines.ts` and the guards in services. The mobile app renders them and never infers them |
| **Labels** | `src/lib/i18n/labels.ts` holds the canonical Arabic wording for statuses and decisions | Export to ARB for mobile status badges. English is new |
| **Money** | Integer piastres everywhere (`assertMinor`), EGP CHECK constraints, `formatEGP()` | DTOs carry `*_piastres` integers plus `currency:"EGP"`. The client formats for display only |
| **OpenAPI** | None | Generate OpenAPI 3.1 from the API DTO zod schemas (`zod` v4 is already a dependency). Commit `openapi/mobile.v1.yaml` and `openapi/admin.v1.yaml`, with a diff check in CI |

---

## 5. Legend for the endpoint catalogue

| Column | Values |
|---|---|
| **Role** | Public · Customer (any signed-in user, including a Protected Deal seller, which is user-level) · Seller (store context: `sellerActor` with seller permissions) · Admin (staff, MFA-verified) · Finance (staff with finance permissions) |
| **Idem** | **K** domain key already in the service · **H** new `Idempotency-Key` header stored in the existing `idempotency_keys` table · **S** state-guarded (row lock + status check makes a retry a no-op) · — read |
| **Concurrency** | **L** row lock in service · **A** advisory lock · **V** expected-value or version check in service · **E** add `If-Match` · DB CHECK = database constraint |
| **Rate limit** | **E** existing service limit (value noted) · **T** API tier only · **S** strict tier |
| **Fresh 2FA** | **SU** enforced by the service today · **SU\*** added by mobile policy · — none |
| **Maker/Checker** | **MAKER** (`requestMovement`) · **CHECKER** (`takeMovementRequest` + DB two-person trigger) · **2P** another two-person rule built into the domain · — |
| **Audit** | **A** existing `audit()` in the transaction · **NA** audit must be added (e.g. PII reads, logout) · — reads |
| **Tests** | **CT** contract (DTO ↔ OpenAPI) · **AZ** authorization negatives (other user, other store, missing permission) · **PR** parity with the Server Action on the same fixture · **RP** replay/idempotency · **CC** concurrency · **SU** step-up negative · **MC** self-approval negative · **LB** ledger balanced + zero projection drift afterwards · **SEC** security-specific (enumeration, OTP non-disclosure, token handling) |
| **Validation** | Unless stated, the request DTO **is** the existing zod schema used by the service (`parse()` in `src/server/modules/_shared.ts`). The adapter adds only transport shape checks (UUID path params, multipart limits from `uploads.maxImageMb` / `uploads.maxDocumentMb`) |
| **Class** | READY_SERVICE · SERVICE_NEEDS_REFACTOR · MISSING_DOMAIN_CAPABILITY · SECURITY_BLOCKER |

All tests listed are in addition to the existing suite: 618 Vitest tests, run in this audit with 617 passing and 1 environment-only failure. See audit §1.

---

## 6. Logic that must move out of the transport layer first

| # | Where it lives today | Why it blocks API reuse | Target |
|---|---|---|---|
| T-1 | `_actions/admin.ts` `riskFlagAction` | Direct DB writes. **No conflict-of-interest check** when resolving deal delivery-review flags (which are release blockers). Audit outside the transaction (**SECURITY_BLOCKER S-H1**) | `risk/service.resolveRiskFlag(actor, …)`: party check like `setDealFinancialHold`, step-up, one transaction |
| T-2 | `_actions/admin.ts` `customerStatusAction` | Direct `users.status` update. No step-up. Audit outside the transaction. Sessions not explicitly revoked | `customers/service.setCustomerStatus(actor, …)` |
| T-3 | `_actions/account.ts` `updateProfileAction` | Direct update, no audit | `customers/service.updateProfile(actor, …)` |
| T-4 | `_actions/shop.ts` `toggleWishlistAction` | Direct DB logic | `customers/wishlist.toggle(actor, …)` |
| T-5 | `_actions/admin.ts` `runSettlementAction` | Permission, step-up and audit live in the action. `runScheduledSettlement()` itself has no `Actor` | `runScheduledSettlement(actor?, …)` with the checks inside |
| T-6 | 92 of 162 `page.tsx` files run direct DB reads (shop 23/59, seller 16/28, admin 53/75). Admin pages authorize reads with `adminWith(permission)` in the page. Several admin query functions take **no Actor** (`withdrawalQueue`, `refundQueue`, `refundDetail`, `reconQueue`, `recentApprovals`, `openMovementRequests`, `pendingClosures`, `ticketQueue`, `getAllSettings`) | An API that calls these directly would have to re-implement authorization in the handler | Query services `xxxQuery(actor, filters)` with `requirePermission` inside. The pages then call the same functions |
| T-7 | Allowed actions, deadlines and badges are derived in page components | Mobile would otherwise invent the state machine | `allowedActionsFor(actor, entity)` query functions |

---

## 7. Endpoint catalogue

There are **293** mobile-required operations. One endpoint covers one domain operation; where several closely related operations share one endpoint, the reuse column lists every function it calls.

| Audience | Endpoints | READY_SERVICE | SERVICE_NEEDS_REFACTOR | MISSING_DOMAIN_CAPABILITY | SECURITY_BLOCKER |
|---|---|---|---|---|---|
| Customer (incl. 18 public/auth) | 116 | 91 | 20 | 5 | 0 |
| Seller | 56 | 49 | 7 | 0 | 0 |
| Admin | 76 | 48 | 24 | 3 | 1 |
| Finance | 45 | 31 | 14 | 0 | 0 |
| **Total** | **293** | **219 (74.7 %)** | **65 (22.2 %)** | **8 (2.7 %)** | **1 (0.3 %)** |

**Cross-cutting prerequisites.** These are not counted above, but every endpoint depends on them. See §3 and §4.

- Bearer authentication and device sessions (SB-1)
- The adapter layer and lint rule
- The OpenAPI 3.1 contract
- The allowed-actions projection
- The generic `Idempotency-Key`
- Audit channel attribution
- Mobile rate-limit tiers
- FCM/APNs push

### Customer: identity, sessions (12)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-AUTH-01 | `POST /api/v1/auth/register` | Public | auth/service.register() | RegisterReq{fullName,email,phone,password,deviceId,deviceName,platform} | AuthTokens{accessToken,refreshToken,expiresAt,user} | anonymous | H | — | E register:ip 10/h | — | — | A | none | CT RP SEC | SERVICE_NEEDS_REFACTOR — core logic reusable; createSession() must issue a MOBILE-scope device-bound session (scope CHECK only allows WEB\|ADMIN) |
| C-AUTH-02 | `POST /api/v1/auth/login` | Public | auth/service.login(scope) | LoginReq{identifier,password,deviceId,deviceName,platform} | AuthTokens | anonymous | — | A atomic failed-login counter | E login-ip 30/15m + login-id 10/15m | — | — | A | none | CT SEC | SERVICE_NEEDS_REFACTOR — same as above; per-IP bucket hurts carrier-grade NAT (S-M3) |
| C-AUTH-03 | `POST /api/v1/auth/token/refresh` | Public | — (new) | RefreshReq{refreshToken,deviceId} | AuthTokens | refresh token bound to device | — | L session row | S | — | — | A | none | CT SEC RP | MISSING_DOMAIN_CAPABILITY — no refresh-token concept exists; sessions are opaque cookie tokens |
| C-AUTH-04 | `POST /api/v1/auth/logout` | Customer | auth/service.logout(token) | — | 204 | bearer | S | — | T | — | — | NA | none | CT | READY_SERVICE — add audit event (logout is not audited today) |
| C-AUTH-05 | `POST /api/v1/auth/password/forgot` | Public | auth/service.requestPasswordReset() | {identifier} | 202 (always) | anonymous | — | — | E pwreset 5/15m/ip + 3/h/account | — | — | — | none | CT SEC | READY_SERVICE |
| C-AUTH-06 | `POST /api/v1/auth/password/reset` | Public | auth/service.resetPassword() | {token,newPassword} | 204 | single-use token | S token usedAt | L | T | — | — | A | none | CT SEC | READY_SERVICE — revokes all sessions incl. mobile |
| C-AUTH-07 | `POST /api/v1/me/password` | Customer | auth/service.changePassword() | {current,next} | AuthTokens | bearer | — | — | E pwchange 5/15m | — | — | A | none | CT SEC | SERVICE_NEEDS_REFACTOR — returns a WEB session token; needs mobile session variant |
| C-AUTH-08 | `POST /api/v1/me/verification/{channel}/send` | Customer | auth/service.sendVerificationCode() | — | 202 | bearer | — | — | E 5/h | — | — | — | none | CT | READY_SERVICE — PHONE refused while SMS unavailable |
| C-AUTH-09 | `POST /api/v1/me/verification/{channel}/confirm` | Customer | auth/service.confirmVerificationCode() | {code} | {verified} | bearer | S | — | E 10/15m | — | — | — | none | CT | READY_SERVICE |
| C-AUTH-10 | `GET /api/v1/me/sessions` | Customer | page query in (shop)/account/security | — | Session[]{id,device,platform,lastSeenAt,current} | bearer | — | — | T | — | — | N | none | CT AZ | SERVICE_NEEDS_REFACTOR — extract query; add device fields |
| C-AUTH-11 | `DELETE /api/v1/me/sessions/{id}` | Customer | — (new) | — | 204 | bearer, own session | — | — | T | SU* | — | A | none | CT AZ | MISSING_DOMAIN_CAPABILITY — no per-session revoke exists |
| C-AUTH-12 | `POST /api/v1/me/sessions/revoke-others` | Customer | auth/service.revokeAllSessions() (unused, not audited, not transactional) | — | 204 | bearer | — | — | T | SU* | — | A | none | CT AZ | SERVICE_NEEDS_REFACTOR |

### Public: catalog, content, app config (12)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P-CAT-01 | `GET /api/v1/catalog/categories` | Public | catalog/taxonomy.categoryTree() | — | Category[] | public | — | — | T | — | — | — | none | CT | READY_SERVICE |
| P-CAT-02 | `GET /api/v1/catalog/search` | Public | catalog/search.searchProducts() | q,category,brand,condition,price,governorateId,sort,page | Page<ProductCard> | public | — | — | T | — | — | — | none | CT | READY_SERVICE — governorate passed explicitly (web reads it from cookie) |
| P-CAT-03 | `GET /api/v1/catalog/products/{slug}` | Public | catalog/search.productDetailBySlug() | governorateId | ProductDetail | public | — | — | T | — | — | — | none | CT | READY_SERVICE |
| P-CAT-04 | `GET /api/v1/catalog/products/{id}/reviews` | Public | reviews/service.productReviewsPublic() | page | Page<Review> | public | — | — | T | — | — | — | none | CT | READY_SERVICE |
| P-CAT-05 | `GET /api/v1/catalog/stores/{slug}` | Public | page query in (shop)/store/[slug] + reviews.sellerReviewsPublic() | page | StorePage | public | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR — extract store read model |
| P-CAT-06 | `GET /api/v1/catalog/brands/{slug}` | Public | page query in (shop)/brand/[slug] | page | BrandPage | public | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR |
| P-CAT-07 | `GET /api/v1/catalog/governorates` | Public | web/context.allGovernorates() | — | Governorate[] | public | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR — lives in the web layer; move to a module |
| P-CAT-08 | `GET /api/v1/content/home` | Public | cms/service.activeBlocks() | — | HomeLayout | public | — | — | T | — | — | — | none | CT | READY_SERVICE |
| P-CAT-09 | `GET /api/v1/content/legal/{code}` | Public | cms/service.currentLegal() | — | LegalDoc{code,version,body} | public | — | — | T | — | — | — | none | CT | READY_SERVICE |
| P-CAT-10 | `GET /api/v1/content/pages/{slug}` | Public | cms/service.pageBySlug() | — | Page | public | — | — | T | — | — | — | none | CT | READY_SERVICE |
| P-CAT-11 | `GET /api/v1/used/passports/{code}` | Public | used/views.passportPage() | — | Passport | public | — | — | T | — | — | — | none | CT | READY_SERVICE |
| P-APP-01 | `GET /api/v1/app/config` | Public | — (new) | platform,version | AppConfig{minVersion,flags,realMoneyEnabled,dealsAvailable} | public | — | — | T | — | — | — | none | CT | MISSING_DOMAIN_CAPABILITY — force-update gate; realMoneyEnabled is read-only (settings.realMoneyEnabled()) |

### Customer: cart, wishlist, addresses, checkout, orders, payments (19)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-CART-01 | `GET /api/v1/cart` | Customer | commerce/cart.cartView({userId},gov) | governorateId | CartView (server-priced, grouped by seller) | bearer | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-CART-02 | `POST /api/v1/cart/items` | Customer | commerce/cart.addToCart() | {variantId,quantity} | CartView | bearer | S upsert | — | T | — | — | — | none | CT | READY_SERVICE |
| C-CART-03 | `PATCH /api/v1/cart/items/{variantId}` | Customer | commerce/cart.updateCartItem() | {quantity} | CartView | bearer | S | — | T | — | — | — | none | CT | READY_SERVICE |
| C-CART-04 | `POST /api/v1/cart/merge-guest` | Customer | commerce/cart.mergeGuestCart() | {guestToken} | CartView | bearer | S | — | T | — | — | — | none | CT | READY_SERVICE |
| C-WISH-01 | `GET /api/v1/me/wishlist` | Customer | page query in account/wishlist | page | Page<ProductCard> | bearer | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR |
| C-WISH-02 | `PUT /api/v1/me/wishlist/{productId}` | Customer | inline DB logic in _actions/shop.toggleWishlistAction | {saved:boolean} | {saved} | bearer | S | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR — logic lives in the Server Action; move to a service |
| C-ADDR-01 | `GET /api/v1/me/addresses` | Customer | customers/addresses.myAddresses() | — | Address[] | bearer | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-ADDR-02 | `POST /api/v1/me/addresses` | Customer | customers/addresses.saveAddress() | AddressReq | Address | bearer | H | — | T | — | — | A | none | CT | READY_SERVICE |
| C-ADDR-03 | `DELETE /api/v1/me/addresses/{id}` | Customer | customers/addresses.archiveAddress() | — | 204 | bearer, owner | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-CHK-01 | `GET /api/v1/checkout/quote` | Customer | commerce/cart.cartView + pricing.priceLines (assembled in checkout page) | {addressId,paymentMethod} | CheckoutQuote{groups,totals,expectedTotal,pricingVersionId} | bearer | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR — expose the exact quote placeOrder() re-validates |
| C-CHK-02 | `POST /api/v1/orders` | Customer | commerce/orders.placeOrder() | {addressId,paymentMethod,checkoutKey,expectedTotal,expectedPricingVersionId,note} | {order,created,payment} | bearer; identity APPROVED; commerce gate; pilot | K checkoutKey | A advisory lock per customer; V expectedTotal; conditional stock reserve | T | — | — | A | creates payment obligation; no journal | CT AZ RP CC | READY_SERVICE |
| C-ORD-01 | `GET /api/v1/orders` | Customer | commerce/orders.customerOrders(userId) | page | Page<OrderSummary> | bearer (scoped by userId) | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-ORD-02 | `GET /api/v1/orders/{id}` | Customer | commerce/orders.orderForCustomer() + loadOrderGraph() + page logic | — | OrderDetail{subOrders[{status,allowedActions,deadlines}]} | bearer, owner | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — allowedActions/deadlines derived in page components today; add server projection |
| C-ORD-03 | `POST /api/v1/orders/{id}/cancel` | Customer | commerce/orders.cancelUnpaidOrder() | — | OrderDetail | bearer, owner | S | L | T | — | — | A | releases stock reservation | CT AZ RP | READY_SERVICE |
| C-PAY-01 | `GET /api/v1/payments/{id}` | Customer | account/orders/[id]/pay page (service reads) | — | PaymentInstructions{method,destinations,amountDue,dueAt,isTest} | bearer, payer | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — assemble DTO in a query service; show TEST banner when isTest |
| C-PAY-02 | `POST /api/v1/payments/{id}/proof` | Customer | payments/service.submitProof() | multipart{reference,claimedAmount,payerName,notes,clientKey,proof} | {submission,created} | bearer, payer; identity APPROVED | K clientKey | L | E proof 10/h | — | — | A | none (never marks paid) | CT AZ RP | READY_SERVICE |
| C-SO-01 | `POST /api/v1/seller-orders/{id}/confirm-receipt` | Customer | commerce/fulfilment.confirmReceipt() | — | {alreadyConfirmed,released:false} | bearer, buyer (actor.type CUSTOMER) | S | L | T | — | — | A | entitlement only; no journal | CT AZ RP CC | READY_SERVICE |
| C-SO-02 | `POST /api/v1/seller-orders/{id}/cancellation-requests` | Customer | commerce/fulfilment.requestCancellation() | {note} | CancellationRequest | bearer, buyer | S | L | T | — | — | A | may create refund request later | CT AZ | READY_SERVICE |
| C-SO-03 | `POST /api/v1/seller-orders/{id}/problems` | Customer | commerce/fulfilment.reportOrderProblem() | {kind,description} | Dispute | bearer, buyer | S | L | T | — | — | A | opens dispute = release hold | CT AZ CC | READY_SERVICE |

### Customer: returns, replacements, disputes, reviews (13)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-RET-01 | `POST /api/v1/returns` | Customer | postpurchase/returns.requestReturn() | multipart{sellerOrderId,items[],reason,description,evidence[]} | Return | bearer, buyer; return window | H | L | T | — | — | A | none (refund later via approval) | CT AZ | READY_SERVICE |
| C-RET-02 | `GET /api/v1/returns` | Customer | postpurchase/returns.returnsForCustomer() | — | Return[] | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-RET-03 | `GET /api/v1/returns/{id}` | Customer | postpurchase/returns.returnGraph() | — | ReturnDetail | bearer, party | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-RET-04 | `POST /api/v1/returns/{id}/shipment` | Customer | postpurchase/returns.customerShipsReturn() | {carrier,tracking} | ReturnDetail | bearer, buyer | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-RET-05 | `POST /api/v1/returns/{id}/escalate` | Customer | postpurchase/returns.escalateReturn() | {description} | Dispute | bearer, party | S | L | T | — | — | A | hold | CT AZ | READY_SERVICE |
| C-REP-01 | `POST /api/v1/seller-orders/{id}/replacements` | Customer | — (new) | {items,reason,evidence} | Replacement | bearer, buyer | H | L | T | — | — | A | none | CT AZ | MISSING_DOMAIN_CAPABILITY — no marketplace replacement entity; REPLACEMENT dispute decision has no order-side effect (F-3) |
| C-DSP-01 | `POST /api/v1/disputes` | Customer | postpurchase/disputes.openDispute() | multipart{sellerOrderId\|dealId,reasonCode,description,evidence[]} | Dispute | bearer, party | H | L | T | — | — | A | hold | CT AZ CC | READY_SERVICE |
| C-DSP-02 | `GET /api/v1/disputes` | Customer | postpurchase/disputes.disputesForUser() + disputesAsRespondent() | — | Dispute[] | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-DSP-03 | `GET /api/v1/disputes/{id}` | Customer | postpurchase/disputes.disputeGraph() | — | DisputeDetail | bearer, party | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-DSP-04 | `POST /api/v1/disputes/{id}/messages` | Customer | postpurchase/disputes.addDisputeMessage(internal=false) | multipart{body,attachment?} | DisputeMessage | bearer, party | H | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-REV-01 | `POST /api/v1/reviews/products` | Customer | reviews/service.createProductReview() | {orderItemId,rating,title,body,photos?} | Review | bearer, verified purchase | S one per item | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-REV-02 | `POST /api/v1/reviews/sellers` | Customer | reviews/service.createSellerReview() | {sellerOrderId,rating,body} | Review | bearer, verified purchase | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-REV-03 | `POST /api/v1/reviews/{id}/reports` | Customer | reviews/service.reportReview() | {reason} | 204 | bearer | S | — | T | — | — | A | none | CT | READY_SERVICE |

### Customer: Protected Deals (buyer and deal seller) (26)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-DEAL-01 | `POST /api/v1/deals` | Customer | deals/service.createDeal() | Step1{title,description,condition,categoryId,quantity,sourceUrl} | Deal | bearer; SMS available | H | — | E deal-create 20/24h | — | — | A | none | CT AZ | READY_SERVICE |
| C-DEAL-02 | `PUT /api/v1/deals/{id}/steps/{step}` | Customer | deals/service.saveDealStep() | StepN payload | Deal | bearer, buyer, DRAFT | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-DEAL-03 | `POST /api/v1/deals/{id}/photos` | Customer | deals/service.addDealPhotos() | multipart photos[] | Evidence[] | bearer, buyer, DRAFT | H | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-DEAL-04 | `POST /api/v1/deals/{id}/invitation` | Customer | deals/service.inviteSeller() | {acceptTerms} | {link,token} (shown once) | bearer, buyer; identity APPROVED; gates | S | L | T | — | — | A | none | CT AZ RP | READY_SERVICE — raw token returned once; never log response body |
| C-DEAL-05 | `POST /api/v1/deals/{id}/invitation/refresh` | Customer | deals/service.refreshInvitation() | — | {link,token} | bearer, buyer, INVITED | — | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-DEAL-06 | `DELETE /api/v1/deals/{id}/invitation` | Customer | deals/service.revokeInvitation() | — | Deal | bearer, buyer, INVITED | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-DEAL-07 | `GET /api/v1/deals` | Customer | deals/service.dealsForUser() | — | DealSummary[] | bearer (scoped) | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-DEAL-08 | `GET /api/v1/deals/{id}` | Customer | deals/service.dealGraph() + page-derived actions | — | DealDetail{deal,role,payment,evidence,allowedActions,deadlines} | bearer, party (role-filtered PII) | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — dealGraph is ready and privacy-filtered; allowedActions/deadlines must become a server projection |
| C-DEAL-09 | `GET /api/v1/deals/{id}/terms` | Customer | deals/service.termsHistory() | — | TermsVersion[] | bearer, party | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-DEAL-10 | `POST /api/v1/deals/{id}/offers/{version}/response` | Customer | deals/service.respondToOffer() | {decision:ACCEPT\|REQUEST_CHANGE\|REJECT,returnPolicy?,message?} | {status,version?} | bearer, buyer; identity APPROVED for ACCEPT | S (ACCEPT replay = no-op) | L + V version + stale-fee CONFLICT | T | — | — | A | freezes agreement + fee snapshot; no journal | CT AZ RP CC | READY_SERVICE |
| C-DEAL-11 | `POST /api/v1/deals/{id}/cancel` | Customer | deals/service.cancelDeal() | {reason} | Deal | bearer, buyer, pre-funding only | S | L | T | — | — | A | cancels unpaid payment | CT AZ | READY_SERVICE |
| C-DEAL-12 | `POST /api/v1/deals/{id}/payment` | Customer | deals/service.startDealPayment() | {method} | PaymentInstructions | bearer, buyer; identity APPROVED; gates | S returns existing | L | T | — | — | A | payment obligation; no journal | CT AZ RP | READY_SERVICE |
| C-DEAL-13 | `GET /api/v1/deals/{id}/delivery-otp` | Customer | deals/service.deliveryOtpForBuyer() | — | {active,expiresAt,attemptsLeft} (code only in non-prod test mode) | bearer, buyer only | — | — | T | — | — | — | none | CT AZ SEC | READY_SERVICE — production never returns the code (SMS only) |
| C-DEAL-14 | `POST /api/v1/deals/{id}/delivery-otp/regenerate` | Customer | deals/service.regenerateDeliveryOtp() | — | {expiresAt} | bearer, party; DELIVERED | — | L; lifetime guess budget | E 5/h/deal | — | — | A | none | CT AZ SEC | READY_SERVICE |
| C-DEAL-15 | `POST /api/v1/deals/{id}/receipt` | Customer | deals/service.confirmDealReceipt() | — | {alreadyConfirmed,alreadyCompleted} | bearer, buyer; verified OTP handover; payment CONFIRMED | S | L | T | — | — | A | entitlement only; release needs admin maker+checker | CT AZ RP CC | READY_SERVICE |
| C-DEAL-16 | `POST /api/v1/deals/{id}/not-received` | Customer | deals/service.reportNotReceived() | {description} | {conflict,dispute} | bearer, buyer | S | L | T | — | — | A | hold (dispute + risk flag) | CT AZ CC | READY_SERVICE |
| C-DEAL-17 | `POST /api/v1/deals/{id}/delivery-exception` | Customer | deals/service.reportDeliveryException() | {description} | Dispute | bearer, party | S | L | T | — | — | A | hold | CT AZ | READY_SERVICE |
| C-INV-01 | `GET /api/v1/deal-invitations/{token}` | Public | deals/service.invitationByToken(token,viewer) | — | InvitationSummary (no buyer PII) | token (+optional bearer) | — | — | S strict per IP + token format check | — | — | A first open | none | CT SEC | READY_SERVICE — add rate limit at API tier (none on this read today) |
| C-INV-02 | `POST /api/v1/deal-invitations/{token}/claim` | Customer | deals/service.claimInvitation() | — | {dealId} | bearer; not the buyer; binds once | S (same account replay) | L deal→invitation lock order | E 20/h | — | — | A | none | CT AZ RP CC | READY_SERVICE |
| C-INV-03 | `POST /api/v1/deal-invitations/reject` | Customer | deals/service.rejectInvitation() | {token?\|dealId?,reason} | 204 | bearer; bound seller or token holder | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-DSL-01 | `POST /api/v1/deals/{id}/offers` | Customer | deals/service.submitSellerOffer() | {details?,location?,payout?,offer,returnPolicy,message,acceptTerms} | {version} | bearer, bound deal seller; identity APPROVED; phone verified | H | L + supersedes open versions | T | — | — | A | none | CT AZ CC | READY_SERVICE |
| C-DSL-02 | `POST /api/v1/deals/{id}/change-requests/{version}/response` | Customer | deals/service.respondToChangeRequest() | {decision:ACCEPT\|REJECT} | {status,version?} | bearer, deal seller | S | L + V version | T | — | — | A | ACCEPT freezes agreement | CT AZ CC | READY_SERVICE |
| C-DSL-03 | `POST /api/v1/deals/{id}/shipment` | Customer | deals/service.markDealDelivered() | multipart{note,proof[]} | Deal (DELIVERED = shipped) | bearer, deal seller; ACTIVE | S state | L | T | — | — | A | none; issues OTP SMS to buyer | CT AZ | READY_SERVICE |
| C-DSL-04 | `POST /api/v1/deals/{id}/delivery-otp/verify` | Customer | deals/service.verifyDeliveryOtp() | {code} | {status:DELIVERY_HANDOVER_VERIFIED} | bearer, deal seller only | S single use | L; lifetime guess budget 30 | E 10/15m/deal + 20/15m/user | — | — | A (never the code) | none; starts buyer window | CT AZ SEC CC | READY_SERVICE — request body must be excluded from logs/Sentry |
| C-USED-01 | `POST /api/v1/deals/{id}/condition-report` | Customer | used/reports.ensureDealReport() + saveReportAnswers() + addReportEvidence() + declareReport() | multipart answers/evidence | ConditionReport | bearer, deal seller | H | L + DB lock triggers | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-USED-02 | `POST /api/v1/deals/{id}/condition-amendments` | Customer | used/snapshots.proposeConditionAmendment() / respondConditionAmendment() | {...}\|{decision} | Amendment | bearer, party | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |

### Customer: identity (KYC), receiving destinations, earnings, refunds (10)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-KYC-01 | `GET /api/v1/me/identity` | Customer | identity/service.myIdentity() | — | IdentityStatus | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-KYC-02 | `POST /api/v1/me/identity` | Customer | identity/service.submitIdentity() | multipart{nationalId,fullName,front,back,...} | IdentityStatus | bearer | H | L | T | — | — | A | none | CT AZ SEC | READY_SERVICE — images: strip EXIF client-side; FLAG_SECURE on capture screen |
| C-RCV-01 | `GET /api/v1/me/receiving-destinations` | Customer | identity/receiving.myReceivingDestinations() | — | Destination[] (masked) | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-RCV-02 | `POST /api/v1/me/receiving-destinations` | Customer | identity/receiving.submitReceivingDestination() | {type,details,holderName} | Destination (PENDING_REVIEW) | bearer | H | — | T | SU* | — | A | changes where money can go (needs admin review) | CT AZ SEC | READY_SERVICE |
| C-RCV-03 | `DELETE /api/v1/me/receiving-destinations/{id}` | Customer | identity/receiving.archiveReceivingDestination() | — | 204 | bearer, owner | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-ERN-01 | `GET /api/v1/me/earnings` | Customer | page queries in account/earnings + withdrawals.accountWithdrawals() | — | Earnings{dealPayables,withdrawals[]} (projection) | bearer | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — balance projection assembled in the page |
| C-ERN-02 | `POST /api/v1/me/withdrawals/preview` | Customer | finance/withdrawals.previewAccountWithdrawal() | {amount,destination} | TransferQuote | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-ERN-03 | `POST /api/v1/me/withdrawals` | Customer | finance/withdrawals.requestAccountWithdrawal() | {amount,clientKey,destination} | {withdrawal,created} | bearer; identity APPROVED | K clientKey | A account advisory lock; authoritative check at approval | E | SU* | — | A | none at request (reservation at approval) | CT AZ RP CC | READY_SERVICE |
| C-ERN-04 | `POST /api/v1/me/withdrawals/{id}/cancel` | Customer | finance/withdrawals.cancelWithdrawal() | — | Withdrawal | bearer, requester | S | L | T | — | — | A | none (pre-approval) | CT AZ | READY_SERVICE |
| C-RFD-01 | `PUT /api/v1/me/refunds/{id}/destination` | Customer | finance/refunds.useReceivingDestinationForRefund() (customer branch) | {destinationId,reason} | Refund | bearer, refund owner | S | L | T | SU* | 2P re-approval by staff before payout | A | changes refund destination | CT AZ SEC | READY_SERVICE |

### Customer: account, notifications, messaging, support, files (24)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-ACC-01 | `GET /api/v1/me` | Customer | web/context.headerState() + page queries in /account | — | Me{user,roles,seller?,identityStatus,counts} | bearer | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR |
| C-ACC-02 | `PATCH /api/v1/me` | Customer | inline DB update in _actions/account.updateProfileAction | {fullName} | Me | bearer | — | E If-Match | T | — | — | A | none | CT | SERVICE_NEEDS_REFACTOR — logic in Server Action; no audit today |
| C-ACC-03 | `POST /api/v1/me/closure` | Customer | customers/closure.requestAccountClosure() | {reason} | ClosureRequest | bearer; no blockers | S | A account lock | T | SU* | — | A | none | CT AZ | READY_SERVICE — store requirement: in-app account deletion |
| C-ACC-04 | `DELETE /api/v1/me/closure` | Customer | customers/closure.withdrawAccountClosure() | — | 204 | bearer | S | A | T | — | — | A | none | CT | READY_SERVICE |
| C-ACC-05 | `GET /api/v1/me/store-invitations` | Customer | sellers/service.staffInvitationsForUser() | — | Invitation[] | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-ACC-06 | `POST /api/v1/me/store-invitations/{id}/response` | Customer | sellers/service.respondToStaffInvitation() | {decision} | 204 | bearer, invitee | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-NTF-01 | `GET /api/v1/me/notifications` | Customer | notifications inbox query (service reads used by page) | cursor | Page<Notification> | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-NTF-02 | `POST /api/v1/me/notifications/read` | Customer | notifications/notify.markRead() | {ids?\|all} | 204 | bearer | S | — | T | — | — | — | none | CT | READY_SERVICE |
| C-NTF-03 | `GET /api/v1/me/notification-preferences` | Customer | notifications/message-alerts.prefsFor() | — | Prefs | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-NTF-04 | `PUT /api/v1/me/notification-preferences` | Customer | notifications/message-alerts.savePrefs() | Prefs | Prefs | bearer | S | — | T | — | — | — | none | CT | READY_SERVICE |
| C-NTF-05 | `PUT /api/v1/me/push-tokens` | Customer | — (new; web-push saveSubscription() is VAPID-only) | {provider:FCM\|APNS,token,deviceId,appId} | 204 | bearer | S upsert | — | T | — | — | A | none | CT SEC | MISSING_DOMAIN_CAPABILITY — FCM/APNs channel missing; lock-screen-safe payload policy needed |
| C-NTF-06 | `DELETE /api/v1/me/push-tokens/{deviceId}` | Customer | notifications/push.revokeSubscription() (adapt) | — | 204 | bearer, owner | S | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR |
| C-MSG-01 | `GET /api/v1/conversations` | Customer | messaging/service.listForUser() | cursor | Conversation[] | bearer | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-MSG-02 | `GET /api/v1/conversations/{id}/messages` | Customer | messaging/service.participantThread()/loadMessages() | after | Message[] | bearer, participant | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-MSG-03 | `POST /api/v1/conversations/{id}/messages` | Customer | messaging/service.sendMessage() | multipart{body,attachment?,clientKey} | Message | bearer, participant; write state | H | — | E (service) | — | — | — | none | CT AZ | READY_SERVICE |
| C-MSG-04 | `POST /api/v1/messages/{id}/reports` | Customer | messaging/service.reportMessage() | {reason} | 204 | bearer, participant | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-MSG-05 | `GET /api/v1/live` | Customer | api/live route (cookie-bound liveActor) | v,since,conv | LiveSnapshot | bearer | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR — replace polling with push + delta endpoint; reuse liveSnapshot() |
| C-SUP-01 | `POST /api/v1/support/tickets` | Customer | support/service.openTicket() | multipart{type,subject,body,linkedEntity?,attachment?} | Ticket | bearer | H | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-SUP-02 | `GET /api/v1/support/tickets` | Customer | support/service.myTickets() | — | Ticket[] | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| C-SUP-03 | `GET /api/v1/support/tickets/{id}` | Customer | support/service.ticketThread() | — | TicketThread | bearer, owner | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| C-SUP-04 | `POST /api/v1/support/tickets/{id}/messages` | Customer | support/service.replyToTicket() | multipart{body,attachment?} | TicketMessage | bearer, owner | H | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-SUP-05 | `POST /api/v1/support/tickets/{id}/reopen` | Customer | support/service.reopenTicket() | {reason} | Ticket | bearer, owner | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| C-SUP-06 | `POST /api/v1/support/tickets/{id}/rating` | Customer | support/service.rateTicket() | {rating,comment} | 204 | bearer, owner | S | — | T | — | — | A | none | CT | READY_SERVICE |
| C-FILE-01 | `GET /api/v1/files/{id}` | Customer | storage/access.readPrivateFile() via cookie-only /api/files/[id] | download? | binary (no-store) | bearer; purpose-specific record authz | — | — | T | — | — | A sensitive purposes | none | CT AZ SEC | SERVICE_NEEDS_REFACTOR — route resolves cookies only; add bearer actor resolution |

### Seller Center (56)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S-ONB-01 | `POST /api/v1/seller/application` | Customer | sellers/service.startApplication() | {type:INDIVIDUAL\|BUSINESS} | Seller (DRAFT) | bearer | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ONB-02 | `PUT /api/v1/seller/application/identity` | Seller | sellers/service.saveIdentity() | IdentityReq | Seller | bearer, applicant | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ONB-03 | `PUT /api/v1/seller/application/business` | Seller | sellers/service.saveBusiness() | BusinessReq | Seller | bearer, applicant | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ONB-04 | `PUT /api/v1/seller/application/store` | Seller | sellers/service.saveStore() | multipart StoreReq+logo | Store | bearer, applicant | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ONB-05 | `POST /api/v1/seller/application/documents` | Seller | sellers/service.uploadSellerDocument() | multipart{kind,file} | Document (metadata only) | bearer, applicant | H | — | T | — | — | A | none | CT AZ SEC | READY_SERVICE |
| S-ONB-06 | `POST /api/v1/seller/application/submit` | Seller | sellers/service.submitApplication() | {acceptAgreement} | Seller (PENDING_REVIEW) | bearer, applicant | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ONB-07 | `GET /api/v1/seller/application` | Seller | sellers/service.applicationChecklist() + onboarding page queries | — | ApplicationStatus{status,checklist,reasons} | bearer, applicant | — | — | T | — | — | — | none | CT | SERVICE_NEEDS_REFACTOR |
| S-CTX-01 | `GET /api/v1/seller/me` | Seller | sellers/service.sellerContextForUser() | — | SellerContext{seller,role,permissions} | bearer | — | — | T | — | — | — | none | CT | READY_SERVICE |
| S-DSH-01 | `GET /api/v1/seller/dashboard` | Seller | reports/service.sellerDashboard() | range | SellerDashboard | bearer, seller | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-PRD-01 | `GET /api/v1/seller/products` | Seller | catalog/products.sellerListingsVisible() (used by page) | status,q,page | Page<SellerProduct> | products.manage | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-PRD-02 | `POST /api/v1/seller/products` | Seller | catalog/products.createDraft() | {categoryId,condition,...} | Product (DRAFT) | products.manage; seller APPROVED | H | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-PRD-03 | `GET /api/v1/seller/products/{id}` | Seller | catalog/products.productForSellerEdit() | — | ProductEdit | products.manage, own store | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-PRD-04 | `PATCH /api/v1/seller/products/{id}` | Seller | catalog/products.updateDetails()/updateLogistics() | DetailsReq\|LogisticsReq | ProductEdit | products.manage, own store | — | E If-Match (missing today: last-write-wins) | T | — | — | A | none | CT AZ CC | SERVICE_NEEDS_REFACTOR — add optimistic concurrency for multi-device edits |
| S-PRD-05 | `PUT /api/v1/seller/products/{id}/variants` | Seller | catalog/products.saveVariants() | Variant[] | Variant[] | products.manage | — | E If-Match | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-PRD-06 | `POST /api/v1/seller/products/{id}/images` | Seller | catalog/products.addImages() | multipart images[] | Image[] | products.manage | H | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-PRD-07 | `DELETE /api/v1/seller/products/{id}/images/{imageId}` | Seller | catalog/products.removeImage() | — | 204 | products.manage | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-PRD-08 | `POST /api/v1/seller/products/{id}/submission` | Seller | catalog/products.submitForReview() / withdrawSubmission() | {action:SUBMIT\|WITHDRAW} | Product | products.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-PRD-09 | `POST /api/v1/seller/products/{id}/listing` | Seller | catalog/products.setListingActive()/archiveProduct()/markOutOfStock() | {action} | Product | products.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-INV-01 | `PUT /api/v1/seller/variants/{id}/stock` | Seller | catalog/inventory.setStock() | {stockOnHand,reason} | Variant | inventory.manage | S | DB CHECK 0≤reserved≤onHand | T | — | — | A | none | CT AZ CC | READY_SERVICE |
| S-USED-01 | `POST /api/v1/seller/products/{id}/condition-report` | Seller | used/reports.ensureProductReport()+saveReportAnswers()+addReportEvidence()+declareReport() | multipart | ConditionReport | products.manage | H | DB lock triggers | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ORD-01 | `GET /api/v1/seller/orders` | Seller | seller orders list (service reads used by page) | status,page | Page<SellerOrderSummary> | orders.manage | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-ORD-02 | `GET /api/v1/seller/orders/{id}` | Seller | commerce/fulfilment.sellerOrderForSeller() + loadSellerOrderGraph() | — | SellerOrderDetail{allowedActions,deadlines} | orders.manage, own store | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — allowedActions projection missing (derived in UI) |
| S-ORD-03 | `POST /api/v1/seller/orders/{id}/confirm` | Seller | commerce/fulfilment.confirmSellerOrder() | — | SellerOrderDetail | orders.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ORD-04 | `POST /api/v1/seller/orders/{id}/advance` | Seller | commerce/fulfilment.advanceSellerOrder() | {to:PROCESSING\|READY_TO_SHIP} | SellerOrderDetail | orders.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ORD-05 | `PUT /api/v1/seller/orders/{id}/shipment` | Seller | commerce/fulfilment.saveShipment() | multipart{carrier,tracking,...,waybill?} | Shipment | orders.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ORD-06 | `POST /api/v1/seller/orders/{id}/ship` | Seller | commerce/fulfilment.markShipped() | — | SellerOrderDetail | orders.manage | S | L | T | — | — | A | starts delivery-report deadline | CT AZ | READY_SERVICE |
| S-ORD-07 | `POST /api/v1/seller/orders/{id}/tracking-events` | Seller | commerce/fulfilment.addTrackingEvent() | {status:IN_TRANSIT\|FAILED,description} | TrackingEvent | orders.manage | H | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-ORD-08 | `POST /api/v1/seller/orders/{id}/delivery-evidence` | Seller | commerce/fulfilment.submitDeliveryEvidence() | multipart{carrierReference,note,files[]} | Evidence | orders.manage | H | L | T | — | — | A (append-only evidence) | none (seller statement never proves delivery) | CT AZ | READY_SERVICE |
| S-ORD-09 | `POST /api/v1/seller/orders/{id}/cancel` | Seller | commerce/fulfilment.cancelSellerOrder() | {reason,code} | SellerOrderDetail | orders.manage; pre-ship | S | L | T | — | — | A | refund request if paid | CT AZ | READY_SERVICE |
| S-ORD-10 | `POST /api/v1/seller/cancellation-requests/{id}/decision` | Seller | commerce/fulfilment.decideCancellationRequest() | {accept,note} | 204 | orders.manage | S | L | T | — | — | A | refund request if accepted | CT AZ | READY_SERVICE |
| S-ORD-11 | `POST /api/v1/seller/orders/{id}/shipment-exception` | Seller | commerce/fulfilment.recordShipmentException() | {code,note} | SellerOrderDetail | orders.manage | S | L | T | — | — | A | hold | CT AZ | READY_SERVICE |
| S-RET-01 | `GET /api/v1/seller/returns` | Seller | postpurchase/returns.returnsForSeller() | status | Return[] | returns.manage | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-RET-02 | `POST /api/v1/seller/returns/{id}/decision` | Seller | postpurchase/returns.approveReturn()/rejectReturn() | {decision,note\|reason} | ReturnDetail | returns.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-RET-03 | `POST /api/v1/seller/returns/{id}/received` | Seller | postpurchase/returns.markReturnReceived()/startInspection() | {action} | ReturnDetail | returns.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-RET-04 | `POST /api/v1/seller/returns/{id}/refund` | Seller | postpurchase/returns.acceptReturnRefund() | {amount?,includeShipping,restock,note} | ReturnDetail | returns.manage | S | L | T | — | — | A | creates refund REQUEST (money moves on admin approval) | CT AZ | READY_SERVICE |
| S-DSP-01 | `GET /api/v1/seller/disputes` | Seller | postpurchase/disputes.disputesAsRespondent() | — | Dispute[] | orders.manage | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-REV-01 | `POST /api/v1/seller/reviews/{id}/response` | Seller | reviews/service.respondToReview() | {body} | Review | reviews.respond | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-SHP-01 | `GET /api/v1/seller/shipping-rates` | Seller | page query in seller/shipping | — | Rate[27] | store.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| S-SHP-02 | `PUT /api/v1/seller/shipping-rates` | Seller | sellers/service.setShippingRates() | Rate[]{governorateId,enabled,fee,etaMinDays,etaMaxDays} | Rate[] | store.manage | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-STR-01 | `GET /api/v1/seller/store` | Seller | page query in seller/settings | — | StoreSettings | store.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| S-STR-02 | `PATCH /api/v1/seller/store` | Seller | sellers/service.updateStoreSettings() | multipart StoreSettings | StoreSettings | store.manage | — | E If-Match | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-PAY-01 | `GET /api/v1/seller/payout-methods` | Seller | page query in seller/settings | — | PayoutMethod[] (masked) | payout.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| S-PAY-02 | `POST /api/v1/seller/payout-methods` | Seller | sellers/service.addPayoutMethod() | {type,details,holderName} | PayoutMethod (PENDING_VERIFICATION) | payout.manage | H | — | T | SU* | 2P staff verification (verifyPayoutMethod) | A | payout hold period starts | CT AZ SEC | READY_SERVICE |
| S-FIN-01 | `GET /api/v1/seller/balance` | Seller | finance/ledger.sellerBalances() + finance page queries | — | SellerBalance{pending,available,reserved} (ledger projection) | finance.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — sellerBalances() ready; page adds holds/allocations |
| S-FIN-02 | `GET /api/v1/seller/statement` | Seller | finance/seller-statement (service) | from,to,cursor | Page<StatementLine> | finance.view | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-FIN-03 | `POST /api/v1/seller/withdrawals/preview` | Seller | finance/withdrawals.previewWithdrawal() | {amount} | TransferQuote | finance.withdraw | — | — | T | — | — | — | none | CT | READY_SERVICE |
| S-FIN-04 | `POST /api/v1/seller/withdrawals` | Seller | finance/withdrawals.requestWithdrawal() | {amount,clientKey} | {withdrawal,created} | finance.withdraw; identity APPROVED; no payout hold | K clientKey | A account lock; reserve at approval under lock | T | SU* | — | A | none at request | CT AZ RP CC | READY_SERVICE |
| S-FIN-05 | `GET /api/v1/seller/withdrawals` | Seller | finance/withdrawals.sellerWithdrawals() | — | Withdrawal[] | finance.view | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-FIN-06 | `POST /api/v1/seller/withdrawals/{id}/cancel` | Seller | finance/withdrawals.cancelWithdrawal() | — | Withdrawal | finance.withdraw | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-STF-01 | `GET /api/v1/seller/staff` | Seller | sellers/service.staffInvitationsForSeller() + members | — | Staff[] | staff.manage | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| S-STF-02 | `POST /api/v1/seller/staff/invitations` | Seller | sellers/service.inviteStaffMember() | {email,role} | Invitation | staff.manage | H | — | T | SU* | — | A | none | CT AZ | READY_SERVICE |
| S-STF-03 | `DELETE /api/v1/seller/staff/invitations/{id}` | Seller | sellers/service.revokeStaffInvitation() | — | 204 | staff.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| S-STF-04 | `DELETE /api/v1/seller/staff/{userId}` | Seller | sellers/service.removeStaffMember() | — | 204 | staff.manage | S | — | T | SU* | — | A | none | CT AZ | READY_SERVICE |
| S-2FA-01 | `POST /api/v1/seller/2fa/enroll` | Seller | auth/service.beginTotpEnrollment() | — | {otpauthUri} (shown once) | bearer | — | — | T | — | — | A | none | CT SEC | READY_SERVICE |
| S-2FA-02 | `POST /api/v1/seller/2fa/verify` | Seller | auth/service.verifyTotpForUser() | {code} | {enabled} | bearer | S replay-safe step | — | E 8/5m | — | — | A | none | CT SEC | READY_SERVICE |
| S-MSG-01 | `GET /api/v1/seller/conversations` | Seller | messaging/service.listForSeller() | cursor | Conversation[] | orders.communicate | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |

### Admin (76)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A-AUTH-01 | `POST /api/v1/admin/auth/login` | Admin | auth/service.login(scope ADMIN) | {identifier,password,deviceId,attestation?} | {challenge:TOTP_REQUIRED\|TOTP_ENROLL} | anonymous → staff | — | A | E 30/15m ip + 10/15m id | — | — | A | none | CT SEC | SERVICE_NEEDS_REFACTOR — needs bearer ADMIN-MOBILE session; host isolation (ENFORCE_ADMIN_HOST) has no API equivalent yet |
| A-AUTH-02 | `POST /api/v1/admin/auth/mfa` | Admin | auth/service.verifyTotpForUser() + elevateSession() | {code} | AuthTokens(mfaVerified) | pre-MFA staff session | S TOTP step replay-safe | — | E 8/5m | — | — | A | none | CT SEC | SERVICE_NEEDS_REFACTOR |
| A-AUTH-03 | `POST /api/v1/admin/auth/mfa/enroll` | Admin | auth/service.beginTotpEnrollment() | — | {otpauthUri} | pre-MFA staff session, not enrolled | — | — | T | — | — | A | none | CT SEC | READY_SERVICE |
| A-AUTH-04 | `POST /api/v1/admin/auth/step-up` | Admin | auth/service.stepUp() | {code,action?} | {stepUpUntil} | MFA session | — | — | E 8/5m | — | — | A | none | CT SEC | SERVICE_NEEDS_REFACTOR — session-wide 10-minute window today; mobile policy wants action-scoped grants (S-M1) |
| A-AUTH-05 | `POST /api/v1/admin/auth/logout` | Admin | auth/service.logout() | — | 204 | MFA session | S | — | T | — | — | NA | none | CT | READY_SERVICE |
| A-AUTH-06 | `GET /api/v1/admin/me/sessions` | Admin | — (new) | — | Session[] | MFA session | — | — | T | — | — | — | none | CT | MISSING_DOMAIN_CAPABILITY |
| A-AUTH-07 | `DELETE /api/v1/admin/me/sessions/{id}` | Admin | — (new) | — | 204 | MFA session | — | — | T | SU | — | A | none | CT AZ | MISSING_DOMAIN_CAPABILITY |
| A-DSH-01 | `GET /api/v1/admin/dashboard` | Admin | reports/service.adminDashboard() | — | AdminDashboard | dashboard.view (enforced inside service) | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| A-APR-01 | `GET /api/v1/admin/approvals` | Admin | finance/movements.openMovementRequests() + approvals page aggregation | type | ApprovalQueue | per-type permission | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — query takes no Actor; page enforces permission |
| A-CUS-01 | `GET /api/v1/admin/customers` | Admin | page query in admin/customers | q,cursor | Page<CustomerRow> (masked) | customers.view | — | — | T | — | — | NA search audited | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-CUS-02 | `GET /api/v1/admin/customers/{id}` | Admin | page queries in admin/customers/[id] (10 direct reads) | — | Customer360 | customers.view | — | — | T | — | — | NA view audited | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-CUS-03 | `POST /api/v1/admin/customers/{id}/status` | Admin | inline DB update in _actions/admin.customerStatusAction | {status,reason} | 204 | customers.manage | S | — | T | SU* | — | A (outside tx) | none | CT AZ SU | SERVICE_NEEDS_REFACTOR — move to a service; revoke sessions on disable; add step-up |
| A-CUS-04 | `POST /api/v1/admin/customers/{id}/sessions/revoke` | Admin | — (new) | {reason} | 204 | customers.manage | S | — | T | SU | — | A | none | CT AZ SU | MISSING_DOMAIN_CAPABILITY |
| A-CLS-01 | `GET /api/v1/admin/closures` | Admin | customers/closure.pendingClosures() | — | ClosureRequest[] | customers.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — query has no Actor/permission |
| A-CLS-02 | `POST /api/v1/admin/closures/{id}/complete` | Admin | customers/closure.completeAccountClosure() | {reason} | 204 | customers.manage | S | A | T | SU | — | A | none | CT AZ SU | READY_SERVICE |
| A-IDN-01 | `GET /api/v1/admin/identity` | Admin | identity/service.identityQueue() | status | IdentityCase[] | identity.view | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| A-IDN-02 | `GET /api/v1/admin/identity/{id}` | Admin | identity/service.identityCase() | — | IdentityCase | identity.view | — | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-IDN-03 | `POST /api/v1/admin/identity/{id}/decision` | Admin | identity/service.reviewIdentity() | {decision,reason,version} | IdentityCase | identity.review; never self-review | S | L + V version | T | SU | — | A | none | CT AZ SU | READY_SERVICE |
| A-IDN-04 | `POST /api/v1/admin/identity/{id}/reveal-number` | Admin | identity/service.revealIdentityNumber() | {reason} | {nationalId} | identity.documents.view | — | — | E | SU | — | A | none | CT AZ SU SEC | READY_SERVICE — response must never be cached/logged; FLAG_SECURE |
| A-RCV-01 | `GET /api/v1/admin/receiving-destinations` | Admin | identity/receiving.destinationQueue() | status | Destination[] | destinations.review | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — check Actor/permission inside query |
| A-RCV-02 | `POST /api/v1/admin/receiving-destinations/{id}/decision` | Admin | identity/receiving.reviewReceivingDestination() | {decision,reason} | Destination | destinations.review; not owner | S | L | T | SU | 2P (owner ≠ reviewer) | A | authorizes a payout destination | CT AZ SU | READY_SERVICE |
| A-RCV-03 | `POST /api/v1/admin/receiving-destinations/{id}/reveal` | Admin | identity/receiving.revealReceivingDestination() | {reason} | DestinationDetails | destinations.view_full | — | — | E | SU | — | A | none | CT AZ SU SEC | READY_SERVICE |
| A-SEL-01 | `GET /api/v1/admin/sellers` | Admin | page query in admin/sellers | status,q | Page<SellerRow> | sellers.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-SEL-02 | `GET /api/v1/admin/sellers/{id}` | Admin | page queries in admin/sellers/[id] (14 direct reads) | — | Seller360 | sellers.view | — | — | T | — | — | A | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-SEL-03 | `POST /api/v1/admin/sellers/{id}/decision` | Admin | sellers/service.decideSeller() | {decision,reason} | Seller | sellers.review \| sellers.suspend | S | L (machine) | T | SU* | — | A | none | CT AZ | READY_SERVICE — no step-up today on seller approval; mobile policy adds it |
| A-SEL-04 | `GET /api/v1/admin/sellers/{id}/documents` | Admin | sellers/service.sellerDocumentsFor() | — | Document[] (metadata) | sellers.documents.view | — | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-SEL-05 | `POST /api/v1/admin/sellers/{id}/reveal-national-id` | Admin | sellers/service.revealNationalId() | {reason} | {nationalId} | sellers.documents.view | — | — | E | SU | — | A | none | CT AZ SU SEC | READY_SERVICE |
| A-SEL-06 | `POST /api/v1/admin/payout-methods/{id}/decision` | Admin | sellers/service.verifyPayoutMethod() | {approve,reason} | PayoutMethod | sellers.payout.verify | S | L | T | SU | 2P | A | authorizes a payout destination | CT AZ SU | READY_SERVICE |
| A-PRD-01 | `GET /api/v1/admin/moderation/products` | Admin | page query in admin/moderation | status | ModerationItem[] | products.moderate | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-PRD-02 | `POST /api/v1/admin/products/{id}/moderation` | Admin | catalog/products.moderateProduct() | {decision,reason} | Product | products.moderate | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-PRD-03 | `POST /api/v1/admin/product-revisions/{id}/moderation` | Admin | catalog/products.moderateRevision() | {decision,reason} | Revision | products.moderate | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-ORD-01 | `GET /api/v1/admin/orders` | Admin | page query in admin/orders | filters | Page<OrderRow> | orders.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-ORD-02 | `GET /api/v1/admin/orders/{id}` | Admin | commerce/orders.loadOrderGraph() + page queries | — | Order360{subOrders,payments,shipments,evidence,ledgerRefs,timeline} | orders.view | — | — | T | — | — | A | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-ORD-03 | `POST /api/v1/admin/seller-orders/{id}/hold` | Admin | commerce/fulfilment.setFinancialHold() | {hold,reason} | 204 | orders.manage | S | L | T | SU (lift) | — | A | hold/lift (lift needs step-up) | CT AZ SU | READY_SERVICE |
| A-ORD-04 | `POST /api/v1/admin/seller-orders/{id}/cancel` | Admin | commerce/fulfilment.cancelSellerOrder() | {reason,code} | 204 | orders.manage | S | L | T | — | — | A | refund request if paid | CT AZ | READY_SERVICE |
| A-ORD-05 | `POST /api/v1/admin/seller-orders/{id}/delivery-event` | Admin | commerce/fulfilment.recordDeliveryEvent() | {reference,source} | 204 | delivery.verify; not seller | S | L | T | SU | — | A | starts buyer 24h window | CT AZ SU | READY_SERVICE |
| A-ORD-06 | `POST /api/v1/admin/seller-orders/{id}/delivery-exception-review` | Admin | commerce/fulfilment.reviewDeliveryException() | {decision,reason} | 204 | delivery.verify | S | L | T | SU (ESTABLISH) | — | A | may establish delivery | CT AZ SU | READY_SERVICE |
| A-ORD-07 | `POST /api/v1/admin/seller-orders/{id}/shipment-exception` | Admin | commerce/fulfilment.recordShipmentException() / resolveShipmentException() | {code\|outcome,reason} | 204 | delivery.verify | S | L | T | — | — | A | LOST/RETURNED → refund path | CT AZ | READY_SERVICE |
| A-ORD-08 | `POST /api/v1/admin/cancellation-requests/{id}/decision` | Admin | commerce/fulfilment.decideCancellationRequest() | {accept,note} | 204 | orders.manage | S | L | T | — | — | A | refund request | CT AZ | READY_SERVICE |
| A-PAY-01 | `GET /api/v1/admin/payments` | Admin | payments queue (service reads; permission in page) | status | PaymentRow[] | payments.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-PAY-02 | `GET /api/v1/admin/payments/{id}` | Admin | payment detail page reads | — | PaymentDetail{submissions,proofFiles} | payments.view | — | — | T | — | — | A | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-PAY-03 | `POST /api/v1/admin/payments/{id}/review` | Admin | payments/service.startReview() | — | 204 | payments.verify | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-PAY-04 | `POST /api/v1/admin/payments/{id}/confirm` | Finance | payments/service.confirmPayment() | {submissionId,note,expectedAmount} | {alreadyConfirmed} | payments.verify; payer≠actor; no self-dealing; kill switch | S + approval idempotencyKey payment-confirmation:{id} | L + V expectedAmount | E fin-approve 300/h | SU | approval (exempt from two-person by design: records money received) | A | Dr PLATFORM_CASH / Cr SELLER_PENDING + COMMISSION_DEFERRED (or DEAL_FUNDS_HELD) | CT AZ RP CC SU LB | READY_SERVICE |
| A-PAY-05 | `POST /api/v1/admin/payments/{id}/reject` | Admin | payments/service.rejectPayment() | {submissionId,reason,requestNewProof} | 204 | payments.verify | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-DEAL-01 | `GET /api/v1/admin/deals` | Admin | page query in admin/deals | status,q | Page<DealRow> | deals.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-DEAL-02 | `GET /api/v1/admin/deals/{id}` | Admin | deals/service.dealGraph() (ADMIN role) + deliveryOtpEvents() + termsHistory() | — | Deal360 (OTP status only, never code) | deals.view | — | — | T | — | — | A | none | CT AZ SEC | READY_SERVICE |
| A-DEAL-03 | `POST /api/v1/admin/deals/{id}/hold` | Admin | deals/service.setDealFinancialHold() | {hold,reason} | 204 | deals.manage; not a party | S | L | T | SU | — | A | blocks/unblocks release | CT AZ SU | READY_SERVICE |
| A-RISK-01 | `POST /api/v1/admin/risk-flags/{id}/resolve` | Admin | inline DB logic in _actions/admin.riskFlagAction | {reason} | 204 | deals.manage (deal) \| sellers.suspend | S | — | T | SU | — | A (outside tx) | resolving DELIVERY_CONFLICT/EXCEPTION flags removes a deal release blocker | CT AZ SU SEC | SECURITY_BLOCKER — no conflict-of-interest check (a party could clear their own deal blocker); audit not atomic (S-H1) |
| A-DSP-01 | `GET /api/v1/admin/disputes` | Admin | page query in admin/disputes | status | DisputeRow[] (SLA) | disputes.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-DSP-02 | `GET /api/v1/admin/disputes/{id}` | Admin | postpurchase/disputes.disputeGraph() | — | Dispute360 | disputes.manage | — | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-DSP-03 | `POST /api/v1/admin/disputes/{id}/workflow` | Admin | postpurchase/disputes.setDisputeStatus()/assignDispute() | {status\|assignee,note} | 204 | disputes.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-DSP-04 | `POST /api/v1/admin/disputes/{id}/messages` | Admin | postpurchase/disputes.addDisputeMessage(internal?) | multipart{body,internal,attachment?} | DisputeMessage | disputes.manage | H | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-DSP-05 | `POST /api/v1/admin/disputes/{id}/resolution` | Admin | postpurchase/disputes.resolveDispute() | {decision,amount?,reasonCode,note} | Dispute | disputes.manage; not a party; no self-dealing | S (OPEN check under lock) | L | T | SU | decision only; money via separate maker/checker | A | creates refund REQUEST / entitlement / re-delivery — no journal | CT AZ SU CC | READY_SERVICE — REPLACEMENT on seller orders has no effect (F-3) |
| A-DSP-06 | `POST /api/v1/admin/disputes/{id}/close` | Admin | postpurchase/disputes.closeDispute() | — | 204 | disputes.manage; RESOLVED only | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-RET-01 | `GET /api/v1/admin/returns` | Admin | page query in admin/returns | status | ReturnRow[] | returns.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-RET-02 | `POST /api/v1/admin/returns/{id}/decision` | Admin | postpurchase/returns.approveReturn()/rejectReturn()/acceptReturnRefund() | {op,...} | ReturnDetail | returns.manage | S | L | T | — | — | A | refund REQUEST | CT AZ | READY_SERVICE |
| A-SUP-01 | `GET /api/v1/admin/support/tickets` | Admin | support/service.ticketQueue() | status,assignee | Ticket[] | support.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — query takes no Actor; permission is page-level |
| A-SUP-02 | `GET /api/v1/admin/support/tickets/{id}` | Admin | support/service.ticketThread() | — | TicketThread | support.manage | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| A-SUP-03 | `POST /api/v1/admin/support/tickets/{id}/actions` | Admin | support/service.replyToTicket()/updateTicket()/escalateTicket()/reopenTicket()/qaReviewTicket() | {op,...} | TicketThread | support.manage \| support.escalate \| support.qa | H | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-MSG-01 | `GET /api/v1/admin/messages/reports` | Admin | messaging/service.reportQueue() | — | Report[] | messages.moderate | — | — | T | — | — | — | none | CT AZ | READY_SERVICE |
| A-MSG-02 | `GET /api/v1/admin/conversations/{id}` | Admin | messaging/service.staffThread() | purpose | Thread | messages.view + active access grant | — | — | T | — | — | A (privileged_message_access) | none | CT AZ | READY_SERVICE |
| A-MSG-03 | `POST /api/v1/admin/conversations/{id}/actions` | Admin | messaging/service.grantMessageAccess()/hideMessage()/resolveReport()/setConversationLock() | {op,...} | 204 | messages.view \| messages.moderate | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-REV-01 | `POST /api/v1/admin/reviews/{id}/moderation` | Admin | reviews/service.moderateReview() | {decision,reason} | 204 | reviews.moderate | S | — | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-USED-01 | `POST /api/v1/admin/used/passports/{id}/actions` | Admin | used/reports.verifyPassport()/recordInspection() | {op,...} | Passport | products.moderate (+policy) | S | DB lock | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-STF-01 | `GET /api/v1/admin/staff` | Admin | page query in admin/roles | — | Staff[] | roles.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-STF-02 | `POST /api/v1/admin/staff` | Admin | rbac/staff.createStaffUser() | {email,phone,fullName,role,reason,confirmPrivileged} | Staff (invite sent) | roles.manage; privileged → SUPER_ADMIN | H | L | T | SU | privileged requires SUPER_ADMIN + reason | A | none | CT AZ SU | READY_SERVICE |
| A-STF-03 | `POST /api/v1/admin/staff/{id}/roles` | Admin | rbac/staff.setStaffRole() | {op:grant\|revoke,role,reason,confirmPrivileged} | 204 | roles.manage; never self | S | L | T | SU | privileged → SUPER_ADMIN | A | none | CT AZ SU | READY_SERVICE |
| A-STF-04 | `POST /api/v1/admin/staff/{id}/status` | Admin | rbac/staff.setStaffStatus() | {status,reason,confirmPrivileged} | 204 | roles.manage; never self; last super-admin guard | S | L | T | SU | — | A | none | CT AZ SU | READY_SERVICE — disabling should also revoke staff sessions (resolveSession already rejects non-ACTIVE) |
| A-STF-05 | `PUT /api/v1/admin/roles/{code}/permissions` | Admin | rbac/staff.setRolePermissions() | {permissions[],reason,confirmPrivileged} | 204 | roles.manage; not own role | — | L | T | SU | privileged → SUPER_ADMIN | A | none | CT AZ SU | READY_SERVICE |
| A-AUD-01 | `GET /api/v1/admin/audit` | Admin | page query in admin/audit | action,entity,entityId,actorType,from,before | Page<AuditEvent> | audit.view | — | — | T | — | — | NA | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-SET-01 | `GET /api/v1/admin/settings` | Admin | settings.getAllSettings() | — | Settings | settings.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — no permission check inside getAllSettings |
| A-SET-02 | `PUT /api/v1/admin/settings/{key}` | Admin | settings.updateSetting() | {value,reason} | 204 | settings.manage; restricted keys refused | — | — | T | SU (sensitive keys) | go-live gate for real money; NOT two-person (S-M2) | A | payments.realMoneyEnabled is fail-closed behind goLiveGate() | CT AZ SU | READY_SERVICE |
| A-OPS-01 | `GET /api/v1/admin/system/health` | Admin | ops/health + ops/provider-health + jobs schedule health | — | SystemHealth | dashboard.view \| finance.controls | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| A-OPS-02 | `POST /api/v1/admin/system/dead-letters/{id}/requeue` | Admin | notifications/outbox requeue (used by requeueDeadLetterAction) | — | 204 | notifications.manage | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| A-RPT-01 | `POST /api/v1/admin/reports/exports` | Admin | reports/service.exportDataset() (cookie route /api/admin/export) | {dataset,from,to} | 202 {exportId} → signed download | reports.export (enforced inside service) | H | — | E | SU* | — | A | none | CT AZ | READY_SERVICE — service ready (cookie route today); bulk PII export from a phone should be watermarked or Web-only |
| A-CMS-01 | `PUT /api/v1/admin/content/{kind}/{id}` | Admin | cms/service.saveBlock()/savePage()/saveLegalDraft()/publishLegal() | {...} | 204 | cms.manage \| legal.manage | — | — | T | SU (legal publish)* | — | A | none | CT AZ | READY_SERVICE |

### Finance (45)

| ID | Method · Path | Role | Reuse (existing service) | Request DTO | Response DTO | Authorization | Idem | Concurrency | Rate limit | Fresh 2FA | Maker/Checker | Audit | Financial effect | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F-OVR-01 | `GET /api/v1/admin/finance/overview` | Finance | finance/controls.controlBalances() + financialInvariants() + latestLedgerHealth() + killSwitchStates() | — | FinanceOverview | finance.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — query fns take no Actor; permission lives in page |
| F-OVR-02 | `POST /api/v1/admin/finance/kill-switches/{key}` | Finance | finance/controls.setKillSwitch() | {paused,reason} | {state} | finance.controls | S | — | T | SU | — | A | pauses money operations | CT AZ SU | READY_SERVICE |
| F-OVR-03 | `POST /api/v1/admin/finance/days/{date}/close` | Finance | finance/controls.closeFinancialDay() | — | DailyControlReport | finance.controls | S unique business date | — | T | SU* | — | A | none (control report) | CT AZ | READY_SERVICE |
| F-LED-01 | `GET /api/v1/admin/finance/journals` | Finance | page queries in admin/ledger (7 direct reads) | account,source,from,to,cursor | Page<Journal> | finance.view | — | — | T | — | — | NA | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-LED-02 | `GET /api/v1/admin/finance/journals/{id}` | Finance | page query | — | Journal{lines,approval,reverses} | finance.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-LED-03 | `POST /api/v1/admin/finance/ledger-health/run` | Finance | finance/ledger-health.runLedgerHealthCheck() | — | LedgerHealth | finance.controls | — | — | E | — | — | A | read-only check (append-only result) | CT AZ | READY_SERVICE |
| F-MOV-01 | `POST /api/v1/admin/finance/movement-requests` | Finance | finance/movements.requestMovement() | {kind,entityId,amount,reason} | MovementRequest | finance.movement.request | K (same maker+amount returns open request) | L | T | SU | MAKER | A | none (proposal only) | CT AZ SU RP | READY_SERVICE |
| F-MOV-02 | `POST /api/v1/admin/finance/movement-requests/{id}/reject` | Finance | finance/movements.rejectMovementRequest() | {reason} | 204 | checker permission for kind; not maker | S | L | T | SU | CHECKER (reject) | A | none | CT AZ SU MC | READY_SERVICE |
| F-MOV-03 | `POST /api/v1/admin/finance/movement-requests/{id}/cancel` | Finance | finance/movements.cancelMovementRequest() | — | 204 | maker only | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| F-APR-01 | `GET /api/v1/admin/finance/approvals` | Finance | finance/approvals.recentApprovals() | cursor | Approval[] | finance.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — no Actor/permission inside query |
| F-APR-02 | `POST /api/v1/admin/finance/approvals/{id}/revoke` | Finance | finance/approvals.revokeApproval() | {reason} | 204 | finance.controls; not the approver | S | L | T | SU | 2P (revoker ≠ approver) | A | none (unexecuted approval) | CT AZ SU MC | READY_SERVICE |
| F-REL-01 | `GET /api/v1/admin/finance/releases` | Finance | page query in admin/releases | — | ReleaseCandidate[] | finance.release | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-REL-02 | `POST /api/v1/admin/finance/seller-orders/{id}/release` | Finance | commerce/fulfilment.releaseSellerOrder() | {expectedSellerAmount,reason} | {approvalId} | finance.release; kill switch; blockers; ledger drift check | S idempotencyKey release:{so} | L + V expectedSellerAmount | E fin-approve | SU | CHECKER (requires open maker request by someone else; DB two-person trigger) | A | Dr SELLER_PENDING → Cr SELLER_AVAILABLE; Dr COMMISSION_DEFERRED → Cr COMMISSION_REVENUE | CT AZ SU MC RP CC LB | READY_SERVICE |
| F-REL-03 | `POST /api/v1/admin/finance/deals/{id}/release` | Finance | deals/service.releaseDeal() | {expectedPayout,reason} | {approvalId} | finance.release; not a party; entitlement; no blockers | S idempotencyKey deal-release:{id} | L + V expectedPayout | E fin-approve | SU | CHECKER (DEAL_RELEASE maker required) | A | Dr DEAL_FUNDS_HELD → Cr DEAL_PAYOUTS_PAYABLE + DEAL_FEE_REVENUE (+ CUSTOMER_REFUNDS_PAYABLE) | CT AZ SU MC RP CC LB | READY_SERVICE |
| F-RFD-01 | `GET /api/v1/admin/finance/refunds` | Finance | finance/refunds.refundQueue() | status | Refund[] | refunds.approve \| refunds.pay | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — no Actor/permission inside query |
| F-RFD-02 | `GET /api/v1/admin/finance/refunds/{id}` | Finance | finance/refunds.refundDetail() | — | RefundDetail | refunds.approve \| refunds.pay | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-RFD-03 | `POST /api/v1/admin/finance/refunds/{id}/approve` | Finance | finance/refunds.approveRefund() | {expectedAmount,reason} | Refund | refunds.approve; kill switch | S idempotencyKey refund:{id} | L + V expectedAmount | E fin-approve | SU | CHECKER (REFUND_APPROVAL maker required) | A | Dr seller liability + fee reversal → Cr CUSTOMER_REFUNDS_PAYABLE | CT AZ SU MC RP LB | READY_SERVICE |
| F-RFD-04 | `POST /api/v1/admin/finance/refunds/{id}/reject` | Finance | finance/refunds.rejectRefund() | {reason} | Refund | refunds.approve | S | L | T | SU | — | A | none | CT AZ SU | READY_SERVICE |
| F-RFD-05 | `POST /api/v1/admin/finance/refunds/{id}/payout` | Finance | finance/refunds.recordRefundPayout() | multipart{reference,proof?} | Refund | refunds.pay; payer ≠ approver; kill switch | S idempotencyKey refund-paid:{id} | L | E fin-approve | SU | 2P (REFUND_PAYOUT: approver = maker) | A | Dr CUSTOMER_REFUNDS_PAYABLE → Cr PLATFORM_CASH | CT AZ SU MC RP LB | READY_SERVICE |
| F-RFD-06 | `POST /api/v1/admin/finance/refunds/{id}/failed` | Finance | finance/refunds.markRefundFailed() | {reason} | Refund | refunds.pay | S | L | T | SU | — | A | none (liability kept) | CT AZ SU | READY_SERVICE |
| F-RFD-07 | `POST /api/v1/admin/finance/refunds/{id}/revoke` | Finance | finance/refunds.revokeRefund() | {reason} | Refund | refunds.approve | S idempotencyKey refund-revocation:{id} | L | E fin-approve | SU | CHECKER (REFUND_REVOCATION maker required) | A | compensating reversal journal | CT AZ SU MC LB | READY_SERVICE |
| F-RFD-08 | `POST /api/v1/admin/finance/refunds/{id}/destination` | Finance | finance/refunds.overrideRefundDestination()/reapproveRefundDestination()/revealRefundDestination() | {op,...} | Refund | refunds.destination.override \| refunds.approve \| refunds.pay | S | L | T | SU | 2P re-approval by a different person | A | changes payout destination | CT AZ SU MC SEC | READY_SERVICE |
| F-WD-01 | `GET /api/v1/admin/finance/withdrawals` | Finance | finance/withdrawals.withdrawalQueue() | status | Withdrawal[] | withdrawals.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — no Actor/permission inside query |
| F-WD-02 | `GET /api/v1/admin/finance/withdrawals/{id}` | Finance | withdrawal detail page + withdrawalAllocationsOf() | — | WithdrawalDetail{allocations,destinationSnapshot} | withdrawals.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-WD-03 | `POST /api/v1/admin/finance/withdrawals/{id}/review` | Finance | finance/withdrawals.reviewWithdrawal() | — | 204 | withdrawals.approve | S | L | T | — | — | A | none | CT AZ | READY_SERVICE |
| F-WD-04 | `POST /api/v1/admin/finance/withdrawals/{id}/approve` | Finance | finance/withdrawals.approveWithdrawal() | {note} | 204 | withdrawals.approve; not beneficiary; identity APPROVED; no drift; kill switch | S idempotencyKey wd:{id} | L + beneficiary lock + balance guards | E fin-approve | SU | approval (reservation of seller’s own funds; payout is two-person) | A | Dr SELLER_AVAILABLE / DEAL_PAYOUTS_PAYABLE → Cr reserved accounts | CT AZ SU RP CC LB | READY_SERVICE |
| F-WD-05 | `POST /api/v1/admin/finance/withdrawals/{id}/processing` | Finance | finance/withdrawals.markWithdrawalProcessing() | — | 204 | withdrawals.pay | S | L | T | SU | — | A | none (point of no rejection) | CT AZ SU | READY_SERVICE |
| F-WD-06 | `POST /api/v1/admin/finance/withdrawals/{id}/paid` | Finance | finance/withdrawals.markWithdrawalPaid() | multipart{reference,proof?,actualTransferCost?} | 204 | withdrawals.pay; payer ≠ approver; kill switch | S | L | E fin-approve | SU | 2P (WITHDRAWAL_PAYOUT: approver = maker) | A | Dr reserved → Cr PLATFORM_CASH (+ transfer cost) | CT AZ SU MC RP LB | READY_SERVICE |
| F-WD-07 | `POST /api/v1/admin/finance/withdrawals/{id}/reject` | Finance | finance/withdrawals.rejectWithdrawal() | {reason} | 204 | withdrawals.approve; maker request if reserved | S | L | T | SU (if reserved) | CHECKER (WITHDRAWAL_REVERSAL) | A | reverses reservation | CT AZ SU MC LB | READY_SERVICE |
| F-WD-08 | `POST /api/v1/admin/finance/withdrawals/{id}/uncertain` | Finance | finance/withdrawals.markWithdrawalTransferUncertain() | {reason} | 204 | withdrawals.pay | S | L | T | SU | — | A | none (stays reserved) | CT AZ SU | READY_SERVICE |
| F-WD-09 | `POST /api/v1/admin/finance/withdrawals/{id}/failed-before-transfer` | Finance | finance/withdrawals.markWithdrawalFailedBeforeTransfer() | {reason,evidence} | 204 | withdrawals.approve; not the processor | S | L | T | SU | CHECKER (WITHDRAWAL_REVERSAL) | A | releases reservation | CT AZ SU MC LB | READY_SERVICE |
| F-WD-10 | `POST /api/v1/admin/finance/withdrawals/{id}/returned` | Finance | finance/withdrawals.recordWithdrawalReturned() | {amount,reference,reason} | 204 | withdrawals.approve; not the payer | S | L | T | SU | CHECKER (WITHDRAWAL_RETURN) | A | compensating re-credit | CT AZ SU MC LB | READY_SERVICE |
| F-WD-11 | `POST /api/v1/admin/finance/payouts/{kind}/{id}/reveal` | Finance | finance/withdrawals.revealPayoutDetails() | {reason} | PayoutDetails | withdrawals.pay \| deals.payout | — | — | E | SU | — | A | none | CT AZ SU SEC | READY_SERVICE |
| F-ADJ-01 | `GET /api/v1/admin/finance/adjustments` | Finance | page query in admin/ledger | status | Adjustment[] | ledger.adjust.create \| ledger.adjust.approve | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-ADJ-02 | `POST /api/v1/admin/finance/adjustments` | Finance | finance/withdrawals.createAdjustment() | {sellerId,amount,reasonCode,reason,sellerOrderId?} | Adjustment (PENDING_APPROVAL) | ledger.adjust.create; no self-dealing; kill switch | H | — | T | SU | MAKER | A | none until approved | CT AZ SU | READY_SERVICE |
| F-ADJ-03 | `POST /api/v1/admin/finance/adjustments/{id}/decision` | Finance | finance/withdrawals.decideAdjustment() | {approve,reason} | 204 | ledger.adjust.approve; creator ≠ approver (service + DB CHECK + trigger) | S idempotencyKey adj:{id} | L | E fin-approve | SU | CHECKER | A | Dr/Cr ADJUSTMENTS_EXPENSE ↔ SELLER_AVAILABLE | CT AZ SU MC LB | READY_SERVICE |
| F-STL-01 | `GET /api/v1/admin/finance/settlements` | Finance | page query in admin/settlements | — | SettlementBatch[] | settlements.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-STL-02 | `POST /api/v1/admin/finance/settlements/run` | Finance | finance/withdrawals.runScheduledSettlement() — permission/step-up/audit live in the Server Action | — | {created,total,settlementId} | settlements.manage | S per Cairo date | — | T | SU | creates withdrawal REQUESTS only (each still needs approval + two-person payout) | A (in action) | none at run | CT AZ SU | SERVICE_NEEDS_REFACTOR — move authz + audit into the service |
| F-REC-01 | `GET /api/v1/admin/finance/reconciliation` | Finance | finance/reconciliation.reconQueue()/reconCounts()/reconImportsList() | state | ReconView | reconciliation.manage | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR — queries take no Actor |
| F-REC-02 | `POST /api/v1/admin/finance/reconciliation/imports` | Finance | finance/reconciliation.importStatement() | multipart{channel,csv} | ReconImport | reconciliation.manage | K file hash/import record | — | T | SU* | — | A | none (evidence only) | CT AZ | READY_SERVICE — large CSV: Web Admin preferred |
| F-REC-03 | `POST /api/v1/admin/finance/reconciliation/{id}/match` | Finance | finance/reconciliation.confirmMatch() | {type,id,note} | {state} | reconciliation.manage | S (already matched → conflict) | L | T | SU* | — | A | none (evidence; mismatch raises risk flag) | CT AZ CC | READY_SERVICE |
| F-REC-04 | `POST /api/v1/admin/finance/reconciliation/{id}/state` | Finance | finance/reconciliation.setReconState() | {to,reason} | 204 | reconciliation.manage | S | L | T | SU* | — (single person can IGNORE a break: S-M4) | A | none | CT AZ | READY_SERVICE |
| F-PRC-01 | `GET /api/v1/admin/finance/pricing` | Finance | pricing/service reads (versions, simulator) | model | PricingVersion[] | pricing.view | — | — | T | — | — | — | none | CT AZ | SERVICE_NEEDS_REFACTOR |
| F-PRC-02 | `POST /api/v1/admin/finance/pricing/versions/{id}/decision` | Finance | pricing/service.approveVersion()/publishVersion() | {op,effectiveFrom?,reason} | PricingVersion | pricing.approve \| pricing.publish; approver ≠ submitter (DB CHECK) | S | L shared pricing lock | T | SU | CHECKER | A | changes future fees only (snapshots immutable) | CT AZ SU MC | READY_SERVICE |
| F-DST-01 | `PUT /api/v1/admin/finance/payment-destinations/{id}` | Finance | payments/service.saveDestination()/updatePaymentMethod() | {...,reason} | 204 | payments.destinations.manage | — | — | T | SU* | — | A | changes where buyers send money | CT AZ SU | READY_SERVICE — test-destination guard enforced by DB trigger in production |

---

## 8. Rollout order

The full ticket list is in `MOBILE_BACKLOG_V2.md`.

1. **Foundations** (no business endpoints):
   - bearer auth and device sessions
   - the adapter skeleton and error mapping
   - the lint rule
   - OpenAPI generation
   - the parity-test harness
   - the T-1 security fix
2. **Read-model extraction** (T-6, T-7) for the screens of the first mobile release.
3. **Customer endpoints:** catalog, cart, checkout, orders, Protected Deal buyer and deal seller, disputes, support.
4. **Seller Center endpoints.**
5. **Admin endpoints:** queues, 360 views and decisions.
6. **Finance endpoints.**

Every money-moving endpoint ships only with its CC, RP, MC and LB tests green.
