import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, q } from './helpers';

/** Final QA / security review fix batch: one regression per finding. */

test('P1 variant switching: price, availability and specifications always describe the selected variant (A → B → A)', async ({ page }) => {
  // A live product with two in-stock variants that differ on a variant-defining attribute (storage).
  // Specs show the attribute option's Arabic label (e.g. 256GB → «256 جيجا»), exactly like the storefront.
  const label = (code: string, col: string) =>
    `coalesce((select o.label_ar from attribute_options o join attributes at on at.id = o.attribute_id where at.code = '${code}' and o.value = v.options->>'${code}'), v.options->>'${code}') as ${col}`;
  const rows = await q<{ slug: string; id: string; price: number; storage: string; color: string | null; avail: number }>(`
    select p.slug, v.id, v.price, ${label('storage', 'storage')}, ${label('color', 'color')}, v.stock_on_hand - v.reserved as avail
      from product_variants v join products p on p.id = v.product_id
     where p.status = 'LIVE' and v.is_active and v.options ? 'storage'
       and (select count(distinct v2.options->>'storage') from product_variants v2 where v2.product_id = p.id and v2.is_active) >= 2
     order by p.slug, v.sort_order`);
  test.skip(rows.length < 2, 'no multi-variant product in this dataset');
  const slug = rows[0].slug;
  const [a, b] = rows.filter((r) => r.slug === slug);
  expect(a.storage).not.toBe(b.storage);

  const check = async (v: typeof a) => {
    await expect(page.getByTestId('product-price')).toHaveAttribute('data-variant', v.id);
    await expect(page.getByTestId('product-price')).toContainText(new Intl.NumberFormat('en-US').format(Math.floor(v.price / 100)));
    await expect(page.getByTestId('product-availability')).toHaveAttribute('data-variant', v.id);
    const specs = page.getByTestId('product-specs');
    await expect(specs).toHaveAttribute('data-variant', v.id);
    await expect(specs).toContainText(v.storage);
    if (v.color) await expect(specs).toContainText(v.color);
    const other = v.id === a.id ? b : a;
    await expect(specs).not.toContainText(other.storage);
    if (other.color && other.color !== v.color) await expect(specs).not.toContainText(other.color);
  };

  await page.goto(`/product/${slug}?v=${a.id}`);
  await check(a);
  await page.locator(`a[href$="?v=${b.id}"]`).first().click();
  await page.waitForURL((u) => u.searchParams.get('v') === b.id);
  await check(b);
  await page.locator(`a[href$="?v=${a.id}"]`).first().click();
  await page.waitForURL((u) => u.searchParams.get('v') === a.id);
  await check(a);
});

