# Attack Surface Inventory

The application is a single Next.js 16 app. State changes happen only through **server actions**
(POST, with Next.js Origin/Host verification) and seven **route handlers**. There are no webhooks
and no public JSON write API.

Guard legend:

- **CUST**: `requireCustomer` (signed-in web session).
- **SELLER**: `requireSellerActor` (web session + seller membership). Seller permissions are checked in services via `requireSeller(actor, perm)`.
- **ADMIN(perm)**: `adminRun` → `requireAdmin` (admin cookie + completed TOTP) + `requirePermission(perm)` inside the service.
- **STEP-UP**: also requires a TOTP re-verification within 10 minutes.
- **PUBLIC**: no session needed (rate-limited where noted).

## 1. Route handlers

| Route | Method | Guard | Purpose / notes |
|---|---|---|---|
| `/api/health` | GET | PUBLIC | Liveness; no dependencies |
| `/api/ready` | GET | PUBLIC | DB, migrations, storage and job checks. Returns counts only; no data |
| `/api/products/cards` | GET | PUBLIC | Product cards by ids, LIVE products only (recently-viewed) |
| `/api/files/[id]` | GET | Session-derived (admin / seller / customer) + per-purpose rule in `storage/access.ts` | PRIVATE files. Uniform 404. `no-store`; `sandbox` CSP; `nosniff` |
| `/media/[...key]` | GET | PUBLIC | PUBLIC objects only (product images, logos, banners). Safe-key check |
| `/api/admin/export` | GET | ADMIN(`reports.export`) | CSV exports. Returns 401 without an admin session |
| `/api/cron/tick` | GET | `Authorization: Bearer CRON_SECRET` (constant-time) | Scheduled background work. Returns 404 otherwise |

## 2. Server actions (109) by surface

### Authentication (PUBLIC, rate-limited)

| Action | Guard / controls |
|---|---|
| `loginAction` | per-IP and per-identifier limits |
| `registerAction` | per-IP limit |
| `forgotPasswordAction` | per-IP limit; uniform response |
| `resetPasswordAction` | single-use hashed token |
| `sellerLoginAction` | same controls as `loginAction` |
| `sellerRegisterAction` | same controls as `registerAction` |
| `adminLoginAction` | staff only; per-IP and per-identifier limits |
| `adminTotpBeginAction` | first-time enrollment only, when TOTP is not yet enabled |
| `adminTotpVerifyAction` | TOTP replay-guarded, 8 attempts / 5 min |
| `adminStepUpAction` | TOTP |
| `adminLogoutAction` | — |

### Customer — `account.ts`, `checkout.ts`, `deals.ts`, `shop.ts` (all CUST, ownership-scoped in services)

- **Orders and payment:** `placeOrderAction` (server pricing; idempotent `checkoutKey`; `expectedTotal` used only as a guard), `submitProofAction` (payer only; client key), `cancelUnpaidOrderAction`, `confirmReceiptAction` (buyer only; exactly-once credit).
- **Post-purchase:** `requestReturnAction`, `shipReturnAction`, `escalateReturnAction`, `openDisputeAction`, `disputeMessageAction`, `productReviewAction` / `sellerReviewAction` (verified purchase only), `reportReviewAction`.
- **Account:** `openTicketAction`, `replyTicketAction`, `saveAddressAction`, `archiveAddressAction`, `updateProfileAction`, `changePasswordAction`, `sendCodeAction` / `confirmCodeAction`, `markNotificationsReadAction`.
- **External deals (invitation-first):** `dealStepAction` (buyer draft only; step 5 = encrypted location + optional unverified seller hints), `inviteSellerAction` / `refreshInviteAction` (raw token handed to the share screen via a 15-minute httpOnly, path-scoped cookie — never in a URL), `revokeInviteAction`, `claimInviteAction` (binds the hashed, expiring token to ONE account; buyer refused; idempotent for the same account), `rejectInviteAction` (token or bound seller), `sellerOfferAction` (bound seller only; verified phone required; every offer = new immutable terms version), `buyerOfferResponseAction` (ACCEPT / REQUEST_CHANGE / REJECT on the exact PROPOSED version), `sellerChangeResponseAction`, `startDealPaymentAction` (only after agreed terms), `dealProofAction`, `dealDeliveredAction`, `dealConfirmAction`, `cancelDealAction`.
- **Cart and other:** `updateCartAction` (guest cart cookie or user cart), `setGovernorateAction` (cookie only), `logoutAction`.

