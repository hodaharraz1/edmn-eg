import { expect, test, type Page } from '@playwright/test';
import { acceptDialogs, adminLogin, customerLogin, png, q } from './helpers';

/**
 * External Protected Deal — invitation-first flow:
 * buyer creates the request WITHOUT seller details (GPS location granted) → share screen with a secure
 * link → a NEW seller registers through the link and is bound to the deal → another account is refused
 * → seller verifies the phone, enters own details / pickup address (GPS denied → manual) / offer with
 * "no voluntary returns" → buyer requests a return-policy change → seller accepts → terms frozen →
 * buyer pays (manual proof) → admin verifies → addresses become visible → seller delivers → buyer
 * confirms "received and as described" (entitlement) → finance checker approves the settlement →
 * payout payable and paid by finance.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString().slice(-7);
const NEW_SELLER = { name: 'كريم البائع الخارجي', email: `ext-seller${RUN}@e2e.local`, phone: `0122${RUN}`, password: 'E2e@ExtSeller2026' };
let dealId = '';
let link = '';
const status = async () => (await q<{ status: string }>(`select status from external_deals where id = $1`, [dealId]))[0]?.status;
/** Click "save & next" only once the current step has rendered and hydrated (soft navigation updates the URL first). */
const STEP_FIELD: Record<string, string> = { '1': 'input[name=title]', '2': 'input[name=unitPrice]', '3': 'input[name=deliveryMethod]', '4': 'textarea[name=customTerms]', '5': 'input[name=loc_city]' };
async function next(page: Page) {
  const step = new URL(page.url()).searchParams.get('step') ?? '1';
  await page.locator(STEP_FIELD[step] ?? 'form').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
}

test('buyer creates a request without seller details, shares a secure link (GPS granted)', async ({ browser }) => {
  const page = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 30.0444, longitude: 31.2357, accuracy: 20 });
  await page.goto('/account/deals/new');
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
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
  await page.getByRole('button', { name: 'استخدم موقعي الحالي' }).click();
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
  await expect(page.getByText('طلب الصفقة اتعمل')).toBeVisible();
  await expect(page.getByTestId('deal-ref')).toHaveText(/^EDMN-\d{8}$/);
  link = await page.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/deal\/invite\/[A-Za-z0-9_-]{40,}$/);
  expect(page.url()).not.toContain(link.split('/').pop()!);
  const wa = await page.getByRole('link', { name: 'ابعت على WhatsApp' }).getAttribute('href');
  expect(decodeURIComponent(wa!)).toContain('عملت طلب صفقة محمية على اضمن.');
  await expect(page.getByRole('button', { name: 'انسخ رابط الدعوة' })).toBeVisible();
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
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
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
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(page.getByText('موبايل سامسونج S22 مستعمل').first()).toBeVisible();
  await ctx.close();
});

