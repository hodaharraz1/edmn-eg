import { expect, test, type Page } from '@playwright/test';
import { customerLogin, png, q } from './helpers';

/**
 * EDMN Trusted Used Commerce — «سوق المستعمل المضمون».
 * Public surfaces (landing, homepage, documented listing, Product Passport) and the full external used deal:
 * buyer creates a USED deal in a covered category → seller documents the condition (structured data + guided
 * evidence + declaration) → offer carries a PROPOSED snapshot → buyer reviews condition + safety score → agreement
 * freezes the condition (integrity shown) → the seller cannot edit it any more.
 */
test.describe.configure({ mode: 'serial' });

const DEMO_IMEI = '490154203237518';
const NO_COMPETITORS = /olx|dubizzle|opensooq|facebook marketplace|السوق المفتوح|دوبيزل/i;
const NO_ABSOLUTE = /100\s*%|مستحيل الاحتيال|مضمون 100/;

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test('«سوق المستعمل المضمون» landing: message, CTA into a protected used deal, honest protection levels, no competitor names', async ({ page }) => {
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/used');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('اشتري مستعمل من شخص متعرفوش');
    await expect(page.getByTestId('used-cta')).toHaveAttribute('href', '/account/deals/new?condition=USED');
    await expect(page.getByTestId('used-cta')).toContainText('لقيتها في أي مكان؟ اضمنها هنا.');
    await expect(page.locator('main')).toContainText('مراجعة مستندات، مش فحص فني');
    const text = (await page.locator('main').innerText()) ?? '';
    expect(text).not.toMatch(NO_COMPETITORS);
    expect(text).not.toMatch(NO_ABSOLUTE);
    await noOverflow(page);
  }
});

test('homepage highlights trusted used commerce next to the general marketplace; nav has «المستعمل المضمون»', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const section = page.getByTestId('home-used');
  await expect(section).toBeVisible();
  await expect(section.getByRole('link', { name: 'لقيتها في أي مكان؟ اضمنها هنا.' })).toHaveAttribute('href', '/account/deals/new?condition=USED');
  await expect(page.getByRole('navigation', { name: 'التنقل الرئيسي' }).locator('a[href="/used"]')).toBeVisible();
  // The general marketplace stays: featured products still render.
  await expect(page.locator('#home-featured')).toBeVisible();
});

test('documented used listing: passport, level, inspection period, masked IMEI, defects, coverage, explainable score — no full IMEI anywhere', async ({ page }) => {
  const [p] = await q<{ slug: string; available: number }>(`select p.slug, v.stock_on_hand - v.reserved as available from products p join product_variants v on v.product_id = p.id where v.sku = 'UW-IP13P-256'`);
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`/product/${p.slug}`);
    const summary = page.getByTestId('used-summary');
    await expect(summary.getByTestId('passport-link')).toBeVisible();
    await expect(summary.getByTestId('protection-level')).toHaveAttribute('data-level', 'VERIFIED');
    await expect(summary).toContainText('فترة الفحص بعد الاستلام');
    const trust = page.getByTestId('used-trust');
    await expect(trust.getByTestId('masked-identifier')).toContainText('7518');
    await expect(trust.getByTestId('declared-defects')).toContainText('خدش صغير');
    const coverage = trust.getByTestId('coverage').locator('li');
    await expect(coverage).toHaveCount(4);
    await expect(coverage.nth(1)).toHaveAttribute('data-covered', 'true'); // condition reviewed (VERIFIED)
    await expect(coverage.nth(2)).toHaveAttribute('data-covered', 'false'); // never claims an inspection that did not happen
    const score = trust.getByTestId('safety-score');
    await score.getByText('لماذا حصلت الصفقة على هذه الدرجة؟').click();
    await expect(score).toContainText('توثيق البائع');
    await expect(score).toContainText('مش احتمال نجاح');
    // Protected purchase CTA (only rendered while the single used unit is still in stock).
    if (Number(p.available) > 0) await expect(page.getByRole('button', { name: /اشتري بحماية اضمن/ })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(DEMO_IMEI);
    await noOverflow(page);
  }
});

