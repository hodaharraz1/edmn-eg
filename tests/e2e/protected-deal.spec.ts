import { expect, test, type Page } from '@playwright/test';
import { acceptDialogs, adminLogin, customerLogin, png, q } from './helpers';

/**
 * External Protected Deal — invitation-first flow:
 * buyer creates the request WITHOUT seller details (GPS location granted) → share screen with a secure
 * link → a NEW seller registers through the link and is bound to the deal → another account is refused
 * → seller verifies the phone, enters own details / pickup address (GPS denied → manual) / offer with
 * "no voluntary returns" → buyer requests a return-policy change → seller accepts → terms frozen →
 * buyer pays (manual proof) → admin verifies → addresses become visible → seller delivers → buyer
 * confirms "received and as described" → payout payable and paid by finance.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString().slice(-7);
const NEW_SELLER = { name: 'كريم البائع الخارجي', email: `ext-seller${RUN}@e2e.local`, phone: `0122${RUN}`, password: 'E2e@ExtSeller2026' };
let dealId = '';
let link = '';
const status = async () => (await q<{ status: string }>(`select status from external_deals where id = $1`, [dealId]))[0]?.status;
const next = (page: Page) => page.getByRole('button', { name: 'حفظ والتالي' }).click();

test('buyer creates a request without seller details, shares a secure link (GPS granted)', async ({ browser }) => {
  const page = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 30.0444, longitude: 31.2357, accuracy: 20 });
  await page.goto('/account/deals/new');
  await page.locator('input[name=title]').fill('موبايل سامسونج S22 مستعمل');
  await page.locator('textarea[name=description]').fill('الجهاز بحالة ممتازة مع العلبة والشاحن الأصلي، البطارية 90%.');
  await next(page);
  await page.waitForURL(/step=2/);
  dealId = new URL(page.url()).searchParams.get('deal')!;
  await page.locator('input[name=unitPrice]').fill('9500');
  await next(page);
  await page.waitForURL(/step=3/);
  await page.locator('input[name=deliveryMethod]').fill('شحن عبر شركة شحن');
  await page.locator('input[name=deliveryDeadline]').fill(new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10));
  await next(page);
  await page.waitForURL(/step=4/);
  await next(page);
  await page.waitForURL(/step=5/);
  await expect(page.getByTestId('seller-optional-note')).toContainText('مش لازم تكون عارف بيانات البائع كاملة');
  await page.getByRole('button', { name: 'استخدام موقعي الحالي' }).click();
  await expect(page.getByTestId('location-ok')).toBeVisible();
  await page.locator('select[name=loc_governorateId]').selectOption({ index: 1 });
  await page.locator('input[name=loc_city]').fill('مدينة نصر');
  await page.locator('input[name=loc_street]').fill('شارع عباس العقاد');
  await page.locator('input[name=loc_building]').fill('12');
  await next(page);
  await page.waitForURL(/step=6/);
  // Coordinates never travel in a URL.
  expect(page.url()).not.toContain('30.04');
  await page.locator('input[name=acceptTerms]').check();
  await page.getByRole('button', { name: 'إنشاء طلب الصفقة' }).click();
  await page.waitForURL(new RegExp(`/account/deals/${dealId}$`));
  await expect(page.getByText('تم إنشاء طلب الصفقة')).toBeVisible();
  await expect(page.getByTestId('deal-ref')).toHaveText(/^EDMN-\d{8}$/);
  link = await page.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/deal\/invite\/[A-Za-z0-9_-]{40,}$/);
  expect(page.url()).not.toContain(link.split('/').pop()!);
  const wa = await page.getByRole('link', { name: 'مشاركة عبر WhatsApp' }).getAttribute('href');
  expect(decodeURIComponent(wa!)).toContain('أنشأت طلب صفقة محمية على اضمن.');
  await expect(page.getByRole('button', { name: 'نسخ رابط الدعوة' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'مشاركة', exact: true })).toBeVisible();
  expect(await status()).toBe('INVITED');
  const [d] = await q<{ enc: string; seller_name: string | null; dest: number }>(`select buyer_location_enc enc, seller_name, destination_governorate_id dest from external_deals where id = $1`, [dealId]);
  expect(d.enc).not.toContain('30.04');
  expect(d.seller_name).toBeNull();
  expect(d.dest).toBeGreaterThan(0);
  const [inv] = await q<{ token_hash: string }>(`select token_hash from deal_invitations where deal_id = $1`, [dealId]);
  expect(inv.token_hash).not.toBe(link.split('/').pop());
});

test('a NEW seller opens the link (safe summary), registers and is bound to the deal', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByText('مشترٍ يريد شراء «موبايل سامسونج S22 مستعمل» منك')).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain('عباس العقاد');
  expect(html).not.toContain('30.04');
  expect(await status()).toBe('INVITED'); // opening does nothing
  await page.getByRole('link', { name: 'قبول ومتابعة (حساب جديد)' }).click();
  await page.waitForURL(/\/register/);
  await page.locator('input[name=fullName]').fill(NEW_SELLER.name);
  await page.locator('input[name=email]').fill(NEW_SELLER.email);
  await page.locator('input[name=phone]').fill(NEW_SELLER.phone);
  await page.locator('input[name=password]').fill(NEW_SELLER.password);
  await page.locator('input[name=terms]').check();
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await page.waitForURL(/\/deal\/invite\//);
  await page.getByRole('button', { name: 'قبول ومتابعة' }).click();
  await page.waitForURL(new RegExp(`/account/deals/${dealId}$`));
  await expect.poll(status).toBe('SELLER_JOINED');
  // The deal appears in the seller's account list.
  await page.goto('/account/deals');
  await expect(page.getByText('موبايل سامسونج S22 مستعمل').first()).toBeVisible();
  await ctx.close();
});

test('another account cannot use the bound link', async ({ browser }) => {
  const page = await customerLogin(browser, 'omar@demo.edmn.local');
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByText('هذه الدعوة مرتبطة بحساب آخر')).toBeVisible();
  await expect(page.getByRole('button', { name: 'قبول ومتابعة' })).toHaveCount(0);
  await page.goto(`/account/deals/${dealId}`);
  // Streaming pages render the not-found view (same as a non-existent id → no existence leak).
  await expect(page.getByRole('heading', { name: /غير موجود/ })).toBeVisible();
  await expect(page.getByText('موبايل سامسونج S22 مستعمل')).toHaveCount(0);
});

async function sellerPage(browser: Parameters<typeof customerLogin>[0]) {
  return customerLogin(browser, NEW_SELLER.email, NEW_SELLER.password);
}

test('seller verifies phone, location denied → manual address, offers with "no voluntary returns"', async ({ browser }) => {
  const page = await sellerPage(browser);
  // Simulate the user pressing "Block" on the browser's location prompt (headless Chromium leaves an
  // ungranted prompt pending instead of answering it).
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) =>
      err?.({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
  });
  await page.goto(`/account/deals/${dealId}`);
  await page.getByRole('button', { name: 'إرسال رمز' }).click();
  const tail = NEW_SELLER.phone.slice(-8);
  await expect.poll(async () => (await q(`select id from outbound_messages where recipient like $1`, [`%${tail}`])).length).toBeGreaterThan(0);
  const [{ body }] = await q<{ body: string }>(`select body from outbound_messages where recipient like $1 order by created_at desc limit 1`, [`%${tail}`]);
  await page.locator('input[name=code]').fill(body.match(/\d{6}/)![0]);
  await page.getByRole('button', { name: 'تأكيد' }).click();
  await expect.poll(async () => (await q<{ v: Date | null }>(`select phone_verified_at v from users where email = $1`, [NEW_SELLER.email]))[0].v).not.toBeNull();
  await page.reload();

  const form = page.getByTestId('seller-offer-form');
  await form.getByRole('button', { name: 'استخدام موقعي الحالي' }).click(); // permission not granted
  await expect(form.getByTestId('location-error')).toContainText('لم يتم السماح بالوصول للموقع');
  await form.locator('select[name=loc_governorateId]').selectOption({ index: 2 });
  await form.locator('input[name=loc_city]').fill('الهرم');
  await form.locator('input[name=loc_street]').fill('شارع فيصل الرئيسي');
  await form.locator('input[name=shippingFee]').fill('75');
  await form.locator('input[name=processingDays]').fill('2');
  await form.locator('textarea[name=defects]').fill('خدش بسيط في الإطار');
  await form.locator('input[name=accessories]').fill('العلبة والشاحن');
  await form.locator('input[name=rp_type][value=NONE]').check();
  await expect(form.getByText('البائع لا يقدم استرجاعًا اختياريًا لهذا المنتج.')).toBeVisible();
  await form.locator('select[name=payoutType]').selectOption('INSTAPAY');
  await form.locator('input[name=instapayAddress]').fill('karim.e2e@instapay');
  await form.locator('input[name=acceptTerms]').check();
  await form.getByRole('button', { name: 'إرسال العرض للمشتري' }).click();
  await expect.poll(status).toBe('OFFER_PENDING_BUYER');
  const [d] = await q<{ enc: string; m: string; phone: string }>(`select seller_location_enc enc, seller_payout_masked m, seller_verified_phone phone from external_deals where id = $1`, [dealId]);
  expect(d.enc).not.toContain('فيصل');
  expect(d.m).not.toBe('karim.e2e@instapay');
  expect(d.phone).toContain(NEW_SELLER.phone.slice(-8));
});

test('buyer reviews the offer (policy visible) and requests a return-policy change; seller accepts it', async ({ browser }) => {
  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await buyer.goto(`/account/deals/${dealId}`);
  const review = buyer.getByTestId('offer-review');
  for (const label of ['السعر', 'تكلفة الشحن', 'طريقة الشحن', 'مدة التجهيز', 'موعد التسليم المتوقع', 'حالة المنتج', 'سياسة الاسترجاع', 'الشروط الخاصة']) await expect(review.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(review.getByText('البائع لا يقدم استرجاعًا اختياريًا لهذا المنتج.').first()).toBeVisible();
  await expect(review.getByText('مع عدم الإخلال بأي حقوق إلزامية للمستهلك تنطبق وفق القانون.').first()).toBeVisible();
  await expect(review.getByRole('button', { name: 'موافق على العرض' })).toBeVisible();
  await expect(review.getByRole('button', { name: 'رفض', exact: true })).toBeVisible();
  // The seller's address is not visible before payment.
  await expect(buyer.getByText('شارع فيصل الرئيسي')).toHaveCount(0);
  await review.getByText('طلب تعديل', { exact: true }).click();
  await review.locator('input[name=rp_type][value=VOLUNTARY]').check();
  await review.locator('input[name=rp_windowDays]').fill('3');
  await review.locator('textarea[name=message]').fill('أريد إمكانية الاسترجاع خلال 3 أيام');
  await review.getByRole('button', { name: 'إرسال طلب التعديل' }).click();
  await expect.poll(status).toBe('CHANGE_REQUESTED');

  const seller = await sellerPage(browser);
  await seller.goto(`/account/deals/${dealId}`);
  await expect(seller.getByTestId('change-request')).toContainText('يسمح بالاسترجاع الاختياري خلال 3 يوم');
  await seller.getByRole('button', { name: 'قبول التعديل' }).click();
  await expect.poll(status).toBe('PAYMENT_PENDING');
  const [d] = await q<{ t: { returnPolicy: { type: string; windowDays: number }; price: { shippingFee: number } }; v: number }>(`select agreed_terms t, agreed_version v from external_deals where id = $1`, [dealId]);
  expect(d.t.returnPolicy).toMatchObject({ type: 'VOLUNTARY', windowDays: 3 });
  expect(Number(d.t.price.shippingFee)).toBe(7500);
  expect(d.v).toBe(2);
});

test('buyer pays and admin verifies; addresses become visible to the parties', async ({ browser }) => {
  const page = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await page.goto(`/account/deals/${dealId}`);
  await expect(page.getByTestId('agreed-terms')).toContainText('يسمح بالاسترجاع الاختياري خلال 3 يوم');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect.poll(async () => (await q(`select id from payments where deal_id = $1`, [dealId])).length).toBe(1);
  await page.reload();
  await page.locator('input[name=reference]').fill('VC-E2E-5555');
  await page.locator('input[name=proof]').setInputFiles({ name: 'vc.png', mimeType: 'image/png', buffer: await png() });
  await page.getByRole('button', { name: 'رفع إثبات الدفع' }).click();
  await expect.poll(status).toBe('PAYMENT_UNDER_REVIEW');
  const [p] = await q<{ id: string }>(`select id from payments where deal_id = $1`, [dealId]);
  const admin = await adminLogin(browser, 'payments@edmn.local');
  acceptDialogs(admin);
  await admin.goto(`/admin/payments/${p.id}`);
  await admin.getByRole('button', { name: /تأكيد الدفع/ }).click();
  await expect.poll(status).toBe('ACTIVE');
  await page.reload();
  await expect(page.getByTestId('deal-locations')).toContainText('شارع فيصل الرئيسي');
});

test('seller delivers, buyer confirms "received and as described", payout becomes payable and is paid', async ({ browser }) => {
  const seller = await sellerPage(browser);
  await seller.goto(`/account/deals/${dealId}`);
  await expect(seller.getByTestId('deal-locations')).toContainText('شارع عباس العقاد');
  await seller.locator('textarea[name=note]').fill('تم الشحن عبر شركة الشحن، بوليصة 12345.');
  await seller.getByRole('button', { name: 'تسجيل التسليم' }).click();
  await expect.poll(status).toBe('DELIVERED');
  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await buyer.goto(`/account/deals/${dealId}`);
  const choice = buyer.getByTestId('delivery-choice');
  await expect(choice.getByRole('link', { name: /استلمت ولكن توجد مشكلة/ })).toBeVisible();
  await expect(choice.getByRole('link', { name: 'لم أستلم' })).toBeVisible();
  await choice.getByRole('button', { name: 'استلمت والمنتج مطابق' }).click();
  await expect.poll(status).toBe('COMPLETED');
  const [po] = await q<{ id: string; amount: string; status: string }>(`select id, amount, status from deal_payouts where deal_id = $1`, [dealId]);
  const [d] = await q<{ r: string }>(`select seller_receives r from external_deals where id = $1`, [dealId]);
  expect(po.status).toBe('PENDING');
  expect(po.amount).toBe(d.r);
  const admin = await adminLogin(browser, 'finance@edmn.local');
  await admin.goto('/admin/refunds?tab=deals');
  const card = admin.locator('li', { hasText: `صفقة #` }).filter({ has: admin.locator(`input[name=id][value="${po.id}"]`) });
  await card.locator('input[name=reference]').fill('PAYOUT-E2E-1');
  await card.getByRole('button', { name: 'تسجيل الصرف' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from deal_payouts where id = $1`, [po.id]))[0].status).toBe('PAID');
});
