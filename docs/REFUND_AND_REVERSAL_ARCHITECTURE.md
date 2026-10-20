# Refund and Reversal Architecture

Code: `src/server/modules/finance/refunds.ts`. Admin UI: `/admin/refunds`.

## Sources
ORDER_CANCELLATION (paid sub-order cancelled before shipment), RETURN (accepted return: returned units, shipping only if
chosen), DISPUTE (decision: full/partial), DELIVERY_FAILURE (returned to seller / lost), ADMIN. Each source creates at
most one refund (`idempotency_key = <source>:<id>`).

## Request (no money moves)
`requestRefundTx` locks the sub-order, computes what is still refundable (`refundableOf`: principal, shipping, buyer fee,
seller fee, per-item units) and refuses any component above the remainder. Item refunds are unit-level
(`refund_items`, append-only); per-unit fee shares are allocated exactly (cumulative proportion; the last unit absorbs
the rounding remainder, so all units together equal the snapshotted Fb/Fs exactly).

Components stored: `principal_amount`, `shipping_amount`, `buyer_fee_refund`, `seller_fee_reversal`,
`amount = principal + shipping + Fb_refund` (what the buyer gets), `seller_liability = principal + shipping − Fs_reversal`.

Destination: snapshot of the **original payment** (method, payment id, payer name, payer reference). Any other
destination is an audited exception (`overrideRefundDestination`, refunds.approve + 2FA + reason ≥ 5 chars).

## Approval (REFUND_APPROVAL → journal REFUND)
`approveRefund(expectedAmount, reason)`: refunds.approve, fresh 2FA, kill switch, exact amount check (stale → refused).
Balanced reversal: DR SELLER_PENDING (or SELLER_AVAILABLE after release — may go negative = seller debt, which blocks
payouts), DR COMMISSION_DEFERRED (or COMMISSION_REVENUE after recognition) for the fee reversal, CR
CUSTOMER_REFUNDS_PAYABLE for the buyer amount.

## Payout (REFUND_PAYOUT → journal REFUND_PAID)
`recordRefundPayout(reference, proof?)`: refunds.pay, 2FA, payouts kill switch; above the dual-control threshold the
payer must differ from the approver (DB CHECK). DR CUSTOMER_REFUNDS_PAYABLE / CR PLATFORM_CASH. `FAILED` keeps the
liability. Cancellation of a paid order therefore always means "refund obligation", never "refund paid".

## Protected deals
Full refund decision → deal `REFUND_PENDING` + REQUESTED refund → `approveDealRefundTx` (DEAL_REFUND).
Partial → `pendingBuyerRefund` applied at the Admin DEAL_RELEASE settlement.

## Reversal principles
Nothing is deleted or edited: corrections are new balanced entries under their own approval; legacy refunds with
`PENDING`/`PAID` keep their history.