test('public Product Passport: history, review ≠ inspection, private identifier photo hidden from the public', async ({ page }) => {
  const [pp] = await q<{ code: string }>(`select pp.code from product_passports pp join product_variants v on v.product_id = pp.product_id where v.sku = 'UW-IP13P-256'`);
  await page.context().clearCookies();
  await page.goto(`/passport/${pp.code}`);
  await expect(page.getByTestId('passport-code')).toHaveText(pp.code);
  await expect(page.getByTestId('passport-verification')).toContainText('مش فحص فني');
  await expect(page.getByTestId('passport-inspection')).toContainText('ما اتفحصش');
  await expect(page.locator('a[href^="/api/files/"]')).toHaveCount(0);
  expect(await page.content()).not.toContain(DEMO_IMEI);
  // Unknown or malformed codes: the uniform not-found view (streaming pages), nothing leaks.
  for (const bad of ['/passport/EP-ZZZZZZZZ', '/passport/not-a-code']) {
    await page.goto(bad);
    await expect(page.getByRole('heading', { name: /مش موجود/ })).toBeVisible();
    await expect(page.getByTestId('passport-page')).toHaveCount(0);
  }
});

let dealId = '';
const status = async () => (await q<{ status: string }>(`select status from external_deals where id = $1`, [dealId]))[0]?.status;

