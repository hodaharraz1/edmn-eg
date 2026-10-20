# EDMN — Final Acceptance Test Plan (owner-led)

| Item | Value |
|---|---|
| Environment | **Staging only** — https://edmn-staging.vercel.app. Banner "بيئة تجريبية (Staging)", noindex, real money **off**. |
| Build under test | Branch `claude/great-tesla-nor0wt`. Record the exact commit from the Vercel deployment as **E-0**. |
| Who runs it | The owner, using three people / browsers (or three separate browser profiles): **BUYER A**, **SELLER B**, **ADMIN**. |
| Rule | Use only fake data. Never use a real national ID, real bank account, real card, or any real customer. |

This plan is a script. Every step lists:
- the actor;
- the exact action;
- the **expected status** after it;
- the **evidence** to capture (`E-…`).

A step passes only if the expected result is observed **and** the evidence is captured. When something does not happen exactly as written, the step **fails**. Note what happened instead and continue only if the remaining steps do not depend on it.

---

## 0. Preparation

| # | Actor | Action | Expected | Evidence |
|---|---|---|---|---|
| 0.1 | Owner | Open three separate browser profiles (A, B, Admin). Use Chrome on a phone for at least BUYER A (390 px). | — | — |
| 0.2 | Owner | Accounts:<br>- **BUYER A:** register a fresh customer at `/register`.<br>- **SELLER B:** registers during the test.<br>- **ADMIN:** the staging super-admin `admin@edmn.local`, with the staging password and TOTP held by the owner (never the repository defaults; staging refuses them). Optionally also `payments@edmn.local` and `finance@edmn.local` to show separation of duties. | Logins work. Admin needs password + 6-digit TOTP. | E-0.2 screenshot of the admin 2FA screen |
| 0.3 | ADMIN | Open `/admin/ledger`. Note total debits and total credits. | Debits = credits | **E-0.3** screenshot (baseline) |
| 0.4 | Owner | Phone codes (SMS/e-mail) are **not delivered** on staging (no provider). To verify a mobile number, ADMIN reads the code from `/admin/notifications` (outbox). The Delivery OTP is shown **to the buyer only**, on their deal page, labelled «رمز تجريبي — بيئة Staging». | — | — |

---

## Part A — Normal marketplace order

### A1. Seller onboarding (SELLER B)

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| A1.1 | SELLER B | Open `/seller/register`. Choose **فرد (Individual)**. Fill name, e-mail, mobile, password; accept terms; create the account. | Lands in the Seller Center onboarding (dark seller shell; **no** customer header or cart). Seller status **DRAFT**. | E-A1.1 screenshot of the onboarding page |
| A1.2 | SELLER B | `/account/security` → **إرسال رمز** (mobile). ADMIN reads the code from `/admin/notifications`. SELLER B enters it → **تأكيد**. | Mobile shows «مؤكد». | E-A1.2 |
| A1.3 | SELLER B | Onboarding steps:<br>- **identity:** fake 14-digit national ID, address, governorate;<br>- **store:** name, description, return address;<br>- **documents:** fake ID front/back images;<br>- **payout:** InstaPay fake address;<br>- submit. | Seller status **PENDING_REVIEW**. «لا يمكنك إضافة منتجات قبل الموافقة» shown. | E-A1.3 screenshot; **Seller ID** from `/admin/sellers` |
| A1.4 | ADMIN | `/admin/approvals` → open the seller.<br>- Verify the documents open (a 2FA step-up may be requested) and the national ID is masked.<br>- Approve the seller and the payout method. | Seller **APPROVED**; payout method verified. Audit entry exists. | E-A1.4 screenshots; `/admin/audit` entry `seller.approve` |
| A1.5 | SELLER B | `/seller/shipping`: enable at least Cairo with a fee (e.g. 50 ج.م), ETA 1–3 days. `/seller/store`: set the default return policy (e.g. **يقبل الاسترجاع الاختياري 7 أيام**, conditions, shipping responsibility). | Saved. | E-A1.5 |

### A2. Products (SELLER B → ADMIN)

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| A2.1 | SELLER B | `/seller/products/new`: **NEW** product.<br>- category, title, description (≥ 20 chars);<br>- 1+ images;<br>- variant with price (e.g. 500 ج.م) and stock 5;<br>- shipping & return step: choose a return policy (store default or own);<br>- **إرسال للمراجعة**. | Product **SUBMITTED** (not public). | E-A2.1; **Product ID** |
| A2.2 | SELLER B | Create a **USED** product.<br>- grade, condition notes, defects (e.g. «خدش بسيط»);<br>- 2+ **actual-item** photos;<br>- return policy **لا يوفر استرجاعًا اختياريًا**;<br>- submit. | **SUBMITTED**. Submitting without a return policy or without actual photos is refused with an Arabic message (try it once). | E-A2.2 |
| A2.3 | BUYER A | Search for both product titles at `/search`. | **Not found** (not yet approved). | E-A2.3 |
| A2.4 | ADMIN | `/admin/moderation`: approve both products. | Products **LIVE**. | E-A2.4 |

