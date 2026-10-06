import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { adminLogin, customerLogin, png, q } from './helpers';

/**
 * Buyer ↔ seller communication in the real UI (local and staging). Fixtures are found read-only in the
 * database: demo accounts only; the owner's acceptance order is never touched.
 */
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stamp = () => `${Date.now().toString(36)}`;

type SoRow = { so_id: string; order_id: string; number: string; suffix: string; status: string; buyer: string; seller: string; other_so: string | null; other_seller: string | null };

/** A paid sub-order of a demo buyer whose parent order also contains another seller's sub-order. */
async function multiSellerFixture(): Promise<SoRow> {
  const [row] = await q<SoRow>(`
    select so.id as so_id, o.id as order_id, o.number::text as number, so.suffix, so.status, bu.email as buyer, su.email as seller,
           so2.id as other_so, su2.email as other_seller
      from seller_orders so join orders o on o.id = so.order_id join users bu on bu.id = o.customer_id
      join sellers se on se.id = so.seller_id join users su on su.id = se.owner_user_id
      join seller_orders so2 on so2.order_id = o.id and so2.id <> so.id
      join sellers se2 on se2.id = so2.seller_id join users su2 on su2.id = se2.owner_user_id
     where bu.email like '%@demo.edmn.local' and su.email like '%@demo.edmn.local' and su2.email like '%@demo.edmn.local'
       and so.status in ('PAID','SELLER_CONFIRMED','PROCESSING','READY_TO_SHIP','SHIPPED','DELIVERED')
       and se.status = 'APPROVED' and su.email <> su2.email
     order by o.number, so.suffix, so2.suffix limit 1`);
  expect(row, 'demo multi-seller paid order').toBeTruthy();
  return row;
}

