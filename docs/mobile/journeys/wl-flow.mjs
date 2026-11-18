import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/mobile/screenshots/wishlist';
const BASE = process.env.APP_URL ?? 'http://localhost:8099/';
const DB = process.env.JOURNEY_DB ?? 'postgresql://edmn:edmn@127.0.0.1:55432/edmn_device'; // a LOCAL demo database only
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('journeys write demo data: local databases only');
const sql = (q) => execSync(`psql ${DB} -tAc "${q}"`).toString().trim();
const rows = () => sql("select count(*) from wishlist_items w join users u on u.id=w.user_id where u.email='mona@demo.edmn.local'");
const log = [];
const check = (name, ok, detail) => { const l = `${ok ? "PASS" : "FAIL"} ${name} — ${detail}`; log.push(l); console.log(l); };

(async () => {
  mkdirSync(OUT, { recursive: true });
  sql("delete from wishlist_items where user_id=(select id from users where email='mona@demo.edmn.local')");
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage();
  const apiCalls = [];
  p.on('response', (r) => { if (r.url().includes('/api/v1/wishlist')) apiCalls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  const sem = async () => { await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await p.waitForTimeout(600); };
  const go = async (hash) => { await p.goto(BASE + '#' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500); await sem(); };
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${n}.png` }); };

  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000); await sem();
  try { await p.getByRole('button', { name: 'تخطي' }).first().click(); await p.waitForTimeout(1500); } catch {}
  await go('/sign-in');
  const boxes = p.getByRole('textbox');
  await boxes.nth(0).click(); await p.waitForTimeout(500); await p.keyboard.type('mona@demo.edmn.local', { delay: 25 });
  await boxes.nth(1).click(); await p.waitForTimeout(500); await p.keyboard.type('Demo@12345', { delay: 25 });
  await p.getByRole('button', { name: 'تسجيل الدخول' }).first().click(); await p.waitForTimeout(4500);

  await go('/');
  await shot('w1-home-hearts');
  const hearts = p.getByRole('switch', { name: 'أضف للمفضلة' });
  const n = await hearts.count();
  check('home shows hearts on product cards', n > 0, `${n} hearts`);
  await hearts.first().click(); await p.waitForTimeout(2500); await sem();
  await shot('w2-saved-toast');
  check('UI → API: PUT', apiCalls.some((c) => c.startsWith('PUT /api/v1/wishlist/') && c.endsWith('200')), apiCalls.join(' | '));
  check('API → DB: row created', rows() === '1', `rows=${rows()}`);
  const removeVisible = await p.getByRole('switch', { name: 'شيل من المفضلة' }).count();
  check('heart now shows saved', removeVisible >= 1, `saved hearts=${removeVisible}`);

  await go('/account/wishlist');
  await shot('w3-wishlist-screen');
  const savedSlug = sql("select p.slug from wishlist_items w join products p on p.id=w.product_id join users u on u.id=w.user_id where u.email='mona@demo.edmn.local' limit 1");
  const title = sql(`select title_ar from products where slug='${savedSlug}'`);
  // Flutter web paints text on a canvas: read the accessibility tree instead of page text.
  const body = await p.evaluate(() => [...document.querySelectorAll('flt-semantics')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.textContent ?? ''}`).join(' '));
  check('wishlist screen lists the saved product (from DB)', body.includes(title.slice(0, 12)), `title=${title}`);

  await go(`/products/${savedSlug}`);
  await shot('w4-product-saved');
  await p.getByRole('switch', { name: 'شيل من المفضلة' }).first().click(); await p.waitForTimeout(2500); await sem();
  check('UI → API: DELETE', apiCalls.some((c) => c.startsWith('DELETE /api/v1/wishlist/') && c.endsWith('200')), apiCalls.slice(-2).join(' | '));
  check('API → DB: row removed', rows() === '0', `rows=${rows()}`);

  await go('/account/wishlist');
  await shot('w5-wishlist-empty');
  const emptyText = await p.evaluate(() => document.body.innerText);
  check('empty state after removal', emptyText.includes('المفضلة فاضية'), 'text present');

  // Server refuses a hidden product: hide it while saved → disappears from the list but row stays.
  sql(`insert into wishlist_items(user_id, product_id) select u.id, p.id from users u, products p where u.email='mona@demo.edmn.local' and p.slug='${savedSlug}' on conflict do nothing`);
  sql(`update products set status='SUSPENDED' where slug='${savedSlug}'`);
  await go('/account/wishlist');
  const hiddenText = await p.evaluate(() => document.body.innerText);
  check('hidden product not listed (row kept)', hiddenText.includes('المفضلة فاضية') && rows() === '1', `rows=${rows()}`);
  sql(`update products set status='LIVE' where slug='${savedSlug}'`);
  sql("delete from wishlist_items where user_id=(select id from users where email='mona@demo.edmn.local')");

  await b.close();
})();