test('P1 CSP: every page surface gets a fresh per-request nonce, no unsafe-inline scripts, strict base directives', async ({ request }) => {
  const paths = ['/', '/search', '/cart', '/checkout', '/login', '/register', '/protected-deal', '/account', '/seller', '/seller/login', '/admin/login'];
  const seen = new Set<string>();
  for (const path of paths) {
    const res = await request.get(path, { maxRedirects: 0 });
    const csp = res.headers()['content-security-policy'] ?? '';
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc, path).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'$/);
    expect(scriptSrc, path).not.toContain("'unsafe-inline'");
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'", "connect-src 'self'", "font-src 'self'"]) expect(csp, `${path}: ${d}`).toContain(d);
    expect(csp, path).not.toMatch(/googleapis|gstatic|\*/);
    const nonce = scriptSrc.match(/nonce-([^']+)/)![1];
    expect(seen.has(nonce), `${path}: nonce must be fresh per request`).toBe(false);
    seen.add(nonce);
  }
});

test('P1 CSP: core journeys render, hydrate and stay interactive with zero CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));
  await page.goto('/');
  // Hydration: a client component reacts (category menu opens).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('category-menu-trigger').click();
  await expect(page.getByTestId('category-menu-panel')).toBeVisible();
  for (const path of ['/search', '/protected-deal', '/login', '/cart', '/stores']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  const product = (await q<{ slug: string }>(`select slug from products where status = 'LIVE' order by created_at limit 1`))[0];
  if (product) {
    await page.goto(`/product/${product.slug}`);
    await expect(page.getByRole('button', { name: /ضيف للسلة|أضف إلى السلة/ }).first()).toBeEnabled();
  }
  expect(violations).toEqual([]);
});

test.describe('P1/P2 post-login return to the intended destination', () => {
  const login = async (page: import('@playwright/test').Page, email = 'ahmed@demo.edmn.local') => {
    await page.fill('input[name=identifier]', email);
    await page.fill('input[name=password]', DEMO_PASSWORD);
    await page.locator('form button[type=submit]').first().click();
  };

  test('Protected Deal CTA → login → back to the new Protected Deal flow', async ({ page }) => {
    await page.goto('/protected-deal');
    await page.getByRole('link', { name: 'أنشئ صفقة ضمان' }).first().click();
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/account/deals/new');
    await login(page);
    await page.waitForURL((u) => u.pathname === '/account/deals/new');
    await expect(page.getByRole('heading', { name: 'اضمن صفقة خارج السوق' })).toBeVisible();
  });

  test('My Orders → login → back to My Orders (query string kept)', async ({ page }) => {
    await page.goto('/account/orders?x=1');
    await page.waitForURL(/\/login\?/);
    await login(page);
    await page.waitForURL((u) => u.pathname === '/account/orders' && u.searchParams.get('x') === '1');
  });

  // One real login per hostile value (alternating ?next= / ?returnTo=) keeps the suite well under the server-side
  // per-identifier login rate limit; every value × param combination is covered by tests/unit/safe-next.test.ts.
  const evils = ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/%2F%2Fevil.example'];
  evils.forEach((evil, i) => {
    const param = i % 2 ? 'returnTo' : 'next';
    test(`open redirect is refused: ${param}=${evil}`, async ({ page }) => {
      await page.goto(`/login?${param}=${encodeURIComponent(evil)}`);
      const origin = new URL(page.url()).origin;
      await login(page, 'mona@demo.edmn.local');
      await page.waitForURL((u) => u.pathname !== '/login', { timeout: 15_000 });
      expect(new URL(page.url()).origin, `${param}=${evil}`).toBe(origin);
    });
  });

  test('a forged x-edmn-path request header is ignored (proxy overwrites it)', async ({ browser }) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-edmn-path': '//evil.example' } });
    const page = await ctx.newPage();
    await page.goto('/account/orders');
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/account/orders');
    await ctx.close();
  });
});

test('P2 search facets: brand counts describe the current results, never the whole catalog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const total = async () => Number(await page.getByTestId('result-count').getAttribute('data-count'));
  const facets = async () =>
    Promise.all((await page.locator('aside [data-testid="brand-facet"]').all()).map(async (l) => ({ id: (await l.getAttribute('data-brand'))!, count: Number(await l.getAttribute('data-count')) })));

  // Zero results: no brand may show a non-zero count.
  await page.goto('/search?q=' + encodeURIComponent('zzqxv-لا-يوجد-منتج-كده'));
  expect(await total()).toBe(0);
  expect((await facets()).filter((f) => f.count > 0)).toEqual([]);

  // A query: every brand count equals the results you get by selecting that brand (with the same query).
  const query = 'سامسونج';
  await page.goto('/search?q=' + encodeURIComponent(query));
  const all = await total();
  const fs = await facets();
  expect(fs.length).toBeGreaterThan(0);
  expect(fs.reduce((a, f) => a + f.count, 0)).toBeLessThanOrEqual(all);
  for (const f of fs.slice(0, 3)) {
    await page.goto(`/search?q=${encodeURIComponent(query)}&brand=${f.id}`);
    expect(await total(), `brand ${f.id}`).toBe(f.count);
    // Disjunctive: the selected brand still lists its own count and stays tickable.
    const self = (await facets()).find((x) => x.id === f.id);
    expect(self?.count).toBe(f.count);
  }

  // Query + another filter (condition) narrows the counts consistently; clearing restores them.
  await page.goto(`/search?q=${encodeURIComponent(query)}&condition=USED`);
  const usedTotal = await total();
  const usedFacets = await facets();
  expect(usedFacets.reduce((a, f) => a + f.count, 0)).toBeLessThanOrEqual(usedTotal);
  for (const f of usedFacets) expect(f.count).toBeLessThanOrEqual(fs.find((x) => x.id === f.id)?.count ?? f.count);
  await page.goto('/search?q=' + encodeURIComponent(query));
  expect(await total()).toBe(all);
});

test('P2 guest support: a visitor who cannot sign in reaches official support without logging in', async ({ page }) => {
  await page.context().clearCookies();
  for (const start of ['/login', '/seller/login']) {
    await page.goto(start);
    await page.getByTestId('login-help').click();
    await page.waitForURL((u) => u.pathname === '/contact' && u.hash === '#cant-sign-in');
    const box = page.getByTestId('guest-support');
    await expect(box).toBeVisible();
    // Official address (settings value when configured, otherwise the company's official email) — never a login wall.
    const mail = page.getByTestId('guest-support-email');
    await expect(mail).toHaveAttribute('href', /^mailto:[^@\s]+@[^@\s]+\.[a-z]+\?subject=/i);
    await expect(box).toContainText('متبعتش كلمة المرور');
    await expect(box.getByRole('link', { name: 'استعادة كلمة المرور' })).toHaveAttribute('href', '/forgot-password');
  }
  await page.goto('/forgot-password');
  await expect(page.getByRole('link', { name: 'كلّم الدعم' })).toHaveAttribute('href', '/contact#cant-sign-in');
});
