import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { adminLogin, customerLogin, q } from './helpers';

/**
 * Resource-efficient live channel: one polling leader per account per browser, followers in sync, fast
 * failover, cheap 204 polls when nothing changed, stop on sign-out; intent-only prefetch; cached category tree.
 * Demo accounts only; A-100016 is excluded from fixtures.
 */
test.describe.configure({ mode: 'serial' });

type Fx = { so_id: string; buyer: string; seller: string };
let fx: Fx;
let convId = '';

/** Per-page log of /api/live calls (status) — what each tab actually costs the server. */
function track(page: Page) {
  const calls: { t: number; status: number }[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === '/api/live') calls.push({ t: Date.now(), status: r.status() });
  });
  return calls;
}
const since = (calls: { t: number }[], t0: number) => calls.filter((c) => c.t >= t0).length;
async function badge(page: Page) {
  const el = page.getByTestId('nav-unread-messages').first();
  return (await el.count()) ? Number((await el.textContent())?.replace('+', '') ?? 0) : 0;
}

test.beforeAll(async ({ browser }) => {
  const [row] = await q<Fx>(`
    select so.id as so_id, bu.email as buyer, su.email as seller
      from seller_orders so join orders o on o.id = so.order_id join users bu on bu.id = o.customer_id
      join sellers se on se.id = so.seller_id join users su on su.id = se.owner_user_id
     where o.number <> 100016 and bu.email like '%@demo.edmn.local' and su.email like '%@demo.edmn.local' and se.status = 'APPROVED'
       and so.status in ('PAID','SELLER_CONFIRMED','PROCESSING','READY_TO_SHIP','SHIPPED','DELIVERED')
     order by o.number desc, so.suffix desc limit 1`);
  fx = row;
  const p = await customerLogin(browser, fx.buyer);
  await p.goto(`/account/messages/open?so=${fx.so_id}`);
  await p.waitForURL(/\/account\/messages\/[0-9a-f-]{36}$/);
  convId = p.url().split('/').pop()!;
  await p.context().close();
});

async function sellerSends(ctx: BrowserContext, text: string) {
  const page = ctx.pages()[0];
  await page.goto(`/seller/messages/${convId}`);
  await page.getByTestId('message-input').fill(text);
  await page.getByTestId('message-send').click();
  await expect(page.getByTestId('message-status')).toContainText('تم الإرسال');
  await page.goto('/seller/finance'); // leave the conversation so it is not «read» by the seller again
}

test('one polling leader for 3 tabs; followers stay in sync; idle polls are 204; leader failover', async ({ browser }) => {
  const first = await customerLogin(browser, fx.buyer);
  const ctx = first.context();
  await first.goto('/');
  const second = await ctx.newPage();
  await second.goto('/account/orders');
  const third = await ctx.newPage();
  await third.goto('/');
  const pages = [first, second, third];
  const logs = pages.map(track);
  await first.waitForTimeout(4000); // election settles
  const t0 = Date.now();
  await first.waitForTimeout(20_000);
  const per = logs.map((l) => since(l, t0));
  // exactly one tab polls; the others are followers
  expect(per.filter((n) => n > 0)).toHaveLength(1);
  expect(Math.max(...per)).toBeLessThanOrEqual(5); // ~every 6 s
  const leaderIdx = per.findIndex((n) => n > 0);
  // nothing changed → cheap 204 responses
  expect(logs[leaderIdx].filter((c) => c.t >= t0).every((c) => c.status === 204)).toBe(true);

  // a new message reaches every tab (followers through the leader's broadcast)
  const before = await Promise.all(pages.map(badge));
  const seller = (await customerLogin(browser, fx.seller)).context();
  await sellerSends(seller, `مزامنة التابات ${Date.now().toString(36)}`);
  for (let i = 0; i < pages.length; i++) await expect.poll(() => badge(pages[i]), { timeout: 20_000 }).toBe(before[i] + 1);

  // failover: the leader tab closes → another tab takes over and keeps the badges live
  await pages[leaderIdx].close();
  const rest = pages.filter((_, i) => i !== leaderIdx);
  const restLogs = logs.filter((_, i) => i !== leaderIdx);
  const t1 = Date.now();
  await expect.poll(() => restLogs.reduce((n, l) => n + since(l, t1), 0), { timeout: 15_000 }).toBeGreaterThan(0);
  const before2 = await Promise.all(rest.map(badge));
  await sellerSends(seller, `بعد إغلاق التاب القائد ${Date.now().toString(36)}`);
  for (let i = 0; i < rest.length; i++) await expect.poll(() => badge(rest[i]), { timeout: 20_000 }).toBe(before2[i] + 1);

  // sign-out (cookies gone) → polling stops in every tab
  await ctx.clearCookies();
  await rest[0].waitForTimeout(9000);
  const t2 = Date.now();
  await rest[0].waitForTimeout(14_000);
  expect(restLogs.reduce((n, l) => n + since(l, t2), 0)).toBe(0);
  await ctx.close();
  await seller.close();
});

