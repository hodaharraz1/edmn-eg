# Legal Wording Review — items requiring counsel approval

Status (2026-10-05): **APPROVED by the company owner. Version 1.0 is published.**

- Operator stated in the documents: **شركة اضمن إي جي (EDMN EG)**, Alexandria.
- Contact: **info@edmneg.com**.
- The commercial registration number was not provided, so it is not stated anywhere.
- The draft notices were removed from the public pages.
- Later changes are published as new versions from **Admin → Legal Texts**. Every earlier version
  and every user acceptance stays recorded.

The table in §2 records how money-handling wording was reviewed and softened in this release.

## 1. Legal documents (CMS-managed)

All 13 legal documents are published as full texts, **version 1.0 (APPROVED)**. They are managed in
**Admin → System → Legal Texts**, are versioned, and record buyer and seller acceptances.

| Code | Public URL |
|---|---|
| TERMS_OF_USE | `/legal/terms` |
| PRIVACY_POLICY | `/legal/privacy` |
| COOKIE_POLICY | `/legal/cookies` |
| BUYER_TERMS | `/legal/buyer-terms` |
| SELLER_AGREEMENT | `/legal/seller-agreement` |
| RETURNS_POLICY | `/legal/returns` |
| SHIPPING_POLICY | `/legal/shipping` |
| PROHIBITED_PRODUCTS | `/legal/prohibited-products` |
| REVIEW_POLICY | `/legal/review-policy` |
| DISPUTE_POLICY | `/legal/dispute-policy` |
| EXTERNAL_DEAL_TERMS | `/legal/protected-deal-terms` |
| FEES_POLICY | `/legal/fees` |
| DATA_DELETION | `/legal/data-deletion` |

They replaced the earlier placeholders as a new version. The previous versions are kept.

## 2. Marketing / UI wording that describes money handling

| Wording (Arabic) | Where | Concern | Change made in this release |
|---|---|---|---|
| «دفع محمي» / «شراء محمي من اضمن» | product page, product cards, hero tiles, footer, site meta description | Could be read as a regulated escrow or guarantee | **Kept** as the product name. The explanation now says only: the seller's net becomes *available for withdrawal* after the buyer confirms receipt |
| «البائع لا يستلم أرباحه إلا بعد تأكيدك استلام الطلب» | footer, homepage | Describes timing of seller payouts | Kept; it is accurate to system behavior. **Needs approval** |
| «لو حصلت مشكلة يتدخل فريق اضمن» | product page | Implied service guarantee | **Replaced** with: return/dispute per the published terms (link to buyer terms) |
| «فريق اضمن يتدخل لحل أي مشكلة بشكل عادل» | homepage trust block (seed) | Implied guarantee of outcome | **Replaced** with: EDMN reviews complaints/disputes per the published dispute policy |
| «تم تأكيد الدفع وحفظه لدى اضمن» | external deal page (buyer) | "Kept with EDMN" implies custody of funds | **Replaced** with: EDMN confirmed receipt of the payment; the seller's amount is not made available until receipt is confirmed or inspection ends |
| «تم تأكيد دفع المشتري لدى اضمن» | external deal page (seller) | Same custody implication | Kept (states receipt only). **Needs approval** |
| «صفقة محمية» disclaimer on `/protected-deal` | protected deal landing | Already states the final legal text is subject to counsel approval | Unchanged |
| «إزاي بنحمي مشترياتك؟» 4-step block | homepage (seed, CMS-editable) | Describes the payment, shipping, receipt and dispute flow | New; states facts only. **Needs approval** |
| Statutory return window («حق الإرجاع القانوني … 14 يوم») | product page | Consumer-law claim | Shows the admin-configured value with "subject to legal review" |
| «لا يقدم إرجاعاً اختيارياً، دون الإخلال بحقوق المستهلك المقررة قانوناً» | product page | Consumer-law reference | **Needs approval** |

## 3. Pilot / test-mode labels (safety, not legal claims)

- «TEST PAYMENT DESTINATION — NOT FOR REAL MONEY» appears on checkout, the order payment page and
  the external deal payment page.
- «TEST PAYOUT — NO REAL MONEY IS TRANSFERRED» appears on seller and admin withdrawal pages.
- These labels appear whenever real money is disabled or the payment destination is a test one.
  Real money can never be enabled on staging.

## 4. Where to edit

| Text | Edit in |
|---|---|
| Homepage text | Admin → Content (CMS blocks) |
| Legal documents | Admin → Legal Texts |
| Payment instructions shown to buyers | Admin → Payment Methods & Destinations |
| Product-page and deal-page sentences in §2 | Source code (`src/app/(shop)/product/[slug]/page.tsx`, `src/app/(shop)/account/deals/[id]/page.tsx`); each is a single sentence, marked with a `COUNSEL REVIEW` comment where applicable |
