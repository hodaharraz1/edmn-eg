import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminLogin, customerLogin, q } from './helpers';

/**
 * Release-candidate layout and accessibility baseline across the three surfaces:
 * no horizontal page scrolling at 360–1440px, and no serious/critical axe (WCAG 2 A/AA) violations.
 */
const WIDTHS = [360, 375, 390, 430, 768, 1024, 1440];

async function pageFor(browser: Browser, role: string): Promise<Page> {
  if (role === 'admin') return adminLogin(browser);
  if (role === 'anon') return (await browser.newContext({ locale: 'ar-EG' })).newPage();
  return customerLogin(browser, `${role}@demo.edmn.local`);
}

async function noHorizontalScroll(page: Page, label: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `${label} scrolls horizontally`).toBeLessThanOrEqual(r.cw + 1);
}

async function axeClean(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')}`);
  expect(bad, `${label} accessibility`).toEqual([]);
}

test('customer, seller and admin surfaces: responsive at 7 widths + accessibility baseline', async ({ browser }) => {
  test.setTimeout(900_000);
  const [prod] = await q<{ slug: string }>(`select slug from products where status = 'LIVE' order by created_at limit 1`);
  const [store] = await q<{ slug: string }>(`select st.slug from stores st join sellers s on s.id = st.seller_id where s.status = 'APPROVED' limit 1`);
  const [order] = await q<{ id: string }>(`select o.id from orders o join users u on u.id = o.customer_id where u.email = 'ahmed@demo.edmn.local' order by o.created_at limit 1`);
  const [agreedDeal] = await q<{ id: string }>(`select d.id from external_deals d join users u on u.id = d.buyer_id where u.email = 'ahmed@demo.edmn.local' and d.agreed_terms is not null order by d.created_at limit 1`);
  const [invitedDeal] = await q<{ id: string }>(`select d.id from external_deals d join users u on u.id = d.buyer_id where u.email = 'mona@demo.edmn.local' and d.status = 'INVITED' limit 1`);
  const pages: [string, string][] = [
    ['anon', '/'],
    ['anon', `/search?q=${encodeURIComponent('سامسونج')}`],
    ['anon', '/categories'],
    ['anon', `/product/${encodeURIComponent(prod.slug)}`],
    ['anon', `/store/${encodeURIComponent(store.slug)}`],
    ['anon', '/protected-deal'],
    ['anon', '/seller/login'],
    ['anon', '/seller/register'],
    ['anon', '/admin/login'],
    ['ahmed', '/cart'],
    ['ahmed', '/checkout'],
    ['ahmed', '/account'],
    ['ahmed', `/account/orders/${order.id}`],
    ['ahmed', '/account/deals/new'],
    ['ahmed', `/account/deals/${agreedDeal.id}`],
    ['mona', `/account/deals/${invitedDeal.id}`],
    ['anon', `/deal/invite/${'x'.repeat(43)}`],
    ['techzone', '/seller'],
    ['techzone', '/seller/products'],
    ['techzone', '/seller/orders'],
    ['techzone', '/seller/withdrawals'],
    ['admin', '/admin'],
    ['admin', '/admin/approvals'],
    ['admin', '/admin/payments'],
    ['admin', '/admin/withdrawals'],
    ['admin', '/admin/orders'],
  ];
  const sessions: Record<string, Page> = {};
  for (const [role, path] of pages) {
    sessions[role] ??= await pageFor(browser, role);
    const page = sessions[role];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const res = await page.goto(path);
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      await page.waitForLoadState('networkidle');
      await noHorizontalScroll(page, `${role} ${path} @${width}`);
      if (width === 390 || width === 1440) await axeClean(page, `${role} ${path} @${width}`);
    }
  }
});
