# Real Seller Pilot — Manual Test Plan

This is the step-by-step script for the EDMN owner to test the complete workflow with **one real
seller** on staging.

> **Money safety.** Real money is **DISABLED** on staging and cannot be enabled there.
> - Every payment destination is shown as **TEST PAYMENT DESTINATION — NOT FOR REAL MONEY**.
> - Every withdrawal is shown as **TEST PAYOUT**.
> - Nobody transfers real money at any step. For the payment proof, upload any image.

## 0. Before you start

| Item | Value |
|---|---|
| Customer marketplace | https://edmn-staging.vercel.app/ |
| Seller Center | https://edmn-staging.vercel.app/seller/login |
| Admin Control Center | https://edmn-staging.vercel.app/admin/login (Super Admin + 2FA) |
| Test buyer | a demo customer (e.g. `ahmed@demo.edmn.local`) or a new account you register |

Notes:

- **SMS and e-mail are not delivered on staging.** No provider is configured yet. Verification
  codes, and every other message, appear in **Admin → العمليات → الإشعارات** (outbox). Read the
  code there and give it to the seller.
- The seller's documents are real personal data. They are stored privately (see §8).
- For the test product, use a price ≥ **150 EGP**. The minimum withdrawal is 100 EGP, and the
  seller's net is price − commission.

---

## 1. SELLER — registration

1. Open **/seller/login** and click **«سجّل كبائع جديد (فرد أو شركة)»**. This opens
   `/seller/register`.
2. Choose **فرد** (Individual) or **شركة / نشاط تجاري** (Business).
3. Fill in full name, e-mail, mobile and password, accept the terms, then click
   **«إنشاء حساب بائع»**.

**Expected:** you land on **/seller/onboarding** (step 1). The seller application status is
**DRAFT** (مسودة).

## 2. SELLER — contact verification

1. On the onboarding page, in **«تأكيد بيانات التواصل»**, click **«إرسال رمز»** next to the mobile
   number.
2. **ADMIN:** open **الإشعارات** and copy the 6-digit code sent to that number.
3. **SELLER:** enter the code and click **«تأكيد»**.

**Expected:** the mobile shows **مؤكد**. E-mail verification is optional unless an admin enables it
in settings.

## 3. SELLER — onboarding (6 steps)

| Step | Enter |
|---|---|
| 1. الهوية والعنوان | Legal name, national ID (14 digits), mobile (the verified number), address, governorate |
| 2. بيانات النشاط | Business sellers only: company name, commercial registration, tax number |
| 3. المتجر | Store name and description; **return address and governorate**; logo (optional) |
| 4. الوثائق | National ID front and back. Business sellers also upload commercial registration and tax card |
| 5. استلام الأرباح | Payout method (bank / InstaPay / wallet) with the seller's own details |
| 6. المراجعة والإرسال | Accept the **Seller Agreement**, then click **«إرسال الطلب للمراجعة»** |

**Expected:**

- Status changes to **PENDING_REVIEW** (قيد المراجعة).
- The seller can open the Seller Center but **cannot** create products yet.
- The national ID is stored encrypted; only its last 4 digits are shown.
- Payout details are stored encrypted; only a masked label is shown.

## 4. ADMIN — review and approve the seller

1. Log in at **/admin/login** with the password, then the **2FA code** from the authenticator app.
2. Open **مركز الموافقات** (Approval Center) → **طلبات البائعين** (or **السوق → التحقق من البائعين**).
3. Open the application. Review the identity data, documents and payout method. Opening a document
   is audited.
4. Choose **موافقة** (approve), then click **«تسجيل القرار»**. To test the other paths, choose
   **طلب معلومات** or **رفض**; these need a written reason.

**Expected:**

- Status changes to **APPROVED** (معتمد). The payout method becomes **ACTIVE**.
- The seller receives a notification, visible in the outbox.
- With MORE_INFO_REQUIRED, the seller sees the reason on the onboarding page and can resubmit.

## 5. SELLER — shipping and first product

1. **/seller/shipping**: enable the governorates the seller ships to, and set a fee and delivery
   days for each. Click **«حفظ أسعار الشحن»**.
2. **/seller/products/new**:
   1. Choose a category, then **«متابعة»**.
   2. Basic data: title, brand, description, key features. Set the condition to **NEW** or
      **USED**. For USED, also enter grade, condition description, defects, accessories, warranty
      and usage, then **«حفظ والتالي»**.
   3. Images: upload **real product photos** (JPG/PNG/WEBP, max 4 MB each on staging). For USED
      items, mark the actual-item photos (at least 2). Click **«رفع الصور»**.
   4. Variants / price / quantity: enter price and stock, then **«حفظ والتالي»**.
   5. Submit: click **«إرسال للمراجعة»**.

**Expected:**

- Product status is **SUBMITTED**.
- The product is **not visible** to the public: its URL shows no add-to-cart button.

## 6. ADMIN — approve the product

