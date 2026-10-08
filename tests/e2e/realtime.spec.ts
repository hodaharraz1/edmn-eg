import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { adminLogin, customerLogin, q } from './helpers';

/**
 * Live messaging, notifications and navigation in the real UI (local + staging). Demo accounts only; the
 * owner's acceptance order A-100016 is excluded from every fixture and never touched.
 * Numbers refer to the acceptance matrix (§78 messaging, §79 navigation) and scenarios A–G (§82).
 */
test.describe.configure({ mode: 'serial' });

const stamp = () => Date.now().toString(36);
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

type Fx = { so_id: string; order_id: string; number: string; suffix: string; buyer: string; seller: string };
let fx: Fx;
let convId = '';

async function fixture(): Promise<Fx> {
  const [row] = await q<Fx>(`
    select so.id as so_id, o.id as order_id, o.number::text as number, so.suffix, bu.email as buyer, su.email as seller
      from seller_orders so join orders o on o.id = so.order_id join users bu on bu.id = o.customer_id
      join sellers se on se.id = so.seller_id join users su on su.id = se.owner_user_id
     where o.number <> 100016 and bu.email like '%@demo.edmn.local' and su.email like '%@demo.edmn.local' and se.status = 'APPROVED'
       and so.status in ('PAID','SELLER_CONFIRMED','PROCESSING','READY_TO_SHIP','SHIPPED','DELIVERED')
     order by o.number desc, so.suffix desc limit 1`);
  expect(row, 'a paid demo sub-order (never A-100016)').toBeTruthy();
  expect(row.number).not.toBe('100016');
  return row;
}

/** Count chimes and detect full page reloads (a reload clears the marker). */
async function instrument(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __chimes: number; __alive: boolean };
    w.__chimes = 0;
    w.__alive = true;
    window.addEventListener('edmn:chime', () => (w.__chimes += 1));
  });
  await page.keyboard.press('Shift'); // a user gesture: browsers only allow audio after one
}
const chimes = (page: Page) => page.evaluate(() => (window as unknown as { __chimes?: number }).__chimes ?? 0);
const alive = (page: Page) => page.evaluate(() => (window as unknown as { __alive?: boolean }).__alive === true);
async function badge(page: Page, testId: string) {
  const el = page.getByTestId(testId).first();
  return (await el.count()) ? Number((await el.textContent())?.replace('+', '') ?? 0) : 0;
}

async function sendFrom(page: Page, text: string) {
  await page.getByTestId('message-input').fill(text);
  await page.getByTestId('message-send').click();
  await expect(page.getByTestId('message-status')).toContainText('تم الإرسال');
}

async function setSound(browser: Browser, email: string, on: boolean, base = '/account') {
  const page = await customerLogin(browser, email);
  await page.goto(`${base}/notifications/settings`);
  const sw = page.getByTestId('pref-sound');
  if ((await sw.isChecked()) !== on) await sw.locator('xpath=..').click();
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ إعدادات الإشعارات').first()).toBeVisible();
  await page.context().close();
}

test.beforeAll(async () => {
  fx = await fixture();
});

test('setup: buyer opens the sub-order conversation from the order page (58, 57)', async ({ browser }) => {
  const page = await customerLogin(browser, fx.buyer);
  await page.goto(`/account/orders/${fx.order_id}`);
  const cta = page.locator('section', { hasText: `شحنة ${fx.number}-${fx.suffix}` }).getByTestId('message-cta');
  await cta.click();
  await page.waitForURL(/\/account\/messages\/[0-9a-f-]{36}$/);
  convId = page.url().split('/').pop()!;
  // 57 — the deep link opens it directly too
  await page.goto(`/account/messages/${convId}`);
  await expect(page.getByTestId('conversation-context')).toContainText(`${fx.number}-${fx.suffix}`);
  // 59 — conversation → order
  await page.getByTestId('conversation-context-link').click();
  await page.waitForURL(new RegExp(`/account/orders/${fx.order_id}$`));
  await page.context().close();
});

