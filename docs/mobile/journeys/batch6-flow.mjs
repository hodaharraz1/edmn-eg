// Batch 6: the APPROVED return lifecycle through the real apps and the real web console (LOCAL server, edmn_device demo
// DB, Real Money OFF / TEST payouts only).
//   R   buyer requests a return (a damaged claim without photos is refused first) → seller approves → buyer sees where
//       to send it and records the shipment → seller receives, inspects and accepts → EDMN in the WEB CONSOLE:
//       finance@ requests the approval (Maker), checker@ approves it (Checker, reversal journal), finance@ records the
//       TEST payout → buyer and seller apps show the refund; ledger balanced; no seller release.
//   RF  the same on a second order, but the first transfer FAILS: finance@ records the failure, the payout form is
//       gone, checker@ proves (with evidence) that no money left, finance@ pays once.
// Delivered orders come from batch5-flow.mjs journey BB (buyer purchase → EDMN payment confirmation → seller
// fulfilment → buyer confirms receipt, all through the UI) unless JOURNEY_ORDERS=<n1,n2> names delivered orders.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { check, results, session, sql, totp } from './harness.mjs';

const OUT = process.env.OUT ?? 'docs/mobile/screenshots/batch6';
const WEB = process.env.JOURNEY_WEB_URL ?? 'http://localhost:3000';
const ONLY = (process.env.JOURNEYS ?? 'R,RF').split(',');
const BUYER = process.env.JOURNEY_BUYER ?? 'mona@demo.edmn.local';
const SELLER = 'techzone@demo.edmn.local';
const PW = 'Demo@12345';
// Demo staff of the LOCAL demo database (same public demo values as tests/e2e/helpers.ts).
const STAFF_PW = process.env.STAGING_ADMIN_PASSWORD ?? 'Admin@Edmn#2026';
const STAFF_TOTP = process.env.STAGING_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

const buyerId = sql(`select id from users where email='${BUYER}'`);
const sellerUid = sql(`select id from users where email='${SELLER}'`);
const balanced = (where) => sql(`select coalesce(sum(l.debit) - sum(l.credit), 0) from journal_lines l join journal_entries e on e.id = l.entry_id where ${where}`) === '0';

/** A delivered TechZone order of the buyer with no return yet (made through the UI by batch5 BB if needed). */
function deliveredOrder(exclude = []) {
  const pick = () =>
    sql(
      `select o.id || '|' || o.number || '|' || so.id from seller_orders so join orders o on o.id = so.order_id where o.customer_id='${buyerId}' and so.seller_id=(select id from sellers where owner_user_id='${sellerUid}') and so.status='DELIVERED' and not exists (select 1 from returns r where r.seller_order_id = so.id) ${exclude.length ? `and so.id not in (${exclude.map((x) => `'${x}'`).join(',')})` : ''} order by so.updated_at desc limit 1`,
    );
  let row = pick();
  if (!row) {
    execSync('node docs/mobile/journeys/batch5-flow.mjs', { env: { ...process.env, JOURNEYS: 'BB', OUT: `${OUT}/setup` }, stdio: 'inherit' });
    row = pick();
  }
  const [id, number, so] = row.split('|');
  return { id, number, so };
}

