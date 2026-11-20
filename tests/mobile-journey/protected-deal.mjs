// Real Flutter web UI → local API → isolated PostgreSQL. No tokens, invitation links or OTPs are logged.
import { chromium } from 'playwright';
import pg from 'pg';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { adminLogin, acceptDialogs } from '../e2e/helpers.ts';
const url = new URL(process.env.JOURNEY_DATABASE_URL ?? '');
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || url.pathname !== '/edmn_journey_test') throw new Error('Journey requires the isolated local edmn_journey_test database');
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const rows = async (query, args = []) => (await db.query(query, args)).rows;
const pollStatus = async (expected) => {
  for (let i = 0; i < 30; i++) {
    const [d] = await rows('select status from external_deals where id=$1', [dealIdForPoll]);
    if (d?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Deal did not reach expected status: ${expected}`);
};
let dealIdForPoll;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' });
let page = await context.newPage();
const observe = (p) => p.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/v1/') && r.request().method() !== 'GET') calls.push([r.request().method(), u.pathname, r.status()]); });
const calls = [];
observe(page);
const sem = async () => { await page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await page.waitForTimeout(600); };
const go = async (path) => { await page.goto('http://127.0.0.1:8099/#' + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(3000); await sem(); };
const type = async (locator, value) => { await locator.click(); await page.waitForTimeout(500); await page.keyboard.type(value, { delay: 20 }); };
const toActions = async () => { await page.mouse.move(190, 400); await page.mouse.wheel(0, 8000); await page.waitForTimeout(1000); await sem(); };
// Re-enter from the hub to dispose the stale detail provider and fetch the other party's changes.
const freshDeal = async (id) => {
  await go('/deals');
  const read = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${id}` && r.request().method() === 'GET', { timeout: 60000 });
  await go(`/deals/${id}`);
  const response = await read;
  assert.equal(response.status(), 200, 'Deal details API');
  const projection = await response.json();
  console.log(`Deal view: role=${projection.role}, status=${projection.status}, version=${projection.terms?.currentVersion ?? 'none'}, actions=${(projection.allowedActions ?? []).join(',')}`);
  await page.waitForTimeout(3000); await sem(); await toActions();
};
const tap = async (label) => {
  const target = page.getByRole('button', { name: label }).last();
  if (!(await target.count())) {
    await page.mouse.move(190, 400); await page.mouse.wheel(0, -10000); await page.waitForTimeout(500); await sem();
    for (let i = 0; i < 24 && !(await target.count()); i++) {
      await page.mouse.wheel(0, 350); await page.waitForTimeout(250); await sem();
    }
  }
  await target.click(); await page.waitForTimeout(1500); await sem();
};
const api = (method, regex, status) => assert(calls.some(([m, p, s]) => m === method && regex.test(p) && s === status), `Missing ${method} ${regex} ${status}; observed: ${JSON.stringify(calls)}`);
try {
  await mkdir('test-results/mobile-journey', { recursive: true });
  await page.goto('http://127.0.0.1:8099/', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500); await sem();
  const skip = page.getByRole('button', { name: 'تخطي' }).first();
  if (await skip.count()) { await skip.click(); await page.waitForTimeout(1000); }
  await go('/sign-in');
  await page.screenshot({ path: 'test-results/mobile-journey/sign-in-empty.png' });
  await type(page.getByRole('textbox').nth(0), 'ahmed@demo.edmn.local');
  await type(page.getByRole('textbox').nth(1), 'Demo@12345');
  const login = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/login' && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تسجيل الدخول');
  assert.equal((await login).status(), 200, 'Login response');
  api('POST', /\/auth\/login$/, 200);
  const gate = await rows("select value from system_settings where key = 'payments.realMoneyEnabled'");
  assert(gate.length === 0 || gate[0].value === false, 'Real Money must be OFF');
  const [user] = await rows('select id from users where email = $1', ['ahmed@demo.edmn.local']);
  assert(user);
  const before = (await rows('select count(*)::int n from external_deals where buyer_id = $1', [user.id]))[0].n;
  await go('/deals/new');
  await tap('متابعة'); // Invalid draft must be refused and no row created.
  api('POST', /\/deals$/, 422);
  assert.equal((await rows('select count(*)::int n from external_deals where buyer_id = $1', [user.id]))[0].n, before);
  await type(page.getByRole('textbox', { name: 'اسم المنتج' }), 'Test camera');
  await type(page.getByRole('textbox', { name: 'وصف المنتج وحالته بالتفصيل' }), 'A camera in good condition for this test');
  const png = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#376899' } }).png().toBuffer();
  const pick = page.getByRole('button', { name: 'اختار صورة' });
  // A misleading filename must not bypass the server's content validation.
  const [invalidChooser] = await Promise.all([page.waitForEvent('filechooser'), pick.click()]);
  await invalidChooser.setFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await page.waitForTimeout(500); await sem();
  await tap('متابعة');
  api('POST', /\/deals\/[^/]+\/photos$/, 422);
  const [invalidDraft] = await rows('select id, status from external_deals where buyer_id=$1 and title=$2', [user.id, 'Test camera']);
  assert.equal(invalidDraft.status, 'DRAFT');
  assert.equal((await rows('select count(*)::int n from deal_evidence where deal_id=$1', [invalidDraft.id]))[0].n, 0);
  await page.getByRole('button', { name: 'حذف' }).last().click(); await page.waitForTimeout(500); await sem();
  console.log('PASS Flutter rejects invalid image bytes and allows correction');
  let [chooser] = await Promise.all([page.waitForEvent('filechooser'), pick.click()]);
  await chooser.setFiles({ name: 'test.png', mimeType: 'image/png', buffer: png }); await page.waitForTimeout(500); await sem();
  await page.getByRole('button', { name: 'حذف' }).last().click(); await page.waitForTimeout(500); await sem();
  [chooser] = await Promise.all([page.waitForEvent('filechooser'), pick.click()]);
  await chooser.setFiles({ name: 'test.png', mimeType: 'image/png', buffer: png }); await page.waitForTimeout(500); await sem();
  await page.screenshot({ path: 'test-results/mobile-journey/creation.png' });
  await tap('متابعة');
  api('POST', /\/deals$/, 201); api('POST', /\/deals\/[^/]+\/photos$/, 200);
  const [deal] = await rows('select id, status from external_deals where buyer_id = $1 and title = $2', [user.id, 'Test camera']);
  assert.equal(deal.id, invalidDraft.id, 'Correcting a rejected upload must reuse the draft');
  assert.equal(deal.status, 'DRAFT');
  dealIdForPoll = deal.id;
  const evidence = await rows('select f.visibility, f.scan_status from deal_evidence e join files f on f.id=e.file_id where e.deal_id=$1 and e.kind=$2', [deal.id, 'PRODUCT_PHOTO']);
  assert.deepEqual(evidence, [{ visibility: 'PRIVATE', scan_status: 'UNSCANNED' }]);
  await type(page.getByRole('textbox', { name: 'السعر (ج.م)' }), '3000');
  await tap('متابعة'); api('PUT', new RegExp(`/deals/${deal.id}/steps/2$`), 200);
  await type(page.getByRole('textbox', { name: 'طريقة التسليم (مندوب، شركة شحن، استلام يدوي)' }), 'Delivery service');
  await tap('متابعة');
  api('PUT', new RegExp(`/deals/${deal.id}/steps/3$`), 200);
  api('PUT', new RegExp(`/deals/${deal.id}/steps/4$`), 200);
  await type(page.getByRole('textbox', { name: 'المدينة / المنطقة' }), 'Cairo');
  await type(page.getByRole('textbox', { name: 'الشارع' }), 'Test street');
  await tap('متابعة'); api('PUT', new RegExp(`/deals/${deal.id}/steps/5$`), 200);
  await tap('مراجعة الصفقة');
  await page.getByText('Test camera').first().waitFor({ state: 'visible' });
  const [saved] = await rows('select status, wizard_step, unit_price, delivery_method, buyer_location_enc from external_deals where id=$1', [deal.id]);
  assert.equal(saved.status, 'DRAFT');
  assert(saved.wizard_step >= 6);
  assert.equal(Number(saved.unit_price), 300000);
  assert.equal(saved.delivery_method, 'Delivery service');
  assert(saved.buyer_location_enc);
  console.log('PASS Flutter buyer login, validation, photo and DRAFT persistence');
  await page.screenshot({ path: 'test-results/mobile-journey/details.png' });
  await tap('دعوة البائع');
  const invitationResponse = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/invitation` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('دعوة البائع');
  const invitation = await invitationResponse;
  assert.equal(invitation.status(), 200);
  const invitationLink = (await invitation.json()).link;
  assert(invitationLink && invitationLink.includes('/deal/invite/'));
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'INVITED');
  console.log('PASS Flutter invitation: API 200 and INVITED');
  await page.mouse.move(190, 350); await page.mouse.wheel(0, -8000); await page.waitForTimeout(1000); await sem();
  await page.getByRole('button', { name: 'نسخ الرابط' }).waitFor({ state: 'visible' });
  // The link is used only in memory; never print it or capture a screenshot while it is displayed.
  const buyerPage = page;
  await go('/deals/join');
  try { await type(page.getByRole('textbox', { name: 'الصق رابط الدعوة' }), invitationLink); }
  catch { throw new Error('Could not enter the buyer invitation'); }
  const buyerClaim = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/deal-invitations/claim' && r.request().method() === 'POST', { timeout: 60000 });
  await tap('الانضمام للصفقة');
  assert.equal((await buyerClaim).status(), 403);
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'INVITED');
  console.log('PASS Flutter refuses buyer participation as seller');
  const sellerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' });
  page = await sellerContext.newPage();
  observe(page);
  await page.goto('http://127.0.0.1:8099/', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500); await sem();
  const sellerSkip = page.getByRole('button', { name: 'تخطي' }).first();
  if (await sellerSkip.count()) { await sellerSkip.click(); await page.waitForTimeout(1000); }
  await go('/sign-in');
  await type(page.getByRole('textbox').nth(0), 'techzone@demo.edmn.local');
  await type(page.getByRole('textbox').nth(1), 'Demo@12345');
  const sellerLogin = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/login' && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تسجيل الدخول'); assert.equal((await sellerLogin).status(), 200);
  await go('/deals/join');
  await type(page.getByRole('textbox', { name: 'الصق رابط الدعوة' }), 'A'.repeat(43));
  const invalidClaim = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/deal-invitations/claim' && r.request().method() === 'POST', { timeout: 60000 });
  await tap('الانضمام للصفقة');
  assert((await invalidClaim).status() >= 400);
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'INVITED');
  await page.getByRole('button', { name: 'الانضمام للصفقة' }).waitFor({ state: 'visible' });
  // Flutter exposes the entered value instead of the placeholder as the accessible name.
  await page.getByRole('textbox').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  console.log('PASS Flutter rejects an invalid invitation and preserves the deal');
  // Move only this disposable invitation's expiry into the past; no waiting or clock changes in the app.
  await rows("update deal_invitations set expires_at=now()-interval '1 minute' where deal_id=$1 and status='PENDING'", [deal.id]);
  try { await type(page.getByRole('textbox').first(), invitationLink); }
  catch { throw new Error('Could not enter the expired invitation'); }
  const expiredClaim = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/deal-invitations/claim' && r.request().method() === 'POST', { timeout: 60000 });
  await tap('الانضمام للصفقة');
  assert((await expiredClaim).status() >= 400);
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'INVITED');
  console.log('PASS Flutter rejects expired invitation without joining');
  // Restore only the synthetic fixture so the existing happy path can continue.
  await rows("update deal_invitations set expires_at=now()+interval '1 hour' where deal_id=$1 and status='PENDING'", [deal.id]);
  await page.getByRole('textbox').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  try { await type(page.getByRole('textbox').first(), invitationLink); }
  catch { throw new Error('Could not enter the seller invitation'); }
  const claim = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/deal-invitations/claim' && r.request().method() === 'POST', { timeout: 60000 });
  await tap('الانضمام للصفقة'); assert.equal((await claim).status(), 200);
  const [joined] = await rows('select status, seller_user_id from external_deals where id=$1', [deal.id]);
  assert.equal(joined.status, 'SELLER_JOINED');
  assert(joined.seller_user_id);
  console.log('PASS Flutter seller join: API 200 and SELLER_JOINED');
  await page.getByRole('button', { name: 'إرسال عرض' }).waitFor({ state: 'visible' });
  await tap('إرسال عرض');
  await type(page.getByRole('textbox', { name: 'الاسم بالكامل' }), 'Test Seller');
  await type(page.getByRole('textbox', { name: 'المدينة / المنطقة' }), 'Giza');
  await type(page.getByRole('textbox', { name: 'الشارع' }), 'Test seller street');
  await type(page.getByRole('textbox', { name: 'اسم صاحب الحساب' }), 'Test Seller');
  await type(page.getByRole('textbox', { name: 'عنوان إنستاباي' }), 'test-seller@instapay');
  await type(page.getByRole('textbox', { name: 'طريقة التسليم (مندوب، شركة شحن، استلام يدوي)' }), 'Delivery service');
  const offer = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/offer` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('إرسال العرض'); assert.equal((await offer).status(), 200);
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'OFFER_PENDING_BUYER');
  console.log('PASS Flutter seller offer: API 200 and OFFER_PENDING_BUYER');
  page = buyerPage;
  await freshDeal(deal.id);
  await page.screenshot({ path: 'test-results/mobile-journey/buyer-offer.png' });
  await tap('طلب تعديل');
  await type(page.getByRole('textbox', { name: 'اكتب التعديل المطلوب بوضوح' }), 'Please confirm the delivery date');
  const change = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/offer-response` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تأكيد'); assert.equal((await change).status(), 200);
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'CHANGE_REQUESTED');
  console.log('PASS Flutter change request: API 200 and CHANGE_REQUESTED');
  page = sellerContext.pages()[0];
  await freshDeal(deal.id);
  const accept = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/change-response` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('قبول التعديل'); assert.equal((await accept).status(), 200);
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'PAYMENT_PENDING');
  console.log('PASS Flutter seller acceptance: API 200 and PAYMENT_PENDING');
  page = buyerPage;
  await freshDeal(deal.id);
  const payment = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/payment` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('ادفع وارفع الإيصال');
  const paymentResponse = await payment;
  assert.equal(paymentResponse.status(), 200);
  const pay = await paymentResponse.json();
  assert.equal(pay.deal.payment.isTest, true);
  assert(Number.isInteger(pay.deal.payment.amountDuePiastres));
  await page.getByText('دفعة تجريبية: الأموال الحقيقية مقفولة. متحوّلش أي فلوس حقيقية.').first().waitFor({ state: 'visible' });
  const [receiptChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /للإيصال/ }).first().click()]);
  await receiptChooser.setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png }); await page.waitForTimeout(500); await sem();
  await type(page.getByRole('textbox', { name: 'المبلغ اللي حوّلته (ج.م)' }), String(pay.deal.payment.amountDuePiastres / 100));
  const proof = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/payments/${pay.paymentId}/proof` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('إرسال الإيصال للمراجعة'); assert.equal((await proof).status(), 201);
  await page.getByText('الإيصال وصل وتحت المراجعة. الدفع مش هيتأكد غير بعد مراجعة فريق أضمن.').waitFor({ state: 'visible' });
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'PAYMENT_UNDER_REVIEW');
  assert.equal((await rows('select count(*)::int n from payment_submissions where payment_id=$1', [pay.paymentId]))[0].n, 1);
  console.log('PASS Flutter test payment proof: API 201 and PAYMENT_UNDER_REVIEW');
  // Existing staff UI performs the real review, with the seeded demo staff's TOTP.
  // No secret, code, receipt or invitation is logged or screenshotted.
  const adminBrowser = { newContext: (options) => browser.newContext({ ...options, baseURL: 'http://127.0.0.1:3000' }) };
  const staffLogin = async (email) => {
    try { return await adminLogin(adminBrowser, email); }
    catch { throw new Error('Test staff sign-in failed'); }
  };
  const admin = await staffLogin('payments@edmn.local');
  acceptDialogs(admin);
  await admin.goto(`/admin/payments/${pay.paymentId}`);
  await admin.waitForLoadState('networkidle');
  const reviewResponse = admin.waitForResponse((r) => new URL(r.url()).pathname === `/admin/payments/${pay.paymentId}` && r.request().method() === 'POST', { timeout: 60000 });
  await admin.getByRole('button', { name: /تأكيد دفع/ }).click();
  assert((await reviewResponse).ok());
  await pollStatus('ACTIVE');
  console.log('PASS authorized test staff review: ACTIVE');
  page = sellerContext.pages()[0];
  await freshDeal(deal.id);
  await tap('تم الشحن');
  await type(page.getByRole('textbox', { name: 'تفاصيل الشحن (الشركة، رقم البوليصة)' }), 'Test delivery');
  const ship = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/shipped` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تم الشحن'); assert.equal((await ship).status(), 200);
  await pollStatus('DELIVERED');
  console.log('PASS Flutter shipment: API 200 and DELIVERED');
  page = buyerPage;
  await freshDeal(deal.id);
  const codeResponse = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/delivery-code` && r.request().method() === 'GET', { timeout: 60000 });
  await tap('عرض كود التسليم');
  const codeResult = await codeResponse; assert.equal(codeResult.status(), 200);
  const code = (await codeResult.json()).code;
  assert(/^\d{6}$/.test(code));
  try { await page.getByText(code, { exact: true }).waitFor({ state: 'visible' }); }
  catch { throw new Error('Buyer delivery code was not visible'); }
  page = sellerContext.pages()[0];
  await freshDeal(deal.id);
  await tap('إدخال كود التسليم');
  const codeInput = page.getByRole('textbox', { name: 'الكود (6 أرقام)' });
  const wrongCode = code === '000000' ? '111111' : '000000';
  try { await type(codeInput, wrongCode); } catch { throw new Error('Could not enter the test code'); }
  const wrongVerify = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/delivery-code/verify` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تحقق'); assert((await wrongVerify).status() >= 400);
  assert.equal((await rows('select status from external_deals where id=$1', [deal.id]))[0].status, 'DELIVERED');
  console.log('PASS Flutter rejects an incorrect delivery code without advancing the deal');
  await page.waitForTimeout(5000);
  // Refreshing the deal after a rejected attempt can remove the bottom sheet.
  // Open it again just as the seller would before trying another code.
  await freshDeal(deal.id);
  await tap('إدخال كود التسليم');
  try { await type(page.getByRole('textbox', { name: 'الكود (6 أرقام)' }), code); }
  catch { throw new Error('Could not enter the delivery code'); }
  const verify = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/delivery-code/verify` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تحقق'); assert.equal((await verify).status(), 200);
  await pollStatus('DELIVERY_HANDOVER_VERIFIED');
  console.log('PASS Flutter OTP verification: API 200 and DELIVERY_HANDOVER_VERIFIED');
  page = buyerPage;
  await freshDeal(deal.id);
  await tap('تأكيد الاستلام');
  const confirmed = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${deal.id}/confirm-receipt` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تأكيد الاستلام'); assert.equal((await confirmed).status(), 200);
  await pollStatus('BUYER_CONFIRMED_RECEIPT');
  console.log('PASS Flutter receipt confirmation: BUYER_CONFIRMED_RECEIPT');
  assert.equal((await rows("select count(*)::int n from journal_entries where source_id=$1 and entry_type='DEAL_SETTLEMENT'", [deal.id]))[0].n, 0);
  // Two-person release stays in the authorized web console; the app has no release action.
  const operator = await staffLogin('finance@edmn.local');
  await operator.goto(`/admin/deals/${deal.id}`); await operator.waitForLoadState('networkidle');
  await operator.getByTestId('movement-maker-DEAL_RELEASE').locator('input[name=reason]').fill('Test confirmed receipt');
  const requestRelease = operator.waitForResponse((r) => new URL(r.url()).pathname === `/admin/deals/${deal.id}` && r.request().method() === 'POST', { timeout: 60000 });
  await operator.getByRole('button', { name: /طلب تسوية صفقة محمية/ }).click();
  assert((await requestRelease).ok());
  await operator.getByTestId('movement-open-DEAL_RELEASE').waitFor({ state: 'visible' });
  const checker = await staffLogin('checker@edmn.local');
  await checker.goto(`/admin/deals/${deal.id}`); await checker.waitForLoadState('networkidle');
  await checker.getByLabel('سبب الاعتماد').fill('Test confirmed receipt');
  const approveRelease = checker.waitForResponse((r) => new URL(r.url()).pathname === `/admin/deals/${deal.id}` && r.request().method() === 'POST', { timeout: 60000 });
  await checker.getByRole('button', { name: /اعتماد تسوية الصفقة/ }).click();
  assert((await approveRelease).ok());
  await pollStatus('COMPLETED');
  assert.equal((await rows("select count(*)::int n from journal_entries where source_id=$1 and entry_type='DEAL_SETTLEMENT'", [deal.id]))[0].n, 1);
  console.log('PASS Flutter Protected Deal with authorized staff review and two-person test settlement');

  // A separate draft exercises cancellation without mutating the completed deal.
  page = buyerPage;
  await go('/deals/new');
  await type(page.getByRole('textbox', { name: 'اسم المنتج' }), 'Test cancellation camera');
  await type(page.getByRole('textbox', { name: 'وصف المنتج وحالته بالتفصيل' }), 'A separate draft for cancellation testing');
  const createCancel = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/deals' && r.request().method() === 'POST', { timeout: 60000 });
  await tap('متابعة'); assert.equal((await createCancel).status(), 201);
  const [cancelDraft] = await rows('select id, status from external_deals where buyer_id=$1 and title=$2', [user.id, 'Test cancellation camera']);
  assert.equal(cancelDraft.status, 'DRAFT');
  await freshDeal(cancelDraft.id);
  await tap('إلغاء الصفقة');
  await type(page.getByRole('textbox', { name: 'سبب الإلغاء' }), 'Cancel this isolated test draft');
  const cancelled = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/deals/${cancelDraft.id}/cancel` && r.request().method() === 'POST', { timeout: 60000 });
  await tap('تأكيد'); assert.equal((await cancelled).status(), 200);
  assert.equal((await rows('select status from external_deals where id=$1', [cancelDraft.id]))[0].status, 'CANCELLED');
  console.log('PASS Flutter cancellation: API 200 and CANCELLED');
} finally { await browser.close(); await db.end(); }