test('A — buyer browsing a product page: badge + toast + chime without refresh; the toast opens the conversation (1, 3, 7, 15, 16, 17, 51)', async ({ browser }) => {
  await setSound(browser, fx.buyer, true);
  const [prod] = await q<{ slug: string }>(`select slug from products where status = 'LIVE' order by created_at limit 1`);
  const buyer = await customerLogin(browser, fx.buyer);
  await buyer.setViewportSize({ width: 1440, height: 900 });
  await buyer.goto(`/product/${encodeURIComponent(prod.slug)}`);
  await instrument(buyer);
  await buyer.waitForTimeout(1500);
  const before = await badge(buyer, 'nav-unread-messages');

  const seller = await customerLogin(browser, fx.seller);
  await seller.goto(`/seller/messages/${convId}`);
  const text = `طلبك اتجهز للشحن ${stamp()}`;
  await sendFrom(seller, text);

  const toast = buyer.getByTestId('message-toast').first();
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await expect(toast).toContainText('بخصوص الطلب');
  await expect(toast).toContainText(`#${fx.number}-${fx.suffix}`);
  await expect.poll(() => badge(buyer, 'nav-unread-messages'), { timeout: 20_000 }).toBe(before + 1);
  await expect(buyer.getByTestId('header-messages')).toHaveAttribute('aria-label', /الرسائل، /);
  expect(await chimes(buyer)).toBeGreaterThanOrEqual(1); // 17 — sound ON
  expect(await alive(buyer)).toBe(true); // no page reload happened
  await toast.getByTestId('toast-open').click();
  await buyer.waitForURL(new RegExp(`/account/messages/${convId}$`));
  await expect(buyer.getByTestId('message-body').filter({ hasText: text })).toBeVisible();
  await buyer.context().close();
  await seller.context().close();
});

test('B — seller on the Finance page: badge + toast without refresh; opens the right conversation (2, 8, 15, 16, 54)', async ({ browser }) => {
  const seller = await customerLogin(browser, fx.seller);
  await seller.setViewportSize({ width: 1440, height: 900 });
  await seller.goto('/seller/finance');
  await instrument(seller);
  await seller.waitForTimeout(1500);
  const before = await badge(seller, 'nav-unread-messages');

  const buyer = await customerLogin(browser, fx.buyer);
  await buyer.goto(`/account/messages/${convId}`);
  const text = `ممكن أعرف ميعاد الشحن؟ ${stamp()}`;
  await sendFrom(buyer, text);

  const toast = seller.getByTestId('message-toast').first();
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await expect(toast).toContainText('رسالة جديدة من المشتري');
  await expect.poll(() => badge(seller, 'nav-unread-messages'), { timeout: 20_000 }).toBe(before + 1);
  await expect(seller.locator('aside').getByTestId('unread-badge')).toBeVisible();
  expect(await alive(seller)).toBe(true);
  await toast.getByTestId('toast-open').click();
  await seller.waitForURL(new RegExp(`/seller/messages/${convId}$`));
  await expect(seller.getByTestId('message-body').filter({ hasText: text })).toBeVisible();
  await buyer.context().close();
  await seller.context().close();
});

