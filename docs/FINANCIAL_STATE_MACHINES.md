# Financial State Machines

Source of truth: `src/domain/machines.ts` (every transition goes through `transition()` and is written to `status_history`).

## Seller sub-order

```
PENDING_PAYMENT ─▶ PAYMENT_UNDER_REVIEW ─▶ PAID ─▶ SELLER_CONFIRMED ─▶ PROCESSING ─▶ READY_TO_SHIP ─▶ SHIPPED
      │                   │                 │            │                 │              │            │
      └──────────────── CANCELLED ◀─────────┴────────────┴─────────────────┴──────────────┘            │
                                                                                                        ▼
         buyer confirms (BUYER_CONFIRMED) ◀──── SHIPPED ──▶ AWAITING_BUYER_RESPONSE ──▶ DELIVERED ──▶ COMPLETED
                                                   │        (event + timely evidence,   (entitled,      (Admin
                                                   │         or Ops review)              awaiting        release
                                                   ▼                                     Admin release)  committed)
                                            DELIVERY_FAILED (returned / lost → refund request)
```

| State | Money position | Who/what moves it out |
|---|---|---|
| PAID … READY_TO_SHIP | SELLER_PENDING + COMMISSION_DEFERRED | seller fulfilment; cancellation (any role) **only here** |
| SHIPPED | pending | Ops delivery event + seller timely evidence → AWAITING; buyer confirmation → DELIVERED; Ops exception → DELIVERY_FAILED |
| AWAITING_BUYER_RESPONSE | pending, 24h buyer window (immutable deadline) | buyer confirmation; timeout job (TIMEOUT_ENTITLEMENT); problem report = hold |
| DELIVERED | pending — **entitled, not available** | Admin release only (SELLER_RELEASE approval) |
| COMPLETED | released (SELLER_AVAILABLE, COMMISSION_REVENUE) | final; DB CHECK requires receipt basis + funds_released_at |
| DELIVERY_FAILED / CANCELLED | refund obligation(s) REQUESTED | refund workflow |

Receipt bases (`RECEIPT_BASES`): `BUYER_CONFIRMED`, `TIMEOUT_ENTITLEMENT`, `DISPUTE_DECISION`, plus legacy
`LEGACY_ADMIN_ON_BEHALF`, `LEGACY_PRE_HARDENING` (backfilled from historic data, never produced by new code).
Delivery exception codes live beside the status (`delivery_exception_code`) and block entitlement/release.

## Parent order (derived, `deriveParentStatus`)

All COMPLETED → COMPLETED; all CANCELLED → CANCELLED; mix of COMPLETED with CANCELLED/DELIVERY_FAILED →
PARTIALLY_COMPLETED; only CANCELLED/DELIVERY_FAILED with at least one failure → CLOSED_UNFULFILLED.

## Shipment

`PENDING → SHIPPED → IN_TRANSIT → DELIVERED` with `EXCEPTION`, `FAILED`, `RETURNED_TO_SELLER`, `LOST`. A shipment
DELIVERED status (carrier) is not a receipt basis by itself.

## Refund

```
REQUESTED ─▶ (UNDER_REVIEW) ─▶ APPROVED ─▶ PROCESSING ─▶ COMPLETED
    │              │              │             │
    ├─▶ REJECTED ◀─┘              └─▶ FAILED ◀──┘ (liability kept; retry after reconciliation)
    └─▶ CANCELLED
```
APPROVED posts the REFUND reversal journal (REFUND_APPROVAL approval). COMPLETED requires a REFUND_PAID journal
(REFUND_PAYOUT approval) with an external reference. Legacy `PENDING`/`PAID` are kept readable, never re-written.

## Withdrawal

`REQUESTED → (UNDER_REVIEW) → APPROVED [reserve journal] → PROCESSING → PAID [payout journal]`;
`REJECTED` (reverses the reservation only if one exists), `CANCELLED` (seller, only while unreserved).
A request reserves nothing.

## Protected deal

`… ACTIVE → DELIVERED (out for handover) → DELIVERY_HANDOVER_VERIFIED (buyer's OTP) → BUYER_CONFIRMED_RECEIPT |
ENTITLED_AWAITING_RELEASE (timeout) → [Admin DEAL_RELEASE] → COMPLETED`; `DISPUTED → decision`; full refund →
`REFUND_PENDING` → Admin DEAL_REFUND approval → `REFUNDED`.

## Financial approval

`APPROVED → CONSUMED` (by the DB trigger, in the posting transaction) or `APPROVED → REVOKED`. Both final.
