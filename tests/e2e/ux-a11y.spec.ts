import { expect, test } from '@playwright/test';

/**
 * UX-02: core screens at 360px width and on a tablet viewport, plus the offline banner and 48px touch targets.
 * لم يتم التحقق: لم تعمل هنا. التشغيل محليًا: `npm run test:e2e -- tests/e2e/ux-a11y.spec.ts`
 */
const PAGES = ['/', '/stores', '/used', '/protected-deal'];

for (const path of PAGES) {
  test(`360px: ${path} renders with a main landmark and no horizontal scroll`, async ({ browser }) => {
    const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test(`tablet 768px: ${path} renders with no horizontal scroll`, async ({ browser }) => {
    const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true })).newPage();
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('accessibility basics: skip link, single h1, html lang/dir, images carry alt', async ({ browser }) => {
  const page = await (await browser.newContext({ locale: 'ar-EG', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })).newPage();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'تخطَّ إلى المحتوى' })).toBeAttached();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const missingAlt = await page.locator('main img:not([alt])').count();
  expect(missingAlt).toBe(0);
});

test('coarse pointer: header controls and primary CTAs are at least 48px tall', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ar-EG', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  // The globals.css @media (pointer: coarse) rule enforces min-height 48px on controls.
  for (const target of await page.locator('header button, header a[href], main a[role="button"], main button').all()) {
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    if (!box) continue;
    expect(box.height, `touch target too small: ${(await target.textContent())?.trim().slice(0, 30)}`).toBeGreaterThanOrEqual(48);
  }
});

test('offline: a clear banner appears and the page recovers when the connection returns', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ar-EG', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  await context.setOffline(true);
  await expect(page.getByRole('alert')).toContainText('الاتصال بالإنترنت انقطع');
  await context.setOffline(false);
  await expect(page.getByRole('alert')).toBeHidden();
});