test('C — both have the conversation open: messages and «seen» appear live; scrolled-up reader gets «رسائل جديدة» (4, 14, 19-20 scroll)', async ({ browser }) => {
  const buyer = await customerLogin(browser, fx.buyer);
  await buyer.setViewportSize({ width: 390, height: 520 });
  await buyer.goto(`/account/messages/${convId}`);
  await instrument(buyer);
  const seller = await customerLogin(browser, fx.seller);
  await seller.goto(`/seller/messages/${convId}`);
  await instrument(seller);
  // Late layout shift above the thread (fonts/images loading on a long conversation): the reader did not scroll
  // away, so new messages must still follow and be marked read (regression: staging run on 7f92d80).
  await buyer.waitForTimeout(500);
  await buyer.evaluate(() => {
    const d = document.createElement('div');
    d.style.height = '900px';
    document.querySelector('section[aria-label="الرسائل"]')?.before(d);
  });

  const text = `أهلاً، ده تحديث مباشر ${stamp()}`;
  await sendFrom(seller, text);
  await expect(buyer.getByTestId('message-body').filter({ hasText: text })).toBeVisible({ timeout: 20_000 });
  expect(await alive(buyer)).toBe(true); // arrived without any reload
  expect(await chimes(buyer)).toBe(0); // no toast/chime for the conversation already on screen
  // 14 — the buyer had it on screen → seller sees «اتشافت» live
  await expect(seller.locator('[data-testid="message"]').filter({ hasText: text }).getByTestId('message-read')).toBeVisible({ timeout: 20_000 });

  // Draft text is preserved while messages arrive
  await buyer.getByTestId('message-input').fill('مسودة لسه ماتبعتتش');
  // scrolled up → no forced scroll, a «رسائل جديدة» pill instead
  await buyer.evaluate(() => window.scrollTo(0, 0));
  const scrollBefore = await buyer.evaluate(() => window.scrollY);
  const text2 = `رسالة وانت فوق ${stamp()}`;
  await sendFrom(seller, text2);
  await expect(buyer.getByTestId('new-messages-pill')).toBeVisible({ timeout: 20_000 });
  expect(await buyer.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await expect(buyer.getByTestId('message-input')).toHaveValue('مسودة لسه ماتبعتتش');
  await buyer.getByTestId('new-messages-pill').click();
  await expect(buyer.getByTestId('message-body').filter({ hasText: text2 })).toBeInViewport();
  await buyer.context().close();
  await seller.context().close();
});

test('18 — sound OFF: the toast still appears, no chime', async ({ browser }) => {
  await setSound(browser, fx.buyer, false);
  const buyer = await customerLogin(browser, fx.buyer);
  await buyer.goto('/account/orders');
  await instrument(buyer);
  await buyer.waitForTimeout(1500);
  const seller = await customerLogin(browser, fx.seller);
  await seller.goto(`/seller/messages/${convId}`);
  await sendFrom(seller, `بدون صوت ${stamp()}`);
  await expect(buyer.getByTestId('message-toast').first()).toBeVisible({ timeout: 20_000 });
  expect(await chimes(buyer)).toBe(0);
  await setSound(browser, fx.buyer, true);
  await buyer.context().close();
  await seller.context().close();
});

test('F + E — returning later: unread count, conversation on top, unread filter; email fallback recorded (5, 6, 25, 65, 66)', async ({ browser }) => {
  const seller = await customerLogin(browser, fx.seller);
  await seller.goto(`/seller/messages/${convId}`);
  const text = `رسالة وانت مش موجود ${stamp()}`;
  await sendFrom(seller, text);
  await seller.context().close();

  const buyer = await customerLogin(browser, fx.buyer);
  await buyer.goto('/account/messages');
  const first = buyer.getByTestId('conversation-row').first();
  await expect(first).toHaveAttribute('href', `/account/messages/${convId}`); // 65 — latest activity first
  expect(Number(await first.getAttribute('data-unread'))).toBeGreaterThan(0);
  await expect(buyer.getByTestId('nav-unread-messages').first()).toBeVisible();
  await buyer.goto('/account/messages?f=unread'); // 66
  const rows = buyer.getByTestId('conversation-row');
  expect(await rows.count()).toBeGreaterThan(0);
  for (const r of await rows.all()) expect(Number(await r.getAttribute('data-unread'))).toBeGreaterThan(0);
  // E — the fallback email is decided server-side (queued after the delay, or suppressed by burst/cooldown), never per message
  const [m] = await q<{ id: string }>(`select id from conversation_messages where conversation_id = $1 order by created_at desc limit 1`, [convId]);
  const emails = await q<{ status: string; reason: string | null }>(
    `select d.status, d.reason from notification_deliveries d join users u on u.id = d.recipient_user_id where d.message_id = $1 and d.channel = 'EMAIL' and u.email = $2`,
    [m.id, fx.buyer],
  );
  expect(emails).toHaveLength(1);
  expect(['QUEUED', 'SENT', 'SUPPRESSED']).toContain(emails[0].status);
  await buyer.goto(`/account/messages/${convId}`);
  await expect(buyer.getByTestId('message-body').filter({ hasText: text })).toBeVisible();
  await buyer.context().close();
});

test('G — chat «استلمت» / «تم التسليم» changes nothing financial or delivery-related (38-41, 46)', async ({ browser }) => {
  const snap = async () =>
    (
      await q<{ s: string }>(
        `select json_build_object('so', (select row_to_json(x) from (select status, receipt_basis, receipt_confirmed_by, delivered_at, completed_at, funds_released_at, seller_net, financial_hold, updated_at from seller_orders where id = $1) x),
                'journals', (select count(*) from journal_entries where source_id = $1::text), 'dr', (select sum(debit) from journal_lines), 'cr', (select sum(credit) from journal_lines))::text as s`,
        [fx.so_id],
      )
    )[0].s;
  const before = await snap();
  const buyer = await customerLogin(browser, fx.buyer);
  await buyer.goto(`/account/messages/${convId}`);
  await sendFrom(buyer, 'استلمت');
  const seller = await customerLogin(browser, fx.seller);
  await seller.goto(`/seller/messages/${convId}`);
  await sendFrom(seller, 'تم التسليم');
  await expect(buyer.getByTestId('message-body').filter({ hasText: 'تم التسليم' }).last()).toBeVisible({ timeout: 20_000 });
  const after = await snap();
  const b = JSON.parse(before);
  const a = JSON.parse(after);
  expect(a.so).toEqual(b.so);
  expect(a.journals).toBe(b.journals);
  expect(a.dr).toBe(a.cr);
  await buyer.context().close();
  await seller.context().close();
});

test('notification bell, notification center (messages filter, open → conversation) and settings (55, 56)', async ({ browser }) => {
  const buyer = await customerLogin(browser, fx.buyer);
  await buyer.setViewportSize({ width: 1440, height: 900 });
  await buyer.goto('/account');
  await expect(buyer.getByTestId('header-notifications')).toHaveAttribute('aria-label', /^الإشعارات/);
  await buyer.getByTestId('header-notifications').click();
  await buyer.waitForURL(/\/account\/notifications$/);
  await buyer.goto('/account/notifications?f=messages');
  const item = buyer.getByTestId('notification-item').filter({ hasText: 'رسالة جديدة من' }).first();
  await expect(item).toBeVisible();
  await item.getByRole('link').click();
  await buyer.waitForURL(/\/account\/messages\/[0-9a-f-]{36}$/);
  await buyer.goto('/account/notifications');
  await buyer.getByTestId('notification-settings-link').click();
  await buyer.waitForURL(/\/account\/notifications\/settings$/);
  for (const id of ['pref-in-app', 'pref-sound', 'pref-push', 'pref-email', 'pref-preview']) await expect(buyer.getByTestId(id)).toBeAttached();
  await buyer.context().close();
});

test('push opt-in: explanation first, permission only after the click; denied and unsupported handled (19, 20, 21, 73)', async ({ browser }) => {
  // The OS permission dialog cannot be automated: the browser API is instrumented to observe our calls.
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __permRequests: number; __perm: string };
    w.__permRequests = 0;
    w.__perm = sessionStorage.getItem('perm') ?? 'default';
    try {
      Object.defineProperty(Notification, 'permission', { get: () => w.__perm, configurable: true });
      Notification.requestPermission = async () => {
        w.__permRequests += 1;
        w.__perm = 'denied';
        sessionStorage.setItem('perm', 'denied');
        return 'denied';
      };
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  const login = await customerLogin(browser, fx.buyer);
  await ctx.addCookies(await login.context().cookies());
  await login.context().close();
  await page.goto('/account/messages');
  await page.goto('/account/notifications/settings');
  const card = page.locator('[data-testid="push-optin"]').last();
  const state = await card.getAttribute('data-state');
  if (state === 'not-configured') {
    // Push not configured on this deployment: shown honestly, nothing is requested.
    await expect(card).toContainText('مش متاحة');
  } else {
    expect(state).toBe('default');
    await expect(card).toContainText('فعّل إشعارات اضمن علشان تعرف فورًا لما البائع أو المشتري يبعتلك رسالة.');
    expect(await page.evaluate(() => (window as unknown as { __permRequests: number }).__permRequests)).toBe(0); // 19 — never on load
    await page.getByTestId('push-enable').click();
    await expect(card).toHaveAttribute('data-state', 'denied');
    expect(await page.evaluate(() => (window as unknown as { __permRequests: number }).__permRequests)).toBe(1);
    await page.reload();
    await expect(page.locator('[data-testid="push-optin"]').last()).toHaveAttribute('data-state', 'denied'); // 20 — not asked again
    await expect(page.getByTestId('push-enable')).toHaveCount(0);
  }
  await ctx.close();

  const ctx2 = await browser.newContext({ locale: 'ar-EG' });
  await ctx2.addInitScript(() => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
  });
  const login2 = await customerLogin(browser, fx.buyer);
  await ctx2.addCookies(await login2.context().cookies());
  await login2.context().close();
  const p2 = await ctx2.newPage();
  await p2.goto('/account/notifications/settings');
  await expect(p2.locator('[data-testid="push-optin"]').last()).toHaveAttribute('data-state', 'unsupported'); // 21
  await expect(p2.getByTestId('push-status')).toContainText('مش بيدعم');
  await ctx2.close();
});

