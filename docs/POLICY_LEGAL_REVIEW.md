# Policy and Legal Review — v1.1 drafts

**Status: LEGAL REVIEW REQUIRED.** Nothing here is legal advice. The texts are not legally approved.

Version `1.1-draft` of eight documents was written to match the hardened behaviour. On staging it is published as
the *current* version with status DRAFT (`src/server/db/seed/legal-texts-v1_1.ts`, seeded by `reference.ts`). Public
pages show «نص غير نهائي — مسودة قيد المراجعة القانونية». The owner-approved v1.0 rows are kept unchanged (history).
Seller agreements accepted from now on record `1.1-draft`. `legal.policiesApproved` stays false and is a go-live blocker.

| Code | What changed vs v1.0 |
|---|---|
| BUYER_TERMS | Admin confirmation of payment; cancellation before shipment only, paid cancellation = refund request; seller evidence + carrier event → 24h buyer window; timeout = entitlement, not confirmation; "seller statement alone is not proof"; shared fee shown before confirmation; shipping paid by buyer |
| SELLER_AGREEMENT | 24h delivery-evidence duty after an authoritative delivery event; late/missing evidence → Operations review (no buyer timer, no entitlement); entitlement ≠ available; release only by explicit Admin approval; withdrawal request reserves nothing; seller share of the fee (Fs) |
| RETURNS_POLICY | Unit/quantity refunds, refund components, refund to original payment method, approval then payout |
| SHIPPING_POLICY | Buyer pays shipping; exceptions (failed/refused/lost/damaged) never count as delivery |
| DISPUTE_POLICY | A problem report is a protective hold (no prior approval); lifting it/settling needs an authorized Admin |
| EXTERNAL_DEAL_TERMS | OTP handover, buyer window, entitlement then Admin settlement then separate payout |
| FEES_POLICY | Transparent shared fee F = Fb + Fs, rounding rule, prospective-only changes, snapshot per order |
| DATA_DELETION | Account closure lock and blockers, pseudonymisation, retention of financial/legal records |

## Items for counsel / owner (not decided by the system)
1. Fee split (buyer share bps) and whether a buyer fee is charged at all — currently carried over as 0% buyer / 100% seller, `fees.ownerApproved = false`.
2. The 24h seller evidence and 24h buyer response windows (fixed in code; deal window = max(24h, inspection days)).
3. Consumer-protection statutory windows (returns statutory window setting = 14 days is a placeholder default).
4. Retention periods for financial records, KYC documents, messages and evidence after closure.
5. Wording on liability, chargebacks, and the operator's role as payment intermediary (licensing).
6. Tax/VAT treatment of the service fee and invoices.
7. Seller SLA values (`sla.sellerConfirmHours` 48h, ship grace 1 day) and their consequences.
