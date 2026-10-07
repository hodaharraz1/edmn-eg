import { expect, test, type Page } from '@playwright/test';
import { adminLogin, customerLogin } from './helpers';

/**
 * Fee engine surfaces: Admin pricing & fees center, simulator, profitability, payout costs, refund
 * fee policy (read-only checks — nothing is published here), and the seller statement. Responsive at
 * mobile / tablet / desktop with Arabic RTL and no horizontal page scroll.
 */
test.describe.configure({ mode: 'serial' });

const WIDTHS = [390, 768, 1440];

async function noHorizontalScroll(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, dir: document.documentElement.dir }));
  expect(r.dir).toBe('rtl');
  expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
}

test('admin pricing center: active versions, owner-approved tiers, examples and governance (3 widths)', async ({ browser }) => {
  const page = await adminLogin(browser);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/finance/pricing');
    await expect(page.getByTestId('overview-MARKETPLACE')).toContainText('الإصدار الساري');
    await expect(page.getByTestId('overview-PROTECTED_DEAL')).toContainText('الإصدار الساري');
    await noHorizontalScroll(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/finance/pricing/marketplace');
  await expect(page.getByTestId('pricing-versions')).toContainText('ساري');
  await expect(page.getByTestId('tiers-STANDARD')).toContainText('12%');
  await expect(page.getByTestId('tiers-LOW_MARGIN')).toContainText('6.5%');
  await expect(page.getByTestId('tiers-HIGH_MARGIN')).toContainText('12.5%');
  await expect(page.getByTestId('pricing-examples')).toContainText('1,100');
  await expect(page.getByTestId('expected-margin')).toBeVisible();
  // The active version is read-only (no tier inputs).
  await expect(page.locator('input[name^="t__"]')).toHaveCount(0);
  await page.goto('/admin/finance/pricing/protected-deals');
  await expect(page.getByTestId('tiers-DEAL')).toContainText('8%');
  await expect(page.getByTestId('pricing-examples')).toContainText('2,600');
});

test('simulator, payout costs, refund fee policy and profitability render (3 widths)', async ({ browser }) => {
  const page = await adminLogin(browser);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/finance/pricing/simulator?model=MARKETPLACE&cls=STANDARD&amount=10000&shipping=75&channel=INSTAPAY');
    await expect(page.getByTestId('sim-result')).toContainText('1,100');
    await expect(page.getByTestId('sim-batch')).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto('/admin/finance/pricing/payout-costs');
    await expect(page.getByTestId('channel-INSTAPAY')).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto('/admin/finance/pricing/refund-policy');
    await expect(page.getByText('LEGAL REVIEW REQUIRED').first()).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto('/admin/finance/profitability');
    await expect(page.getByTestId('profit-kpis')).toContainText('صافي المساهمة');
    await noHorizontalScroll(page);
  }
  await page.goto('/admin/finance/pricing/simulator?model=PROTECTED_DEAL&amount=50000&shipping=0');
  await expect(page.getByTestId('sim-result')).toContainText('2,600');
});

test('seller statement and withdrawal transfer-cost preview render (mobile + desktop)', async ({ browser }) => {
  const page = await customerLogin(browser, 'techzone@demo.edmn.local');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/seller/finance');
    await expect(page.getByRole('heading', { name: 'كشف الحساب' })).toBeVisible();
    await expect(page.getByText('رسوم خدمة اضمن').first()).toBeVisible();
    await noHorizontalScroll(page);
  }
});