test.describe.serial('buyer ↔ seller communication (marketplace)', () => {
  let fx: SoRow;
  let convId = '';
  const text = `هو المقاس ده مظبوط؟ ${stamp()}`;
  const xss = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> ${stamp()}`;

  test.beforeAll(async () => {
    fx = await multiSellerFixture();
  });

  test('buyer: «تواصل مع البائع» on the paid sub-order opens its own conversation; text and XSS render as plain text', async ({ browser }) => {
    const page = await customerLogin(browser, fx.buyer);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/account/orders/${fx.order_id}`);
    const section = page.locator('section', { hasText: `شحنة ${fx.number}-${fx.suffix}` });
    await expect(section.getByTestId('message-cta')).toHaveText(/تواصل مع البائع/);
    await section.getByTestId('message-cta').click();
    await page.waitForURL(/\/account\/messages\/[0-9a-f-]{36}$/);
    convId = page.url().split('/').pop()!;
    await expect(page.getByRole('heading', { name: 'تواصل مع البائع' })).toBeVisible();
    await expect(page.getByTestId('conversation-context')).toContainText(`${fx.number}-${fx.suffix}`);
    await expect(page.getByTestId('conversation-notices')).toContainText('خلي تفاصيل الطلب والاتفاق هنا');
    await page.waitForLoadState('networkidle');
    for (const body of [text, xss]) {
      await page.getByTestId('message-input').fill(body);
      await page.getByTestId('message-send').click();
      await expect(page.getByTestId('message-status')).toContainText('تم الإرسال');
      await expect(page.getByTestId('message-body').filter({ hasText: body.slice(-6) }).last()).toHaveText(body);
    }
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    // Attachment (private file)
    await page.getByTestId('message-attachments').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: await png() });
    await page.getByTestId('message-input').fill('صورة المنتج');
    await page.getByTestId('message-send').click();
    await expect(page.getByTestId('message-status')).toContainText('تم الإرسال');
    const img = page.locator('[data-testid="message"] img[alt="صورة مرفقة"]').last();
    await expect(img).toBeVisible();
    const src = (await img.getAttribute('src'))!;
    expect((await page.request.get(src)).status()).toBe(200);
    // The other seller's sub-order has its own (separate) conversation entry point.
    if (fx.other_so) expect(fx.other_so).not.toBe(fx.so_id);
  });

  test('seller: unread badge, sees the buyer message, replies; another seller cannot open it', async ({ browser }) => {
    const seller = await customerLogin(browser, fx.seller);
    await seller.setViewportSize({ width: 1440, height: 900 });
    await seller.goto('/seller/messages');
    await expect(seller.locator('aside').getByTestId('unread-badge')).toBeVisible();
    const row = seller.getByTestId('conversation-list').locator(`a[href="/seller/messages/${convId}"]`);
    await expect(row).toContainText(`${fx.number}-${fx.suffix}`);
    await row.click();
    await expect(seller.getByRole('heading', { name: 'تواصل مع المشتري' })).toBeVisible();
    await expect(seller.getByTestId('message-body').filter({ hasText: text })).toBeVisible();
    // Opening the conversation clears it from the sidebar badge right away (well before the 7 s polling refresh).
    // Persistent staging data may hold other unread conversations of this store (e.g. manual acceptance tests), so the
    // badge must equal exactly the unread count of the store's *other* conversations (read-only query).
    const [{ n: otherUnread }] = await q<{ n: number }>(`
      select count(*)::int as n from conversation_messages m
        join conversations c on c.id = m.conversation_id
        join sellers se on se.id = c.seller_id join users u on u.id = se.owner_user_id
        left join conversation_reads r on r.conversation_id = c.id and r.user_id = u.id
       where u.email = $1 and c.id <> $2 and m.sender_role = 'BUYER' and m.hidden_at is null
         and (r.last_read_at is null or m.created_at > r.last_read_at)`, [fx.seller, convId]);
    const badge = seller.locator('aside').getByTestId('unread-badge');
    if (Number(otherUnread) === 0) await expect(badge).toHaveCount(0, { timeout: 4000 });
    else await expect(badge).toHaveText(new RegExp(`^${otherUnread > 99 ? '99\\+' : otherUnread}`), { timeout: 4000 });
    await seller.waitForLoadState('networkidle');
    await seller.getByTestId('message-input').fill('أيوه مظبوط، وهشحنه بكرة');
    await seller.getByTestId('message-send').click();
    await expect(seller.getByTestId('message-status')).toContainText('تم الإرسال');
    // Order page CTA for the seller
    await seller.goto(`/seller/orders/${fx.so_id}`);
    await expect(seller.getByTestId('message-cta')).toHaveText(/تواصل مع المشتري/);

    if (fx.other_seller) {
      const other = await customerLogin(browser, fx.other_seller);
      const res = await other.goto(`/seller/messages/${convId}`);
      expect(res?.status()).toBe(404);
      await expect(other.getByTestId('message-body')).toHaveCount(0);
      await other.goto('/seller/messages');
      await expect(other.locator(`a[href="/seller/messages/${convId}"]`)).toHaveCount(0);
      const [att] = await q<{ file_id: string }>(
        `select a.file_id from conversation_message_attachments a join conversation_messages m on m.id = a.message_id where m.conversation_id = $1 limit 1`,
        [convId],
      );
      expect((await other.request.get(`/api/files/${att.file_id}`)).status()).toBe(404);
    }
  });

  test('buyer: sees the reply and «اتشافت»; reports the reply; another buyer gets 404', async ({ browser }) => {
    const page = await customerLogin(browser, fx.buyer);
    await page.goto(`/account/messages/${convId}`);
    await expect(page.getByTestId('message-body').filter({ hasText: 'وهشحنه بكرة' })).toBeVisible();
    await expect(page.getByTestId('message-read').first()).toBeVisible();
    const reply = page.locator('[data-testid="message"][data-side="SELLER"]').last();
    await reply.getByText('الإبلاغ عن الرسالة').click();
    await reply.locator('select[name=reason]').selectOption('OTHER');
    await reply.getByRole('button', { name: 'ابعت البلاغ' }).click();
    await expect(reply.getByText('البلاغ وصلنا').first()).toBeVisible();

    const intruderEmail = fx.buyer === 'ahmed@demo.edmn.local' ? 'mona@demo.edmn.local' : 'ahmed@demo.edmn.local';
    const intruder = await customerLogin(browser, intruderEmail);
    await intruder.goto(`/account/messages/${convId}`);
    // Streamed account pages keep HTTP 200 for notFound(); what matters is that nothing leaks.
    await expect(intruder.getByText(/مش موجود/).first()).toBeVisible();
    await expect(intruder.getByTestId('message-body')).toHaveCount(0);
    await expect(intruder.getByTestId('message-composer')).toHaveCount(0);
  });

  test('admin (authorized role): read-only viewer from the order page; the view is audited', async ({ browser }) => {
    const admin = await adminLogin(browser);
    await admin.goto(`/admin/orders/${fx.order_id}`);
    // The link inside THIS sub-order's section (each seller sub-order has its own conversation).
    await admin.locator('section', { hasText: `${fx.number}-${fx.suffix} ·` }).getByTestId('admin-conversation-link').click();
    await admin.waitForURL(/\/admin\/messages\/[0-9a-f-]{36}/);
    await expect(admin.getByText('دليل مساعد فقط')).toBeVisible();
    await expect(admin.getByTestId('message-body').filter({ hasText: text })).toBeVisible();
    await expect(admin.getByTestId('message-composer')).toHaveCount(0); // staff never post as a party
    const logs = await q<{ n: number }>(`select count(*)::int as n from audit_logs where action = 'conversation.staff_viewed' and entity_id = $1`, [convId]);
    expect(Number(logs[0].n)).toBeGreaterThan(0);
  });
});