1. Open **مركز الموافقات → منتجات** (or **السوق → مراجعة المنتجات**) and open the product.
2. Choose approve and click **«تسجيل القرار»**.

**Expected:**

- Status is **LIVE**.
- The product appears in search, its category, and the seller's public store.
- USED items show the **«منتج مستعمل USED»** banner and the condition disclosure.

## 7. BUYER — purchase

1. As the buyer, find the product, then click **«إضافة إلى السلة»** (or **«اشترِ الآن»**).
2. **/checkout**: choose an address in a governorate the seller ships to, choose a payment method,
   and click **«تأكيد الطلب»**.
3. On the payment page you see **TEST PAYMENT DESTINATION — NOT FOR REAL MONEY**. **Do not transfer
   money.** Upload any image as proof, enter the amount, and click **«رفع إثبات الدفع»**.

**Expected:**

- The order is created and stock is reserved.
- Payment status is **PAYMENT_SUBMITTED**.
- The order is **not** paid yet. Uploading proof never marks an order paid.

## 8. ADMIN — verify the test payment

1. Open **المالية → التحقق من المدفوعات اليدوية** and open the payment. It is marked
   **دفعة تجريبية (TEST)**.
2. Click **«تأكيد الدفع»**.

**Expected:**

- Payment is **CONFIRMED**. The seller order is **PAID**.
- The ledger posts the payment and the commission snapshot.
- The seller's amount is **PENDING** (معلّق), not available.

## 9. SELLER — process and ship

1. **/seller/orders** → open the order.
2. Click **«تأكيد الطلب»** (→ **SELLER_CONFIRMED**), then **«بدء التجهيز»** (→ **PROCESSING**).
3. Enter the carrier and tracking number, **upload the waybill** (PDF or image), save, and mark
   shipped.

**Expected:**

- Marking shipped without a waybill is refused.
- With the waybill uploaded, status is **SHIPPED**.
- **The seller balance is still PENDING.** A waybill is not proof of delivery.
- The waybill is private: only the buyer, this seller and authorized staff can open it.

## 10. BUYER — confirm receipt

1. As the buyer, open **طلباتي** → the order, then click **«تأكيد استلام الطلب»**.

**Expected:**

- Seller order is **DELIVERED**.
- The seller's net (price − commission) moves from **PENDING** to **AVAILABLE**, **exactly once**.
  Repeating the confirmation does not credit again.
- If an admin placed a **financial hold** or a dispute is open, the money is not released.

## 11. SELLER — balance and test withdrawal

1. **/seller/balance**: check that **المتاح** equals the order's seller net.
2. **/seller/withdrawals**: the page shows **TEST PAYOUT — NO REAL MONEY IS TRANSFERRED**. Enter
   an amount ≥ 100 EGP and click **«تقديم طلب السحب»**.

**Expected:**

- Withdrawal status is **REQUESTED** and it carries a **TEST** badge.
- The amount moves from **available** to **reserved**.
- A second request cannot overspend the balance.

## 12. ADMIN — process the test withdrawal

1. **المالية → السحوبات** → open the request. It shows **TEST PAYOUT**.
2. Click **«اعتماد للصرف»** (→ **APPROVED**).
3. Click **«تأكيد الصرف»** with reference `TEST` (→ **PAID**). No money is sent.
   - For amounts at or above the dual-control threshold (default 50,000 EGP), the payer must be a
     different staff member from the approver.

**Expected:**

- Withdrawal is **PAID (TEST)**. Seller **reserved** drops to 0.
- The ledger posts the payout entry.
- **Admin → المالية → دفتر القيود**: **DEBITS = CREDITS** (difference 0).

## 13. Extra checks (optional)

| Check | Expected |
|---|---|
| Seller B opens Seller A's order or document URLs | Not found |
| Buyer opens `/api/files/<seller document id>` | Not found |
| A logged-out visitor opens the payment proof | Not found |
| Return: buyer requests a return within the window; seller/admin approve | A refund is created for the admin queue |
| External protected deal: buyer creates a deal at `/protected-deal` and invites the seller by link | Seller accepts; test payment; delivery; confirmation; payout appears in **المستردات والمستحقات** |
| Risk flags: request a withdrawal within 72 h of changing the payout method | Appears in **المخاطر والأمان → مؤشرات المخاطر** |

## Status reference

| Object | Path |
|---|---|
| Seller | DRAFT → PENDING_REVIEW → (MORE_INFO_REQUIRED ↔) APPROVED / REJECTED |
| Product | DRAFT → SUBMITTED → LIVE (or REJECTED) |
| Payment | AWAITING_PAYMENT → PAYMENT_SUBMITTED → CONFIRMED (or REJECTED / EXPIRED) |
| Seller order | PAID → SELLER_CONFIRMED → PROCESSING → SHIPPED → DELIVERED → COMPLETED |
| Seller money | PENDING (paid) → AVAILABLE (buyer confirmed) → RESERVED (withdrawal requested) → paid out |
| Withdrawal | REQUESTED → APPROVED → PAID (TEST) |
