import { expect, test } from '@playwright/test';

/** Homepage (approved reference design): sections in order, header, search routing, cart CTA, Egyptian identity. */
test('desktop homepage: header, hero, sections in the approved order, search routing, add to cart', async ({ browser }) => {
  const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText('اشتري وبيع بأمان');
  await expect(page.locator('h1')).toContainText('تحمي كل صفقة');

  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' });
  for (const href of ['/', '/stores', '/protected-deal', '/sell', '/contact']) await expect(nav.locator(`a[href="${href}"]`)).toBeVisible();
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
