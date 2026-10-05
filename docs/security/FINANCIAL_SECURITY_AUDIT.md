# Financial Security Audit

**Scope.** Payments (manual transfer + proof), the seller balance projection, withdrawals, refunds, external protected deals (escrow-style holding), and the double-entry ledger.

**No real money.** `payments.realMoneyEnabled` is false on staging and cannot be enabled there.

## 1. Money model

- **Ledger.** Every movement is a balanced journal entry posted through `postEntry`:
  - a balanced-entry check in code;
  - a deferred DB balance trigger (it must post inside a transaction);
  - append-only triggers on `journal_entries` / `journal_lines`;
  - a unique `idempotency_key` per business event.
- **Balances.** `ledger_accounts.balance` is a projection of the journal. `reconcile()` recomputes every account from its lines and reports any drift as mismatches plus a trial balance check.
- **Amounts.** Integer piasters everywhere (`parseEgp`); no floating-point money.

## 2. Flow-by-flow review

| Flow | Attack considered | Control | Test |
|---|---|---|---|
| Checkout | Client tampers price, discount or shipping | Server re-prices every line (`priceLines`); `expectedTotal` is only a guard; idempotent `checkoutKey` | checkout-payments |
| Checkout | Buy from own store to fake sales / ratings | Refused for owner and members, including a merged guest cart | SEC-AZ-2 |
| Payment proof | Zero / negative / mismatching amount | Positive amount required; confirm requires claimed = due | SEC-PAY-1, 2 |
| Payment confirm | Insider confirms own store / own payment; stale session | Self-dealing guard, payer ≠ confirmer, step-up | SEC-PAY-3, 4 |
| Payment confirm | Double click / replay / two admins at once | Row lock + idempotency key → exactly one posting | SEC-PAY-5 |
| Funds release | Release before delivery / during dispute | State machine + `financialHold`; dispute freezes | fulfilment-finance |
| Withdrawal request | Concurrent requests spend the same balance | `FOR UPDATE` on the seller balance; reserve account | SEC-WD-1 |
| Withdrawal approve | Split requests under the dual-control threshold | Rolling 24h total | SEC-WD-2 |
| Withdrawal pay | Pay a suspended, held or indebted seller; insider pays own store; seller pays self | Status, hold and `SELLER_AVAILABLE ≥ 0` checks; self-dealing | SEC-WD-3, 5, 6, 7 |
| Withdrawal reject in PROCESSING | Same person reverses a transfer that actually went out | Different person + step-up | SEC-WD-4 |
| Refund paid | Beneficiary marks own refund paid; large refunds by one person | Payee ≠ actor; maker/checker over threshold | integration |
| Ledger adjustment | One person creates and approves | maker ≠ checker (default threshold 0) | integration |
| Real-money switch | Turning test money into real money | Refused while anything test-derived is open; refused on staging | pilot-safety |
| Protected deal | Pay before both sides agree; seller changes terms after payment | Payment only from PAYMENT_PENDING (after agreed version); agreed terms are DB-immutable; versions append-only | deal-invitation-returns |
| Protected deal | Buyer accepts a stale or replaced offer | ACCEPT must name the current PROPOSED version | deal-invitation-returns |
| Protected deal | Payout before buyer confirmation / during a dispute | Completion only on buyer confirm, end of inspection, or dispute decision; payout PENDING → PAID by finance (payee ≠ actor) | E2E protected-deal |
| Protected deal | Seller marks the buyer as having received / courier collects the money release with a code only | No seller "received" action. The handover OTP proves physical handover only. Release requires the buyer's explicit "received & as described" after a verified handover, confirmed payment, no dispute, no ops hold and no hold flag — exactly once | delivery-otp suite |
| Protected deal | Buyer says "not received" after a verified OTP | DELIVERY_CONFLICT: dispute + HIGH risk flag; funds held; Operations decides | delivery-otp 22 |
| Protected deal | Shipping fee manipulation | Seller's shipping fee is part of the versioned terms; total, fee and buyer-pays are recomputed on the server and frozen at agreement | deal-invitation-returns |

## 3. Return policy and money

- **Snapshot.** The seller's voluntary return policy is snapshotted per order item (`order_items.return_policy_snapshot`). For protected deals it is part of the agreed terms (`external_deals.agreed_terms`). Later edits by the seller change neither refunds nor windows for past purchases (test).
- **Window.** The eligibility window is computed from the snapshot. Protected reasons (wrong, damaged, defective, missing parts, not as described, counterfeit) always get at least `disputes.windowDays`. This applies even when the seller offers no voluntary returns.
- **Residual (business decision).** Funds may be released to the seller before a long voluntary return window ends. A late refund then creates seller debt. Payouts are blocked while the seller is in debt (FIN-P1-1).

## 4. Reconciliation

`reconcile()` was run after the full integration suite (SEC-LG-3: trial balance OK, zero drift). It was also run read-only against the staging database. See `FINAL_SECURITY_REPORT.md` §Ledger for the numbers.

## 5. Open financial risks

| Risk | Severity | Note |
|---|---|---|
| Release before the voluntary window ends (seller debt) | P2 (business) | Mitigated by the debt payout block; product decision whether to delay release for long windows |
| Adjustment self-approval if an operator sets the threshold above 0 | P2 (config) | Keep the default 0 in production |
| Manual-transfer model depends on staff verifying the bank statement | Operational | Real-money launch requires a reconciled bank feed or a payment gateway |
