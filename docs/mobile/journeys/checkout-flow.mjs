// Buyer release path, UI → API → DB on the Flutter web build against the LOCAL server (edmn_device, Real Money OFF):
// cart → checkout (address, delivery, payment method, confirm) → order placed → payment instructions → receipt upload.
// Each step asserts the HTTP call the UI made AND the row it produced. No real money: payments are test transfers.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
const OUT = process.env.OUT ?? 'docs/mobile/screenshots/checkout';
const BASE = process.env.APP_URL ?? 'http://localhost:8099/';
const DB = process.env.JOURNEY_DB ?? 'postgresql://edmn:edmn@127.0.0.1:55432/edmn_device'; // a LOCAL demo database only
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('journeys write demo data: local databases only');
const sql = (q) => execSync(`psql ${DB} -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const results = [];
const check = (name, ok, detail) => { const l = `${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`; results.push(l); console.log(l); };
const EMAIL = process.env.JOURNEY_USER ?? 'omar@demo.edmn.local';

(async () => {
  mkdirSync(OUT, { recursive: true });
  // A real (tiny) JPEG receipt: the server sniffs content and re-validates it.
  const receipt = `${OUT}/receipt.jpg`;
  writeFileSync(receipt, await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0d6b5e' } }).jpeg().toBuffer());

  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage();
  const calls = [];
  p.on('response', (r) => { if (r.url().includes('/api/v1/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  const sem = async () => { await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await p.waitForTimeout(600); };
  const go = async (hash) => { await p.goto(BASE + '#' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500); await sem(); };
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${n}.png` }); };
  const type = async (loc, text) => { await loc.click(); await p.waitForTimeout(500); await p.keyboard.type(text, { delay: 25 }); };
  const tap = async (name) => { await p.getByRole('button', { name }).last().click(); await p.waitForTimeout(3000); await sem(); };
  try {
    await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000); await sem();
    try { await p.getByRole('button', { name: 'تخطي' }).first().click(); await p.waitForTimeout(1500); } catch {}
    await go('/sign-in');
    await type(p.getByRole('textbox').nth(0), EMAIL);
    await type(p.getByRole('textbox').nth(1), 'Demo@12345');
    await tap('تسجيل الدخول'); await p.waitForTimeout(1500);
    check('sign-in', calls.some((c) => c.startsWith('POST /api/v1/auth/login 200')), calls.join(' | '));
    const uid = sql(`select id from users where email='${EMAIL}'`);

    // 1. Cart: add a product from the product page.
    await go('/products/' + encodeURIComponent(sql("select slug from products where title_ar like 'سامسونج%' limit 1")));
    await tap('أضف إلى السلة');
    check('cart: UI → POST /cart/items', calls.some((c) => /POST \/api\/v1\/cart\/items 20\d/.test(c)), calls.slice(-1).join(''));

    // 2. Checkout: four steps, then place the order.
    const ordersBefore = Number(sql(`select count(*) from orders where customer_id='${uid}'`));
    await go('/checkout'); await shot('c1-address');
    await tap('متابعة'); await shot('c2-delivery');
    await tap('متابعة'); await shot('c3-payment');
    // No method is preselected: the buyer must choose one (Continue stays disabled until then).
    await p.getByRole('radio', { name: /إنستاباي/ }).first().click(); await p.waitForTimeout(800); await sem();
    await tap('متابعة'); await shot('c4-confirm');
    await tap('تأكيد الطلب'); await p.waitForTimeout(2500); await shot('c5-order-placed');
    const ordersAfter = Number(sql(`select count(*) from orders where customer_id='${uid}'`));
    check('checkout: UI → POST /orders', calls.some((c) => /POST \/api\/v1\/orders 20\d/.test(c)), calls.filter((c) => c.includes('/orders')).join(' | '));
    check('checkout: exactly one new order row', ordersAfter === ordersBefore + 1, `${ordersBefore} → ${ordersAfter}`);
    const order = sql(`select id || '|' || status || '|' || grand_total from orders where customer_id='${uid}' order by placed_at desc limit 1`).split('|');
    check('checkout: order awaits payment, total from the server in piastres', order[1] === 'PENDING_PAYMENT' && Number.isInteger(Number(order[2])), `status=${order[1]} total=${order[2]}`);
    check('checkout: cart emptied', sql(`select count(*) from cart_items ci join carts c on c.id=ci.cart_id where c.user_id='${uid}'`) === '0', 'cart items=0');

    // 3. Payment instructions → receipt upload (test transfer only).
    const payment = sql(`select id from payments where order_id='${order[0]}' order by created_at desc limit 1`);
    const amount = (Number(order[2]) / 100).toString();
    await go(`/payments/${payment}`); await shot('c6-payment-instructions');
    const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), p.getByRole('button', { name: /للإيصال/ }).first().click()]);
    await chooser.setFiles(receipt); await p.waitForTimeout(1500); await sem();
    await sem();
    await type(p.getByRole('textbox', { name: /المبلغ/ }).first(), amount);
    await shot('c7-receipt-filled');
    await tap('إرسال الإيصال للمراجعة'); await p.waitForTimeout(2000); await shot('c8-receipt-submitted');
    check('payment: UI → POST /payments/{id}/proof', calls.some((c) => /POST \/api\/v1\/payments\/.+\/proof 20\d/.test(c)), calls.slice(-1).join(''));
    const sub = sql(`select count(*) from payment_submissions where payment_id='${payment}'`);
    const status = sql(`select status from payments where id='${payment}'`);
    check('payment: one submission row, payment awaits staff review (no money moved)', sub === '1' && status === 'PAYMENT_SUBMITTED', `submissions=${sub} status=${status}`);
    const file = sql(`select f.scan_status || '|' || f.visibility from payment_submissions s join files f on f.id = s.proof_file_id where s.payment_id='${payment}'`);
    check('payment: receipt stored PRIVATE', file.endsWith('|PRIVATE'), `scan|visibility=${file}`);
  } catch (e) {
    check('journey error', false, String(e).split('\n')[0]); await shot('error');
  }
  await b.close();
  writeFileSync(`${OUT}/results.txt`, results.join('\n') + '\n');
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
