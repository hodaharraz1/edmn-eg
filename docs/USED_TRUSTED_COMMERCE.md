# EDMN Trusted Used Commerce — «سوق المستعمل المضمون»

> «اشتري مستعمل من شخص متعرفوش، وفلوسك تفضل محمية لحد ما تستلم وتتأكد.» — «لقيتها في أي مكان؟ اضمنها هنا.»

Last product feature batch before the production freeze. It **reuses** Marketplace, Seller Center, Admin, Protected
Deal, Invitation Flow, Agreement Freeze, Payment Protection, Delivery OTP, Disputes, Holds, Returns, Ledger,
Maker/Checker and the Audit Log. It adds **no financial path**: no ledger entry, no release, no wallet.

## 1. Configurable architecture (Phase 1)

`Category → used_category_policies.config` (zod `usedPolicySchema`, `src/domain/used.ts`):

| Part | Field |
|---|---|
| Condition schema + required fields | `fields[]` (SELECT / BOOLEAN / NUMBER / TEXT, groups, defect rules, one `identifier` field) |
| Required evidence | `evidence[]` (required / requiredWhenDefects / private / maxFiles) |
| Verification rules | `verification.requireIdentity`, `verification.requireComplete` |
| Inspection rules | `inspection.{minDays, defaultDays, maxDays}` |
| Dispute rules | `disputeReasons[]` (structured codes) |
| Protection policy | `levels[]` + `declaration` text |

* The deepest **enabled** policy on the category path applies (`policyForCategory`).
* V1 has one policy, seeded idempotently: used mobile phones (`mobile-phones`).
* Laptops, consoles or cameras are added at **/admin/used/policies**. That page requires `catalog.manage` and a fresh 2FA, asks for a reason, and versions and audits every change. No code change is needed.

## 2. Data model (migration `0019_used_trusted_commerce`, additive only)

| Table | Purpose |
|---|---|
| `used_category_policies` | Per-category configuration, versioned. |
| `used_condition_reports` | The seller's structured documentation for one item (a listing or a deal). The IMEI/serial is stored three ways: AES-GCM ciphertext (`identifier_enc`), a masked form, and a keyed HMAC (`identifier_hash`) for comparisons. **Status flow:** DRAFT → DECLARED → LOCKED. A DB trigger forbids any edit once LOCKED. |
| `used_condition_evidence` | Guided evidence by slot. Rows cannot change once the report is LOCKED (trigger). |
| `product_passports` | Public code `EP-XXXXXXXX`, protection level, staff verification. Linked through the identifier hash to support a future Product History. |
| `product_passport_events` | Append-only history (trigger). |
| `used_inspections` | **Real** inspections only, each with its report file. Append-only. |
| `condition_snapshots` | **Product Condition Freeze.** Content is immutable (trigger), only forward status moves are allowed, and records are hash-chained (`hash = sha256(canonical(snapshot, prevHash))`). |
| `used_analytics_events` | Privacy-safe events. Properties are whitelisted and coarse. |
| `external_deals.category_id` | Selects the policy for an external deal. |
| `files.purpose += CONDITION_EVIDENCE` | Private condition evidence: identifier photos, all deal photos and inspection reports. |

## 3. Flows

**Marketplace listing.** The seller opens **جواز المنتج** at `/seller/products/[id]/condition` and enters structured data, the identifier, guided photos and the declaration.
* `submitForReview` refuses a used listing in a covered category until its report is DECLARED.
* Public photos go through the public image pipeline (scan, re-encode, EXIF/GPS stripped). The identifier photo is private.
* At checkout, `freezeOrderConditions` creates an ACCEPTED snapshot for each seller order.

**External deal (Phase 10).**
1. The buyer enters the product, source URL, price and **category**. The inspection days must fall within the policy range.
2. Invitation.
3. The seller logs in or registers, then documents the condition at `/account/deals/[id]/condition` and declares it.
4. The seller's offer creates a PROPOSED snapshot bound to that terms version (`terms.condition.hash`).
5. The buyer reviews the condition, Safety Score and seller signals.
6. Agreement: `finalizeTerms` → `acceptDealSnapshot`. The snapshot becomes ACCEPTED and the report LOCKED. A hash mismatch or a missing snapshot refuses the agreement.
7. Payment, shipping, Delivery OTP.
8. Inspection period: «تم استلام المنتج. أموالك ما زالت محمية.» with a countdown and two choices, «المنتج مطابق» or «توجد مشكلة».
9. The existing settlement path follows.

**Material change after agreement.** `proposeConditionAmendment` is allowed after agreement and before shipping. It creates a new PROPOSED version chained to the agreed hash. The buyer accepts (the old version becomes SUPERSEDED) or rejects it. Both steps are audited.

**Used disputes (Phase 9).** `/account/deals/[id]/problem` lets the buyer pick a structured reason from the frozen snapshot, then opens the **existing** dispute. The existing hold rules apply. Admin dispute pages show the frozen condition, its integrity check and the passport.

## 4. Separation of concepts (Phase 5)

| Concept | Meaning |
|---|---|
| Transaction Protection | Always on: the money is held by EDMN until receipt, inspection and Admin maker/checker release. |
| Condition Verification («موثّق») | Staff reviewed the documents and photos. This is **not** a technical inspection. Requires `products.moderate` (listings) or `deals.manage` (deals) plus a fresh 2FA. Never done by the author or a party, and never by a member of the seller's store. |
| Professional Inspection («مفحوص») | Only with a recorded `used_inspections` PASS that has its report attached. |
| Warranty | Only what the seller declares. EDMN does not warrant products. |

No «100%» or «مستحيل» claims anywhere. The unit tests assert this.

## 5. Deal Safety Score (Phase 6)

* The setting `used.safetyScore` holds the weights, thresholds and saturation points. It is edited at **/admin/used/score** (`settings.manage`, fresh 2FA, reason, audit).
* The score covers 10 factors. Each factor states its points and *why*; a factor that does not apply is excluded.
* Levels: مرتفع / متوسط / محدود.
* Disclaimer: it is not a probability and not a guarantee.
* It never affects money.

## 6. Seller reputation (Phase 11)

`sellerSignals(userId)` reports: identity, verification level, account age, completed and successful transactions, dispute rate, product match rate, on-time shipping, and response time. Every rate shows «لسه بيانات قليلة» below 3 observations. There is no blanket «trusted seller» badge.

## 7. Invariants (unchanged)

* Delivery OTP proves receipt only.
* Buyer acceptance creates entitlement only.
* Release needs Admin approval plus universal maker/checker with different actors, and is booked in the immutable double-entry ledger.
* No automatic release, no Buyer Wallet, Real Money OFF.
* Fee Engine, historical pricing and A-100016 are untouched.

## 8. Tests

* `tests/unit/used-domain.test.ts`
* `tests/integration/used-commerce.test.ts`: configuration, IMEI privacy, IDOR, evidence authorization, duplicate-IMEI flag, freeze and tampering triggers, amendments, concurrency, OTP ≠ acceptance ≠ release, maker/checker, structured disputes, verification/inspection RBAC, marketplace freeze, Safety Score, analytics privacy.
* `tests/e2e/used-commerce.spec.ts`
