import { expect, test } from '@playwright/test';

test.describe('storefront (Arabic RTL)', () => {
  for (const vp of [{ name: 'desktop', width: 1366, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    test(`home, search and product pages render without horizontal scroll — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(1);
      await page.goto('/search?q=' + encodeURIComponent('سامسونج'));
      const first = page.locator('a[href^="/product/"]').first();
      await expect(first).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(1);
      await first.click();
      await page.waitForURL(/\/product\//);
      await expect(page.getByRole('button', { name: /ضيف للسلة/ })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(1);
    });
  }

  test('Arabic typo-tolerant search finds products', async ({ page }) => {
    await page.goto('/search?q=' + encodeURIComponent('سامسنج'));
    await expect(page.locator('a[href^="/product/"]').first()).toBeVisible();
  });

  test('legal pages show the approved version with full text and no draft notice', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { name: /التعريفات/ })).toBeVisible();
    await expect(page.getByText('info@edmneg.com').first()).toBeVisible();
    await expect(page.getByText('نص غير نهائي')).toHaveCount(0);
  });

  test('used product shows its condition', async ({ page }) => {
    await page.goto('/search?condition=USED');
    await page.locator('a[href^="/product/"]').first().click();
    await expect(page.locator('#main').getByText(/مستعمل/).first()).toBeVisible();
  });
});

test('signed-in buyer and seller pages fit a 360px phone', async ({ browser }) => {
  const { customerLogin } = await import('./helpers');
  for (const [email, paths] of [
    ['ahmed@demo.edmn.local', ['/account', '/account/orders', '/account/deals/new', '/checkout']],
    ['techzone@demo.edmn.local', ['/seller', '/seller/orders', '/seller/products/new', '/seller/withdrawals']],
  ] as const) {
    const page = await customerLogin(browser, email);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const p of paths) {
      await page.goto(p);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${p} overflows horizontally`).toBeLessThanOrEqual(1);
    }
  }
});