### A3. Purchase (BUYER A)

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| A3.1 | BUYER A | Search the NEW product with an Arabic spelling variant (e.g. replace أ with ا, or ة with ه). Open the product page. | Found. The PDP shows:<br>- price;<br>- stock;<br>- seller store link;<br>- verified-seller indicator;<br>- the **return policy** block («سياسة الاسترجاع» + the mandatory-rights notice);<br>- processing time.<br>The USED product page additionally shows grade and defects. | E-A3.1 screenshots of both PDPs |
| A3.2 | BUYER A | Add the NEW product (qty 1) **and** one product from another (demo) seller to the cart. Open `/cart`. | Cart grouped **per seller**. | E-A3.2 |
| A3.3 | BUYER A | Checkout: add a Cairo address.<br>- Review per-seller shipping and the per-item return policy («سياسة الاسترجاع — …»).<br>- Choose InstaPay; place the order. | Parent order **PENDING_PAYMENT**; one seller sub-order per seller. Totals = items + per-seller shipping (the server recomputes them; there is no client-side override). | E-A3.3; **Order ID / number** |
| A3.4 | BUYER A | On the payment page, note the destination is marked **TEST** («تجريبي»). Upload a payment-proof image, enter the exact amount and a reference; submit. | Order **PAYMENT_UNDER_REVIEW**. | E-A3.4 |

### A4. Payment verification and fulfilment

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| A4.1 | ADMIN (`payments@edmn.local`) | `/admin/payments` → open the payment.<br>- **Negative check first:** try to confirm with a different amount → refused.<br>- Then confirm with the correct amount (a TOTP step-up is requested). | Payment **CONFIRMED**. Order **PAID**; sub-orders **PAID**. | E-A4.1 screenshot; payment ID |
| A4.2 | SELLER B | `/seller/balance` | **Pending** balance = seller net of the sub-order (price + shipping − commission). **Available = 0**. | **E-A4.2 balance BEFORE** (screenshot) |
| A4.3 | SELLER B | `/seller/orders` → open the sub-order → confirm → processing → ready to ship → shipment (carrier + tracking number) → **upload the waybill (PDF/image)** → mark shipped. Shipping without a waybill must be refused (try once). | Sub-order **SHIPPED**. | E-A4.3 |
| A4.4 | SELLER B | `/seller/balance` again. | **Still pending.** Available unchanged (**the waybill and SHIPPED release nothing**). | E-A4.4 |
| A4.5 | BUYER A | `/account/orders/<id>`: tracking timeline visible → **تأكيد الاستلام** for SELLER B's sub-order. | Sub-order **DELIVERED**. | E-A4.5 |
| A4.6 | SELLER B | `/seller/balance` | **Available** increased by the seller net **exactly once**; pending decreased by the same amount. | **E-A4.6 balance AFTER** |
| A4.7 | BUYER A | Repeat the confirmation (refresh and click again if the button is still shown). | No second credit. | E-A4.7 (balance unchanged) |

### A5. Withdrawal

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| A5.1 | SELLER B | `/seller/withdrawals`: request **more than available** → refused. Then request a valid amount. | Withdrawal **REQUESTED**. Available decreases (amount reserved). The page shows «TEST PAYOUT — NO REAL MONEY». | E-A5.1; **Withdrawal ID** |
| A5.2 | ADMIN (`checker@edmn.local` or super-admin) | `/admin/withdrawals` → approve. | **APPROVED**. | E-A5.2 |
| A5.3 | ADMIN (`finance@edmn.local`) | Record the transfer (reference e.g. `TEST-TRX-1`; a step-up is requested). | **PAID**. Seller sees «تم التحويل». Ledger debits = credits. | E-A5.3; ledger entry ID |

---

## Part B — External protected deal (main scenario)

