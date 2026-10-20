# Financial Invariants

Computed by `financialInvariants()` (`src/server/modules/finance/controls.ts`), shown at `/admin/finance-control`,
stored in each daily close (`financial_closes`) and checked by the go-live gate. **Violations are never repaired
automatically**; each check returns the offending rows for drill-down to the source event.

| Code | Invariant (expected count 0) |
|---|---|
| TRIAL_BALANCE | Σ debits = Σ credits over all journal lines |
| PROJECTION_DRIFT | every `ledger_accounts.balance` equals the sum of its journal lines |
| UNBALANCED_ENTRY | every entry balanced and has ≥ 2 lines |
| DUPLICATE_BUSINESS_EVENT | one ORDER_PAYMENT / SELLER_RELEASE / DEAL_* / WITHDRAWAL_* per source |
| ORPHAN_JOURNAL | every entry's source row exists |
| MISSING_PAYMENT_JOURNAL | every confirmed payment's paid sub-order has its ORDER_PAYMENT entry |
| MISSING_WITHDRAWAL_JOURNAL | reserved ⇒ WITHDRAWAL_RESERVE; PAID ⇒ WITHDRAWAL_PAID |
| MISSING_REFUND_JOURNAL | approved ⇒ REFUND (or deal) entry; COMPLETED/PAID ⇒ REFUND_PAID |
| UNAPPROVED_JOURNAL | no entry after the hardening cut-over lacks an approval |
| NEGATIVE_INVENTORY | stock ≥ 0, 0 ≤ reserved ≤ stock |
| RESERVATION_DRIFT | `reserved` = Σ ACTIVE reservations |
| INVALID_RESERVATION | no ACTIVE reservation on a paid/cancelled sub-order |
| REFUND_OVERAGE | Σ active refunds ≤ gross; refunded_total ≤ gross |
| REFUND_QTY_OVERAGE | Σ refunded units ≤ purchased units |
| WITHDRAWAL_OVERAGE | SELLER_WITHDRAWAL_RESERVED balance = Σ open reserved withdrawals, never negative |
| COMPLETION_WITHOUT_RELEASE | COMPLETED ⇒ receipt basis AND funds_released_at |

Database-level guarantees (not only checks): approval trigger + amount trigger, balanced-entry deferred trigger,
append-only journal, immutable deadlines/receipt basis/release timestamp, immutable withdrawal destination snapshot and
amount, no deletion of orders/sub-orders/payments/refunds/withdrawals/ledger accounts/approvals, CHECKs
(`orders_totals_chk`, `seller_orders_totals_chk`, `seller_orders_fee_split_chk`, `seller_orders_completion_chk`,
`order_items_total_chk`, dual control ≠ same person).

Money is integer piasters everywhere (`bigint`/`integer`), `applyBps` rounds half-up (599.00 × 15% = 89.85 exactly).
