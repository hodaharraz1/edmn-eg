// Unified build: UI → API → DB journeys on the Flutter web build against the local server (edmn_device DB, Real Money OFF).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/mobile/screenshots/e2e';
const BASE = process.env.APP_URL ?? 'http://localhost:8099/';
const DB = process.env.JOURNEY_DB ?? 'postgresql://edmn:edmn@127.0.0.1:55432/edmn_device'; // a LOCAL demo database only
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('journeys write demo data: local databases only');
const sql = (q) => execSync(`psql ${DB} -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const results = [];
const check = (name, ok, detail) => { const l = `${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`; results.push(l); console.log(l); };

async function session(b, email, fn) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage();
  const calls = [];
  p.on('response', (r) => { if (r.url().includes('/api/v1/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  const sem = async () => { await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await p.waitForTimeout(600); };
  const go = async (hash) => { await p.goto(BASE + '#' + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(3500); await sem(); };
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${n}.png` }); };
  const type = async (loc, text) => { await loc.click(); await p.waitForTimeout(500); await p.keyboard.type(text, { delay: 25 }); };
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000); await sem();
  try { await p.getByRole('button', { name: 'تخطي' }).first().click(); await p.waitForTimeout(1500); } catch {}
  await go('/sign-in');
  const boxes = p.getByRole('textbox');
  await type(boxes.nth(0), email);
  await type(boxes.nth(1), 'Demo@12345');
  await p.getByRole('button', { name: 'تسجيل الدخول' }).first().click(); await p.waitForTimeout(4500);
  check(`${email.split('@')[0]}: sign-in`, calls.some((c) => c.startsWith('POST /api/v1/auth/login 200')), calls.filter((c) => c.includes('login')).join(' | '));
  try { await fn({ p, go, shot, type, sem, calls }); } catch (e) { check(`${email}: journey error`, false, String(e).split('\n')[0]); await shot(`error-${email.split('@')[0]}`); }
  await ctx.close();
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});

  await session(b, 'mona@demo.edmn.local', async ({ p, go, shot, type, sem, calls }) => {
    const uid = sql("select id from users where email='mona@demo.edmn.local'");
    // 1. Cart: add from the product page.
    const cartBefore = Number(sql(`select coalesce(sum(ci.quantity),0) from cart_items ci join carts c on c.id=ci.cart_id where c.user_id='${uid}'`));
    await go('/products/' + encodeURIComponent(sql("select slug from products where title_ar like 'سامسونج%' limit 1")));
    await shot('e1-product');
    await p.getByRole('button', { name: 'أضف إلى السلة' }).first().click(); await p.waitForTimeout(3000); await sem();
    const cartAfter = Number(sql(`select coalesce(sum(ci.quantity),0) from cart_items ci join carts c on c.id=ci.cart_id where c.user_id='${uid}'`));
    check('cart: UI → POST /cart/items', calls.some((c) => /POST \/api\/v1\/cart\/items 20\d/.test(c)), calls.slice(-1).join(''));
    check('cart: DB quantity +1', cartAfter === cartBefore + 1, `${cartBefore} → ${cartAfter}`);
    await go('/cart'); await shot('e2-cart');

    // 2. Chat: send a message in the order conversation.
    // Opened through the UI (order page → «مراسلة البائع»), so the journey also works on a freshly seeded database.
    let conv = sql(`select id from conversations where buyer_user_id='${uid}' order by created_at limit 1`);
    if (!conv) {
      const order = sql(`select id from orders where customer_id='${uid}' order by placed_at limit 1`);
      await go(`/orders/${order}`);
      await p.getByRole('button', { name: 'مراسلة البائع' }).first().click(); await p.waitForTimeout(3500); await sem();
      check('chat: UI opens the order conversation', calls.some((c) => /POST \/api\/v1\/seller-orders\/.+\/conversation 20\d/.test(c)), calls.slice(-1).join(''));
      conv = sql(`select id from conversations where buyer_user_id='${uid}' order by created_at limit 1`);
    }
    const msgsBefore = Number(sql(`select count(*) from conversation_messages where conversation_id='${conv}'`));
    await go(`/messages/${conv}`);
    const text = `رسالة من اختبار الواجهة ${Date.now() % 100000}`;
    await type(p.getByRole('textbox').last(), text);
    await p.getByRole('button', { name: 'إرسال' }).last().click(); await p.waitForTimeout(3500); await sem();
    await shot('e3-chat-sent');
    const msgsAfter = Number(sql(`select count(*) from conversation_messages where conversation_id='${conv}'`));
    check('chat: UI → POST messages', calls.some((c) => /POST \/api\/v1\/conversations\/.+\/messages 20\d/.test(c)), calls.slice(-1).join(''));
    check('chat: exactly one new DB row with the text', msgsAfter === msgsBefore + 1 && sql(`select count(*) from conversation_messages where conversation_id='${conv}' and body='${text}'`) === '1', `${msgsBefore} → ${msgsAfter}`);

    // 3. Support ticket.
    const tBefore = Number(sql(`select count(*) from support_tickets where requester_user_id='${uid}'`));
    await go('/support/new');
    const subj = `اختبار واجهة ${Date.now() % 100000}`;
    await type(p.getByRole('textbox').nth(0), subj);
    await type(p.getByRole('textbox').nth(1), 'وصف المشكلة من اختبار الواجهة الكامل للتطبيق');
    await shot('e4-ticket-form');
    await p.getByRole('button', { name: 'إرسال التذكرة' }).first().click(); await p.waitForTimeout(3500); await sem();
    await shot('e5-ticket-created');
    check('support: UI → POST ticket', calls.some((c) => /POST \/api\/v1\/support\/tickets 20\d/.test(c)), calls.slice(-1).join(''));
    check('support: DB row OPEN with the subject', Number(sql(`select count(*) from support_tickets where requester_user_id='${uid}'`)) === tBefore + 1 && sql(`select status from support_tickets where subject='${subj}'`) === 'OPEN', `subject=${subj}`);

    // 4. Notifications: mark all read.
    sql(`update notifications set read_at=null where user_id='${uid}' and category='GENERAL'`);
    await go('/notifications'); await shot('e6-notifications');
    await p.getByRole('button', { name: 'تعليم الكل كمقروء' }).first().click(); await p.waitForTimeout(2500);
    check('notifications: DB unread → 0', sql(`select count(*) from notifications where user_id='${uid}' and category='GENERAL' and read_at is null`) === '0', calls.slice(-1).join(''));

    // 5. Orders and dispute views load real data.
    await go('/orders'); await shot('e7-orders');
    const oid = sql(`select id from orders where customer_id='${uid}' limit 1`);
    await go(`/orders/${oid}`); await shot('e8-order-100002');
  });

  await session(b, 'techzone@demo.edmn.local', async ({ go, shot }) => {
    await go('/wallet'); await shot('e9-wallet-techzone');
    await go('/seller/orders'); await shot('e10-seller-orders');
    check('seller: wallet and orders screens rendered', true, 'see screenshots');
  });

  await session(b, 'ahmed@demo.edmn.local', async ({ go, shot }) => {
    const did = sql("select id from external_deals where number=500007");
    await go(`/deals/${did}`); await shot('e11-deal-500007');
    check('deal: screen rendered', true, 'see screenshot');
  });

  await b.close();
  writeFileSync(`${OUT}/RESULTS.txt`, results.join('\n') + '\n');
})();