test('another account cannot use the bound link', async ({ browser }) => {
  const page = await customerLogin(browser, 'omar@demo.edmn.local');
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(page.getByText('الدعوة دي مرتبطة بحساب تاني')).toBeVisible();
  await expect(page.getByRole('button', { name: 'قبول ومتابعة' })).toHaveCount(0);
  await page.goto(`/account/deals/${dealId}`);
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  // Streaming pages render the not-found view (same as a non-existent id → no existence leak).
  await expect(page.getByRole('heading', { name: /مش موجود/ })).toBeVisible();
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
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await page.getByRole('button', { name: 'ابعت الرمز' }).click();
  const tail = NEW_SELLER.phone.slice(-8);
  await expect.poll(async () => (await q(`select id from outbound_messages where recipient like $1`, [`%${tail}`])).length).toBeGreaterThan(0);
  const [{ body }] = await q<{ body: string }>(`select body from outbound_messages where recipient like $1 order by created_at desc limit 1`, [`%${tail}`]);
  await page.locator('input[name=code]').fill(body.match(/\d{6}/)![0]);
  await page.getByRole('button', { name: 'تأكيد' }).click();
  await expect.poll(async () => (await q<{ v: Date | null }>(`select phone_verified_at v from users where email = $1`, [NEW_SELLER.email]))[0].v).not.toBeNull();
  await page.reload();
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)

  const form = page.getByTestId('seller-offer-form');
  await form.getByRole('button', { name: 'استخدم موقعي الحالي' }).click(); // permission not granted
  await expect(form.getByTestId('location-error')).toContainText('ما سمحتش بالوصول لموقعك');
  await form.locator('select[name=loc_governorateId]').selectOption({ index: 2 });
  await form.locator('input[name=loc_city]').fill('الهرم');
  await form.locator('input[name=loc_street]').fill('شارع فيصل الرئيسي');
  await form.locator('input[name=shippingFee]').fill('75');
  await form.locator('input[name=processingDays]').fill('2');
  await form.locator('textarea[name=defects]').fill('خدش بسيط في الإطار');
  await form.locator('input[name=accessories]').fill('العلبة والشاحن');
  await form.locator('input[name=rp_type][value=NONE]').check();
  await expect(form.getByText('البائع مش بيقدّم إرجاع اختياري للمنتج ده.')).toBeVisible();
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
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  const review = buyer.getByTestId('offer-review');
  for (const label of ['السعر', 'مصاريف الشحن', 'طريقة الشحن', 'مدة التجهيز', 'موعد التسليم المتوقع', 'حالة المنتج', 'سياسة الإرجاع', 'الشروط الخاصة']) await expect(review.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(review.getByText('البائع مش بيقدّم إرجاع اختياري للمنتج ده.').first()).toBeVisible();
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
  await seller.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(seller.getByTestId('change-request')).toContainText('بيقبل الإرجاع الاختياري خلال 3 يوم');
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
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(page.getByTestId('agreed-terms')).toContainText('بيقبل الإرجاع الاختياري خلال 3 يوم');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect.poll(async () => (await q(`select id from payments where deal_id = $1`, [dealId])).length).toBe(1);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('input[name=reference]').fill('VC-E2E-5555');
  await page.locator('input[name=proof]').setInputFiles({ name: 'vc.png', mimeType: 'image/png', buffer: await png() });
  await page.getByRole('button', { name: 'رفع إثبات الدفع' }).click();
  await expect.poll(status).toBe('PAYMENT_UNDER_REVIEW');
  const [p] = await q<{ id: string }>(`select id from payments where deal_id = $1`, [dealId]);
  const admin = await adminLogin(browser, 'payments@edmn.local');
  acceptDialogs(admin);
  await admin.goto(`/admin/payments/${p.id}`);
  await admin.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await admin.getByRole('button', { name: /تأكيد دفع/ }).click();
  await expect.poll(status).toBe('ACTIVE');
  await page.reload();
  await page.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(page.getByTestId('deal-locations')).toContainText('شارع فيصل الرئيسي');
});

test('seller ships → buyer gets the handover code → seller verifies it; funds stay unavailable', async ({ browser }) => {
  const seller = await sellerPage(browser);
  await seller.goto(`/account/deals/${dealId}`);
  await seller.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(seller.getByTestId('deal-locations')).toContainText('شارع عباس العقاد');
  await seller.locator('textarea[name=note]').fill('تم الشحن عبر شركة الشحن، بوليصة 12345.');
  await seller.getByRole('button', { name: 'تسجيل الشحن' }).click();
  await expect.poll(status).toBe('DELIVERED');
  // The seller never sees the code — there is only an input and no "buyer received" button.
  await seller.reload();
  await seller.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(seller.getByTestId('handover-verify')).toBeVisible();
  await expect(seller.getByTestId('staging-otp')).toHaveCount(0);
  await expect(seller.getByRole('button', { name: /استلم/ })).toHaveCount(0);

  const code = await buyerHandoverCode(browser, dealId);
  expect(await seller.content()).not.toContain(code);
  await seller.locator('input[name=code]').fill(code === '000000' ? '111111' : '000000');
  await seller.getByRole('button', { name: 'تأكيد الرمز' }).click();
  await expect(seller.getByText(/رمز الاستلام غير صحيح/)).toBeVisible();
  await seller.locator('input[name=code]').fill(code);
  await seller.getByRole('button', { name: 'تأكيد الرمز' }).click();
  await expect.poll(status).toBe('DELIVERY_HANDOVER_VERIFIED');
  await seller.reload();
  await seller.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(seller.getByText('التسليم اتأكد برمز الاستلام.')).toBeVisible();
  // OTP alone releases nothing.
  expect(await q(`select id from deal_payouts where deal_id = $1`, [dealId])).toHaveLength(0);
  expect(await q(`select id from journal_entries where source_id = $1 and entry_type = 'DEAL_SETTLEMENT'`, [dealId])).toHaveLength(0);
});

