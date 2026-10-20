# Business Logic — Final (hardened)

1. **Admin approval for money.** Every posting, reclassification, release, refund, reservation, payout, reversal or
   manual adjustment executes one operation-specific Admin approval (FINANCIAL_APPROVAL_MATRIX.md). Enforced in the DB.
   Not money movements (no approval): a seller withdrawal *request*; a buyer problem report/dispute or an Operations
   hold (protective, fail-closed); buyer receipt confirmation; the timeout entitlement; provider callbacks; statement imports.
2. **Canonical order flow.** checkout snapshot → proof → Admin payment approval (1 journal) → fulfilment → authoritative
   delivery event + seller evidence ≤ 24h → buyer 24h window → BUYER_CONFIRMED or TIMEOUT_ENTITLEMENT →
   ENTITLED_AWAITING_ADMIN_RELEASE → explicit Admin release (release journal + fee recognition) → COMPLETED.
3. **No automatic release, withdrawal or payout. Ever.**
4. **Seller statement is not proof of delivery.** Only Operations/carrier events are authoritative. Seller failure to
   provide evidence within 24h → Operations exception; no buyer timer, no entitlement, no release.
5. **Cancellation** only before SHIPPED, for every role, serialized with shipment on the sub-order lock. A pending buyer
   request blocks shipment. A paid cancellation creates a refund *request* (obligation).
6. **Refunds**: full/partial, item/quantity, components (principal, shipping, buyer fee, seller fee), original
   destination by default, approval then separate payout approval.
7. **Withdrawals**: request reserves nothing; approval reserves atomically with a frozen destination snapshot; payout is
   a separate approval; maker/checker threshold (production 0); negative balance/suspension/hold/drift block payouts.
8. **Fees**: F per item from commission rules; Fb = round_half_up(F × buyerShareBps), Fs = F − Fb; buyer pays
   merchandise + shipping + Fb; seller net = gross − F; snapshot per order; config changes prospective; missing config blocks checkout.
9. **Account closure**: blocked while anything is open or any balance ≠ 0; account lock serializes closure against
   new orders/withdrawals; completion pseudonymises PII and keeps all records.
10. **Kill switches** for each money operation; fail closed.
11. **Daily financial control** + close; invariants never auto-repaired.
12. **Reconciliation** never auto-matches.
13. **Go-live gate** fails closed; real money remains OFF.