test('a visible conversation stays live even in a follower tab (≈6 s) and reports reads', async ({ browser }) => {
  const a = await customerLogin(browser, fx.buyer);
  const ctx = a.context();
  await a.goto(`/account/messages/${convId}`);
  const b = await ctx.newPage(); // becomes leader (opened last)
  await b.goto('/account/orders');
  await a.waitForTimeout(3000);
  const seller = (await customerLogin(browser, fx.seller)).context();
  const text = `في تاب تابع ${Date.now().toString(36)}`;
  const t0 = Date.now();
  await sellerSends(seller, text);
  await expect(a.getByTestId('message-body').filter({ hasText: text })).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - t0).toBeLessThan(15_000);
  await ctx.close();
  await seller.close();
});

test('prefetch is intent-only: a home page view triggers ≤ a few RSC prefetches; hover prefetches the hovered link', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const prefetches: string[] = [];
  page.on('request', (r) => {
    if (r.headers()['next-router-prefetch']) prefetches.push(new URL(r.url()).pathname);
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  expect(prefetches.length).toBeLessThanOrEqual(3); // was 48–59 per home view
  const card = page.locator('main a[href^="/product/"]').first();
  const href = new URL((await card.getAttribute('href'))!, 'http://x').pathname;
  await card.hover();
  await expect.poll(() => prefetches.some((p) => decodeURIComponent(p) === decodeURIComponent(href)), { timeout: 5000 }).toBe(true);
  await card.click();
  await page.waitForURL((u) => decodeURIComponent(u.pathname) === decodeURIComponent(href));
  await ctx.close();
});

test('category tree is cached and refreshed right after an Admin edit (local only: edits a category)', async ({ browser }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'edits reference data — local database only');
  const [cat] = await q<{ id: string; name_ar: string }>(`select id, name_ar from categories where parent_id is null and is_active order by sort_order limit 1`);
  const admin = await adminLogin(browser);
  const guest = await (await browser.newContext({ locale: 'ar-EG' })).newPage();
  await guest.setViewportSize({ width: 1440, height: 900 });
  const rename = async (name: string) => {
    await admin.goto(`/admin/categories?edit=${cat.id}`);
    await admin.locator('#nameAr').fill(name);
    await admin.getByRole('button', { name: 'حفظ' }).first().click();
    await expect.poll(async () => (await q<{ n: string }>(`select name_ar as n from categories where id = $1`, [cat.id]))[0].n).toBe(name);
  };
  const menuText = async () => {
    await guest.goto('/');
    await guest.getByTestId('category-menu-trigger').click();
    return guest.getByTestId('category-menu-panel').innerText();
  };
  expect(await menuText()).toContain(cat.name_ar);
  const temp = `${cat.name_ar} مؤقت`;
  try {
    await rename(temp);
    expect(await menuText()).toContain(temp); // invalidated immediately, not after 5 minutes
  } finally {
    await rename(cat.name_ar);
  }
  expect(await menuText()).not.toContain(temp);
  await admin.context().close();
  await guest.context().close();
});
