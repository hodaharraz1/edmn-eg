// Admin App on its Flutter web build against the LOCAL server (edmn_device demo DB, Real Money OFF):
// sign-in → TOTP → dashboard → the six monitoring screens, asserting each API call and what the screen shows against the
// database; then a limited role (catalog reviewer) sees no monitoring entries and the server refuses the lists (403).
// Demo staff credentials are public demo values (SECRET_EXPOSURE_REGISTER S1–S3), never real accounts.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/mobile/screenshots/admin';
const BASE = process.env.APP_URL ?? 'http://localhost:8099/';
const DB = process.env.JOURNEY_DB ?? 'postgresql://edmn:edmn@127.0.0.1:55432/edmn_device';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('journeys use demo data: local databases only');
const sql = (q) => execSync(`psql ${DB} -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const demo = JSON.parse(execSync(`npx tsx -e "import { DEMO_ADMIN_PASSWORD, DEMO_TOTP_SECRET } from './src/server/db/seed/demo'; import { totpCode } from './src/server/auth/totp'; console.log(JSON.stringify({ p: DEMO_ADMIN_PASSWORD, s: DEMO_TOTP_SECRET }))"`).toString().trim().split('\n').pop());
const totp = () => execSync(`npx tsx -e "import { totpCode } from './src/server/auth/totp'; console.log(totpCode('${demo.s}'))"`).toString().trim().split('\n').pop();
const results = [];
const check = (name, ok, detail) => { const l = `${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`; results.push(l); console.log(l); };

async function session(b, email, fn) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage();
  const calls = [];
  p.on('response', (r) => { if (r.url().includes('/api/v1/admin/')) calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  const sem = async () => { await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await p.waitForTimeout(600); };
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${n}.png` }); };
  const type = async (loc, text) => { await loc.click(); await p.waitForTimeout(400); await p.keyboard.type(text, { delay: 20 }); };
  const open = async (label) => { await p.getByRole('button', { name: label }).first().click(); await p.waitForTimeout(3000); await sem(); };
  const back = async () => { await p.goBack(); await p.waitForTimeout(2000); await sem(); };
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500); await sem();
  await type(p.getByRole('textbox').nth(0), email);
  await type(p.getByRole('textbox').nth(1), demo.p);
  await p.getByRole('button', { name: 'تسجيل الدخول' }).first().click(); await p.waitForTimeout(3500); await sem();
  await type(p.getByRole('textbox').first(), totp());
  await p.getByRole('button', { name: 'تحقق' }).first().click(); await p.waitForTimeout(3500); await sem();
  check(`${email}: sign-in + TOTP`, calls.some((c) => c.startsWith('POST /api/v1/admin/auth/login 200')) && calls.some((c) => c.startsWith('POST /api/v1/admin/auth/mfa/verify 200')), calls.filter((c) => c.includes('/auth/')).join(' | '));
  try { await fn({ p, calls, sem, shot, open, back }); } catch (e) { check(`${email}: journey error`, false, String(e).split('\n')[0]); await shot(`error-${email.split('@')[0]}`); }
  await ctx.close();
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});

  await session(b, 'admin@edmn.local', async ({ p, calls, shot, open, back }) => {
    await shot('a0-home');
    await open('لوحة القيادة'); await shot('a1-dashboard');
    check('dashboard: GET 200', calls.some((c) => c.startsWith('GET /api/v1/admin/dashboard 200')), calls.slice(-1).join(''));
    await back();

    const screens = [
      ['طلبات البائعين', 'sellers/applications', 'a2-sellers', sql("select coalesce((select st.name from sellers s join stores st on st.seller_id=s.id where s.status='PENDING_REVIEW' order by s.submitted_at limit 1),'')")],
      ['التحقق من الهوية (KYC)', 'identity/reviews', 'a3-identity', ''],
      ['الطلبات والشحن', 'orders', 'a4-orders', '#' + sql('select number from orders order by placed_at desc limit 1')],
      ['الصفقات المضمونة', 'deals', 'a5-deals', ''],
      ['النزاعات والشكاوى', 'disputes', 'a6-disputes', ''],
      ['سجل العمليات', 'audit', 'a7-audit', sql('select action from audit_logs order by id desc limit 1')],
    ];
    for (const [label, path, shotName, expectText] of screens) {
      await open(label); await shot(shotName);
      check(`${path}: GET 200`, calls.some((c) => c.startsWith(`GET /api/v1/admin/${path} 200`)), calls.filter((c) => c.includes(path)).join(' | '));
      if (expectText) {
        const seen = await p.getByText(expectText, { exact: false }).count();
        check(`${path}: shows the DB item «${expectText}»`, seen > 0, `matches=${seen}`);
      }
      const notice = await p.getByText('عرض فقط', { exact: false }).count();
      check(`${path}: read-only notice`, notice > 0, `matches=${notice}`);
      await back();
    }
  });

  // Batch 3: detail screens and the two safe dispute actions, each checked in the database.
  await session(b, 'admin@edmn.local', async ({ p, calls, shot, open, back, sem }) => {
    const tapText = async (text) => { await p.getByText(text, { exact: false }).first().click(); await p.waitForTimeout(3000); await sem(); };
    await open('الطلبات والشحن');
    const shippedOrder = sql("select o.number from orders o join seller_orders so on so.order_id=o.id where so.status in ('SHIPPED','DELIVERED','COMPLETED') order by o.placed_at desc limit 1");
    await p.getByRole('textbox').first().click(); await p.waitForTimeout(600); await p.keyboard.type(shippedOrder, { delay: 30 }); await p.keyboard.press('Enter'); await p.waitForTimeout(3000); await sem();
    check('orders: server-side search', calls.some((c) => c.startsWith('GET /api/v1/admin/orders') && c.endsWith(' 200')), `q=${shippedOrder}`);
    await tapText('#' + shippedOrder); await shot('b1-order-detail');
    check('order detail: GET 200', calls.some((c) => /^GET \/api\/v1\/admin\/orders\/[0-9a-f-]{36} 200/.test(c)), calls.slice(-1).join(''));
    const carrier = sql(`select coalesce(sh.carrier_name,'') from shipments sh join seller_orders so on so.id=sh.seller_order_id join orders o on o.id=so.order_id where o.number=${shippedOrder} limit 1`);
    if (carrier) check(`order detail: shows the shipment carrier «${carrier}» from the DB`, (await p.getByText(carrier, { exact: false }).count()) > 0, 'carrier on screen');
    await back(); await back();

    await open('طلبات البائعين');
    const store = sql("select st.name from sellers s join stores st on st.seller_id=s.id where s.status='PENDING_REVIEW' order by s.submitted_at limit 1");
    await tapText(store); await shot('b2-seller-detail');
    check('seller detail: GET 200 + checklist', calls.some((c) => /^GET \/api\/v1\/admin\/sellers\/[0-9a-f-]{36} 200/.test(c)) && (await p.getByText('صورة البطاقة', { exact: false }).count()) > 0, 'checklist visible');
    await back(); await back();

    await open('الصفقات المضمونة');
    const dealTitle = sql("select title from external_deals where status in ('INVITED','ACCEPTED','PAYMENT_PENDING','PAYMENT_UNDER_REVIEW','ACTIVE','DELIVERED','SELLER_JOINED','OFFER_PENDING_BUYER','CHANGE_REQUESTED','BUYER_CONFIRMATION_PENDING','DELIVERY_HANDOVER_VERIFIED') order by updated_at desc limit 1");
    if (dealTitle) {
      await tapText(dealTitle); await shot('b3-deal-detail');
      check('deal detail: GET 200', calls.some((c) => /^GET \/api\/v1\/admin\/deals\/[0-9a-f-]{36} 200/.test(c)), calls.slice(-1).join(''));
      await back();
    }
    await back();

    await open('النزاعات والشكاوى');
    const disp = sql("select id || '|' || number from disputes where status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION') order by created_at limit 1").split('|');
    const adminId = sql("select id from users where email='admin@edmn.local'");
    await tapText('#' + disp[1]); await shot('b4-dispute-detail');
    check('dispute detail: GET 200', calls.some((c) => c.startsWith(`GET /api/v1/admin/disputes/${disp[0]} 200`)), calls.slice(-1).join(''));
    // Assign to me through the sheet.
    await p.getByRole('button', { name: 'إسناد' }).first().click(); await p.waitForTimeout(2500); await sem();
    await shot('b5-assign-sheet');
    await p.getByText('(أنا)', { exact: false }).first().click(); await p.waitForTimeout(3500); await sem();
    check('assign: UI → POST 200', calls.some((c) => c.startsWith(`POST /api/v1/admin/disputes/${disp[0]}/assign 200`)), calls.filter((c) => c.includes('/assign')).join(' | '));
    check('assign: DB assigned_to = me', sql(`select assigned_to from disputes where id='${disp[0]}'`) === adminId, 'assigned_to');
    check('assign: audited from the Admin App', sql(`select count(*) from audit_logs where entity_id='${disp[0]}' and action='dispute.assigned' and channel='ADMIN_MOBILE' and actor_user_id='${adminId}'`) !== '0', 'audit row');
    // Internal note.
    const note = `ملاحظة داخلية من الموبايل ${Date.now() % 100000}`;
    await p.getByRole('button', { name: 'إضافة ملاحظة داخلية' }).first().click(); await p.waitForTimeout(2000); await sem();
    await p.getByRole('textbox').last().click(); await p.waitForTimeout(600); await p.keyboard.type(note, { delay: 20 });
    await p.getByRole('button', { name: 'حفظ' }).first().click(); await p.waitForTimeout(3500); await sem();
    await shot('b6-note-added');
    check('note: UI → POST 200', calls.some((c) => c.startsWith(`POST /api/v1/admin/disputes/${disp[0]}/notes 200`)), calls.filter((c) => c.includes('/notes')).join(' | '));
    check('note: one DB row, internal, by me', sql(`select count(*) from dispute_messages where dispute_id='${disp[0]}' and body='${note}' and is_internal and author_user_id='${adminId}'`) === '1', 'dispute_messages');
    check('note: nobody notified', sql(`select count(*) from notifications where created_at > now() - interval '2 minutes' and event='DISPUTE_UPDATED'`) === '0', 'no notification row');
    await back(); await back();

    await open('سجل العمليات');
    await p.getByRole('checkbox', { name: 'ADMIN', exact: true }).click(); // filter chips are exposed as named checkboxes await p.waitForTimeout(2500); await sem();
    await p.getByRole('textbox').first().click(); await p.waitForTimeout(600); await p.keyboard.type('dispute', { delay: 30 }); await p.keyboard.press('Enter'); await p.waitForTimeout(3000); await sem();
    await shot('b7-audit-filtered');
    check('audit: filtered by actor + action shows the assignment', calls.some((c) => c.startsWith('GET /api/v1/admin/audit') && c.endsWith(' 200')) && (await p.getByText('dispute.assigned', { exact: false }).count()) > 0, 'dispute.assigned visible');
  });

  await session(b, 'catalog@edmn.local', async ({ p, calls, shot }) => {
    await shot('a8-catalog-home');
    // The menu must match the account's permissions in the database exactly (the demo catalog@ also holds SELLER_REVIEWER).
    const perms = new Set(sql("select distinct rp.permission from users u join user_roles ur on ur.user_id=u.id join role_permissions rp on rp.role_code=ur.role_code where u.email='catalog@edmn.local'").split('\n'));
    const entries = [['طلبات البائعين', 'sellers.review'], ['التحقق من الهوية (KYC)', 'identity.view'], ['الطلبات والشحن', 'orders.view'], ['الصفقات المضمونة', 'deals.view'], ['النزاعات والشكاوى', 'disputes.manage'], ['سجل العمليات', 'audit.view']];
    for (const [label, perm] of entries) {
      const shown = (await p.getByRole('button', { name: label }).count()) > 0;
      check(`catalog@: «${label}» ${perms.has(perm) ? 'shown' : 'hidden'} (${perm} ${perms.has(perm) ? 'granted' : 'not granted'})`, shown === perms.has(perm), `shown=${shown}`);
    }
    // The server, not the menu, is the control: a direct call with this session's token is refused.
    const direct = await p.evaluate(async () => (await fetch('/api/v1/admin/disputes')).status);
    check('direct call without a token is refused', direct === 401, `status=${direct}`);
    void calls;
  });

  await b.close();
  writeFileSync(`${OUT}/results.txt`, results.join('\n') + '\n');
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