### Seller — `seller.ts`, `seller-onboarding.ts` (SELLER; seller-scoped with per-member seller permissions)

- **Products:** `createProductAction`, `productDetailsAction`, `productImagesAction`, `removeImageAction`, `productVariantsAction`, `productLogisticsAction`, `submitProductAction` (moderation queue, never self-publish), `productControlAction`, `setStockAction`.
- **Orders:** `sellerOrderAction`, `shipmentAction` (waybill upload required before SHIPPED), `shippingRatesAction`, `sellerReturnAction`, `respondReviewAction`, `sellerDisputeMessageAction`.
- **Money:** `requestWithdrawalAction` (`finance.withdraw`; reserves under lock), `cancelWithdrawalAction`, `payoutMethodAction` (`payout.manage`; change → review + hold).
- **Settings:** `storeSettingsAction`, `staffAction` (`staff.manage`), `sellerTotpAction`, `sellerTicketAction`.
- **Onboarding (CUST):** `startSellerAction`, `onboardingStepAction`.

### Admin — `admin.ts` (33 actions; ADMIN(perm); STEP-UP where marked)

| Area | Actions (permission) |
|---|---|
| Sellers | `sellerDecisionAction` (`sellers.review` / `sellers.suspend`), `revealNationalIdAction` (`sellers.documents.view`, audited), `verifyPayoutAction` (`sellers.payout.verify`), `riskFlagAction` |
| Catalog | `categoryAction`, `categoryAttributeAction`, `brandAction`, `attributeAction` (`catalog.manage`), `policyRuleAction` (`policy.manage`), `moderateProductAction`, `moderateRevisionAction` (`products.moderate`) |
| Payments | `paymentDecisionAction` (`payments.verify`), `destinationAction`, `paymentMethodAction` (`payments.destinations.manage` + STEP-UP) |
| Operations | `adminOrderAction` (`orders.manage`, `orders.confirm_receipt_on_behalf`), `adminReturnAction` (`returns.manage`), `disputeAdminAction` (`disputes.manage`), `reviewModerationAction`, `ticketAdminAction`, `customerStatusAction` |
| Finance | `commissionRuleAction` (`commissions.manage` + STEP-UP), `withdrawalAdminAction` (`withdrawals.approve` / `withdrawals.pay`, dual control above threshold), `revealPayoutAction` (audited), `refundPaidAction` (`refunds.pay` / `deals.payout`), `adjustmentAction` (`ledger.adjust.create` / `ledger.adjust.approve`, maker ≠ checker), `runSettlementAction` (`settlements.manage`) |
| Content / system | `cmsBlockAction`, `cmsPageAction` (`cms.manage`), `legalAction` (`legal.manage`), `templateAction` (`notifications.manage`), `settingAction` (`settings.manage`; STEP-UP for sensitive keys incl. `payments.realMoneyEnabled`), `rolePermissionAction`, `staffUserAction` (`roles.manage` + STEP-UP) |

## 3. Pages that render objects by id

These pages scope queries to the actor or gate on a permission:

- **Customer:** `/account/orders/[id]`, `/account/orders/[id]/pay`, `/account/returns/[id]`, `/account/disputes/[id]`, `/account/deals/[id]` (parties or `deals.view`; counterparty address only from ACTIVE), `/deal/invite/[token]` (safe summary: no buyer name/phone/address/coordinates; opening is read-only), `/deal-invite/[token]` (legacy → redirect).
- **Seller:** `/seller/orders/[id]`, `/seller/products/[id]`, `/seller/returns/[id]`.
- **Admin** (every page uses `adminWith(perm)` or `requireAdmin` + a service permission): `/admin/*/[id]`.

## 4. Uploads

The single pipeline is `storeUpload`.

1. Magic-byte sniffing allows JPEG, PNG, WEBP and PDF only. Extensions are allow-listed and SVG/HTML are rejected.
2. Images are re-encoded with sharp, which strips EXIF/GPS and neutralizes polyglot files.
3. Each file gets a random UUID key.
4. Visibility comes from the purpose: KYC, proofs, waybills, evidence and payout proofs are PRIVATE.
5. Size cap = min(admin setting, deployment hard cap). Staging uses 4 MB.

## 5. Background work

| Mechanism | Trigger | Concurrency control |
|---|---|---|
| `runTick` | `scripts/worker.ts` (Docker), `/api/cron/tick` (secret), after-response inline tick (`INLINE_WORKER`, throttled) | Jobs claimed with `FOR UPDATE SKIP LOCKED`; schedule functions are idempotent state transitions under row locks |
