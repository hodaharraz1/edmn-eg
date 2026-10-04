# Application / Action Contracts

EDMN's write API is a set of **domain functions** (`src/server/modules/**`) invoked by Server
Actions (`src/app/_actions/**`). Every function takes an `Actor` first and enforces its own
authorization — the action layer only authenticates and parses input. Errors are typed
`DomainError` codes: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`,
`CONFLICT`, `STEP_UP_REQUIRED`, `RATE_LIMITED`; they are shown as form errors (no internal details).
Unexpected errors return a generic message with a log reference.

Common guarantees: **one database transaction per call**; status changes through state machines with
`status_history`; money only through the ledger; audit and notifications written in the same
transaction (notifications delivered later by the worker).

---

### PlaceOrder — `placeOrder(actor, { addressId, paymentMethod, checkoutKey, expectedTotal, note })`
- **Auth:** signed-in customer. **Authz:** own cart and address.
- **Validation:** address belongs to user; method enabled with a destination; every line live,
  seller approved, stock available, seller ships to the governorate; `expectedTotal` equals the
  server-computed total (else `CONFLICT` and the cart shows the new prices — EDGE 5).
- **Transaction:** price → reserve stock (conditional UPDATE per variant) → order + seller orders +
  items (snapshots, commission) → payment `AWAITING_PAYMENT` with destination snapshot → clear cart.
- **Output:** order id; redirect to the pay page.
- **Audit/notify:** `order.placed`; ORDER_CREATED to customer.
- **Idempotency:** unique `(customer, checkoutKey)` — a resubmission returns the same order.

### SubmitPaymentProof — `submitProof(actor, paymentId, { claimedAmount, reference, payerName, notes, clientKey }, file)`
- **Auth:** customer (payer). **Authz:** own payment.
- **Preconditions:** payment `AWAITING_PAYMENT` or `REJECTED` (not expired/confirmed).
- **Validation:** file type by magic bytes, size; amount parses as EGP.
- **Transaction:** store private file → submission `SUBMITTED` → payment `PAYMENT_SUBMITTED`, order
  `PAYMENT_UNDER_REVIEW`. **Never** marks paid.
- **Idempotency:** unique `(payment, clientKey)`; a different proof while one is pending → `INVALID_STATE`.

### ConfirmPayment — `confirmPayment(actor, paymentId, submissionId, note?)`
- **Auth:** staff session with completed 2FA. **Authz:** `payments.verify`.
- **Preconditions:** payment `PAYMENT_SUBMITTED`/`UNDER_REVIEW`; submission belongs to it and is pending.
- **Transaction:** `SELECT … FOR UPDATE` payment → submission `ACCEPTED` → payment `CONFIRMED` →
  order/seller orders `PAID` → reservations committed → ledger `ORDER_PAYMENT` per seller order (or
  `DEAL_PAYMENT` for a deal; deal → `ACTIVE`).
- **Output:** `{ alreadyConfirmed }`.
- **Audit:** `payment.confirmed` (staff, note, IP). **Notify:** PAYMENT_CONFIRMED (customer), SELLER_NEW_ORDER (sellers).
- **Idempotency:** already `CONFIRMED` → returns `alreadyConfirmed: true`, posts nothing (EDGE 3/4); ledger keys unique.

### RejectPayment — `rejectPayment(actor, paymentId, submissionId, reason, requestNewProof)`
- **Authz:** `payments.verify`. **Validation:** reason required (shown to customer).
- **Effect:** submission `REJECTED`/`NEW_PROOF_REQUESTED`, payment `REJECTED` → customer may resubmit (EDGE 20).

### ApproveSeller — `decideSeller(actor, sellerId, 'APPROVE' | 'REQUEST_MORE_INFORMATION' | 'REJECT' | 'RESTRICT' | 'SUSPEND' | 'REINSTATE', reason)`
- **Authz:** `sellers.review` (decisions on applications) / `sellers.suspend` (restrict/suspend/reinstate).
- **Preconditions:** APPROVE only from `PENDING_REVIEW`; reason required for every non-approval.
- **Transaction:** lock seller → transition → approval activates the payout method submitted with the
  application and records approver/time.
- **Audit:** `seller.<decision>`. **Notify:** SELLER_APPROVED / SELLER_REJECTED / SELLER_MORE_INFO_REQUIRED / SELLER_STATUS_CHANGED.
- **Idempotency:** repeated decision fails the state machine (`INVALID_STATE`) — no double effects.

### ApproveProduct — `moderateProduct(actor, productId, decision, { reasonCode, note })`
- **Authz:** `products.moderate`.
- **Preconditions:** `SUBMITTED`/`UNDER_REVIEW` for APPROVE/REQUEST_CHANGES/REJECT; `LIVE`/`APPROVED` for SUSPEND.
- **Transaction:** lock product → transition (APPROVE publishes: `LIVE`, `published_at`) →
  `product_moderation_events` row. (If `products.requireModeration` is turned off, submission auto-publishes.)
- **Audit:** `product.<decision>` with old/new status and reason. **Notify:** PRODUCT_APPROVED / PRODUCT_REJECTED / PRODUCT_SUSPENDED.

### CreateShipment — `saveShipment(actor, sellerOrderId, { carrierName, trackingNumber, shippedAt, expectedDeliveryAt, note, markShipped }, waybill?)` + `markShipped(actor, sellerOrderId)`
- **Authz:** seller staff with `orders.manage` **of the owning seller** (ownership checked).
- **Preconditions:** seller order `SELLER_CONFIRMED`/`PROCESSING`/`READY_TO_SHIP`.
- **Validation:** carrier ≥ 2 chars; waybill PDF/image by magic bytes (EDGE 19); `markShipped`
  requires at least one waybill.
- **Transaction:** upsert shipment, store private waybill (`shipment_documents`), transition shipment
  and seller order to `SHIPPED`, tracking event.
- **Audit:** `shipment.saved`, `seller_order.shipped`. **Notify:** ORDER_SHIPPED (carrier, tracking).
- **Note:** shipping never releases funds.

### ConfirmBuyerReceipt — `confirmReceipt(actor, sellerOrderId, { onBehalfReason? })`
- **Auth:** the order's customer, or staff with `orders.confirm_receipt_on_behalf` + mandatory reason.
- **Preconditions:** seller order `SHIPPED`.
- **Transaction:** lock seller order → `DELIVERED` (source BUYER / ADMIN_ON_BEHALF) → shipment
  `DELIVERED` → unless an open dispute or financial hold exists: ledger `SELLER_RELEASE`
  (pending → available, deferred → earned commission).
- **Output:** `{ alreadyConfirmed, released }`.
- **Audit:** `seller_order.receipt_confirmed[_on_behalf]`. **Notify:** BUYER_RECEIPT_CONFIRMED (seller).
- **Idempotency:** already delivered/completed → `alreadyConfirmed: true`; release key `release:<so>` (EDGE 10).

### OpenDispute — `openDispute(actor, { sellerOrderId | dealId | returnId, reasonCode, description, claimedAmount? }, evidence[])`
- **Auth:** the buyer of the order/deal (claimant); the counter-party is set as respondent.
- **Preconditions:** one open dispute per subject; order must be paid/shipped/delivered (deal active/delivered).
- **Transaction:** dispute `OPEN` + private evidence; places the seller order / deal on hold
  (funds not released while open; deal → `DISPUTED`).
- **Audit:** `dispute.opened`. **Notify:** DISPUTE_OPENED (claimant, respondent).

### ResolveDispute — `resolveDispute(actor, disputeId, { decision, amount, reasonCode, note })`
- **Authz:** `disputes.manage`. **Validation:** written justification ≥ 10 chars; amount ≤ paid.
- **Effect:** FULL/PARTIAL_REFUND → refund record + ledger `REFUND` (or deal settlement split);
  RELEASE_TO_SELLER / REJECT_CLAIM → funds released; RETURN_REQUIRED / REPLACEMENT → workflow notes.
- **Audit:** `dispute.resolved`. **Notify:** DISPUTE_RESOLVED. **Idempotency:** state machine (RESOLVED is not re-resolvable).

### RequestWithdrawal — `requestWithdrawal(actor, { amount, clientKey })`
- **Authz:** seller staff with `finance.withdraw` (scheduled settlements use the system actor).
- **Preconditions:** seller `APPROVED`/`RESTRICTED`; no payout-change hold; an active payout method;
  amount ≥ `withdrawals.minimumAmount` and ≤ available.
- **Transaction:** lock seller → ledger `WITHDRAWAL_RESERVE` with guard `SELLER_AVAILABLE ≥ 0`
  (concurrency-safe — EDGE 12) → request with SLA (48 business hours) and dual-control flag.
- **Audit:** `withdrawal.requested`. **Notify:** WITHDRAWAL_REQUESTED.
- **Idempotency:** unique `(seller, clientKey)` returns the existing request (EDGE 11).

### ApproveWithdrawal / MarkWithdrawalPaid / RejectWithdrawal
- `approveWithdrawal` — `withdrawals.approve`; seller not suspended; → `APPROVED`.
- `markWithdrawalPaid(actor, id, reference, proof?)` — `withdrawals.pay` + **step-up**; reference
  required; status `APPROVED`/`PROCESSING`; dual control enforced; ledger `WITHDRAWAL_PAID`
  (`wd-paid:<id>`); idempotent on `PAID`.
- `rejectWithdrawal(actor, id, reason)` — `withdrawals.approve`; reason required; ledger
  `WITHDRAWAL_REVERSAL` returns the reservation.
- `revealPayoutDetails(actor, 'withdrawal' | 'deal_payout', id)` — `withdrawals.pay` / `deals.payout`
  + **step-up**; audited `payout.details_revealed`.

### External deal actions
- `createDeal` / `saveDealStep(step 1..5)` — buyer only; validated per step.
- `inviteSeller(actor, dealId, acceptTerms)` — buyer; terms accepted (version recorded); creates a
  random token stored as SHA-256 with expiry; returns the link once.
- `acceptInvitation(actor, token, payout, acceptTerms)` — signed-in invitee, not the buyer; token
  valid/unexpired; payout details encrypted; deal → `ACCEPTED` → `PAYMENT_PENDING`. Idempotent per token status.
- `startDealPayment`, `submitProof`, `confirmPayment` — as above, crediting `DEAL_FUNDS_HELD`.
- `markDealDelivered` (seller) → `DELIVERED`; `confirmDealReceipt` (buyer) → `COMPLETED` + ledger
  `DEAL_SETTLEMENT` + `deal_payouts` row; finance records `markDealPayoutPaid` (step-up, reference).

### Settings / roles / destinations
- `updateSetting(actor, key, value, reason)` — `settings.manage`; zod-validated per key; sensitive
  keys need step-up; audit with old/new values.
- `saveDestination` / `updatePaymentMethod` — `payments.destinations.manage` + step-up; reason; audit.
- Role permission and staff changes — `roles.manage` + step-up; cannot modify SUPER_ADMIN or oneself; audit.
