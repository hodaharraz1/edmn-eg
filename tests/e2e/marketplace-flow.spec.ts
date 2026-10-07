import { expect, test } from '@playwright/test';
import { acceptDialogs, adminLogin, customerLogin, PDF, png, q } from './helpers';

/**
 * Competition critical flow 1, entirely through the UI and real domain logic:
 * seller registers → verifies mobile → submits identity/store/documents/payout → admin approves →
 * seller sets governorate shipping and adds a product → admin approves it → it is live →
 * buyer finds it, adds to cart, checks out, uploads manual payment proof → admin confirms →
 * seller confirms, uploads the mandatory waybill and ships → buyer confirms receipt (entitlement only,
 * no money moves) → a finance checker explicitly approves the seller release → seller balance becomes
 * available → seller requests a withdrawal (reserves nothing) → admin approves (reserves) and pays it.
 * Every state change is asserted against the database.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString().slice(-7);
const SELLER = { email: `seller${RUN}@e2e.local`, phone: `0101${RUN}`, password: 'E2e@Seller2026', name: 'محمد البائع' };
const STORE = `متجر الاختبار ${RUN}`;
const PRODUCT = `طقم سكاكين مطبخ ستانلس ${RUN}`;
let sellerId = '';
let productId = '';
let orderId = '';
let soId = '';

const sellerStatus = async () => (await q<{ status: string }>(`select status from sellers where id = $1`, [sellerId]))[0]?.status;
const soStatus = async () => (await q<{ status: string }>(`select status from seller_orders where id = $1`, [soId]))[0]?.status;

test('a new seller registers, verifies the mobile number and submits the application', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const page = await ctx.newPage();
  // Self-service sign-up through the dedicated Seller Center entry (no admin-created accounts).
  await page.goto('/seller/register');
  await expect(page.getByText('EDMN Seller Center').first()).toBeVisible();
  await page.locator('input[name=type][value=INDIVIDUAL]').check();
  await page.locator('input[name=fullName]').fill(SELLER.name);
  await page.locator('input[name=email]').fill(SELLER.email);
  await page.locator('input[name=phone]').fill(SELLER.phone);
  await page.locator('input[name=password]').fill(SELLER.password);
  await page.locator('input[name=terms]').check();
  await page.getByRole('button', { name: 'إنشاء حساب بائع' }).click();
  await page.waitForURL(/\/seller\/onboarding/);
  sellerId = (await q<{ id: string }>(`select s.id from sellers s join users u on u.id = s.owner_user_id where u.email = $1`, [SELLER.email]))[0].id;

  // Mobile verification (the development SMS driver records outbound messages).
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'ابعت الرمز' }).first().click();
  await expect.poll(async () => (await q(`select id from outbound_messages where recipient like $1`, [`%${SELLER.phone.slice(-8)}`])).length).toBeGreaterThan(0);
  const [{ body }] = await q<{ body: string }>(`select body from outbound_messages where recipient like $1 order by created_at desc limit 1`, [`%${SELLER.phone.slice(-8)}`]);
  await page.locator('input[name=code]').first().fill(body.match(/\d{6}/)![0]);
  await page.getByRole('button', { name: 'تأكيد' }).first().click();
  await expect.poll(async () => (await q<{ v: Date | null }>(`select phone_verified_at v from users where email = $1`, [SELLER.email]))[0].v).not.toBeNull();

  await page.goto('/seller/onboarding?step=1');

  // Step 1 — identity
  await page.locator('input[name=legalName]').fill('محمد أحمد البائع');
  await page.locator('input[name=nationalId]').fill(`2900101${RUN}`);
  await page.locator('input[name=addressLine]').fill('شارع عباس العقاد، مدينة نصر');
  await page.locator('input[name=city]').fill('القاهرة');
  await page.locator('select[name=governorateId]').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=3/);
  // Step 3 — store
  await page.locator('input[name=name]').fill(STORE);
  await page.locator('textarea[name=description]').fill('أدوات مطبخ أصلية بأسعار مناسبة.');
  await page.locator('input[name=returnAddress]').fill('شارع عباس العقاد، مدينة نصر، القاهرة');
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=4/);
  // Step 4 — private identity documents
  await page.locator('input[name=NATIONAL_ID_FRONT]').setInputFiles({ name: 'id-front.png', mimeType: 'image/png', buffer: await png() });
  await page.locator('input[name=NATIONAL_ID_BACK]').setInputFiles({ name: 'id-back.png', mimeType: 'image/png', buffer: await png() });
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=5/);
  // Step 5 — payout method
  await page.locator('select[name=payoutType]').selectOption('INSTAPAY');
  await page.locator('input[name=instapayAddress]').fill(`seller${RUN}@instapay`);
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=6/);
  // Step 6 — agreement & submit
  await page.locator('input[name=acceptAgreement]').check();
  await page.getByRole('button', { name: 'إرسال الطلب للمراجعة' }).click();
  await expect.poll(sellerStatus).toBe('PENDING_REVIEW');
  const docs = await q<{ v: string }>(`select f.visibility v from seller_documents d join files f on f.id = d.file_id where d.seller_id = $1`, [sellerId]);
  expect(docs.length).toBe(2);
  expect(docs.every((d) => d.v === 'PRIVATE')).toBe(true);
  await ctx.close();
});

test('seller cannot list products before approval; admin approves the seller (and the submitted payout method)', async ({ browser }) => {
  const seller = await customerLogin(browser, SELLER.email, SELLER.password);
  await seller.goto('/seller/products/new');
  await expect(seller.locator('select[name=categoryId]')).toHaveCount(0);

  const admin = await adminLogin(browser, 'catalog@edmn.local');
  await admin.goto(`/admin/sellers/${sellerId}`);
  await admin.locator('select[name=decision]').selectOption('APPROVE');
  await admin.getByRole('button', { name: 'تسجيل القرار' }).click();
  await expect.poll(sellerStatus).toBe('APPROVED');
  // The payout method submitted with the application is verified as part of the approval.
  await expect.poll(async () => (await q<{ status: string }>(`select status from seller_payout_methods where seller_id = $1 and status <> 'ARCHIVED'`, [sellerId]))[0]?.status).toBe('ACTIVE');
});

test('approved seller configures shipping, creates a product and submits it for review', async ({ browser }) => {
  const page = await customerLogin(browser, SELLER.email, SELLER.password);
  // Governorate-based shipping fees (enable all governorates at 60 EGP).
  await page.goto('/seller/shipping');
  for (const cb of await page.locator('input[type=checkbox][name^=en_]').all()) await cb.check();
  for (const fee of await page.locator('input[name^=fee_]').all()) await fee.fill('60');
  await page.getByRole('button', { name: 'حفظ أسعار الشحن' }).click();
  await expect.poll(async () => (await q(`select governorate_id from seller_shipping_rates where seller_id = $1 and enabled`, [sellerId])).length).toBeGreaterThan(20);

  await page.goto('/seller/products/new');
  const [cat] = await q<{ id: string }>(`select id from categories where slug = 'kitchen'`);
  await page.locator('select[name=categoryId]').selectOption(cat.id);
  await page.locator('input[name=titleAr]').fill(PRODUCT);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.waitForURL(/step=details/);
  productId = page.url().split('/seller/products/')[1].split('?')[0];
  await page.locator('textarea[name=description]').fill('طقم سكاكين من الستانلس ستيل المقاوم للصدأ، 6 قطع مع حامل خشبي، مناسب للاستخدام اليومي.');
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=images/);
  await page.locator('input[name=images]').setInputFiles([{ name: 'p1.png', mimeType: 'image/png', buffer: await png() }]);
  await page.getByRole('button', { name: 'رفع الصور' }).click();
  await expect.poll(async () => (await q(`select id from product_images where product_id = $1`, [productId])).length).toBe(1);
  await page.goto(`/seller/products/${productId}?step=variants`);
  await page.locator('input[name=sku_new1]').fill(`KNIFE-${RUN}`);
  await page.locator('input[name=price_new1]').fill('1000');
  await page.locator('input[name=stock_new1]').fill('5');
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=logistics/);
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=review/);
  await page.getByRole('button', { name: 'إرسال للمراجعة' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from products where id = $1`, [productId]))[0].status).toBe('SUBMITTED');
  // Not visible to customers before approval.
  const [{ slug }] = await q<{ slug: string }>(`select slug from products where id = $1`, [productId]);
  const html = await (await page.request.get(`/search?q=${encodeURIComponent(PRODUCT)}`)).text();
  expect(html).not.toContain(`/product/${encodeURIComponent(slug)}`);
  await page.goto(`/product/${encodeURIComponent(slug)}`);
  await expect(page.getByRole('heading', { name: /مش موجود/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /ضيف للسلة/ })).toHaveCount(0);
});

test('admin approves the product and it becomes live and searchable', async ({ browser }) => {
  const admin = await adminLogin(browser, 'catalog@edmn.local');
  await admin.goto(`/admin/products/${productId}`);
  await admin.locator('select[name=decision]').selectOption('APPROVE');
  await admin.getByRole('button', { name: 'تسجيل القرار' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from products where id = $1`, [productId]))[0].status).toBe('LIVE');
});

test('buyer finds the product, checks out and submits payment proof', async ({ browser }) => {
  const page = await customerLogin(browser, 'mona@demo.edmn.local');
  await page.goto(`/search?q=${encodeURIComponent(PRODUCT)}`);
  await page.locator('a[href^="/product/"]', { hasText: PRODUCT }).first().click();
  await page.waitForURL(/\/product\//);
  await expect(page.getByText(STORE).first()).toBeVisible();
  await page.getByRole('button', { name: /ضيف للسلة/ }).first().click();
  await expect.poll(async () => (await q(`select ci.id from cart_items ci join carts c on c.id = ci.cart_id join users u on u.id = c.user_id where u.email = 'mona@demo.edmn.local'`)).length).toBeGreaterThan(0);
  await page.goto('/checkout');
  // Fee transparency before commitment: the buyer's service/protection fee (1,000 EGP standard item → 3.5% = 35 EGP).
  await expect(page.getByTestId('checkout-buyer-fee')).toContainText('35');
  await expect(page.getByText('رسوم خدمة وحماية اضمن').first()).toBeVisible();
  expect(await page.content()).not.toContain('حصة البائع');
  await page.locator('input[name=paymentMethod][value=INSTAPAY]').check();
  await page.getByRole('button', { name: /أكّد الطلب/ }).click();
  await page.waitForURL(/\/account\/orders\/[^/]+\/pay/);
  orderId = page.url().split('/orders/')[1].split('/')[0];
  await page.locator('input[name=payerName]').fill('منى خالد');
  await page.locator('input[name=reference]').fill(`IPN-E2E-${RUN}`);
  await page.locator('input[name=proof]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: await png() });
  await page.getByRole('button', { name: 'رفع إثبات الدفع' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from payments where order_id = $1`, [orderId]))[0]?.status).toBe('PAYMENT_SUBMITTED');
  // Uploading proof never marks the order paid.
  expect((await q<{ status: string }>(`select status from orders where id = $1`, [orderId]))[0].status).not.toBe('PAID');
  const [so] = await q<{ id: string; seller_id: string }>(`select id, seller_id from seller_orders where order_id = $1`, [orderId]);
  expect(so.seller_id).toBe(sellerId);
  soId = so.id;
  // Invoice keeps the buyer fee actually charged; the seller's private fee is never shown to the buyer.
  await page.goto(`/account/orders/${orderId}`);
  await expect(page.getByTestId('invoice-buyer-fee')).toContainText('35');
  expect(await page.content()).not.toContain('حصة البائع');
});

test('admin verifies the payment', async ({ browser }) => {
  const [p] = await q<{ id: string }>(`select id from payments where order_id = $1`, [orderId]);
  const page = await adminLogin(browser, 'payments@edmn.local');
  acceptDialogs(page);
  await page.goto(`/admin/payments/${p.id}`);
  await page.getByRole('button', { name: /تأكيد دفع/ }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from payments where id = $1`, [p.id]))[0].status).toBe('CONFIRMED');
  expect(await soStatus()).toBe('PAID');
});

test('seller confirms, processes and ships with a mandatory waybill', async ({ browser }) => {
  const page = await customerLogin(browser, SELLER.email, SELLER.password);
  await page.goto(`/seller/orders/${soId}`);
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect.poll(soStatus).toBe('SELLER_CONFIRMED');
  await page.reload();
  await page.getByRole('button', { name: 'بدء التجهيز' }).click();
  await expect.poll(soStatus).toBe('PROCESSING');
  await page.reload();
  // Marking shipped without a waybill is refused.
  await page.locator('input[name=carrierName]').fill('بوسطة');
  await page.locator('input[name=trackingNumber]').fill(`BOSTA-${RUN}`);
  await page.locator('input[name=markShipped]').check();
  await page.getByRole('button', { name: 'حفظ' }).first().click();
  await expect(page.getByText(/بوليصة/).first()).toBeVisible();
  expect(await soStatus()).not.toBe('SHIPPED');
  await page.locator('input[name=waybill]').setInputFiles({ name: 'waybill.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.locator('input[name=markShipped]').check();
  await page.getByRole('button', { name: 'حفظ' }).first().click();
  await expect.poll(soStatus).toBe('SHIPPED');
  // Seller economics: sale value − EDMN service fee (8.5% = 85 EGP) = net proceeds (+ shipping separately).
  await page.goto(`/seller/orders/${soId}`);
  await expect(page.getByTestId('seller-fee')).toContainText('85');
  const docs = await q(`select d.id from shipment_documents d join shipments s on s.id = d.shipment_id where s.seller_order_id = $1`, [soId]);
  expect(docs.length).toBe(1);
  // Shipping alone does not make the seller's money available.
  expect(Number((await q<{ b: string }>(`select balance b from ledger_accounts where seller_id = $1 and code = 'SELLER_AVAILABLE'`, [sellerId]))[0]?.b ?? 0)).toBe(0);
});

test('buyer confirms receipt: entitlement only — nothing becomes available without an Admin release', async ({ browser }) => {
  const page = await customerLogin(browser, 'mona@demo.edmn.local');
  await page.goto(`/account/orders/${orderId}`);
  await page.getByRole('button', { name: 'أكّد الاستلام' }).click();
  await expect.poll(soStatus).toBe('DELIVERED');
  const [{ basis }] = await q<{ basis: string }>(`select receipt_basis basis from seller_orders where id = $1`, [soId]);
  expect(basis).toBe('BUYER_CONFIRMED');
  expect(Number((await q<{ b: string }>(`select balance b from ledger_accounts where seller_id = $1 and code = 'SELLER_AVAILABLE'`, [sellerId]))[0]?.b ?? 0)).toBe(0);
  expect((await q(`select id from journal_entries where entry_type = 'SELLER_RELEASE' and source_id = $1`, [soId])).length).toBe(0);
});

test('finance checker explicitly approves the seller release → available, order COMPLETED', async ({ browser }) => {
  const checker = await adminLogin(browser, 'checker@edmn.local');
  await checker.goto(`/admin/releases/${soId}`);
  await checker.locator('input[name=reason]').fill('استلام مؤكد من المشتري ولا توجد موانع');
  await checker.getByRole('button', { name: /اعتماد إتاحة/ }).click();
  const [{ net }] = await q<{ net: string }>(`select seller_net as net from seller_orders where id = $1`, [soId]);
  await expect.poll(async () => Number((await q<{ b: string }>(`select balance b from ledger_accounts where seller_id = $1 and code = 'SELLER_AVAILABLE'`, [sellerId]))[0]?.b ?? 0)).toBe(Number(net));
  await expect.poll(soStatus).toBe('COMPLETED');
  const [{ approval }] = await q<{ approval: string | null }>(`select release_approval_id approval from seller_orders where id = $1`, [soId]);
  expect(approval).toBeTruthy();
  expect((await q(`select id from journal_entries where entry_type = 'SELLER_RELEASE' and source_id = $1 and approval_id = $2`, [soId, approval])).length).toBe(1);
  const [{ c }] = await q<{ c: string }>(`select commission_total c from seller_orders where id = $1`, [soId]);
  expect(Number(c)).toBeGreaterThan(0);
});

test('seller requests a withdrawal; admin approves and records the transfer', async ({ browser }) => {
  const seller = await customerLogin(browser, SELLER.email, SELLER.password);
  await seller.goto('/seller/withdrawals');
  // Transfer cost shown BEFORE requesting (InstaPay 0.1% of 500 = 0.50 EGP), separate from EDMN fees.
  await seller.locator('input[name=preview]').fill('500');
  await seller.getByRole('button', { name: 'احسب رسوم التحويل' }).click();
  await expect(seller.getByTestId('transfer-cost')).toContainText('0.5');
  await expect(seller.getByTestId('transfer-net')).toContainText('499.5');
  await seller.getByRole('button', { name: /تأكيد طلب سحب/ }).click();
  await expect.poll(async () => (await q(`select id from withdrawal_requests where seller_id = $1 and amount = 50000 and status = 'REQUESTED'`, [sellerId])).length).toBe(1);
  const [w] = await q<{ id: string }>(`select id from withdrawal_requests where seller_id = $1`, [sellerId]);
  // A request moves no money and reserves nothing; the Admin approval reserves.
  expect(Number((await q<{ b: string }>(`select balance b from ledger_accounts where seller_id = $1 and code = 'SELLER_WITHDRAWAL_RESERVED'`, [sellerId]))[0]?.b ?? 0)).toBe(0);
  expect((await q(`select id from journal_entries where source_id = $1`, [w.id])).length).toBe(0);

  const checker = await adminLogin(browser, 'checker@edmn.local');
  await checker.goto(`/admin/withdrawals/${w.id}`);
  await expect(checker.getByRole('button', { name: 'تأكيد الصرف' })).toHaveCount(0); // checker cannot pay
  await checker.getByRole('button', { name: /اعتماد وحجز/ }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from withdrawal_requests where id = $1`, [w.id]))[0].status).toBe('APPROVED');
  expect(Number((await q<{ b: string }>(`select balance b from ledger_accounts where seller_id = $1 and code = 'SELLER_WITHDRAWAL_RESERVED'`, [sellerId]))[0].b)).toBe(50000);

  const operator = await adminLogin(browser, 'finance@edmn.local');
  await operator.goto(`/admin/withdrawals/${w.id}`);
  await operator.locator('input[name=reference]').fill(`TRX-E2E-${RUN}`);
  await operator.getByRole('button', { name: 'تأكيد الصرف' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from withdrawal_requests where id = $1`, [w.id]))[0].status).toBe('PAID');
  expect((await q(`select id from journal_entries where idempotency_key = $1`, [`wd-paid:${w.id}`])).length).toBe(1);
  expect(Number((await q<{ b: string }>(`select balance b from ledger_accounts where seller_id = $1 and code = 'SELLER_WITHDRAWAL_RESERVED'`, [sellerId]))[0].b)).toBe(0);
});

test('ledger stays balanced and every account projection matches its journal lines', async () => {
  const [t] = await q<{ dr: string; cr: string }>(`select coalesce(sum(debit),0) dr, coalesce(sum(credit),0) cr from journal_lines`);
  expect(t.dr).toBe(t.cr);
  const drift = await q(`select a.id from ledger_accounts a left join journal_lines l on l.account_id = a.id group by a.id, a.type, a.balance
    having a.balance <> coalesce(sum(case when a.type in ('ASSET','EXPENSE') then l.debit - l.credit else l.credit - l.debit end), 0)`);
  expect(drift.length).toBe(0);
});
