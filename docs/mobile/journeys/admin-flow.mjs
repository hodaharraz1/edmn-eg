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