### B1. Buyer request (BUYER A, phone)

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| B1.1 | BUYER A | `/account/deals/new`.<br>- **Product:** title, description, condition USED, qty 1.<br>- **السعر المطلوب:** e.g. 8,000.<br>- **توقعات التسليم:** preferred method + latest date + inspection days. The page says these are expectations only.<br>- **Special terms:** optional. | Draft saved per step. | E-B1.1 |
| B1.2 | BUYER A | **عنوان الاستلام:** press **استخدام موقعي الحالي**. The browser asks for location permission → allow. Then fill governorate / city / street / building. Leave the seller fields **empty**. | «تم تحديد موقعك» shown. The text «مش لازم تكون عارف بيانات البائع كاملة…» is visible. Coordinates are **not** in the address bar. | E-B1.2 screenshot incl. URL bar |
| B1.3 | BUYER A | Review → accept the terms → **إنشاء طلب الصفقة**. | Share screen: «تم إنشاء طلب الصفقة», «رقم الصفقة: EDMN-XXXXXXXX», buttons نسخ / WhatsApp / مشاركة. Deal **INVITED**. | **E-B1.3 Deal ID (EDMN-…)**; screenshot. Copy the invitation link (send it to SELLER B by WhatsApp to test the share). |

### B2. Seller joins and offers (SELLER B, using the same seller account as Part A or a new one)

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| B2.1 | SELLER B (logged out) | Open the link. | Safe summary only: product, requested price, buyer's **governorate** — **no** buyer name, phone, street or coordinates. Status still **INVITED** (opening changes nothing). | E-B2.1 |
| B2.2 | SELLER B | **قبول ومتابعة** → log in (or register) → **قبول ومتابعة** again. | Deal **SELLER_JOINED**; it appears in SELLER B's «الصفقات المحمية». | E-B2.2 |
| B2.3 | Third account (any other customer) | Open the same link. | «هذه الدعوة مرتبطة بحساب آخر»; no accept button. | E-B2.3 |
| B2.4 | SELLER B | On the deal page:<br>- verify the mobile if asked;<br>- full name;<br>- pickup address: press «استخدام موقعي الحالي» and **deny** permission → a clear message appears, then type the address manually;<br>- **offer:** final unit price (change it, e.g. 7,800), shipping fee 60, **delivery method**, processing days 2, **delivery window 1–3 days**, defects, accessories;<br>- return policy **لا يوفر استرجاعًا اختياريًا**;<br>- InstaPay payout;<br>- accept terms → send. | Deal **OFFER_PENDING_BUYER** (terms version 1). | E-B2.4 |

### B3. Negotiation

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| B3.1 | BUYER A | Open the deal. The review shows:<br>- price, shipping cost, delivery method, processing time, expected delivery window;<br>- product condition + defects;<br>- **return policy** + the mandatory-rights notice;<br>- special terms, total;<br>- buttons موافق على العرض / طلب تعديل / رفض. | Nothing is hidden in the T&C. | E-B3.1 |
| B3.2 | BUYER A | **طلب تعديل**: return policy **يسمح بالاسترجاع 3 أيام**, message «أريد إمكانية الاسترجاع». | Deal **CHANGE_REQUESTED** (version 2, proposed by the buyer). Version 1 is unchanged in «سجل نسخ الشروط». | E-B3.2 |
| B3.3 | SELLER B | Open **عرض مقابل** (counter-offer): keep 3-day returns, adjust the shipping fee (e.g. 50) → send. | Deal **OFFER_PENDING_BUYER** (version 3, seller). | E-B3.3 |
| B3.4 | BUYER A | Try to pay before agreeing (no payment button should exist). Then **موافق على العرض**. | Deal **PAYMENT_PENDING**. «الشروط المتفق عليها (نسخة 3)» shown. | E-B3.4; screenshot of the terms history with 3 versions |

### B4. Payment and handover

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| B4.1 | BUYER A | Choose InstaPay → upload proof of the exact total → submit. | **PAYMENT_UNDER_REVIEW**. | E-B4.1 |
| B4.2 | ADMIN | `/admin/payments` → confirm (step-up). | Deal **ACTIVE**. Each party now sees the other's address. | E-B4.2 |
| B4.3 | SELLER B | Enter shipping details + upload the waybill → **تسجيل الشحن**. | Deal shows «تم الشحن — بانتظار التسليم». The seller page has the «تأكيد تسليم الصفقة» input and **no** «buyer received» button. **No** «رمز تجريبي» box on the seller page. | E-B4.3 seller screenshot |
| B4.4 | BUYER A | Open the deal. | «رمز الاستلام» card with «رمز تجريبي — بيئة Staging» and a 6-digit code + expiry + attempts left. | E-B4.4 (OTP **issued**) |
| B4.5 | SELLER B | Enter a **wrong** code once. | «رمز الاستلام غير صحيح (متبقٍ 4 محاولة)». | E-B4.5 |
| B4.6 | BUYER A | Press **إرسال رمز جديد**. | A new code appears; the old one stops working. | E-B4.6 |
| B4.7 | SELLER B | Enter the **old** code. | Refused. Then enter the new code (read aloud by BUYER A — simulating the physical handover) → «تم التحقق من تسليم المنتج للمشتري.». Deal **DELIVERY_HANDOVER_VERIFIED**. | E-B4.7 (OTP **verified**) |
| B4.8 | ADMIN | `/admin/deals/<id>`: section «التسليم ورمز الاستلام». | Shows issued / regenerated / failed / verified with timestamps and attempt counts; **no code** displayed. «المستحق للبائع» = **—** (nothing payable yet). | **E-B4.8 no release after OTP** |

