# Delivery, Entitlement and Release

Implements the canonical flow and the business-rule clarification (seller statement ≠ proof of delivery).
Code: `src/server/modules/commerce/fulfilment.ts`, `src/server/modules/deals/service.ts`, jobs in `src/server/jobs/worker.ts`.

## Canonical marketplace flow

1. Checkout — immutable economic snapshot (`orders.economic_snapshot`, per-item `buyer_fee_amount`/`seller_fee_amount`).
2. Proof submitted → under review.
3. Admin payment approval → exactly one `ORDER_PAYMENT` journal per sub-order (PAYMENT_CONFIRMATION approval).
4. Fulfilment: seller confirms → processing → ships (waybill mandatory). Shipping moves no money.
5. **Authoritative delivery event** — recorded only by Operations (`delivery.verify`) after checking the carrier, or by a
   future carrier integration (`DELIVERY_EVENT_SOURCES = OPERATIONS_CARRIER_CHECK | CARRIER_INTEGRATION`). The seller is
   never a source. Sets `delivery_event_at` and `delivery_report_due_at = event + 24h` (immutable).
6. **Seller delivery evidence** (files + carrier reference) within 24h of the event (`submitDeliveryEvidence`).
   First submission time is kept; re-submission never restarts/shortens a clock.
7. **Delivery established** only when *event* AND *timely evidence* exist (`AUTO_EVENT_AND_TIMELY_EVIDENCE`), or after
   an Operations review with a reason (`OPERATIONS_REVIEW`; requires both an event and evidence).
   → status `AWAITING_BUYER_RESPONSE`, `buyer_response_due_at = established + 24h` (immutable, never restarted).
8. Buyer confirms receipt (`BUYER_CONFIRMED`) **or** the timeout job records `TIMEOUT_ENTITLEMENT` at the real processing
   time (server `now()`, never backdated). Either → status `DELIVERED` = **ENTITLED_AWAITING_ADMIN_RELEASE**. No money moves.
9. **Explicit Admin release** (`releaseSellerOrder`, `/admin/releases/[id]`): `finance.release` + fresh 2FA + kill switch +
   every blocker re-checked under row lock + ledger drift check + exact expected amount → one `SELLER_RELEASE` journal
   (pending → available, deferred fee → revenue) under one SELLER_RELEASE approval.
10. `COMPLETED` only with a receipt basis AND a committed release AND no blockers (DB CHECK
    `seller_orders_completion_chk`; invariant `COMPLETION_WITHOUT_RELEASE`).

There is **no automatic seller release** and **no automatic withdrawal/payout** anywhere (the old completion job was removed).

## Clarification §1 — failure paths (all fail closed into Operations)

| Situation | Result | Buyer timeout? | Entitlement? | Money? |
|---|---|---|---|---|
| Seller evidence, no authoritative event | stays `SHIPPED`; queue «مشحون بدون حدث تسليم موثّق» | No | No | No |
| Event, seller evidence missing after 24h | `delivery_exception_code = SELLER_EVIDENCE_MISSING` + HIGH risk flag (job every 15 min) | No | No | No |
| Event, seller evidence late (>24h) | `SELLER_EVIDENCE_LATE` exception | No | No | No |
| Shipped, no event long after ETA (+`delivery.eventMissingGraceDays`) | `DELIVERY_EVENT_MISSING` exception | No | No | No |
| Shipment exception (failed/refused/returned/lost/damaged) | `SHIPMENT_*` exception; resolution RESHIP or DELIVERY_FAILED + refund request | No | No | No |
| Buyer window expires with a blocker (dispute/hold/return/refund/cancel/shipment issue) | `TIMEOUT_BLOCKED` exception | — | No | No |
| Operations review ESTABLISH without event or without evidence | refused («كلام البائع لوحده مش دليل») | — | — | — |

Operations may only `ESTABLISH` (opens a fresh 24h buyer window) or `KEEP_OPEN`. Operations never confirms receipt for the buyer
(`orders.confirm_receipt_on_behalf` retired; `confirmReceipt` accepts the CUSTOMER actor only).

## Protective holds

An open dispute / problem report (buyer, no approval needed) or an Operations `financial_hold` blocks the timeout
entitlement and the release (`releaseBlockers()`). Lifting a hold requires fresh 2FA and releases nothing by itself.

## Protected deals

Handover is proven by the buyer's one-time code (the buyer hands the code over; a seller statement alone cannot verify).
After OTP verification the buyer window is `max(24h, inspection days)`; then `BUYER_CONFIRMED_RECEIPT` or timeout →
`ENTITLED_AWAITING_RELEASE`; settlement only via `releaseDeal` (DEAL_RELEASE approval); payout is a separate DEAL_PAYOUT approval.

## SLA settings

| Key | Default | Meaning |
|---|---|---|
| `SELLER_DELIVERY_REPORT_HOURS` (code) | 24 | seller evidence after authoritative event |
| `BUYER_RESPONSE_HOURS` (code) | 24 | buyer window after delivery established |
| `sla.sellerConfirmHours` | 48 | seller response after payment (flag only) |
| `sla.shipGraceDays` | 1 | added to processing days (flag only) |
| `delivery.eventMissingGraceDays` | 3 | after max ETA without an event → exception |

SLA breaches raise flags/notifications only; nothing is auto-cancelled and no money moves.
