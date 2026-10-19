import { expect, test } from '@playwright/test';
import { customerLogin, q } from './helpers';

test('admin console requires a staff session', async ({ page }) => {
  await page.goto('/admin/payments');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('a customer session is not an admin session', async ({ browser }) => {
  const page = await customerLogin(browser, 'mona@demo.edmn.local');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('private files are not public', async ({ request, browser }) => {
  const [f] = await q<{ id: string }>(`select id from files where visibility = 'PRIVATE' limit 1`);
  expect(f).toBeTruthy();
  const anon = await request.get(`/api/files/${f.id}`);
  expect([401, 403, 404]).toContain(anon.status());
  // A different customer cannot read someone else's payment proof.
  const [proof] = await q<{ id: string; email: string }>(`select s.proof_file_id id, u.email from payment_submissions s join payments p on p.id = s.payment_id join users u on u.id = p.payer_user_id where u.email <> 'omar@demo.edmn.local' limit 1`);
  const page = await customerLogin(browser, 'omar@demo.edmn.local');
  const res = await page.request.get(`/api/files/${proof.id}`);
  expect([403, 404]).toContain(res.status());
});

test('customers cannot open other customers’ orders', async ({ browser }) => {
  const [o] = await q<{ id: string; number: string }>(`select o.id, o.number from orders o join users u on u.id = o.customer_id where u.email = 'ahmed@demo.edmn.local' limit 1`);
  const page = await customerLogin(browser, 'omar@demo.edmn.local');
  await page.goto(`/account/orders/${o.id}`);
  // Streaming pages render the not-found view (same response as a non-existent id → no existence leak).
  await expect(page.getByRole('heading', { name: /مش موجود/ })).toBeVisible();
  await expect(page.getByText(`#${o.number}`)).toHaveCount(0);
});

test('sellers cannot open other sellers’ orders', async ({ browser }) => {
  const [so] = await q<{ id: string }>(`select so.id from seller_orders so join stores s on s.seller_id = so.seller_id where s.slug <> 'تك-زون' limit 1`);
  test.skip(!so, 'no order for another seller in demo data');
  const page = await customerLogin(browser, 'techzone@demo.edmn.local');
  await page.goto(`/seller/orders/${so.id}`);
  await expect(page.getByRole('heading', { name: /مش موجود/ })).toBeVisible();
});

test('security headers are present', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['referrer-policy']).toBeTruthy();
});

test('re-login revokes the previously presented session token (no stale session survives a new sign-in)', async ({ browser }) => {
  const { DEMO_PASSWORD } = await import('./helpers');
  // Two tabs of the same browser both show the sign-in form; the user signs in from both (realistic re-login).
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const tab1 = await ctx.newPage();
  const tab2 = await ctx.newPage();
  for (const t of [tab1, tab2]) {
    await t.goto('/login');
    await t.waitForLoadState('networkidle');
  }
  const submit = async (t: import('@playwright/test').Page) => {
    await t.fill('input[name=identifier]', 'omar@demo.edmn.local');
    await t.fill('input[name=password]', DEMO_PASSWORD);
    await t.locator('form button[type=submit]').first().click();
    await t.waitForURL((u) => u.pathname !== '/login');
  };
  await submit(tab1);
  const first = (await ctx.cookies()).find((c) => c.name === 'edmn_sid')!;
  expect(first?.value).toBeTruthy();
  await submit(tab2);
  const second = (await ctx.cookies()).find((c) => c.name === 'edmn_sid')!;
  expect(second.value).not.toBe(first.value);
  // The previously issued token no longer authenticates anywhere.
  const stale = await browser.newContext({ locale: 'ar-EG' });
  await stale.addCookies([{ ...first }]);
  const sp = await stale.newPage();
  await sp.goto('/account');
  await sp.waitForURL(/\/login/);
  // The new one does.
  await tab1.goto('/account');
  expect(new URL(tab1.url()).pathname).toBe('/account');
  await stale.close();
  await ctx.close();
});
