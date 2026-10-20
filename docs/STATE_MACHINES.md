# State Machines

All lifecycle statuses are defined once in `src/domain/machines.ts` with `defineMachine()`
(`src/domain/state-machine.ts`). Domain services change a status **only** through `transition()`,
which:

1. rejects any move not listed below with a `DomainError('INVALID_STATE')`;
2. writes a row to `status_history` (entity, from, to, actor, reason, timestamp) in the same
   transaction — `status_history` is append-only at the database level.

Status columns also carry a CHECK constraint generated from the same arrays, so an unknown status can
never be stored. No controller/route writes a status column directly.

Legend: `A → B, C` means A may move to B or C. Terminal states have no outgoing moves.

## Seller
```
DRAFT              → PENDING_REVIEW                (seller submits a complete application)
PENDING_REVIEW     → APPROVED, REJECTED, MORE_INFO_REQUIRED   (seller reviewer)
MORE_INFO_REQUIRED → PENDING_REVIEW, REJECTED
APPROVED           → RESTRICTED, SUSPENDED
RESTRICTED         → APPROVED, SUSPENDED
SUSPENDED          → APPROVED, RESTRICTED
REJECTED           (terminal)
```
Only APPROVED sellers can list or receive new orders; RESTRICTED sellers keep existing listings but
cannot add new ones; SUSPENDED sellers' listings are hidden and their withdrawals cannot be approved.
Existing paid orders of a suspended seller stay intact (EDGE 7).

## Product
```
DRAFT        → SUBMITTED, ARCHIVED
SUBMITTED    → UNDER_REVIEW, APPROVED, LIVE, REJECTED, DRAFT (seller withdraws)
UNDER_REVIEW → APPROVED, LIVE, REJECTED
APPROVED     → LIVE, SUSPENDED, ARCHIVED
LIVE         → APPROVED, SUSPENDED, ARCHIVED
REJECTED     → SUBMITTED, DRAFT, ARCHIVED
SUSPENDED    → APPROVED, ARCHIVED
ARCHIVED     (terminal)
```
Material edits to a LIVE product create a `product_revisions` row (SUBMITTED → APPROVED/REJECTED/
WITHDRAWN); the live version is unchanged until the revision is approved. Never-published products
are not reachable publicly, even by URL.

## Order (parent) and Seller Order
```
Order:        PENDING_PAYMENT → PAYMENT_UNDER_REVIEW, PAID, CANCELLED
              PAYMENT_UNDER_REVIEW → PAID, PENDING_PAYMENT, CANCELLED
              PAID → COMPLETED, CANCELLED          COMPLETED, CANCELLED (terminal)

Seller order: PENDING_PAYMENT → PAYMENT_UNDER_REVIEW, PAID, CANCELLED
              PAYMENT_UNDER_REVIEW → PAID, PENDING_PAYMENT, CANCELLED
              PAID → SELLER_CONFIRMED, CANCELLED
              SELLER_CONFIRMED → PROCESSING, READY_TO_SHIP, CANCELLED
              PROCESSING → READY_TO_SHIP, CANCELLED
              READY_TO_SHIP → SHIPPED, CANCELLED
              SHIPPED → DELIVERED            (buyer confirmation, or admin on-behalf with evidence)
              DELIVERED → COMPLETED          (after the completion window)
              COMPLETED, CANCELLED (terminal)
```
`SHIPPED` requires carrier data **and** at least one waybill document. Funds are released at
`DELIVERED` unless a financial hold or open dispute exists.

## Payment (orders and external deals)
```
AWAITING_PAYMENT  → PAYMENT_SUBMITTED, EXPIRED, CANCELLED
PAYMENT_SUBMITTED → UNDER_REVIEW, CONFIRMED, REJECTED, AWAITING_PAYMENT, CANCELLED
UNDER_REVIEW      → CONFIRMED, REJECTED, AWAITING_PAYMENT, CANCELLED
REJECTED          → PAYMENT_SUBMITTED, EXPIRED, CANCELLED      (customer re-submits proof)
CONFIRMED, EXPIRED, CANCELLED (terminal)
```
Submissions (`payment_submissions`): SUBMITTED → ACCEPTED | REJECTED | NEW_PROOF_REQUESTED | SUPERSEDED.