test('navigation: buyer desktop + mobile, seller desktop + mobile, active states, back, unauthorized and empty (49-53, 61-64)', async ({ browser }) => {
  const buyer = await customerLogin(browser, fx.buyer);
  // 49 — desktop header
  await buyer.setViewportSize({ width: 1440, height: 900 });
  await buyer.goto('/');
  await buyer.getByTestId('header-messages').click();
  await buyer.waitForURL(/\/account\/messages$/);
  await expect(buyer.getByTestId('header-messages')).toHaveAttribute('aria-current', 'page');
  // 62 — inbox → conversation → browser back → inbox; in-page back link → inbox
  await buyer.locator(`a[href="/account/messages/${convId}"]`).first().click();
  await buyer.waitForURL(new RegExp(`/account/messages/${convId}$`));
  await expect(buyer.locator('nav[aria-label="قائمة الحساب"] a[aria-current="page"]')).toContainText('الرسائل'); // 61
  await buyer.goBack();
  await buyer.waitForURL(/\/account\/messages$/);
  await buyer.goto(`/account/messages/${convId}`);
  await buyer.getByTestId('conversation-back').click();
  await buyer.waitForURL(/\/account\/messages$/);
  // 50 — mobile bottom nav
  await buyer.setViewportSize({ width: 390, height: 844 });
  await buyer.goto('/');
  await expect(buyer.getByTestId('header-messages')).toBeHidden();
  await buyer.getByTestId('bottom-nav-messages').click();
  await buyer.waitForURL(/\/account\/messages$/);
  await expect(buyer.getByTestId('bottom-nav-messages')).toHaveAttribute('aria-current', 'page');
  await buyer.goto(`/account/messages/${convId}`);
  await expect(buyer.getByTestId('bottom-nav-messages')).toHaveAttribute('aria-current', 'page'); // 61 (nested route)
  // 64 — empty (filtered) state
  await buyer.goto('/account/messages?q=zzzz-no-match');
  await expect(buyer.getByText('مفيش محادثات مطابقة')).toBeVisible();
  await buyer.context().close();

  // 63 — another buyer: uniform not-found, nothing leaks
  const intruderEmail = fx.buyer === 'ahmed@demo.edmn.local' ? 'mona@demo.edmn.local' : 'ahmed@demo.edmn.local';
  const intruder = await customerLogin(browser, intruderEmail);
  await intruder.goto(`/account/messages/${convId}`);
  await expect(intruder.getByText(/مش موجود/).first()).toBeVisible();
  await expect(intruder.getByTestId('message-body')).toHaveCount(0);
  const live = await intruder.request.get(`/api/live?surface=account&conv=${convId}&visible=1`);
  expect((await live.json()).thread).toBeNull();
  await intruder.context().close();

  const seller = await customerLogin(browser, fx.seller);
  // 52 — seller desktop sidebar + header
  await seller.setViewportSize({ width: 1440, height: 900 });
  await seller.goto('/seller');
  await seller.locator('aside').getByRole('link', { name: /^الرسائل/ }).click();
  await seller.waitForURL(/\/seller\/messages$/);
  await expect(seller.locator('aside a[aria-current="page"]')).toContainText('الرسائل');
  await seller.goto(`/seller/messages/${convId}`);
  await expect(seller.locator('aside a[aria-current="page"]')).toContainText('الرسائل');
  // 53 — seller mobile: messages reachable from the top bar without opening the menu
  await seller.setViewportSize({ width: 390, height: 844 });
  await seller.goto('/seller/orders');
  await seller.getByTestId('seller-header-messages').click();
  await seller.waitForURL(/\/seller\/messages$/);
  await seller.getByTestId('seller-header-notifications').click();
  await seller.waitForURL(/\/seller\/notifications$/);
  await seller.context().close();
});

