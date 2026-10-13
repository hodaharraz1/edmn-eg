import { writeFileSync } from 'node:fs';
import { test, type Browser, type Page } from '@playwright/test';
import { adminLogin, customerLogin } from './helpers';

/**
 * AUDIT CRAWLER (not part of the regression suite; run explicitly, READ-ONLY GET navigation only).
 * BFS over same-origin links per role; for each route pattern: HTTP status, console/page errors, horizontal
 * overflow at 1440 / 1024 / 390 / 360 with the offending elements.
 */
test.setTimeout(3 * 60 * 60_000);
const OUT = process.env.CRAWL_OUT ?? 'crawl.json';
const WIDTHS = [1440, 1024, 390, 360];
const SKIP = /^\/(api|media|_next)\/|\/logout|\/sign-?out|download|\.(png|jpe?g|webp|pdf|xml|txt|ico)$/i;

const pattern = (p: string) =>
  p
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/^\/(product|store|category|brand|pages|legal|deal-invite|deal\/invite)\/[^/]+/, '/$1/:slug');

interface Result { role: string; url: string; pattern: string; status: number | null; errors: string[]; overflow: Record<number, string[]> }

async function audit(page: Page, url: string, role: string): Promise<{ r: Result; links: string[] }> {
  const errors: string[] = [];
  const onErr = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 160)}`);
  const onCon = (m: import('@playwright/test').ConsoleMessage) => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 40[134]/.test(m.text())) errors.push(`console: ${m.text().slice(0, 160)}`); };
  page.on('pageerror', onErr);
  page.on('console', onCon);
  const overflow: Record<number, string[]> = {};
  let status: number | null = null;
  let links: string[] = [];
  try {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
      if (w === WIDTHS[0]) status = resp?.status() ?? null;
      await page.waitForTimeout(250);
      const off = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= vw + 1) return [];
        const bad: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width === 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
          let p: HTMLElement | null = el.parentElement;
          let clipped = false;
          while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
          if (clipped) continue;
          const e = el as HTMLElement;
          bad.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(/\s+/).slice(0, 3).join('.') : ''} [${Math.round(r.left)},${Math.round(r.right)}] "${(e.innerText || '').slice(0, 40).replace(/\s+/g, ' ')}"`);
          if (bad.length >= 4) break;
        }
        return bad.length ? bad : [`scrollWidth ${document.documentElement.scrollWidth} > ${vw}`];
      });
      if (off.length) overflow[w] = off;
      if (w === WIDTHS[0]) {
        links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href));
      }
    }
  } catch (e) {
    errors.push(`navigation: ${(e as Error).message.slice(0, 160)}`);
  }
  page.off('pageerror', onErr);
  page.off('console', onCon);
  return { r: { role, url, pattern: pattern(new URL(url).pathname), status, errors, overflow }, links };
}

async function crawl(page: Page, role: string, seeds: string[], allow: (p: string) => boolean, results: Result[], linkStatus: Map<string, number>) {
  const origin = new URL(page.url()).origin;
  const seen = new Map<string, number>();
  const queue = seeds.map((s) => origin + s);
  const visited = new Set<string>();
  let n = 0;
  while (queue.length && n < 260) {
    const url = queue.shift()!.split('#')[0];
    const u = new URL(url);
    if (u.origin !== origin || visited.has(u.pathname + u.search) || SKIP.test(u.pathname) || !allow(u.pathname)) continue;
    const pat = pattern(u.pathname) + (u.search ? '?' : '');
    if ((seen.get(pat) ?? 0) >= (u.search ? 1 : 2)) continue;
    seen.set(pat, (seen.get(pat) ?? 0) + 1);
    visited.add(u.pathname + u.search);
    n++;
    const { r, links } = await audit(page, url, role);
    results.push(r);
    for (const l of links) {
      const lu = new URL(l);
      if (lu.origin !== origin || SKIP.test(lu.pathname)) continue;
      const key = lu.pathname;
      if (!linkStatus.has(key)) {
        const res = await page.request.get(lu.origin + key, { maxRedirects: 0 }).catch(() => null);
        linkStatus.set(key, res?.status() ?? 0);
      }
      queue.push(l);
    }
  }
}

test('audit crawl', async ({ browser }: { browser: Browser }) => {
  const results: Result[] = [];
  const linkStatus = new Map<string, number>();
  // Anonymous visitor
  const anonCtx = await browser.newContext({ locale: 'ar-EG' });
  const anon = await anonCtx.newPage();
  await anon.goto('/');
  await crawl(anon, 'anonymous', ['/', '/categories', '/stores', '/deals', '/protected-deal', '/sell', '/legal', '/search?q=هاتف', '/best-sellers', '/login', '/register', '/forgot-password', '/seller/login', '/seller/register', '/admin/login', '/cart'], (p) => !p.startsWith('/admin/') || p === '/admin/login', results, linkStatus);
  await anonCtx.close();
  // Customer
  const cust = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await crawl(cust, 'customer', ['/account', '/account/orders', '/account/deals', '/account/deals/new', '/account/disputes', '/account/returns', '/account/messages', '/account/notifications', '/account/notifications/settings', '/account/support', '/account/support/new', '/account/identity', '/account/receiving', '/account/earnings', '/account/payments', '/account/profile', '/account/addresses', '/account/security', '/account/wishlist', '/account/reviews', '/cart', '/checkout'], (p) => p.startsWith('/account') || p === '/cart' || p === '/checkout', results, linkStatus);
  await cust.context().close();
  // Seller
  const sel = await customerLogin(browser, 'techzone@demo.edmn.local');
  await crawl(sel, 'seller', ['/seller', '/seller/orders', '/seller/products', '/seller/products/new', '/seller/inventory', '/seller/returns', '/seller/messages', '/seller/notifications', '/seller/reviews', '/seller/finance', '/seller/balance', '/seller/withdrawals', '/seller/shipping', '/seller/store', '/seller/settings', '/seller/support', '/seller/health', '/seller/analytics', '/account/earnings'], (p) => p.startsWith('/seller') || p.startsWith('/account/earnings'), results, linkStatus);
  await sel.context().close();
  // Admin (SUPER_ADMIN)
  const adm = await adminLogin(browser);
  const navHrefs = await adm.evaluate(() => Array.from(document.querySelectorAll('nav a[href^="/admin"]')).map((a) => a.getAttribute('href')!));
  await crawl(adm, 'admin', ['/admin', ...navHrefs], (p) => p.startsWith('/admin') && !/\/admin\/(login|2fa|step-up)/.test(p), results, linkStatus);
  writeFileSync(OUT, JSON.stringify({ results, links: Object.fromEntries(linkStatus) }, null, 1));
});
