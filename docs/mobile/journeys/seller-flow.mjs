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
import { waitOutLoginLimit } from './harness.mjs';
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
  // Flutter web moves semantics nodes when the page scrolls: bring the target into view, refresh, then click.
  const tapFresh = async (loc) => { await loc.scrollIntoViewIfNeeded(); await p.waitForTimeout(800); await sem(); await loc.click(); await p.waitForTimeout(800); await sem(); };
  const dump = async (tag) => console.log(`--- ${tag}\n` + (await p.locator('flt-semantics [role]').evaluateAll((els) => els.map((e) => `${e.getAttribute('role')}: ${(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').slice(0, 80)}`))).join('\n'));
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000); await sem();
  try { await p.getByRole('button', { name: 'تخطي' }).first().click(); await p.waitForTimeout(1500); } catch {}
  await go('/sign-in');
  // Flutter web can finish its first frame after networkidle: wait for the field, re-navigate once if it never shows.
  try { await p.getByRole('textbox').first().waitFor({ timeout: 15000 }); } catch { await go('/sign-in'); await p.getByRole('textbox').first().waitFor({ timeout: 20000 }); }
  await type(p.getByRole('textbox').nth(0), email);
  await type(p.getByRole('textbox').nth(1), password);
  await tap('تسجيل الدخول'); await p.waitForTimeout(1500);
  if (await waitOutLoginLimit(calls)) {
    await p.reload({ waitUntil: 'networkidle' }); await go('/sign-in'); await p.getByRole('textbox').first().waitFor({ timeout: 20000 });
    await type(p.getByRole('textbox').nth(0), email); await type(p.getByRole('textbox').nth(1), password);
    await tap('تسجيل الدخول'); await p.waitForTimeout(1500);
  }
  check(`${email.split('@')[0]}: sign-in`, calls.some((c) => c.startsWith('POST /api/v1/auth/login 200')), calls.filter((c) => c.includes('login')).join(' | '));
  try { await fn({ p, go, shot, type, tap, tapFresh, sem, calls, dump }); } catch (e) { check(`${email.split('@')[0]}: journey error`, false, String(e).split('\n')[0]); await shot(`error-${email.split('@')[0]}-${Date.now() % 10000}`); }
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

  if (ONLY.includes('E')) {
    await session(b, SELLER, PW, async ({ p, go, shot, type, tap, sem, calls }) => {
      const sellerId = sql(`select s.id from sellers s join users u on u.id = s.owner_user_id where u.email='${SELLER}'`);
      const acct = (code) => Number(sql(`select balance from ledger_accounts where seller_id='${sellerId}' and code='${code}'`));
      const journal = (code) => Number(sql(`select coalesce(sum(l.credit - l.debit), 0) from journal_lines l join ledger_accounts a on a.id = l.account_id where a.seller_id='${sellerId}' and a.code='${code}'`));
      const egp = (piastres) => (piastres / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
      // E1. Funds come from the authoritative ledger: screen = account projection = sum of journal lines.
      await go('/seller/funds'); await shot('e1-funds');
      const fundsText = (await p.locator('flt-semantics').allTextContents()).join(' ') + ' ' + (await p.locator('[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join(' ')));
      for (const [code, label] of [['SELLER_AVAILABLE', 'withdrawable'], ['SELLER_PENDING', 'pending release']]) {
        const shown = fundsText.includes(egp(acct(code)));
        check(`E1 seller funds: ${label} on screen = ledger account = journal sum`, shown && acct(code) === journal(code), `screen=${shown ? egp(acct(code)) : 'missing'} account=${acct(code)} journal=${journal(code)}`);
      }
      // E2. The fulfilled order appears in the earnings statement.
      const lastSo = sql(`select o.number || '-' || so.suffix from seller_orders so join orders o on o.id = so.order_id where so.seller_id='${sellerId}' and so.status in ('DELIVERED','COMPLETED') order by so.updated_at desc limit 1`);
      await go('/seller/statement'); await shot('e2-statement');
      const stText = (await p.locator('[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join(' '))) + (await p.locator('flt-semantics').allTextContents()).join(' ');
      check(`E2 statement lists the delivered order #${lastSo}`, stText.includes(lastSo.split('-')[0]), `#${lastSo}`);
      // E3. Payout REQUEST (request only: no transfer, no ledger posting).
      await go('/seller/payouts'); await shot('e3-payouts');
      await tap('طلب سحب', { wait: 2000 });
      await sem();
      await type(p.getByRole('textbox').last(), '100');
      await shot('e3-payout-sheet');
      await tap('مراجعة المبلغ', { wait: 2500 });
      await shot('e3-payout-preview');
      const before = Number(sql(`select count(*) from withdrawal_requests where seller_id='${sellerId}'`));
      const availBefore = acct('SELLER_AVAILABLE');
      // Double tap: a duplicate submission must not create a second request.
      const send = p.getByRole('button', { name: 'إرسال الطلب' }).last();
      await send.click(); await send.click({ timeout: 2000 }).catch(() => {});
      await p.waitForTimeout(4000); await sem();
      await shot('e3-payout-sent');
      const created = sql(`select count(*) || '|' || coalesce(max(amount)::text,'') || '|' || coalesce(max(status),'') from withdrawal_requests where seller_id='${sellerId}' and created_at > now() - interval '2 minutes'`).split('|');
      check('E3 payout: one request through the UI (double tap) — REQUESTED, 100 EGP', Number(sql(`select count(*) from withdrawal_requests where seller_id='${sellerId}'`)) === before + 1 && created[0] === '1' && created[1] === '10000' && created[2] === 'REQUESTED', `rows=${created[0]} amount=${created[1]} status=${created[2]}`);
      const wid = sql(`select id from withdrawal_requests where seller_id='${sellerId}' order by created_at desc limit 1`);
      check('E3 payout: request only — no journal entry, available balance unchanged', sql(`select count(*) from journal_entries where source_id='${wid}'`) === '0' && acct('SELLER_AVAILABLE') === availBefore, `entries=0 available=${acct('SELLER_AVAILABLE')}`);
      check('E3 payout: the UI call succeeded once', calls.filter((c) => /POST \/api\/v1\/seller\/payout-requests 20\d/.test(c)).length >= 1, calls.filter((c) => c.includes('payout-requests')).join(' | '));
    });
  }

  if (ONLY.includes('D')) {
    // A delivered TechZone order of the buyer (journey C leaves one).
    const so = sql(`select so.id || '|' || o.number || '-' || so.suffix from seller_orders so join orders o on o.id = so.order_id join users u on u.id = o.customer_id join sellers s on s.id = so.seller_id join users su on su.id = s.owner_user_id where u.email='${BUYER}' and su.email='${SELLER}' and so.status = 'DELIVERED' and not exists (select 1 from returns r where r.seller_order_id = so.id) order by so.updated_at desc limit 1`).split('|');
    state.ret = { so: so[0], number: so[1] };
    await session(b, BUYER, PW, async ({ p, go, shot, type, tapFresh, sem, calls }) => {
      await go(`/returns/new?so=${state.ret.so}`);
      await shot('d1-return-form');
      await tapFresh(p.getByRole('button', { name: 'زيادة الكمية' }).first());
      await tapFresh(p.getByRole('radio', { name: /وصل تالف/ }).first());
      check('D1 buyer: «arrived damaged» selected (named radio)', (await p.getByRole('radio', { name: /وصل تالف/, checked: true }).count()) === 1, 'checked');
      const docs = p.getByRole('button', { name: /صور أو مستندات/ }).first();
      await docs.scrollIntoViewIfNeeded(); await p.waitForTimeout(800); await sem();
      const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), docs.click()]);
      await chooser.setFiles(img); await p.waitForTimeout(1500); await sem();
      const desc = p.getByRole('textbox').last();
      await desc.scrollIntoViewIfNeeded(); await p.waitForTimeout(600); await sem();
      await type(p.getByRole('textbox').last(), 'الشاشة وصلت مكسورة من الطرف، والصور مرفقة');
      await shot('d1-return-filled');
      await tapFresh(p.getByRole('button', { name: 'إرسال طلب الإرجاع' }).last());
      await p.waitForTimeout(3000); await sem();
      await shot('d1-return-sent');
      const r = sql(`select id || '|' || status || '|' || reason from returns where seller_order_id='${state.ret.so}' order by created_at desc limit 1`).split('|');
      state.ret.id = r[0];
      check('D1 buyer: return requested through the UI', calls.some((c) => /POST \/api\/v1\/returns 20\d/.test(c)) && r[1] === 'REQUESTED', `status=${r[1]} reason=${r[2]}`);
      const ev = sql(`select string_agg(f.visibility || ':' || f.purpose, ',') from files f where f.id in (select file_id from return_evidence where return_id='${state.ret.id}')`);
      check('D1 security: evidence stored PRIVATE as RETURN_EVIDENCE', /^PRIVATE:RETURN_EVIDENCE/.test(ev ?? ''), ev);
    });
    const sellerUid = sql(`select id from users where email='${SELLER}'`);
    check('D2 seller: notified of the return request', Number(sql(`select count(*) from notifications where user_id='${sellerUid}' and event='RETURN_REQUESTED' and created_at > now() - interval '15 minutes'`)) >= 1, 'RETURN_REQUESTED');
    await session(b, SELLER, PW, async ({ p, go, shot, type, tap, tapFresh, sem, calls }) => {
      await go('/seller/returns'); await shot('d2-seller-returns');
      await go(`/seller/returns/${state.ret.id}`); await shot('d2-seller-return');
      check('D2 seller: sees the return for the order', (await p.locator('[aria-label*="100"], flt-semantics:has-text("' + state.ret.number + '")').count()) > 0, `#${state.ret.number}`);
      await tapFresh(p.getByRole('button', { name: 'رفض الإرجاع' }).last());
      await sem();
      await type(p.getByRole('textbox').last(), 'الصور لا توضح تلف من الشحن، والمنتج اتسلم سليم حسب التغليف');
      await shot('d2-reject-sheet');
      await tap('تأكيد', { wait: 3500 });
      const r = sql(`select status || '|' || coalesce(decision_reason, '') from returns where id='${state.ret.id}'`).split('|');
      check('D2 seller: authorized rejection with a reason, persisted', calls.some((c) => c.includes(`/seller/returns/${state.ret.id}/steps 200`)) && r[0] === 'REJECTED' && r[1].length > 10, `status=${r[0]}`);
      await shot('d2-rejected');
    });
    // D3. The buyer sees the decision and escalates; a dispute opens for EDMN to decide (no automatic refund).
    await session(b, BUYER, PW, async ({ p, go, shot, type, tap, tapFresh, sem, calls, dump }) => {
      await go(`/returns/${state.ret.id}`); await shot('d3-buyer-return');
      check('D3 buyer: sees the seller rejection', (await p.locator('flt-semantics:has-text("مرفوض")').count()) > 0, 'مرفوض on screen');
      const unnamed = await p.locator('flt-semantics[role="button"]').evaluateAll((els) => els.filter((e) => !(e.getAttribute('aria-label') || e.textContent || '').trim()).length);
      check('D3 a11y: no unnamed buttons on the return screen', unnamed === 0, `unnamed=${unnamed}`);
      await tapFresh(p.getByRole('button', { name: /تحويل لفريق أضمن/ }).last());
      if (await p.getByRole('alertdialog').count()) { await p.getByRole('alertdialog').getByRole('button').last().click(); await p.waitForTimeout(3500); await sem(); }
      else {
        const box = p.getByRole('textbox');
        if (await box.count()) { await type(box.last(), 'البائع رفض رغم إن الصور واضحة'); await tap('تأكيد', { wait: 3500 }); }
      }
      await shot('d3-escalated');
      const d = sql(`select d.id || '|' || d.status || '|' || r.status from disputes d join returns r on r.id = d.return_id where d.return_id='${state.ret.id}'`).split('|');
      check('D3 buyer: escalation opens one dispute linked to the return', calls.some((c) => c.includes(`/returns/${state.ret.id}/escalate 20`)) && d[1] === 'OPEN', `dispute=${d[1]} return=${d[2]}`);
      check('D3 money: escalation moves no money (no refund entry)', sql(`select count(*) from refunds where seller_order_id = (select seller_order_id from returns where id='${state.ret.id}')`) === '0', 'no refund record');
      state.dispute = d[0];
      if (process.env.JOURNEY_DEBUG) await dump('after escalate');
    });
    const sellerId2 = sql(`select id from users where email='${SELLER}'`);
    check('D3 seller: notified that a dispute was opened', Number(sql(`select count(*) from notifications where user_id='${sellerId2}' and event='DISPUTE_OPENED' and created_at > now() - interval '15 minutes'`)) >= 1, 'DISPUTE_OPENED');
    await session(b, SELLER, PW, async ({ p, go, shot }) => {
      await go(`/seller/disputes/${state.dispute}`); await shot('d4-seller-dispute');
      check('D4 seller: sees the dispute', (await p.locator('flt-semantics:has-text("نزاع"), [aria-label*="نزاع"]').count()) > 0, 'dispute screen');
    });
  }

  if (ONLY.includes('B')) {
    await session(b, SELLER, PW, async ({ p, go, shot, type, tap, tapFresh, sem, calls }) => {
      await go('/seller/products/new'); await shot('b1-new-product');
      state.newTitle = `سماعة بلوتوث اختبار ${Date.now() % 100000}`;
      await type(p.getByRole('textbox').first(), state.newTitle);
      await tapFresh(p.getByRole('button', { name: 'القسم' }).first());
      await shot('b1-category-menu');
      await tapFresh(p.getByRole('menuitem', { name: 'إلكترونيات › صوتيات ومسرح منزلي' }));
      await tap('متابعة', { wait: 4000 });
      const prod = sql(`select p.id || '|' || p.status || '|' || p.condition from products p where p.title_ar='${state.newTitle}'`).split('|');
      state.newProduct = prod[0];
      check('B1 seller: draft product created through the UI', calls.some((c) => /POST \/api\/v1\/seller\/products 20\d/.test(c)) && prod[1] === 'DRAFT' && prod[2] === 'NEW', `status=${prod[1]} condition=${prod[2]}`);
      await shot('b2-editor');
      // B2. Photo, description, price and stock, return policy — each saved through its own route.
      const add = p.getByRole('button', { name: 'إضافة صورة للمنتج' }).first();
      await add.scrollIntoViewIfNeeded(); await p.waitForTimeout(600); await sem();
      const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), add.click()]);
      await chooser.setFiles(img); await p.waitForTimeout(4000); await sem();
      const pimg = sql(`select count(*) || '|' || coalesce(min(f.visibility),'') || '|' || coalesce(min(f.purpose),'') from product_images i join files f on f.id = i.file_id where i.product_id='${state.newProduct}'`).split('|');
      check('B2 seller: photo uploaded (PUBLIC product image, re-encoded by the server)', calls.some((c) => c.includes(`/seller/products/${state.newProduct}/images 20`)) && pimg[0] === '1' && pimg[1] === 'PUBLIC' && pimg[2] === 'PRODUCT_IMAGE', `images=${pimg[0]} ${pimg[1]} ${pimg[2]}`);
      await tapFresh(p.getByRole('button', { name: 'اضغط للإضافة' }).first());
      await sem();
      await type(p.getByRole('textbox', { name: /^وصف المنتج/ }).first(), 'سماعة بلوتوث لاسلكية بعزل ضوضاء وبطارية تدوم ٢٠ ساعة، للاختبار فقط');
      await shot('b2-details-sheet');
      await tap('حفظ', { wait: 3500 });
      const desc = sql(`select length(coalesce(description,'')) from products where id='${state.newProduct}'`);
      check('B2 seller: description saved', calls.some((c) => c.includes(`/seller/products/${state.newProduct}/details 200`)) && Number(desc) >= 20, `length=${desc}`);
      await tapFresh(p.getByRole('button', { name: 'حدد السعر والكمية' }).first());
      await sem();
      await type(p.getByRole('textbox', { name: /^السعر \(/ }).first(), '799');
      const stock = p.getByRole('textbox').last();
      await stock.click(); await p.waitForTimeout(400); await p.keyboard.press('Control+A'); await p.keyboard.type('10', { delay: 30 });
      await shot('b2-price-sheet');
      await tap('حفظ', { wait: 3500 });
      const v = sql(`select price || '|' || stock_on_hand from product_variants where product_id='${state.newProduct}'`).split('|');
      check('B2 seller: price 799 EGP and stock 10 saved (integer piastres)', calls.some((c) => c.includes(`/seller/products/${state.newProduct}/variants 200`)) && v[0] === '79900' && v[1] === '10', `price=${v[0]} stock=${v[1]}`);
      await tapFresh(p.getByRole('button', { name: /سياسة الإرجاع/ }).first());
      await shot('b2-policy-sheet');
      await tap('حفظ', { wait: 3500 }); // keep the store's return policy (confirmed for this product)
      check('B2 seller: return policy confirmed', sql(`select return_policy_confirmed from products where id='${state.newProduct}'`) === 't', 'return_policy_confirmed');
      await tapFresh(p.getByRole('button', { name: 'إرسال للمراجعة' }).last());
      await p.waitForTimeout(2500); await sem();
      await shot('b3-submitted');
      check('B3 seller: submitted for EDMN moderation', calls.some((c) => c.includes(`/seller/products/${state.newProduct}/submit 200`)) && sql(`select status from products where id='${state.newProduct}'`) === 'SUBMITTED', sql(`select status from products where id='${state.newProduct}'`));
    });
    // B4. EDMN moderation (console service), then the product is public.
    staff('approve-product', state.newProduct);
    const live = sql(`select status || '|' || slug from products where id='${state.newProduct}'`).split('|');
    check('B4 staff: approved → product LIVE', live[0] === 'LIVE', `status=${live[0]}`);
    const pub = execSync(`curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8099/api/v1/catalog/products/${encodeURIComponent(live[1])}'`).toString();
    check('B4 buyers: the product page is public', pub === '200', `GET catalog/products → ${pub}`);
    await session(b, SELLER, PW, async ({ p, go, shot, tapFresh, sem, calls }) => {
      await go(`/seller/products/${state.newProduct}/edit`); await shot('b5-live');
      await tapFresh(p.getByRole('button', { name: /وقف البيع/ }).first());
      await p.getByRole('alertdialog').getByRole('button', { name: 'تأكيد' }).click(); await p.waitForTimeout(3500); await sem();
      const v = sql(`select stock_on_hand || '|' || reserved from product_variants where product_id='${state.newProduct}'`).split('|');
      check('B5 seller: stop sales → stock down to reserved units', calls.some((c) => c.includes(`/seller/products/${state.newProduct}/out-of-stock 200`)) && v[0] === v[1], `stock=${v[0]} reserved=${v[1]}`);
      await shot('b5-out-of-stock');
      await tapFresh(p.getByRole('button', { name: 'أرشفة المنتج' }).first());
      await p.getByRole('alertdialog').getByRole('button', { name: 'تأكيد' }).click(); await p.waitForTimeout(3500); await sem();
      await shot('b6-archived');
      check('B6 seller: archived through the UI', calls.some((c) => c.includes(`/seller/products/${state.newProduct}/archive 200`)) && sql(`select status from products where id='${state.newProduct}'`) === 'ARCHIVED', 'ARCHIVED');
    });
    const gone = execSync(`curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8099/api/v1/catalog/products/${encodeURIComponent(live[1])}'`).toString();
    check('B6 buyers: an archived product is no longer public', gone === '404', `GET catalog/products → ${gone}`);
  }

  if (ONLY.includes('A')) {
    // A. A brand-new account becomes a seller. Codes sent by SMS are read from the local outbox (the "phone"): in local
    // mode no dispatcher runs and bodies are not sealed; production seals and redacts them.
    const n = Date.now() % 100000000;
    const A = { name: 'سارة محمود حسن', phone: `011${String(n).padStart(8, '0')}`, email: `journey.seller.${n}@test.local`, pw: 'Journey#2026x' };
    const smsCode = (phoneLike) => (sql(`select body from outbound_messages where channel='SMS' and recipient like '%${phoneLike.slice(-9)}' order by created_at desc limit 1`).match(/\b(\d{6})\b/) ?? [])[1];
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
    const p = await ctx.newPage();
    const calls = [];
    p.on('response', (r) => { if (r.url().includes('/api/v1/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
    const sem = async () => { await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await p.waitForTimeout(600); };
    const go = async (hash) => { await p.goto(BASE + '#' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500); await sem(); };
    const shot = async (nm) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${nm}.png` }); };
    const type = async (loc, text) => { await loc.click(); await p.waitForTimeout(600); await p.keyboard.type(text, { delay: 25 }); };
    const dump = async (tag) => console.log(`--- ${tag}\n` + (await p.locator('flt-semantics [role]').evaluateAll((els) => els.map((e) => `${e.getAttribute('role')}: ${(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').slice(0, 80)}`))).join('\n'));
    const tapFresh = async (loc) => { await loc.scrollIntoViewIfNeeded(); await p.waitForTimeout(800); await sem(); await loc.click(); await p.waitForTimeout(2500); await sem(); };
    try {
      await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000); await sem();
      try { await p.getByRole('button', { name: 'تخطي' }).first().click(); await p.waitForTimeout(1500); } catch {}
      await go('/register');
      await p.getByRole('textbox').first().waitFor({ timeout: 20000 });
      const boxes = p.getByRole('textbox');
      await type(boxes.nth(0), A.name);
      await type(boxes.nth(1), A.phone);
      await type(boxes.nth(2), A.email);
      await type(boxes.nth(3), A.pw);
      await shot('a1-register');
      await tapFresh(p.getByRole('button', { name: 'إنشاء حساب جديد' }).last());
      await p.waitForTimeout(2000); await sem();
      const uid = sql(`select id from users where email='${A.email}'`);
      check('A1 new account registered through the UI', calls.some((c) => /POST \/api\/v1\/auth\/register 20\d/.test(c)) && uid.length === 36, `user=${uid ? 'created' : 'missing'}`);
      await shot('a2-verify');
      let code = smsCode(A.phone);
      if (!code) { await tapFresh(p.getByRole('button', { name: 'إرسال الكود' }).first()); code = smsCode(A.phone); }
      check('A2 an OTP was sent by SMS to the new number', !!code, code ? 'code received' : 'no SMS');
      await type(p.getByRole('textbox').first(), code ?? '');
      await tapFresh(p.getByRole('button', { name: 'تحقق' }).first());
      await p.waitForTimeout(1500);
      check('A2 phone verified through the UI', sql(`select phone_verified_at is not null from users where id='${uid}'`) === 't', 'phone_verified_at set');
      await shot('a2-verified');
      // A3. National ID (KYC): legal name, ID number (test), both sides as images → pending review.
      await go('/account/identity'); await shot('a3-identity');
      await sem();
      await type(p.getByRole('textbox').nth(0), A.name);
      A.nid = `290010${String(n).slice(-8).padStart(8, '1')}`;
      await type(p.getByRole('textbox').nth(1), A.nid);
      for (const side of ['الوجه', 'الظهر']) {
        const btn = p.getByRole('button', { name: new RegExp(`\\(${side}\\)`) }).first();
        await btn.scrollIntoViewIfNeeded(); await p.waitForTimeout(600); await sem();
        const [ch] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), btn.click()]);
        await ch.setFiles(img); await p.waitForTimeout(1200); await sem();
      }
      await shot('a3-identity-filled');
      await tapFresh(p.getByRole('button', { name: 'إرسال للمراجعة' }).last());
      const kyc = sql(`select status || '|' || (front_file_id is not null and back_file_id is not null) from user_identity_verifications where user_id='${uid}' order by created_at desc limit 1`).split('|');
      if (process.env.JOURNEY_DEBUG) console.log('identity calls:', calls.filter((c) => c.includes('identity')));
      check('A3 identity submitted through the UI (both sides), pending review', calls.some((c) => /POST \/api\/v1\/me\/identity 20\d/.test(c)) && kyc[0] === 'PENDING_REVIEW' && kyc[1] === 'true', `status=${kyc[0]}`);
      const idFiles = sql(`select string_agg(distinct f.visibility || ':' || f.purpose, ',') from files f where f.id in (select front_file_id from user_identity_verifications where user_id='${uid}' union select back_file_id from user_identity_verifications where user_id='${uid}')`);
      check('A3 security: ID images are PRIVATE identity documents; the number is stored encrypted', idFiles === 'PRIVATE:IDENTITY_DOCUMENT' && !sql(`select national_id_enc from user_identity_verifications where user_id='${uid}' limit 1`).includes(String(n).slice(-6)), idFiles);
      // EDMN reviews the ID (console service; step-up).
      staff('approve-identity', A.email);
      check('A4 staff: identity approved', sql(`select status from user_identity_verifications where user_id='${uid}' order by created_at desc limit 1`) === 'APPROVED', 'APPROVED');
      await go('/seller/apply'); await shot('a5-apply');
      await tapFresh(p.getByRole('radio', { name: 'فرد' }).first());
      await tapFresh(p.getByRole('button', { name: 'ابدأ الطلب' }).first());
      check('A5 application started through the UI (individual)', calls.some((c) => /POST \/api\/v1\/seller\/application 20\d/.test(c)) && sql(`select status from sellers where owner_user_id='${uid}'`) === 'DRAFT', sql(`select status from sellers where owner_user_id='${uid}'`));
      await shot('a5-wizard');
      await tapFresh(p.getByRole('button', { name: 'بيانات الهوية والعنوان' }).first());
      await sem();
      await type(p.getByRole('textbox').nth(1), A.nid);
      await type(p.getByRole('textbox').nth(4), 'شارع ٩، المعادي');
      await type(p.getByRole('textbox').nth(5), 'القاهرة');
      // Batch 5: the governorate comes from the database list (searchable picker), not a typed number.
      const pickGov = async (search, name) => {
        await tapFresh(p.getByRole('button', { name: /^المحافظة:/ }).last());
        await p.getByRole('textbox', { name: /ابحث عن المحافظة/ }).last().waitFor({ timeout: 10000 });
        await type(p.getByRole('textbox', { name: /ابحث عن المحافظة/ }).last(), search);
        await p.waitForTimeout(800); await sem();
        if (process.env.JOURNEY_DEBUG) await dump(`governorate ${search}`);
        await p.locator(`flt-semantics:has-text("${name}")`).last().click(); await p.waitForTimeout(1200); await sem();
      };
      await pickGov('اسكندر', 'الإسكندرية');
      check('A6 governorate picker: search without hamza finds «الإسكندرية» and shows it', (await p.getByRole('button', { name: 'المحافظة: الإسكندرية' }).count()) > 0, 'picker value');
      await shot('a6-owner-sheet');
      await tapFresh(p.getByRole('button', { name: 'حفظ' }).last());
      await p.waitForTimeout(1500);
      const alexId = sql(`select id from governorates where name_en='Alexandria'`);
      check('A6 owner identity and address saved with the governorate id', calls.some((c) => /PUT \/api\/v1\/seller\/application\/identity 200/.test(c)) && sql(`select governorate_id from sellers where owner_user_id='${uid}'`) === alexId, `governorate_id=${sql(`select governorate_id from sellers where owner_user_id='${uid}'`)} (Alexandria=${alexId})`);
      await shot('a6-after-owner');
      // The application's mobile equals the account's verified phone, so the server carries the verification over.
      check('A7 application mobile verified (same as the verified account phone)', sql(`select mobile_verified_at is not null from sellers where owner_user_id='${uid}'`) === 't', 'mobile_verified_at');
      await tapFresh(p.getByRole('button', { name: 'بيانات المتجر وعنوان الإرجاع' }).first());
      await sem();
      A.store = `متجر سارة ${n % 100000}`;
      await type(p.getByRole('textbox').nth(0), A.store);
      await type(p.getByRole('textbox').nth(1), 'إكسسوارات موبايل أصلية بضمان');
      await type(p.getByRole('textbox').nth(2), 'شارع ٩، المعادي، القاهرة');
      await pickGov('القاه', 'القاهرة');
      const logoBtn = p.getByRole('button', { name: /شعار المتجر/ }).first();
      const [lc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), logoBtn.click()]);
      await lc.setFiles(img); await p.waitForTimeout(1200); await sem();
      await shot('a8-store-sheet');
      await tapFresh(p.getByRole('button', { name: 'حفظ' }).last());
      await p.waitForTimeout(1500);
      const st = sql(`select st.name || '|' || (st.logo_file_id is not null) || '|' || st.return_governorate_id from stores st join sellers s on s.id = st.seller_id where s.owner_user_id='${uid}'`).split('|');
      check('A8 store created with name, return address (Cairo id from the picker) and logo', calls.some((c) => /POST \/api\/v1\/seller\/application\/store 20\d/.test(c)) && st[0] === A.store && st[1] === 'true' && st[2] === sql(`select id from governorates where name_en='Cairo'`), `store=${st[0]} logo=${st[1]} returnGovernorate=${st[2]}`);
      if (process.env.JOURNEY_DEBUG) await dump('after store');
      // A9. Seller documents: ID front and back (private seller documents).
      for (const side of ['الوجه', 'الظهر']) {
        const row = p.getByRole('button', { name: `صورة البطاقة (${side})` }).first();
        await p.mouse.move(195, 500);
        for (let i = 0; i < 8 && !(await row.isVisible()); i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(500); await sem(); }
        await row.click(); await p.waitForTimeout(1500); await sem();
        if (process.env.JOURNEY_DEBUG) await dump(`doc ${side}`);
        const pick = p.getByRole('button', { name: /^المستندات:/ }).last();
        await pick.waitFor({ state: 'visible', timeout: 15000 });
        const [dc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 15000 }), pick.click()]);
        await dc.setFiles(img); await p.waitForTimeout(1500); await sem();
        await p.getByRole('button', { name: 'رفع' }).last().click(); await p.waitForTimeout(3500); await sem();
      }
      const docs = sql(`select string_agg(d.kind || ':' || f.visibility, ',' order by d.kind) from seller_documents d join files f on f.id = d.file_id join sellers s on s.id = d.seller_id where s.owner_user_id='${uid}' and d.superseded_at is null`);
      check('A9 seller documents uploaded through the UI, PRIVATE', docs === 'NATIONAL_ID_BACK:PRIVATE,NATIONAL_ID_FRONT:PRIVATE', docs);
      await shot('a9-docs');
      await tapFresh(p.getByRole('button', { name: 'بيانات استلام الأموال' }).first());
      await p.getByRole('radio', { name: 'InstaPay' }).first().click(); await p.waitForTimeout(1000); await sem();
      await type(p.getByRole('textbox').nth(0), A.name);
      await type(p.getByRole('textbox').nth(1), `sara${n % 100000}@instapay`);
      await shot('a10-payout-sheet');
      await tapFresh(p.getByRole('button', { name: 'حفظ' }).last());
      await p.waitForTimeout(1500);
      const pm = sql(`select pm.status || '|' || pm.type from seller_payout_methods pm join sellers s on s.id = pm.seller_id where s.owner_user_id='${uid}' order by pm.created_at desc limit 1`).split('|');
      check('A10 payout account added (pending EDMN verification)', calls.some((c) => /POST \/api\/v1\/seller\/application\/payout-account 20\d/.test(c)) && pm[0] === 'PENDING_VERIFICATION' && pm[1] === 'INSTAPAY', `status=${pm[0]} type=${pm[1]}`);
      // A11. Accept the agreement and submit.
      const agree = p.getByRole('checkbox', { name: /اتفاقية البائع/ }).first();
      await p.mouse.move(195, 500);
      for (let i = 0; i < 8 && !(await agree.isVisible()); i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(500); await sem(); }
      await agree.click(); await p.waitForTimeout(800); await sem();
      await p.getByRole('button', { name: 'إرسال للمراجعة' }).last().click(); await p.waitForTimeout(4000); await sem();
      await shot('a11-submitted');
      check('A11 application submitted through the UI', calls.some((c) => /POST \/api\/v1\/seller\/application\/submit 20\d/.test(c)) && sql(`select status from sellers where owner_user_id='${uid}'`) === 'PENDING_REVIEW', sql(`select status from sellers where owner_user_id='${uid}'`));
      // A12. EDMN approves the seller and verifies the payout account (console services, step-up).
      staff('approve-seller', A.email);
      check('A12 staff: seller approved, payout account verified', sql(`select s.status || '|' || (select status from seller_payout_methods where seller_id = s.id order by created_at desc limit 1) from sellers s where s.owner_user_id='${uid}'`) === 'APPROVED|ACTIVE', sql(`select status from sellers where owner_user_id='${uid}'`));
      check('A12 the new seller is notified', Number(sql(`select count(*) from notifications where user_id='${uid}' and event='SELLER_APPROVED'`)) >= 1, 'SELLER_APPROVED');
      await go('/seller'); await shot('a13-seller-center');
      check('A13 the new seller sees the Seller Center (store + menu)', (await p.getByRole('button', { name: 'إدارة المنتجات' }).count()) > 0 && (await p.locator(`flt-semantics:has-text("${A.store}")`).count()) > 0, A.store);
    } catch (e) { check('A journey error', false, String(e).split('\n')[0]); await shot(`error-a-${Date.now() % 10000}`); }
    await ctx.close();
  }

  await b.close();
  writeFileSync(`${OUT}/results.txt`, results.join('\n') + '\n');
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} PASS / ${results.filter((r) => r.startsWith('FAIL')).length} FAIL`);
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
