// Seller journeys on the Customer App's Flutter web build against the LOCAL server (edmn_device demo DB, Real Money OFF).
// Buyer and seller act ONLY through the real UI; EDMN staff steps (payment confirmation, approvals, moderation) run through
// staff-step.ts, which calls the same services as the web console. Each step asserts the UI's HTTP call AND the row it
// produced; ledger invariants are checked on the journal.
//   C  buyer purchase → staff confirms payment → seller confirms, prepares, ships with a waybill → buyer confirms receipt
//   E  seller sees the order in earnings and statement; payout request (request only) with idempotent retry
//   D  buyer requests a return → seller sees and answers it → escalation to a dispute
//   B  seller creates a product, uploads a photo, prices it, submits → staff approves → live → stop sales → archive
//   A  a new account: identity → seller application (store, documents, payout account) → staff approval → seller center
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
const OUT = process.env.OUT ?? 'docs/mobile/screenshots/seller';
const BASE = process.env.JOURNEY_APP_URL ?? 'http://localhost:8099/'; // not APP_URL: that names the backend
const DB = process.env.JOURNEY_DB ?? 'postgresql://edmn:edmn@127.0.0.1:55432/edmn_device';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('journeys write demo data: local databases only');
const ONLY = (process.env.JOURNEYS ?? 'C,E,D,B,A').split(',');
const sql = (q) => execSync(`psql ${DB} -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const staff = (cmd, arg) => execSync(`npx tsx docs/mobile/journeys/staff-step.ts ${cmd} ${arg}`, { env: { ...process.env, DATABASE_URL: DB } }).toString().trim().split('\n').pop();
const results = [];
const check = (name, ok, detail) => { const l = `${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`; results.push(l); console.log(l); };
const ledgerBalanced = (sourceIds) => sql(`select coalesce(sum(l.debit) - sum(l.credit), 0) from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id in (${sourceIds.map((s) => `'${s}'`).join(',')})`) === '0';

async function session(b, email, password, fn) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage();
  const calls = [];
  p.on('response', (r) => { if (r.url().includes('/api/v1/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  const sem = async () => { await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await p.waitForTimeout(600); };
  const go = async (hash) => { await p.goto(BASE + '#' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500); await sem(); };
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${n}.png` }); };
  const type = async (loc, text) => { await loc.click(); await p.waitForTimeout(600); await p.keyboard.type(text, { delay: 25 }); };
  const tap = async (name, opts = {}) => { await p.getByRole(opts.role ?? 'button', { name, exact: opts.exact }).last().click(); await p.waitForTimeout(opts.wait ?? 3000); await sem(); };
  const dump = async (tag) => console.log(`--- ${tag}\n` + (await p.locator('flt-semantics [role]').evaluateAll((els) => els.map((e) => `${e.getAttribute('role')}: ${(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').slice(0, 80)}`))).join('\n'));
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000); await sem();
  try { await p.getByRole('button', { name: 'تخطي' }).first().click(); await p.waitForTimeout(1500); } catch {}
  await go('/sign-in');
  // Flutter web can finish its first frame after networkidle: wait for the field, re-navigate once if it never shows.
  try { await p.getByRole('textbox').first().waitFor({ timeout: 15000 }); } catch { await go('/sign-in'); await p.getByRole('textbox').first().waitFor({ timeout: 20000 }); }
  await type(p.getByRole('textbox').nth(0), email);
  await type(p.getByRole('textbox').nth(1), password);
  await tap('تسجيل الدخول'); await p.waitForTimeout(1500);
  check(`${email.split('@')[0]}: sign-in`, calls.some((c) => c.startsWith('POST /api/v1/auth/login 200')), calls.filter((c) => c.includes('login')).join(' | '));
  try { await fn({ p, go, shot, type, tap, sem, calls, dump }); } catch (e) { check(`${email.split('@')[0]}: journey error`, false, String(e).split('\n')[0]); await shot(`error-${email.split('@')[0]}-${Date.now() % 10000}`); }
  await ctx.close();
}