### B5. Buyer final confirmation

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| B5.1 | BUYER A | The deal shows the three choices: «استلمت والمنتج مطابق» / «استلمت ولكن توجد مشكلة» / «لم أستلم المنتج فعليًا». Press **استلمت والمنتج مطابق** → read the confirmation dialog (it explains the funds will be released) → OK. | Deal **COMPLETED** (passing through BUYER_CONFIRMED_RECEIPT). | E-B5.1 dialog + final screen |
| B5.2 | ADMIN | `/admin/deals/<id>` and `/admin/refunds?tab=deals`. | Exactly **one** seller payout, **PENDING**, amount = seller receives. The audit timeline shows `deal.receipt_confirmed`. | **E-B5.2 release exactly once** |
| B5.3 | BUYER A | Reload and try to confirm again. | No button; no second payout. | E-B5.3 |
| B5.4 | ADMIN (`finance@edmn.local`) | Record the payout transfer (TEST reference). | Payout **PAID**. | E-B5.4 |

## Part C — Protected deal, problem after a verified handover

| # | Actor | Action | Expected status | Evidence |
|---|---|---|---|---|
| C1 | BUYER A + SELLER B | Repeat B1–B4.7 quickly. The seller may accept directly without negotiation. | **DELIVERY_HANDOVER_VERIFIED**. | **E-C1 Deal ID** |
| C2 | BUYER A | **استلمت ولكن توجد مشكلة** → dispute form (reason «غير مطابق للوصف», description, optional photo) → submit. | Deal **DISPUTED**. | E-C2 |
| C3 | ADMIN | `/admin/deals/<id>` + `/admin/disputes`. | Dispute open. «المستحق للبائع» = **—** (funds held). Agreed terms, return policy, waybill and OTP evidence are all visible. | **E-C3 funds held** |
| C4 *(optional)* | BUYER A + SELLER B | On a third deal after a verified OTP, choose **لم أستلم المنتج فعليًا** and give a reason. | Deal **DISPUTED** + red banner «تعارض في التسليم (DELIVERY_CONFLICT)» on the admin deal page; no payout. | E-C4 |

## Part D — Cross-cutting checks

| # | Check | Expected | Evidence |
|---|---|---|---|
| D1 | SELLER B opens BUYER A's order URL or another seller's order / product URL (copy an id from the admin page). | Not-found view; no data. | E-D1 |
| D2 | BUYER A opens `/admin` or `/seller` (the latter without being a seller). | Admin login / not authorized; no admin links visible in the customer UI. | E-D2 |
| D3 | Phone at 360–430 px: home, search, PDP, cart, checkout, the deal page, `/seller/orders`, `/admin`. | No horizontal scrolling; buttons reachable. | E-D3 screenshots |
| D4 | ADMIN `/admin/ledger` at the end. | **Debits = credits**; compare with E-0.3. | **E-D4** |

## Evidence register (fill in during the test)

| Evidence | Value |
|---|---|
| Build commit | |
| Seller ID | |
| Product IDs (NEW / USED) | |
| Order number + payment ID | |
| Seller balance before / after receipt (pending, available) | |
| Withdrawal ID + final status | |
| Deal B ID (EDMN-…) + agreed version | |
| Deal B OTP: issued / regenerated / failed / verified timestamps | |
| Deal B payout ID + status | |
| Deal C ID + dispute number + payout = none | |
| Ledger: debits / credits / difference (start and end) | |
| Audit events seen (`seller.approve`, `payment.confirmed`, `deal.delivery_otp_*`, `deal.receipt_confirmed`, `withdrawal.*`) | |

**Pass criteria:**
- every step's expected result is observed;
- the ledger difference is 0;
- no seller money becomes available before the buyer's explicit confirmation;
- no cross-account data is visible.
