# Inventory and Concurrency

## Inventory
- Checkout reserves stock per variant inside the order transaction (`inventory_reservations` ACTIVE, `product_variants.reserved += q`) under row locks taken in deterministic (variant id) order — no deadlocks, no oversell.
- Payment confirmation commits the reservation (stock_on_hand −= q, reserved −= q, COMMITTED).
- Expiry of an unpaid order releases with status **EXPIRED** (distinct from a manual RELEASED); cancellation before shipment restocks (idempotent per `cancel:<so>`).
- Checks: `NEGATIVE_INVENTORY`, `RESERVATION_DRIFT`, `INVALID_RESERVATION` invariants; DB CHECKs on stock ≥ 0.
- Checkout re-prices server-side and refuses with a specific reason: «السعر اتغير», «المنتج خلص», «الإجمالي اتغير من X إلى Y».

## Serialization points
| Race | Mechanism | Tested in |
|---|---|---|
| Two buyers, last unit | variant row lock + reserved check | checkout-payments |
| Double payment confirmation | payment row lock + unique journal idempotency key + approval idempotency key | checkout-payments |
| Buyer confirm ×2 | sub-order row lock, idempotent return | fulfilment-finance (EDGE 10) |
| Release ×2 | sub-order row lock + `release:<so>` approval key + unique journal key | hardening-money |
| Cancel vs ship | sub-order row lock; only one legal transition commits | hardening-money |
| Buyer problem report vs timeout job at the deadline | sub-order row lock; timeout re-checks `now() >= due` and blockers inside the lock | hardening-delivery |
| Concurrent withdrawals | request reserves nothing; approval re-checks available under ledger-account locks + guard ≥ 0 | fulfilment-finance (EDGE 12) |
| Withdrawal vs account closure / checkout vs closure | per-account advisory lock `account:<user>` | closure + withdrawals code |
| Approval reuse across transactions | DB trigger consumes the approval atomically | hardening-money |

## Jobs
All jobs are idempotent, lock the row and re-check state inside the transaction, use the DB clock (`now()`), never
backdate, and never move money: buyer-response timeouts (5 min), missing delivery evidence (15 min), missing delivery
events (1 h), seller SLA flags (15 min), deal buyer timeouts, order expiry.
