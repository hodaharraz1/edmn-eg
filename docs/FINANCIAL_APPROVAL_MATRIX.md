# Financial Approval Matrix

Status: implemented (migration `0008_production_hardening`). Owner: Finance. Applies to staging and production.

## Rule

Explicit, authenticated, operation-specific **Admin financial authorization** is required for every operation that
**posts, reclassifies, releases, refunds, reserves for payout, pays out, reverses or manually adjusts** money in the
ledger. It is enforced twice:

1. **Application**: `grantApproval()` (`src/server/modules/finance/approvals.ts`) — Admin actor only, fresh 2FA
   step-up, permission of the operation, rate limit 300/h per approver, maker ≠ checker where dual control applies.
2. **Database** (cannot be bypassed by a code path that forgets step 1):
   - `journal_entries_require_approval` (BEFORE INSERT): every new journal entry must reference an approval that is
     `APPROVED` (it is consumed atomically) or was consumed in the same transaction, whose `entry_types` include the
     entry's type and that has an approving Admin.
   - `journal_entries_approval_amount` (deferred constraint trigger): sum of debits posted under an approval = the
     approved amount, checked at commit.
   - `financial_approvals_guard`: approvals are never deleted/truncated; amount/action/entity/version/approver are
     immutable; a CONSUMED/REVOKED approval is final.
   - CHECK: `dual_control` ⇒ `requested_by <> approved_by`.

Each approval persists: id, action, entity type/id, exact amount (EGP piasters), currency, economic version, destination
snapshot (payouts/refunds), reason, approver, step-up time, requested-by (maker), idempotency key, status, timestamps,
and an audit row (`financial_approval.granted`). Stale (economic version changed), revoked, reused or mismatched
approvals are rejected.

## Matrix

| Operation | Approval action | Journal entry type | Permission | 2FA | Dual control | Kill switch |
|---|---|---|---|---|---|---|
| Confirm manual marketplace payment | PAYMENT_CONFIRMATION | ORDER_PAYMENT | payments.verify | yes | — | killswitch.paymentConfirmation |
| Confirm protected-deal payment | DEAL_PAYMENT_CONFIRMATION | DEAL_PAYMENT | payments.verify | yes | — | killswitch.paymentConfirmation |
| Seller release (pending → available + fee recognition) | SELLER_RELEASE | SELLER_RELEASE | finance.release | yes | — | killswitch.sellerRelease |
| Approve marketplace refund (reversal to refunds payable) | REFUND_APPROVAL | REFUND | refunds.approve | yes | — | killswitch.refunds |
| Record refund payout | REFUND_PAYOUT | REFUND_PAID | refunds.pay | yes | ≥ threshold: payer ≠ approver | killswitch.payouts |
| Approve withdrawal (reserve) | WITHDRAWAL_RESERVATION | WITHDRAWAL_RESERVE | withdrawals.approve | yes | — | killswitch.withdrawals |
| Reject/cancel an approved withdrawal (unreserve) | WITHDRAWAL_RELEASE_RESERVATION | WITHDRAWAL_REVERSAL | withdrawals.approve | yes | — | — |
| Record withdrawal payout | WITHDRAWAL_PAYOUT | WITHDRAWAL_PAID | withdrawals.pay | yes | ≥ threshold: payer ≠ approver | killswitch.payouts |
| Manual ledger adjustment | MANUAL_ADJUSTMENT | ADJUSTMENT | ledger.adjust.create (maker) + ledger.adjust.approve (checker) | yes | maker/checker | killswitch.adjustments |
| Protected-deal settlement | DEAL_RELEASE | DEAL_SETTLEMENT | finance.release | yes | — | killswitch.dealRelease |
| Protected-deal refund | DEAL_REFUND | DEAL_REFUND | refunds.approve | yes | — | killswitch.refunds |
| Protected-deal payout | DEAL_PAYOUT | DEAL_PAYOUT_PAID | deals.payout | yes | — | killswitch.payouts |

## Actions that need NO prior financial approval (clarification §2)

| Action | Why | Moves money? |
|---|---|---|
| Seller creates a withdrawal **request** | A request only; reserves nothing, posts nothing. Approval later re-checks under lock and reserves. | No |
| Buyer opens a dispute / reports a problem ("ماستلمتش" / "فيه مشكلة") | Protective hold, fail-closed: blocks timeout entitlement and release. | No |
| Operations places a financial hold (`setFinancialHold(true)`) | Protective; permission `orders.manage`, no step-up needed to *place*. | No |
| Buyer confirms receipt | Records entitlement (`BUYER_CONFIRMED`) only. | No |
| Timeout job | Records `TIMEOUT_ENTITLEMENT` only. | No |
| Provider webhook | Evidence only (`provider_events`). | No |
| Statement import | `UNMATCHED`/`SUGGESTED_MATCH` only, never auto-`MATCHED`. | No |

**Removing a hold** requires fresh 2FA (and is not itself a release). Settling/releasing after a hold requires the
operation's own approval above.

## Maker/checker threshold

| Environment | `withdrawals.dualControlThreshold` | Status |
|---|---|---|
| STAGING (current) | 5,000,000 piasters = **50,000 EGP** | allowed for pilot testing only |
| PRODUCTION | **0 EGP — REQUIRED** | the go-live gate (`MAKER_CHECKER`) fails closed while it is not 0 |

The rolling 24-hour total per seller is used (splitting a payout does not avoid the second person).