test('external used deal: buyer picks a covered category → seller documents condition + evidence + declaration → offer → buyer sees condition and score → agreement freezes it', async ({ browser }) => {
  test.setTimeout(240_000);
  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  const [cat] = await q<{ id: string }>(`select id from categories where slug = 'mobile-phones'`);
  await buyer.goto('/account/deals/new?condition=USED');
  await buyer.waitForLoadState('networkidle');
  await buyer.locator('input[name=title]').fill('آيفون 12 مستعمل من جروب بيع');
  await buyer.locator('textarea[name=description]').fill('لقيته على جروب بيع، البائع بيقول البطارية 86% والجهاز بحالة كويسة.');
  await buyer.locator('select[name=condition]').selectOption('USED');
  await buyer.locator('select[name=categoryId]').selectOption(cat.id);
  await buyer.getByRole('button', { name: 'حفظ والتالي' }).click();
  await buyer.waitForURL(/step=2/);
  dealId = new URL(buyer.url()).searchParams.get('deal')!;
  await buyer.locator('input[name=unitPrice]').fill('15000');
  await buyer.waitForLoadState('networkidle');
  await buyer.getByRole('button', { name: 'حفظ والتالي' }).click();
  await buyer.waitForURL(/step=3/);
  await buyer.locator('input[name=deliveryMethod]').fill('شحن عبر شركة شحن');
  await buyer.locator('input[name=deliveryDeadline]').fill(new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10));
  await expect(buyer.locator('input[name=inspectionDays]')).toHaveAttribute('min', '2');
  await buyer.locator('input[name=inspectionDays]').fill('3');
  await buyer.waitForLoadState('networkidle');
  await buyer.getByRole('button', { name: 'حفظ والتالي' }).click();
  await buyer.waitForURL(/step=4/);
  await buyer.waitForLoadState('networkidle');
  await buyer.getByRole('button', { name: 'حفظ والتالي' }).click();
  await buyer.waitForURL(/step=5/);
  await buyer.locator('select[name=loc_governorateId]').selectOption({ index: 1 });
  await buyer.locator('input[name=loc_city]').fill('مدينة نصر');
  await buyer.locator('input[name=loc_street]').fill('شارع مكرم عبيد');
  await buyer.waitForLoadState('networkidle');
  await buyer.getByRole('button', { name: 'حفظ والتالي' }).click();
  await buyer.waitForURL(/step=6/);
  await buyer.locator('input[name=acceptTerms]').check();
  await buyer.getByRole('button', { name: 'إنشاء طلب الصفقة' }).click();
  await buyer.waitForURL(new RegExp(`/account/deals/${dealId}$`));
  const link = await buyer.getByTestId('invite-link').inputValue();

  const seller = await customerLogin(browser, 'omar@demo.edmn.local');
  await seller.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await seller.waitForLoadState('networkidle');
  await seller.getByRole('button', { name: 'قبول ومتابعة' }).click();
  await seller.waitForURL(new RegExp(`/account/deals/${dealId}$`));
  await expect(seller.getByTestId('seller-condition-step')).toBeVisible();
  await seller.getByRole('button', { name: 'ابدأ توثيق الحالة' }).click();
  await seller.waitForURL(new RegExp(`/account/deals/${dealId}/condition$`));
  await seller.waitForLoadState('networkidle');

  // Structured condition (selects default to the first non-empty option, then explicit values).
  const form = seller.getByTestId('condition-form');
  for (const sel of await form.locator('select').all()) {
    const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
    await sel.selectOption(opts.includes('works') ? 'works' : opts.includes('none') ? 'none' : opts.includes('no') ? 'no' : opts.includes('original') ? 'original' : opts.includes('perfect') ? 'perfect' : opts.includes('true') ? 'true' : opts[0]);
  }
  await form.locator('input[name=f_brand]').fill('Apple');
  await form.locator('input[name=f_model]').fill('iPhone 12');
  await form.locator('input[name=f_color]').fill('أزرق');
  await form.locator('input[name=f_imei]').fill('356938035643809');
  await form.locator('input[name=f_battery_health]').fill('86');
  await form.locator('input[name=f_known_defects]').fill('خدش خفيف على الضهر');
  await form.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(form).toContainText('تم الحفظ');
  await seller.reload();
  await seller.waitForLoadState('networkidle');
  // Guided evidence: every required slot (+ defect photos, since a defect is declared).
  for (const slot of ['front', 'back', 'left', 'right', 'screen_on', 'battery', 'imei', 'defects']) {
    const box = seller.locator(`[data-slot="${slot}"]`);
    await box.locator('input[type=file]').setInputFiles({ name: `${slot}.png`, mimeType: 'image/png', buffer: await png() });
    await box.getByRole('button', { name: 'رفع', exact: true }).click();
    await expect(box.locator('img').first()).toBeVisible({ timeout: 20_000 });
  }
  await seller.reload();
  await seller.waitForLoadState('networkidle');
  await expect(seller.getByTestId('completeness')).toHaveText('100%');
  const declare = seller.getByTestId('declare-form');
  await declare.locator('input[name=declare]').check();
  await declare.getByRole('button', { name: /أقر وأنشئ جواز المنتج/ }).click();
  await expect(declare).toContainText('جواز المنتج: EP-');
  // The full identifier never reaches the page; the masked form does.
  expect(await seller.content()).not.toContain('356938035643809');

  // Offer (documented: free-text defects are optional for a covered used deal).
  await seller.goto(`/account/deals/${dealId}`);
  await seller.waitForLoadState('networkidle');
  const offer = seller.getByTestId('seller-offer-form');
  await offer.locator('select[name=loc_governorateId]').selectOption({ index: 2 });
  await offer.locator('input[name=loc_city]').fill('الهرم');
  await offer.locator('input[name=loc_street]').fill('شارع فيصل الرئيسي');
  await offer.locator('input[name=processingDays]').fill('1');
  await offer.locator('input[name=rp_type][value=NONE]').check();
  await offer.locator('input[name=instapayAddress]').fill('omar.used@instapay');
  await offer.locator('input[name=acceptTerms]').check();
  await offer.getByRole('button', { name: 'إرسال العرض للمشتري' }).click();
  await expect.poll(status).toBe('OFFER_PENDING_BUYER');

  // Buyer reviews the documented condition with the offer (masked IMEI, defects, coverage, explainable score).
  await buyer.goto(`/account/deals/${dealId}`);
  await buyer.waitForLoadState('networkidle');
  const used = buyer.getByTestId('used-deal-section');
  await expect(used).toContainText('بتتجمّد لما توافق على العرض');
  await expect(used.getByTestId('masked-identifier')).toContainText('3809');
  await expect(used.getByTestId('declared-defects')).toContainText('خدش خفيف');
  await expect(used.getByTestId('safety-score')).toBeVisible();
  await expect(used.getByTestId('seller-signals')).toContainText('التحقق من الهوية');
  await buyer.getByTestId('offer-review').getByRole('button', { name: 'موافق على العرض' }).click();
  await expect.poll(status).toBe('PAYMENT_PENDING');
  await buyer.reload();
  const frozen = buyer.getByTestId('used-deal-section');
  await expect(frozen.getByTestId('condition-freeze')).toContainText('مجمّدة');
  await expect(frozen.getByTestId('snapshot-integrity')).toContainText('سليمة');
  const [snap] = await q<{ status: string; n: string }>(`select status, (select count(*) from condition_snapshots where deal_id = $1)::text n from condition_snapshots where deal_id = $1 and status = 'ACCEPTED'`, [dealId]);
  expect(snap.status).toBe('ACCEPTED');

  // The seller can no longer edit the agreed condition.
  await seller.goto(`/account/deals/${dealId}/condition`);
  await expect(seller.getByTestId('condition-editor')).toHaveAttribute('data-status', 'LOCKED');
  await expect(seller.getByRole('button', { name: 'حفظ البيانات' })).toHaveCount(0);
  await expect(seller.getByTestId('declare-form')).toHaveCount(0);
  await noOverflow(buyer);
});