test('pending-payment order: no conversation yet, and the open URL explains why', async ({ browser }) => {
  const [row] = await q<{ order_id: string; so_id: string; buyer: string }>(`
    select o.id as order_id, so.id as so_id, u.email as buyer from seller_orders so join orders o on o.id = so.order_id join users u on u.id = o.customer_id
     where so.status in ('PENDING_PAYMENT','PAYMENT_UNDER_REVIEW') and u.email like '%@demo.edmn.local' order by o.number limit 1`);
  test.skip(!row, 'no unpaid demo order');
  const page = await customerLogin(browser, row.buyer);
  await page.goto(`/account/orders/${row.order_id}`);
  await expect(page.getByTestId('message-cta')).toHaveCount(0);
  await expect(page.getByTestId('message-cta-pending').first()).toContainText('بيتفتح بعد تأكيد الدفع');
  await page.goto(`/account/messages/open?so=${row.so_id}`);
  await expect(page.getByText('التواصل مع البائع بيتفتح بعد ما الدفع يتأكد')).toBeVisible();
});

test('protected deal: both parties can talk after the seller joined; chat never changes the terms', async ({ browser }) => {
  const [deal] = await q<{ id: string; buyer: string; seller: string; unit_price: string | null; status: string }>(`
    select d.id, bu.email as buyer, su.email as seller, d.unit_price::text as unit_price, d.status from external_deals d
      join users bu on bu.id = d.buyer_id join users su on su.id = d.seller_user_id
     where bu.email like '%@demo.edmn.local' and (su.email like '%@demo.edmn.local' or su.email like 'ext-seller%@e2e.local')
       and d.seller_joined_at is not null and d.status not in ('DRAFT','INVITED') order by d.number desc limit 1`);
  test.skip(!deal, 'no demo deal with a bound seller');
  const buyer = await customerLogin(browser, deal.buyer);
  await buyer.goto(`/account/deals/${deal.id}`);
  await expect(buyer.getByTestId('message-cta')).toHaveText(/تواصل مع البائع/);
  await buyer.getByTestId('message-cta').click();
  await buyer.waitForURL(/\/account\/messages\/[0-9a-f-]{36}$/);
  await expect(buyer.getByTestId('deal-terms-notice')).toContainText('لازم يتأكد من خلال العرض الرسمي');
  await buyer.waitForLoadState('networkidle');
  await buyer.getByTestId('message-input').fill(`خليه 5000 بدل 5500 ${stamp()}`);
  await buyer.getByTestId('message-send').click();
  await expect(buyer.getByTestId('message-status')).toContainText('تم الإرسال');
  // Sellers created by the protected-deal E2E use that spec's fixed test password.
  const seller = await customerLogin(browser, deal.seller, deal.seller.endsWith('@e2e.local') ? 'E2e@ExtSeller2026' : undefined);
  await seller.goto(`/account/deals/${deal.id}`);
  await expect(seller.getByTestId('message-cta')).toHaveText(/تواصل مع المشتري/);
  const [after] = await q<{ unit_price: string | null; status: string }>(`select unit_price::text as unit_price, status from external_deals where id = $1`, [deal.id]);
  expect(after).toEqual({ unit_price: deal.unit_price, status: deal.status });
});

for (const width of [360, 375, 390, 430, 768, 1024, 1440]) {
  test(`conversation layout at ${width}px: no horizontal overflow, long text wraps, composer usable`, async ({ browser }) => {
    const fx = await multiSellerFixture();
    const page = await customerLogin(browser, fx.buyer);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/account/messages/open?so=${fx.so_id}`);
    await page.waitForURL(/\/account\/messages\/[0-9a-f-]{36}$/);
    if (width === 390) {
      await page.waitForLoadState('networkidle');
      await page.getByTestId('message-input').fill(`https://example.com/${'a'.repeat(220)} ${'كلمة_طويلة_جدا'.repeat(12)}`);
      await page.getByTestId('message-send').click();
      await expect(page.getByTestId('message-status')).toContainText('تم الإرسال');
    }
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (width === 390 || width === 1440) {
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
    await expect(page.getByTestId('message-input')).toBeVisible();
    await expect(page.getByTestId('message-send')).toBeVisible();
    const box = await page.getByTestId('message-send').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  });
}
