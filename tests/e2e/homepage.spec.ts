import { expect, test } from '@playwright/test';

/** Homepage (approved reference design): sections in order, header, search routing, cart CTA, Egyptian identity. */
test('desktop homepage: header, hero, sections in the approved order, search routing, add to cart', async ({ browser }) => {
  const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText('اشتري وبيع بأمان');
  await expect(page.locator('h1')).toContainText('تحمي كل صفقة');

  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' });
  for (const href of ['/', '/stores', '/used', '/protected-deal', '/seller', '/contact']) await expect(nav.locator(`a[href="${href}"]`)).toBeVisible();
  await nav.getByTestId('category-menu-trigger').click();
  await expect(page.getByTestId('category-menu-panel')).toBeVisible();
  await page.keyboard.press('Escape');

  // Section order follows the reference.
  const order = ['home-hero-title', 'home-cats', 'home-featured', 'escrow-title'];
  const ys = [];
  for (const id of order) ys.push((await page.locator(`#${id}`).boundingBox())!.y);
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  await expect(page.getByLabel('ضمانات اضمن')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ابدأ البيع على اضمن' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'تطبيق اضمن' })).toBeVisible();
  await expect(page.getByLabel('اضمن بالأرقام')).toContainText('+5,000');
  await expect(page.getByRole('link', { name: 'أنشئ صفقة ضمان' })).toHaveAttribute('href', '/account/deals/new');

  // Egyptian identity: EGP only, no app-store download claims.
  const text = await page.locator('main').innerText();
  expect(text).toContain('ج.م');
  expect(text).not.toMatch(/ر\.س|SAR|App Store|Google Play/);
  const seller = page.locator('img[src="/brand/home/seller-banner-2000.webp"]'); // the owner-approved artwork
  await seller.scrollIntoViewIfNeeded();
  await expect.poll(() => seller.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

  // Search: all categories → /search; a chosen category → that category's listing with the query.
  await page.locator('#site-search').fill('سامسونج');
  await page.locator('#site-search').press('Enter');
  await page.waitForURL(/\/search\?q=/);
  await page.goto('/');
  const firstCat = await page.locator('#site-search-cat option').nth(1).getAttribute('value');
  await page.locator('#site-search-cat').selectOption(firstCat!);
  await page.locator('#site-search').fill('test');
  await page.getByRole('button', { name: 'ابحث', exact: true }).click();
  await page.waitForURL((u) => u.pathname === `/category/${firstCat}` && u.searchParams.get('q') === 'test');

  // One-tap add to cart on a single-option featured product.
  await page.goto('/');
  const add = page.locator('section[aria-labelledby="home-featured"]').getByRole('button', { name: 'أضف إلى السلة' }).first();
  if (await add.count()) {
    await add.click();
    await expect(page.locator('section[aria-labelledby="home-featured"]').getByRole('button', { name: 'اتضاف للسلة' }).first()).toBeVisible();
  }
  await page.context().close();
});

test('mobile homepage: compact header search, no horizontal scroll, reduced hero visual', async ({ browser }) => {
  const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width: 360, height: 780 } })).newPage();
  await page.goto('/');
  await expect(page.locator('#site-search')).toBeVisible();
  await expect(page.getByTestId('category-menu-trigger')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.context().close();
});

for (const width of [1440, 390]) {
  test(`approved seller banner at ${width}px: seller onboarding and protected deal stay two separate CTAs`, async ({ browser }) => {
    const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width, height: 900 } })).newPage();
    await page.goto('/');
    const section = page.locator('section[aria-label="ابدأ مع اضمن"]');
    await section.scrollIntoViewIfNeeded();
    // The approved artwork itself (desktop: full composition; mobile: merchant crop + real text), never a stand-in.
    const img = section.locator('img').filter({ visible: true }).first();
    await expect(img).toHaveAttribute('src', /\/brand\/home\/seller-banner-(2000|mobile-900)\.webp$/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const seller = section.getByRole('link', { name: 'افتح متجرك الآن' }).filter({ visible: true });
    await expect(seller).toHaveCount(1);
    await expect(seller).toHaveAttribute('href', '/seller/register');
    const box = (await seller.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const deal = section.getByRole('link', { name: 'أنشئ صفقة ضمان' }).filter({ visible: true });
    await expect(deal).toHaveAttribute('href', '/account/deals/new');
    await expect(section.getByText('بتشتري أو بتبيع مع شخص خارج اضمن؟')).toBeVisible();
    await page.context().close();
  });
}

for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [360, 780], [320, 640]] as const) {
  test(`hero at ${width}px: one HTML headline and CTA set, the approved artwork for this viewport only, protection message in HTML`, async ({ browser }) => {
    const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width, height } })).newPage();
    const heroAssets: string[] = [];
    page.on('request', (r) => { if (/\/brand\/home\/hero-visual/.test(r.url())) heroAssets.push(r.url().split('/').pop()!); });
    await page.goto('/');
    const hero = page.locator('section[aria-labelledby="home-hero-title"]');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(hero.locator('h1')).toContainText('اشتري وبيع بأمان');
    await expect(hero.locator('h1')).toContainText('اضمن تحمي كل صفقة');
    await expect(hero.getByRole('link', { name: 'تسوق الآن' })).toHaveAttribute('href', '/categories');
    await expect(hero.getByRole('link', { name: 'ابدأ البيع' })).toHaveAttribute('href', '/sell');
    for (const cta of await hero.locator('a.edmn-cta').all()) expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The artwork is decorative (alt=""); the protection message is real, visible HTML at every size.
    const img = hero.locator('picture img');
    await expect(img).toHaveAttribute('alt', '');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(hero.getByText('المبلغ محمي لدى اضمن').filter({ visible: true })).toHaveCount(1);
    await expect(hero.getByText('تحويل المبلغ للبائع بعد التأكيد').filter({ visible: true })).toHaveCount(1);
    await expect(hero.getByText('دفع آمن', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    // Only the crop for this viewport is downloaded (desktop/tablet ≥640px, phone crop below).
    expect(heroAssets.length).toBeGreaterThan(0);
    expect(heroAssets.every((a) => (width >= 640 ? /^hero-visual-\d+\./ : /^hero-visual-m-/).test(a))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.context().close();
  });
}