test('buyer explicitly confirms "received and as described" → payout payable exactly once and paid', async ({ browser }) => {
  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  acceptDialogs(buyer);
  await buyer.goto(`/account/deals/${dealId}`);
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  const choice = buyer.getByTestId('delivery-choice');
  await expect(choice.getByText('تسليم المنتج ليك اتأكد برمز الاستلام.')).toBeVisible();
  await expect(choice.getByRole('link', { name: /استلمت بس فيه مشكلة/ })).toBeVisible();
  await expect(choice.getByText('لم أستلم المنتج فعليًا')).toBeVisible();
  await choice.getByRole('button', { name: 'استلمت والمنتج مطابق' }).click();
  // Buyer confirmation = entitlement only: no settlement and no payout until an Admin approves.
  await expect.poll(status).toBe('BUYER_CONFIRMED_RECEIPT'); // entitled, still held until an Admin approves
  expect(await q(`select id from journal_entries where source_id = $1 and entry_type = 'DEAL_SETTLEMENT'`, [dealId])).toHaveLength(0);
  expect(await q(`select id from deal_payouts where deal_id = $1`, [dealId])).toHaveLength(0);
  const checker = await adminLogin(browser, 'checker@edmn.local');
  await checker.goto(`/admin/deals/${dealId}`);
  await checker.waitForLoadState('networkidle');
  await checker.getByLabel('سبب الاعتماد').fill('استلام مؤكد من المشتري');
  await checker.getByRole('button', { name: /اعتماد تسوية الصفقة/ }).click();
  await expect.poll(status).toBe('COMPLETED');
  const pos = await q<{ id: string; amount: string; status: string }>(`select id, amount, status from deal_payouts where deal_id = $1`, [dealId]);
  expect(pos).toHaveLength(1);
  const [po] = pos;
  const [d] = await q<{ r: string }>(`select seller_receives r from external_deals where id = $1`, [dealId]);
  expect(po.status).toBe('PENDING');
  expect(po.amount).toBe(d.r);
  // A second confirmation (replay) changes nothing.
  await buyer.reload();
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(buyer.getByTestId('delivery-choice')).toHaveCount(0);
  expect(await q(`select id from journal_entries where source_id = $1 and entry_type = 'DEAL_SETTLEMENT'`, [dealId])).toHaveLength(1);
  // Super-admin: views the handover evidence (never the code) and records the payout.
  const admin = await adminLogin(browser);
  await admin.goto(`/admin/deals/${dealId}`);
  await admin.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(admin.getByTestId('admin-handover')).toContainText('deal.delivery_otp_verified');
  await expect(admin.getByTestId('admin-handover')).toContainText('deal.delivery_otp_failed');
  expect(await admin.content()).not.toContain('codeHash');
  await admin.goto('/admin/refunds?tab=deals');
  await admin.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  const card = admin.locator('li', { hasText: `صفقة #` }).filter({ has: admin.locator(`input[name=id][value="${po.id}"]`) });
  await card.locator('input[name=reference]').fill('PAYOUT-E2E-1');
  await card.getByRole('button', { name: 'تسجيل الصرف' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from deal_payouts where id = $1`, [po.id]))[0].status).toBe('PAID');
});

/* ── Second deal (existing seller account): OTP handover → buyer reports a problem → funds stay held ── */
let deal2 = '';
const status2 = async () => (await q<{ status: string }>(`select status from external_deals where id = $1`, [deal2]))[0]?.status;

test('second deal reaches ACTIVE with the existing seller account (login path)', async ({ browser }) => {
  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await buyer.goto('/account/deals/new');
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await buyer.locator('input[name=title]').fill('سماعة لاسلكية مستعملة');
  await buyer.locator('textarea[name=description]').fill('سماعة بحالة جيدة مع علبة الشحن والكابل الأصلي.');
  await next(buyer);
  await buyer.waitForURL(/step=2/);
  deal2 = new URL(buyer.url()).searchParams.get('deal')!;
  await buyer.locator('input[name=unitPrice]').fill('1200');
  await next(buyer);
  await buyer.waitForURL(/step=3/);
  await buyer.locator('input[name=deliveryMethod]').fill('تسليم يد بيد');
  await buyer.locator('input[name=deliveryDeadline]').fill(new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10));
  await next(buyer);
  await buyer.waitForURL(/step=4/);
  await next(buyer);
  await buyer.waitForURL(/step=5/);
  await buyer.locator('select[name=loc_governorateId]').selectOption({ index: 1 });
  await buyer.locator('input[name=loc_city]').fill('مدينة نصر');
  await buyer.locator('input[name=loc_street]').fill('شارع مكرم عبيد');
  await next(buyer);
  await buyer.waitForURL(/step=6/);
  await buyer.locator('input[name=acceptTerms]').check();
  await buyer.getByRole('button', { name: 'إنشاء طلب الصفقة' }).click();
  await buyer.waitForURL(new RegExp(`/account/deals/${deal2}$`));
  const link2 = await buyer.getByTestId('invite-link').inputValue();

  const seller = await sellerPage(browser);
  await seller.goto(link2.replace(/^https?:\/\/[^/]+/, ''));
  await seller.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await seller.getByRole('button', { name: 'قبول ومتابعة' }).click();
  await seller.waitForURL(new RegExp(`/account/deals/${deal2}$`));
  const form = seller.getByTestId('seller-offer-form');
  await form.locator('select[name=loc_governorateId]').selectOption({ index: 2 });
  await form.locator('input[name=loc_city]').fill('الهرم');
  await form.locator('input[name=loc_street]').fill('شارع فيصل الرئيسي');
  await form.locator('input[name=processingDays]').fill('1');
  await form.locator('textarea[name=defects]').fill('خدوش خفيفة على العلبة');
  await form.locator('input[name=rp_type][value=NONE]').check();
  await form.locator('input[name=instapayAddress]').fill('karim.e2e@instapay');
  await form.locator('input[name=acceptTerms]').check();
  await form.getByRole('button', { name: 'إرسال العرض للمشتري' }).click();
  await expect.poll(status2).toBe('OFFER_PENDING_BUYER');

  await buyer.goto(`/account/deals/${deal2}`);
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await buyer.getByTestId('offer-review').getByRole('button', { name: 'موافق على العرض' }).click();
  await expect.poll(status2).toBe('PAYMENT_PENDING');
  await buyer.reload();
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await buyer.getByRole('button', { name: 'متابعة' }).click();
  await expect.poll(async () => (await q(`select id from payments where deal_id = $1`, [deal2])).length).toBe(1);
  await buyer.reload();
  await buyer.waitForLoadState('networkidle');
  await buyer.locator('input[name=reference]').fill('VC-E2E-7777');
  await buyer.locator('input[name=proof]').setInputFiles({ name: 'vc.png', mimeType: 'image/png', buffer: await png() });
  await buyer.getByRole('button', { name: 'رفع إثبات الدفع' }).click();
  await expect.poll(status2).toBe('PAYMENT_UNDER_REVIEW');
  const [p] = await q<{ id: string }>(`select id from payments where deal_id = $1`, [deal2]);
  const admin = await adminLogin(browser, 'payments@edmn.local');
  acceptDialogs(admin);
  await admin.goto(`/admin/payments/${p.id}`);
  await admin.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await admin.getByRole('button', { name: /تأكيد دفع/ }).click();
  await expect.poll(status2).toBe('ACTIVE');
});

test('OTP handover then "received but there is a problem" → dispute, funds stay held', async ({ browser }) => {
  const seller = await sellerPage(browser);
  await seller.goto(`/account/deals/${deal2}`);
  await seller.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await seller.locator('textarea[name=note]').fill('تم التسليم يدًا بيد.');
  await seller.getByRole('button', { name: 'تسجيل الشحن' }).click();
  await expect.poll(status2).toBe('DELIVERED');
  const code = await buyerHandoverCode(browser, deal2);
  await seller.reload();
  await seller.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await seller.locator('input[name=code]').fill(code);
  await seller.getByRole('button', { name: 'تأكيد الرمز' }).click();
  await expect.poll(status2).toBe('DELIVERY_HANDOVER_VERIFIED');

  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await buyer.goto(`/account/deals/${deal2}`);
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await buyer.getByTestId('delivery-choice').getByRole('link', { name: /استلمت بس فيه مشكلة/ }).click();
  await buyer.waitForURL(/\/account\/disputes\/new/);
  await buyer.locator('select[name=reasonCode]').selectOption('NOT_AS_DESCRIBED');
  await buyer.locator('textarea[name=description]').fill('السماعة اليمنى لا تعمل نهائيًا رغم أن العرض لم يذكر ذلك.');
  await buyer.getByRole('button', { name: 'افتح النزاع' }).click();
  await expect.poll(status2).toBe('DISPUTED');
  expect(await q(`select id from deal_payouts where deal_id = $1`, [deal2])).toHaveLength(0);
  expect(await q(`select id from journal_entries where source_id = $1 and entry_type = 'DEAL_SETTLEMENT'`, [deal2])).toHaveLength(0);
  await buyer.goto(`/account/deals/${deal2}`);
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  await expect(buyer.getByTestId('delivery-choice')).toHaveCount(0);
});

test('ledger stays balanced after both deals', async () => {
  const [t] = await q<{ dr: string; cr: string }>(`select coalesce(sum(debit),0) dr, coalesce(sum(credit),0) cr from journal_lines`);
  expect(t.dr).toBe(t.cr);
  const drift = await q(`select a.id from ledger_accounts a left join journal_lines l on l.account_id = a.id group by a.id
    having a.balance <> coalesce(sum(case when a.type in ('ASSET','EXPENSE') then l.debit - l.credit else l.credit - l.debit end), 0)`);
  expect(drift).toHaveLength(0);
});

/** The buyer reads their own code from the deal page (staging test display — only the buyer sees it). */
async function buyerHandoverCode(browser: Parameters<typeof customerLogin>[0], id: string) {
  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await buyer.goto(`/account/deals/${id}`);
  await buyer.waitForLoadState('networkidle'); // hydrated before interacting (slow serverless cold starts)
  const box = buyer.getByTestId('staging-otp');
  await expect(box).toContainText('رمز تجريبي — بيئة Staging');
  const code = (await buyer.getByTestId('staging-otp-code').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  // Anonymous visitors get no code (redirected to login).
  const anon = await (await browser.newContext({ locale: 'ar-EG' })).newPage();
  await anon.goto(`/account/deals/${id}`);
  await anon.waitForURL(/\/login/);
  await expect(anon.getByTestId('staging-otp')).toHaveCount(0);
  expect(await anon.content()).not.toContain(code);
  await anon.context().close();
  return code;
}