test('isolation: another user cannot open the deal condition editor or the deal passport; admin used console needs staff', async ({ browser }) => {
  const stranger = await customerLogin(browser, 'mona@demo.edmn.local');
  await stranger.goto(`/account/deals/${dealId}/condition`);
  await expect(stranger.getByRole('heading', { name: /مش موجود/ })).toBeVisible();
  await expect(stranger.getByTestId('condition-editor')).toHaveCount(0);
  const [pp] = await q<{ code: string }>(`select code from product_passports where deal_id = $1`, [dealId]);
  await stranger.goto(`/passport/${pp.code}`);
  await expect(stranger.getByRole('heading', { name: /مش موجود/ })).toBeVisible();
  await expect(stranger.getByTestId('passport-page')).toHaveCount(0);
  const res = await stranger.goto('/admin/used');
  expect(new URL(stranger.url()).pathname).not.toBe('/admin/used');
  expect(res!.status()).toBeLessThan(500);
});

test('admin: used console (analytics, queues), passport review forms, category policies, score rules', async ({ browser }) => {
  const { adminLogin } = await import('./helpers');
  const admin = await adminLogin(browser, 'admin@edmn.local');
  await admin.goto('/admin/used');
  await expect(admin.getByTestId('admin-used')).toContainText('رحلة الصفقات المستعملة');
  await expect(admin.getByTestId('admin-used')).toContainText('من غير بيانات شخصية');
  expect(await admin.content()).not.toContain(DEMO_IMEI);
  const [pp] = await q<{ id: string }>(`select pp.id from product_passports pp join product_variants v on v.product_id = pp.product_id where v.sku = 'UW-IP13P-256'`);
  await admin.goto(`/admin/used/passports/${pp.id}`);
  await expect(admin.getByTestId('verify-form')).toBeVisible();
  await expect(admin.getByTestId('inspection-form')).toContainText('تقرير فحص حقيقي');
  expect(await admin.content()).not.toContain(DEMO_IMEI);
  await admin.goto('/admin/used/policies');
  await expect(admin.getByTestId('admin-used-policies')).toContainText('موبايلات');
  await admin.goto('/admin/used/score');
  await expect(admin.getByTestId('admin-used-score').locator('input[name=w_SELLER_VERIFICATION]')).toHaveValue('20');
});