## Shipment
```
CREATED → SHIPPED;  SHIPPED → IN_TRANSIT, DELIVERED, FAILED;  IN_TRANSIT → DELIVERED, FAILED;
FAILED → SHIPPED;   DELIVERED (terminal)
```

## Return
```
REQUESTED         → UNDER_REVIEW, APPROVED, REJECTED
UNDER_REVIEW      → APPROVED, REJECTED
APPROVED          → RETURN_IN_TRANSIT, RECEIVED
RETURN_IN_TRANSIT → RECEIVED
RECEIVED          → INSPECTION, REFUND_PENDING
INSPECTION        → REFUND_PENDING, DISPUTED
REFUND_PENDING    → REFUNDED
REJECTED          → DISPUTED
DISPUTED          → APPROVED, REFUND_PENDING, REJECTED
REFUNDED          (terminal)
```
Refund records: PENDING → PAID (CANCELLED terminal).

## External Protected Deal
```
DRAFT                      → INVITED, CANCELLED
INVITED                    → ACCEPTED, CANCELLED, DRAFT (invitation rejected/expired)
ACCEPTED                   → PAYMENT_PENDING, CANCELLED
PAYMENT_PENDING            → PAYMENT_UNDER_REVIEW, ACTIVE, CANCELLED
PAYMENT_UNDER_REVIEW       → ACTIVE, PAYMENT_PENDING, CANCELLED
ACTIVE                     → DELIVERED, DISPUTED
DELIVERED                  → COMPLETED, BUYER_CONFIRMATION_PENDING, DISPUTED
BUYER_CONFIRMATION_PENDING → COMPLETED, DISPUTED
DISPUTED                   → COMPLETED, REFUNDED, ACTIVE
COMPLETED, CANCELLED, REFUNDED (terminal)
```
Acceptance by the invited seller moves the deal ACCEPTED → PAYMENT_PENDING in one transaction.
Invitations: PENDING → ACCEPTED | REJECTED | REVOKED | EXPIRED (token stored as SHA-256 only).

## Dispute
```
OPEN                 → UNDER_REVIEW, AWAITING_INFORMATION, RESOLVED, CLOSED
UNDER_REVIEW         → AWAITING_INFORMATION, RESOLVED
AWAITING_INFORMATION → UNDER_REVIEW, RESOLVED
RESOLVED             → CLOSED
CLOSED               (terminal)
```
Decisions: FULL_REFUND, PARTIAL_REFUND, RETURN_REQUIRED, REPLACEMENT, RELEASE_TO_SELLER, REJECT_CLAIM.

## Withdrawal
```
REQUESTED    → UNDER_REVIEW, APPROVED, REJECTED, CANCELLED (seller)
UNDER_REVIEW → APPROVED, REJECTED
APPROVED     → PROCESSING, PAID, REJECTED
PROCESSING   → PAID, REJECTED
PAID, REJECTED, CANCELLED (terminal)
```
Approve = checker (`withdrawals.approve`); Paid = maker (`withdrawals.pay`, step-up, reference
required; above the dual-control threshold the payer must differ from the approver).
Ledger adjustments: PENDING_APPROVAL → POSTED | REJECTED (approver ≠ creator).

## Support ticket
```
OPEN, IN_PROGRESS, WAITING_CUSTOMER, WAITING_SELLER, ESCALATED → (each other as listed in code), RESOLVED, CLOSED
RESOLVED → CLOSED, IN_PROGRESS (reopen);  CLOSED (terminal)
```

## Tests

`tests/unit/state-machines.test.ts` checks allowed moves, rejected moves and terminal states; the
integration suites exercise every machine through real domain flows.