const state = {};
(async () => {
  mkdirSync(OUT, { recursive: true });
  const img = `${OUT}/photo.jpg`;
  writeFileSync(img, await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f6f8b' } }).jpeg().toBuffer());
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const BUYER = process.env.JOURNEY_BUYER ?? 'ahmed@demo.edmn.local'; // receipt uploads are rate-limited per user: repeated runs may need another demo buyer
  const SELLER = 'techzone@demo.edmn.local';
  const PW = 'Demo@12345';

  if (ONLY.includes('C')) {
    // ── C1. Buyer buys one unit of a live TechZone product and uploads the receipt.
    const prod = sql(`select p.slug || '|' || p.title_ar || '|' || v.id from products p join product_variants v on v.product_id = p.id join sellers s on s.id = p.seller_id join users u on u.id = s.owner_user_id where u.email='${SELLER}' and p.status='LIVE' and v.stock_on_hand - v.reserved >= 1 and not exists (select 1 from product_variants w where w.product_id = p.id and w.stock_on_hand - w.reserved < 1) order by p.created_at limit 1`).split('|');
    state.product = { slug: prod[0], title: prod[1], variant: prod[2] };
    await session(b, BUYER, PW, async ({ p, go, shot, type, tap, sem, calls }) => {
      const uid = sql(`select id from users where email='${BUYER}'`);
      sql(`delete from cart_items where cart_id in (select id from carts where user_id='${uid}')`); // start from an empty cart
      await go('/products/' + encodeURIComponent(state.product.slug));
      await tap('أضف إلى السلة');
      await go('/checkout');
      await tap('متابعة'); await tap('متابعة');
      await p.getByRole('radio', { name: /إنستاباي/ }).first().click(); await p.waitForTimeout(800); await sem();
      await tap('متابعة'); await tap('تأكيد الطلب'); await p.waitForTimeout(2000);
      const order = sql(`select id || '|' || number || '|' || grand_total from orders where customer_id='${uid}' order by placed_at desc limit 1`).split('|');
      state.order = { id: order[0], number: order[1], total: Number(order[2]) };
      check('C1 buyer: order placed through the UI', calls.some((c) => /POST \/api\/v1\/orders 201/.test(c)), `#${state.order.number} total=${state.order.total}`);
      const payment = sql(`select id from payments where order_id='${state.order.id}'`);
      await go(`/payments/${payment}`);
      const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), p.getByRole('button', { name: /للإيصال/ }).first().click()]);
      await chooser.setFiles(img); await p.waitForTimeout(1500); await sem();
      await type(p.getByRole('textbox', { name: /المبلغ/ }).first(), String(state.order.total / 100));
      await tap('إرسال الإيصال للمراجعة'); await shot('c1-receipt');
      check('C1 buyer: receipt submitted, payment awaits staff', sql(`select status from payments where id='${payment}'`) === 'PAYMENT_SUBMITTED', 'PAYMENT_SUBMITTED');
    });
    // ── C2. EDMN staff confirm the (test) payment in the console's service. No step is skipped.
    staff('ledger-health', '-'); // what the 30-minute scheduler records; money movements need a recent, healthy snapshot
    staff('confirm-payment', state.order.number);
    const so = sql(`select id || '|' || status from seller_orders where order_id='${state.order.id}'`).split('|');
    state.so = { id: so[0] };
    check('C2 staff: payment confirmed → seller order PAID', so[1] === 'PAID', `seller order status=${so[1]}`);
    check('C2 ledger: payment entries balanced', ledgerBalanced([state.order.id, sql(`select id from payments where order_id='${state.order.id}'`)]), 'debits = credits');

    // ── C3. Seller sees the order with product and quantity, confirms, prepares, ships with a waybill.
    await session(b, SELLER, PW, async ({ p, go, shot, type, tap, sem, calls, dump }) => {
      await go('/seller/orders');
      await shot('c3-seller-orders');
      await go(`/seller/orders/${state.so.id}`);
      await shot('c3-seller-order');
      if (process.env.JOURNEY_DEBUG) await dump('seller order');
      check('C3 seller: order shows the product', (await p.getByText(state.product.title, { exact: false }).count()) > 0, state.product.title);
      // Each fulfilment step: tap it, confirm the dialog (same label), then the server's state must follow.
      const step = async (label, expected, shotName) => {
        await tap(label, { wait: 1500 });
        await p.getByRole('alertdialog').getByRole('button', { name: label }).click(); await p.waitForTimeout(3500); await sem();
        await shot(shotName);
        const st = sql(`select status from seller_orders where id='${state.so.id}'`);
        check(`C3 seller: «${label}» → ${expected}`, st === expected && calls.some((c) => c.startsWith(`POST /api/v1/seller/orders/${state.so.id}/steps 200`)), `status=${st}`);
      };
      await step('قبول الطلب', 'SELLER_CONFIRMED', 'c3-confirmed');
      await step('بدء التجهيز', 'PROCESSING', 'c3-processing');
      await step('جاهز للشحن', 'READY_TO_SHIP', 'c3-ready');
      await tap('بيانات الشحن', { wait: 2000 });
      await sem();
      const tracking = `JNY${Date.now() % 1000000}`;
      await type(p.getByRole('textbox', { name: /شركة الشحن/ }).first(), 'بوسطة');
      await type(p.getByRole('textbox', { name: /رقم البوليصة/ }).first(), tracking);
      const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), p.getByRole('button', { name: /للبوليصة/ }).first().click()]);
      await chooser.setFiles(img); await p.waitForTimeout(1500); await sem();
      await shot('c3-shipment-sheet');
      await tap('حفظ', { wait: 4000 });
      const ship = sql(`select coalesce(carrier_name,'') || '|' || coalesce(tracking_number,'') || '|' || (select count(*) from shipment_documents d where d.shipment_id = s.id) from shipments s where seller_order_id='${state.so.id}'`).split('|');
      check('C3 seller: shipment saved with carrier, waybill number and the waybill file', calls.some((c) => c.startsWith(`POST /api/v1/seller/orders/${state.so.id}/shipment 20`)) && ship[0] === 'بوسطة' && ship[1] === tracking && Number(ship[2]) >= 1, `carrier=${ship[0]} tracking=${ship[1]} docs=${ship[2]}`);
      const doc = sql(`select f.visibility || '|' || f.purpose from shipment_documents d join files f on f.id = d.file_id join shipments s on s.id = d.shipment_id where s.seller_order_id='${state.so.id}' limit 1`);
      check('C3 security: the waybill is a PRIVATE file', doc.startsWith('PRIVATE|'), doc);
      await step('تم الشحن', 'SHIPPED', 'c3-shipped');
      state.tracking = tracking;
    });

    // ── C4. The buyer is notified, sees the tracking, and confirms receipt in the app.
    const buyerId = sql(`select id from users where email='${BUYER}'`);
    check('C4 buyer: notified that the order shipped', Number(sql(`select count(*) from notifications where user_id='${buyerId}' and event like '%SHIPPED%' and created_at > now() - interval '15 minutes'`)) >= 1, 'notification row');
    await session(b, BUYER, PW, async ({ p, go, shot, tap, sem, calls, dump }) => {
      await go(`/orders/${state.order.id}`);
      await shot('c4-buyer-order');
      check('C4 buyer: sees the shipment on its way', (await p.locator('[aria-label*="في طريقه إليك"], flt-semantics:has-text("في طريقه إليك")').count()) > 0, 'shipment state on screen');
      await tap('تأكيد الاستلام', { wait: 1500 });
      if (await p.getByRole('alertdialog').count()) { await p.getByRole('alertdialog').getByRole('button').last().click(); await p.waitForTimeout(3500); await sem(); }
      await shot('c4-received');
      const st = sql(`select status || '|' || coalesce(receipt_confirmed_by::text, '') || '|' || coalesce(receipt_confirmation_source, '') from seller_orders where id='${state.so.id}'`).split('|');
      check('C4 buyer: receipt confirmed through the UI and recorded', calls.some((c) => c.startsWith(`POST /api/v1/seller-orders/${state.so.id}/confirm-receipt 200`)) && st[1] === buyerId, `status=${st[0]} confirmedBy=${st[1] === buyerId ? 'buyer' : st[1]} source=${st[2]}`);
      if (process.env.JOURNEY_DEBUG) await dump('after receipt');
    });
    const sellerUid = sql(`select id from users where email='${SELLER}'`);
    check('C4 seller: notified of the buyer confirmation', Number(sql(`select count(*) from notifications where user_id='${sellerUid}' and event='BUYER_RECEIPT_CONFIRMED' and created_at > now() - interval '15 minutes'`)) >= 1, 'BUYER_RECEIPT_CONFIRMED');
    // Release to the seller is a Maker/Checker staff decision: the buyer's confirmation alone moves no money.
    check('C4 money: no release journal entry without the staff Maker/Checker step', sql(`select count(*) from journal_entries where source_id='${state.so.id}' and entry_type='SELLER_RELEASE'`) === '0', 'SELLER_RELEASE count=0');
    check('C4 ledger: every entry for this order is balanced', ledgerBalanced([state.order.id, state.so.id, sql(`select id from payments where order_id='${state.order.id}'`)]), 'debits = credits');
  }

  await b.close();
  writeFileSync(`${OUT}/results.txt`, results.join('\n') + '\n');
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} PASS / ${results.filter((r) => r.startsWith('FAIL')).length} FAIL`);
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