test('60 — protected deal page opens its conversation', async ({ browser }) => {
  const [deal] = await q<{ id: string; buyer: string }>(`
    select d.id, bu.email as buyer from external_deals d join users bu on bu.id = d.buyer_id
     where bu.email like '%@demo.edmn.local' and d.seller_joined_at is not null and d.status not in ('DRAFT','INVITED') order by d.number desc limit 1`);
  test.skip(!deal, 'no demo deal with a bound seller');
  const buyer = await customerLogin(browser, deal.buyer);
  await buyer.goto(`/account/deals/${deal.id}`);
  await buyer.getByTestId('message-cta').click();
  await buyer.waitForURL(/\/account\/messages\/[0-9a-f-]{36}$/);
  await expect(buyer.getByRole('navigation', { name: 'مسار التنقل' })).toContainText('الصفقات المحمية');
  await expect(buyer.getByTestId('conversation-context-link')).toHaveText('الرجوع للصفقة');
  await buyer.context().close();
});

for (const width of [390, 768, 1440]) {
  test(`responsive ${width}px: inbox, conversation, notifications, settings (buyer + seller) — RTL, no overflow, accessible (67-71)`, async ({ browser }) => {
    const buyer = await customerLogin(browser, fx.buyer);
    await buyer.setViewportSize({ width, height: 900 });
    for (const path of ['/account/messages', `/account/messages/${convId}`, '/account/notifications', '/account/notifications/settings']) {
      await buyer.goto(path);
      await buyer.waitForLoadState('networkidle');
      expect(await buyer.evaluate(() => document.documentElement.dir)).toBe('rtl');
      expect(await overflow(buyer), path).toBeLessThanOrEqual(1);
      if (width !== 768) {
        const res = await new AxeBuilder({ page: buyer }).withTags(['wcag2a', 'wcag2aa']).analyze();
        const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    }
    await buyer.context().close();
    const seller = await customerLogin(browser, fx.seller);
    await seller.setViewportSize({ width, height: 900 });
    for (const path of ['/seller/messages', `/seller/messages/${convId}`, '/seller/notifications', '/seller/notifications/settings', '/seller/finance']) {
      await seller.goto(path);
      await seller.waitForLoadState('networkidle');
      expect(await overflow(seller), path).toBeLessThanOrEqual(1);
    }
    await seller.context().close();
  });
}

test('admin: notification delivery health is read-only and shows channel status (58 ops)', async ({ browser }) => {
  const admin = await adminLogin(browser);
  await admin.goto('/admin/notifications?tab=health');
  await expect(admin.getByTestId('notification-health')).toBeVisible();
  await expect(admin.getByTestId('notification-health')).toContainText('IN_APP');
  await expect(admin.getByTestId('message-input')).toHaveCount(0); // staff cannot post as a participant from here
  await admin.context().close();
});