let lastStep = 0;
/** Web console sign-in with password + TOTP (codes are single-use: wait for a fresh 30 s step). */
async function staff(b, email, fn) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-EG' });
  const p = await ctx.newPage();
  try {
    await p.goto(`${WEB}/admin/login`);
    await p.locator('input[name=email]').fill(email);
    await p.locator('input[name=password]').fill(STAFF_PW);
    await p.locator('form button[type=submit]').click();
    await p.waitForURL(/\/admin\/2fa/, { timeout: 60000 });
    while (Math.floor(Date.now() / 30000) <= lastStep) await p.waitForTimeout(1000);
    lastStep = Math.floor(Date.now() / 30000);
    await p.locator('input[name=code]').fill(totp(STAFF_TOTP));
    await p.locator('form button[type=submit]').click();
    await p.waitForURL((u) => u.pathname === '/admin' || u.pathname === '/admin/', { timeout: 60000 });
    check(`${email.split('@')[0]} (web console): sign-in with 2FA`, true, 'password + TOTP');
    await fn(p);
  } catch (e) {
    check(`${email.split('@')[0]} (web console): error`, false, String(e).split('\n')[0]);
    await p.screenshot({ path: `${OUT}/error-${email.split('@')[0]}-${Date.now() % 10000}.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
}
const refundRow = (p, number) => p.locator('[data-testid=refund-row]').filter({ hasText: `استرداد #${number}` }).first();
const submitIn = async (p, scope, buttonName) => {
  await scope.getByRole('button', { name: buttonName }).first().click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(2500);
};

/** Buyer + seller through the apps up to REFUND_PENDING. Returns the return id and its refund. */
async function returnToRefundPending(b, o, tag, opts = {}) {
  const r = {};
  await session(b, OUT, BUYER, PW, async (s) => {
    const { p, go, shot, type, tapFresh, calls } = s;
    await go(`/returns/new?so=${o.so}`);
    await tapFresh(p.getByRole('button', { name: 'زيادة الكمية' }).first());
    if (opts.evidenceCheck) {
      // A damaged claim without photos is refused by the server; nothing is stored.
      await tapFresh(p.getByRole('radio', { name: /وصل تالف/ }).first());
      await type(p.getByRole('textbox').last(), 'الشاشة فيها خدش');
      await tapFresh(p.getByRole('button', { name: 'إرسال طلب الإرجاع' }).last(), 3000);
      await shot(`${tag}-evidence-required`);
      const n = sql(`select count(*) from returns where seller_order_id='${o.so}'`);
      check(`${tag}1 buyer: a damaged claim without photos is refused; nothing stored`, n === '0' && (await s.has('ارفع صور')), `returns=${n}`);
      // The same form, now with a reason that needs no photos (quantity and description stay as entered).
    }
    if (process.env.JOURNEY_DEBUG) await s.dump('return form');
    await tapFresh(p.getByRole('radio', { name: /غيرت رأيي/ }).first());
    if (!opts.evidenceCheck) await type(p.getByRole('textbox').last(), 'المقاس مش مناسب، والمنتج بحالته وفي علبته');
    await shot(`${tag}-request`);
    await tapFresh(p.getByRole('button', { name: 'إرسال طلب الإرجاع' }).last(), 3500);
    const row = sql(`select id || '|' || number || '|' || status from returns where seller_order_id='${o.so}' order by created_at desc limit 1`).split('|');
    [r.id, r.number] = row;
    check(`${tag}1 buyer: return requested through the UI (REQUESTED)`, calls.some((c) => /POST \/api\/v1\/returns 20\d/.test(c)) && row[2] === 'REQUESTED', `#${r.number}`);
  });
  await session(b, OUT, SELLER, PW, async ({ go, shot, tap, confirmDialog, has, calls }) => {
    await go(`/seller/returns/${r.id}`);
    await shot(`${tag}-seller-request`);
    await tap('الموافقة على الإرجاع', { wait: 3500 });
    await confirmDialog();
    const st = sql(`select status from returns where id='${r.id}'`);
    check(`${tag}2 seller: approves the return (APPROVED)`, calls.some((c) => c.includes(`/seller/returns/${r.id}/steps 200`)) && st === 'APPROVED' && (await has('اتقبل')), `status=${st}`);
  });
  check(`${tag}2 buyer: notified of the approval`, Number(sql(`select count(*) from notifications where user_id='${buyerId}' and event like 'RETURN%' and created_at > now() - interval '10 minutes'`)) >= 1, 'RETURN_* notification');
  await session(b, OUT, BUYER, PW, async ({ p, go, shot, type, tap, has, sem, calls }) => {
    await go(`/returns/${r.id}`);
    await shot(`${tag}-buyer-approved`);
    const addr = sql(`select return_address from stores where seller_id=(select seller_id from returns where id='${r.id}')`);
    check(`${tag}3 buyer: sees the approval and where to send the item`, (await has('ابعت المنتج على')) && (await has(addr.slice(0, 12))), addr);
    await tap('بعت المنتج للبائع', { wait: 1500 });
    await type(p.getByRole('textbox', { name: /شركة الشحن/ }).last(), 'بوسطة');
    r.tracking = `RT${Date.now() % 1000000}`;
    await type(p.getByRole('textbox', { name: /رقم البوليصة/ }).last(), r.tracking);
    await p.getByRole('button', { name: 'تأكيد' }).last().click();
    await p.waitForTimeout(3500);
    await sem();
    await shot(`${tag}-buyer-shipped`);
    const row = sql(`select status || '|' || coalesce(return_carrier,'') || '|' || coalesce(return_tracking,'') from returns where id='${r.id}'`).split('|');
    check(`${tag}3 buyer: return shipment recorded (RETURN_IN_TRANSIT, carrier + tracking)`, calls.some((c) => c.includes(`/returns/${r.id}/ship-back 200`)) && row[0] === 'RETURN_IN_TRANSIT' && row[2] === r.tracking, row.join(' · '));
  });
  await session(b, OUT, SELLER, PW, async ({ p, go, shot, tap, tapFresh, confirmDialog, has }) => {
    await go(`/seller/returns/${r.id}`);
    check(`${tag}4 seller: sees the buyer's carrier and tracking`, await has(r.tracking), r.tracking);
    const stepTo = async (label, expected) => {
      await tap(label, { wait: 3500 });
      await confirmDialog();
      const st = sql(`select status from returns where id='${r.id}'`);
      check(`${tag}4 seller: «${label}» → ${expected}`, st === expected, `status=${st}`);
    };
    await stepTo('استلمت المنتج المرتجع', 'RECEIVED');
    await stepTo('بدء الفحص', 'INSPECTION');
    await shot(`${tag}-seller-inspection`);
    const before = sql(`select count(*) from journal_entries where source_id='${o.so}'`);
    await tap('قبول الإرجاع وطلب الاسترداد', { wait: 1500 });
    await shot(`${tag}-seller-accept-sheet`);
    await tapFresh(p.getByRole('button', { name: 'تأكيد' }).last(), 3500);
    await shot(`${tag}-seller-refund-requested`);
    const ref = sql(`select r.id || '|' || r.number || '|' || r.status || '|' || r.amount from refunds r where r.source_type='RETURN' and r.source_id='${r.id}'`).split('|');
    [r.refundId, r.refundNumber, , r.amount] = ref;
    check(`${tag}4 seller: accepts → REFUND_PENDING, one refund REQUESTED for EDMN, no journal entry yet`, sql(`select status from returns where id='${r.id}'`) === 'REFUND_PENDING' && ref[2] === 'REQUESTED' && sql(`select count(*) from journal_entries where source_id='${o.so}'`) === before, `refund #${r.refundNumber} ${Number(r.amount) / 100} EGP`);
  });
  return r;
}

/** Maker (finance@) asks for the approval, Checker (checker@) approves it — in the web console. */
async function approveInConsole(b, r, tag) {
  await staff(b, 'finance@edmn.local', async (p) => {
    await p.goto(`${WEB}/admin/refunds?tab=requested`);
    const row = refundRow(p, r.refundNumber);
    await row.waitFor({ timeout: 30000 });
    check(`${tag}5 console: no approve button for the Maker`, (await row.getByRole('button', { name: /^اعتماد استرداد/ }).count()) === 0 && (await row.getByText('طلب اعتماد', { exact: false }).count()) > 0, 'maker sees only «request», no approve');
    await row.getByLabel('سبب طلب الحركة').fill('إرجاع مستلم ومفحوص من البائع — طلب اعتماد الاسترداد');
    await submitIn(p, row, /^طلب /);
    await p.screenshot({ path: `${OUT}/${tag}-console-maker.png`, fullPage: true });
    const m = sql(`select status || '|' || requested_by from financial_movement_requests where kind='REFUND_APPROVAL' and entity_id='${r.refundId}' order by requested_at desc limit 1`).split('|');
    check(`${tag}5 console: Maker request PENDING; the refund is still REQUESTED`, m[0] === 'PENDING' && sql(`select status from refunds where id='${r.refundId}'`) === 'REQUESTED', `request=${m[0]}`);
  });
  await staff(b, 'checker@edmn.local', async (p) => {
    await p.goto(`${WEB}/admin/refunds?tab=requested`);
    const row = refundRow(p, r.refundNumber);
    await row.waitFor({ timeout: 30000 });
    await row.getByLabel('سبب الاعتماد').fill('مطابق: الوحدة المرتجعة مستلمة');
    await submitIn(p, row, /اعتماد استرداد/);
    await p.screenshot({ path: `${OUT}/${tag}-console-checker.png`, fullPage: true });
    const st = sql(`select status from refunds where id='${r.refundId}'`);
    check(`${tag}5 console: a different person (Checker) approves → APPROVED; reversal journal balanced`, st === 'APPROVED' && balanced(`e.entry_type='REFUND' and e.idempotency_key='refund:${r.refundId}'`), `status=${st}`);
  });
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const named = (process.env.JOURNEY_ORDERS ?? '').split(',').filter(Boolean);
  const byNumber = (n) => {
    const [id, so] = sql(`select o.id || '|' || so.id from orders o join seller_orders so on so.order_id = o.id where o.number=${Number(n)}`).split('|');
    return { id, number: n, so };
  };

  if (ONLY.includes('R')) {
    const o = named[0] ? byNumber(named[0]) : deliveredOrder();
    const r = await returnToRefundPending(b, o, 'r', { evidenceCheck: true });
    await approveInConsole(b, r, 'r');
    await staff(b, 'finance@edmn.local', async (p) => {
      await p.goto(`${WEB}/admin/refunds?tab=payout`);
      const row = refundRow(p, r.refundNumber);
      await row.waitFor({ timeout: 30000 });
      r.ref = `TEST-RFD-${Date.now() % 1000000}`;
      await row.getByLabel('مرجع التحويل').fill(r.ref);
      await submitIn(p, row, /تسجيل صرف/);
      await p.screenshot({ path: `${OUT}/r-console-paid.png`, fullPage: true });
      const st = sql(`select status || '|' || coalesce(paid_reference,'') from refunds where id='${r.refundId}'`).split('|');
      check('r6 console: TEST payout recorded with its reference → COMPLETED; payout journal balanced', st[0] === 'COMPLETED' && st[1] === r.ref && balanced(`e.entry_type='REFUND_PAID' and e.source_id='${r.refundId}'`), st.join(' · '));
    });
    check('r6 return: REFUNDED after the payout', sql(`select status from returns where id='${r.id}'`) === 'REFUNDED', 'REFUNDED');
    check('r6 money: one payout entry, no seller release, every entry of this order balanced', sql(`select count(*) from journal_entries where entry_type='REFUND_PAID' and source_id='${r.refundId}'`) === '1' && sql(`select count(*) from journal_entries where entry_type='SELLER_RELEASE' and source_id='${o.so}'`) === '0' && balanced(`e.source_id in ('${o.so}', '${r.refundId}', '${o.id}')`), 'ledger');
    await session(b, OUT, BUYER, PW, async ({ go, shot, has }) => {
      await go(`/returns/${r.id}`);
      await shot('r7-buyer-refunded');
      check('r7 buyer app: return refunded, refund paid with the transfer reference', (await has('تم الاسترداد')) && (await has(r.ref)), r.ref);
    });
    await session(b, OUT, SELLER, PW, async ({ go, shot, has }) => {
      await go(`/seller/returns/${r.id}`);
      await shot('r7-seller-refunded');
      check('r7 seller app: the return reads refunded, no further steps', (await has('تم الاسترداد')) && !(await has('استلمت المنتج المرتجع')), 'REFUNDED');
    });
  }

  if (ONLY.includes('RF')) {
    const o = named[1] ? byNumber(named[1]) : deliveredOrder();
    const r = await returnToRefundPending(b, o, 'rf');
    await approveInConsole(b, r, 'rf');
    await staff(b, 'finance@edmn.local', async (p) => {
      await p.goto(`${WEB}/admin/refunds?tab=payout`);
      const row = refundRow(p, r.refundNumber);
      await row.waitFor({ timeout: 30000 });
      await row.getByLabel('سبب فشل التحويل').fill('البنك رفض التحويل (اختبار)');
      await submitIn(p, row, /تسجيل فشل التحويل/);
      await p.goto(`${WEB}/admin/refunds?tab=payout`);
      const after = refundRow(p, r.refundNumber);
      await after.waitFor({ timeout: 30000 });
      await p.screenshot({ path: `${OUT}/rf-console-failed.png`, fullPage: true });
      check('rf6 console: failure recorded (FAILED); the payout form is gone; the money stays owed', sql(`select status from refunds where id='${r.refundId}'`) === 'FAILED' && (await after.getByRole('button', { name: /تسجيل صرف/ }).count()) === 0 && sql(`select count(*) from journal_entries where entry_type='REFUND_PAID' and source_id='${r.refundId}'`) === '0', 'FAILED, no payout entry');
      check('rf6 console: the person who recorded the failure is not offered to resolve it', (await after.getByRole('button', { name: /إثبات أن التحويل لم يخرج/ }).count()) === 0, 'not offered');
    });
    await session(b, OUT, BUYER, PW, async ({ go, shot, has }) => {
      await go(`/returns/${r.id}`);
      await shot('rf6-buyer-failed');
      check('rf6 buyer app: the refund is not shown as paid', !(await has('TEST-')) && sql(`select status from returns where id='${r.id}'`) === 'REFUND_PENDING', 'not paid');
    });
    await staff(b, 'checker@edmn.local', async (p) => {
      await p.goto(`${WEB}/admin/refunds?tab=payout`);
      const row = refundRow(p, r.refundNumber);
      await row.waitFor({ timeout: 30000 });
      await row.getByLabel('دليل عدم خروج التحويل').fill('STATEMENT-TEST-0001');
      await row.getByLabel('سبب الحسم').fill('كشف الحساب يثبت أن التحويل لم يخرج');
      await submitIn(p, row, /إثبات أن التحويل لم يخرج/);
      await p.screenshot({ path: `${OUT}/rf-console-resolved.png`, fullPage: true });
      check('rf7 console: a second person proves no money left → APPROVED (payable again)', sql(`select status from refunds where id='${r.refundId}'`) === 'APPROVED', 'APPROVED');
    });
    await staff(b, 'finance@edmn.local', async (p) => {
      await p.goto(`${WEB}/admin/refunds?tab=payout`);
      const row = refundRow(p, r.refundNumber);
      await row.waitFor({ timeout: 30000 });
      r.ref = `TEST-RFD-${Date.now() % 1000000}`;
      await row.getByLabel('مرجع التحويل').fill(r.ref);
      await submitIn(p, row, /تسجيل صرف/);
      const st = sql(`select status || '|' || coalesce(paid_reference,'') from refunds where id='${r.refundId}'`).split('|');
      check('rf8 console: retry paid once → COMPLETED; exactly one payout entry; balanced', st[0] === 'COMPLETED' && sql(`select count(*) from journal_entries where entry_type='REFUND_PAID' and source_id='${r.refundId}'`) === '1' && balanced(`e.source_id in ('${o.so}', '${r.refundId}')`), st.join(' · '));
    });
    await session(b, OUT, BUYER, PW, async ({ go, shot, has }) => {
      await go(`/returns/${r.id}`);
      await shot('rf8-buyer-refunded');
      check('rf8 buyer app: refunded with the retry reference', (await has('تم الاسترداد')) && (await has(r.ref)), r.ref);
    });
  }

  await b.close();
  const pass = results.filter((x) => x.startsWith('PASS')).length;
  const fail = results.length - pass;
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  writeFileSync(`${OUT}/results.txt`, results.join('\n') + `\n\n${pass} PASS / ${fail} FAIL\n`);
  process.exit(fail ? 1 : 0);
})();
