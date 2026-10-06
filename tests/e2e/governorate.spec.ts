import { expect, test, type Browser, type Page } from '@playwright/test';
import { formatEGP } from '../../src/lib/format';
import { DEMO_PASSWORD, q } from './helpers';

/**
 * Header delivery governorate ⇄ shipping, end to end. Expected fees are read (read-only) from the
 * seller's own shipping-rate rows, so the suite also runs against staging without changing its data.
 */
const CAIRO = 'القاهرة';
const DAMIETTA = 'دمياط';
const GOV_NAMES = ['القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الشرقية', 'الدقهلية', 'البحيرة', 'الغربية', 'المنوفية', 'كفر الشيخ', 'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد', 'مطروح', 'شمال سيناء', 'جنوب سيناء'];
const BUYER = 'ahmed@demo.edmn.local';

const nameOf = (page: Page) => page.getByTestId('delivery-location-name');
const dialog = (page: Page) => page.getByTestId('delivery-location-dialog');
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function chooseGovernorate(page: Page, name: string) {
  await page.getByTestId('delivery-location').click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByTestId('delivery-location-select').selectOption({ label: name });
  await dialog(page).getByTestId('delivery-location-apply').click();
  // Closes only after the server stored the choice; the header then shows the server's value.
  await expect(dialog(page)).toBeHidden();
  await expect(nameOf(page)).toHaveText(name);
}

/** A live single-variant product of an approved demo seller that ships to both Cairo and Damietta, below any free-shipping threshold. */
async function pickProduct() {
  const [row] = await q<{ slug: string; store: string; cai: number; dmt: number; dkh: number | null }>(
    `select p.slug, s.name as store, r1.fee as cai, r11.fee as dmt, (select fee from seller_shipping_rates where seller_id = p.seller_id and governorate_id = 6 and enabled) as dkh
       from products p
       join sellers se on se.id = p.seller_id and se.status = 'APPROVED'
       join stores s on s.seller_id = p.seller_id
       join seller_shipping_rates r1 on r1.seller_id = p.seller_id and r1.governorate_id = 1 and r1.enabled
       join seller_shipping_rates r11 on r11.seller_id = p.seller_id and r11.governorate_id = 11 and r11.enabled
       join product_variants v on v.product_id = p.id and v.is_active
      where p.status = 'LIVE' and r1.fee <> r11.fee
      group by p.id, p.slug, s.name, r1.fee, r11.fee, s.free_shipping_threshold
     having count(*) = 1 and min(v.stock_on_hand - v.reserved) >= 3
        and (s.free_shipping_threshold is null or max(v.price) * 3 < s.free_shipping_threshold)
      order by p.published_at desc nulls last limit 1`,
  );
  expect(row, 'a demo product shipping to Cairo and Damietta').toBeTruthy();
  return { ...row, cai: Number(row.cai), dmt: Number(row.dmt), dkh: row.dkh === null ? null : Number(row.dkh) };
}

async function freshGuest(browser: Browser, width: number) {
  const ctx = await browser.newContext({ locale: 'ar-EG', viewport: { width, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

test.describe('header delivery governorate', () => {
  test('guest: selector opens, lists all 27 governorates, Cairo → Damietta updates the header immediately (1440)', async ({ browser }) => {
    const { ctx, page } = await freshGuest(browser, 1440);
    await page.goto('/');
    await expect(nameOf(page)).toHaveText(CAIRO);
    await page.getByTestId('delivery-location').click();
    await expect(dialog(page)).toBeVisible();
    const options = await dialog(page).locator('option').allTextContents();
    expect(options).toHaveLength(27);
    expect([...options].sort()).toEqual([...GOV_NAMES].sort());
    await expect(dialog(page).getByTestId('delivery-location-select')).toHaveValue('1');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await chooseGovernorate(page, DAMIETTA);
    await ctx.close();
  });

  test('guest: Damietta persists across refresh and navigation, with no reversion after hydration', async ({ browser }) => {
    const { ctx, page } = await freshGuest(browser, 1440);
    const prod = await pickProduct();
    await page.goto('/');
    await chooseGovernorate(page, DAMIETTA);
    await page.reload();
    await expect(nameOf(page)).toHaveText(DAMIETTA);
    for (const path of [`/product/${prod.slug}`, '/search?q=' + encodeURIComponent('سامسونج'), '/cart', '/deals', '/']) {
      await page.goto(path);
      await expect(nameOf(page), path).toHaveText(DAMIETTA);
    }
    // After hydration has settled nothing reverts, and reopening shows the stored choice (not Cairo).
    await page.waitForLoadState('networkidle');
    await expect(nameOf(page)).toHaveText(DAMIETTA);
    await page.getByTestId('delivery-location').click();
    await expect(dialog(page).getByTestId('delivery-location-select')).toHaveValue('11');
    await page.keyboard.press('Escape');
    // Every one of the 27 governorates is selectable and becomes the delivery context.
    for (const name of [GOV_NAMES[26], GOV_NAMES[2], CAIRO]) await chooseGovernorate(page, name);
    await ctx.close();
  });

  test('works before/without client JavaScript (no double click, native popover + form post)', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-EG', javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(nameOf(page)).toHaveText(CAIRO);
    await page.getByTestId('delivery-location').click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByTestId('delivery-location-select').selectOption({ label: DAMIETTA });
    await dialog(page).getByTestId('delivery-location-apply').click();
    await page.waitForLoadState('load');
    await page.goto('/');
    await expect(nameOf(page)).toHaveText(DAMIETTA);
    await ctx.close();
  });

  test('manual selection works without geolocation and when location permission is denied', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-EG', permissions: [], viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      const deny = (_ok: unknown, err?: (e: { code: number; message: string }) => void) => err?.({ code: 1, message: 'denied' });
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: deny, watchPosition: deny, clearWatch: () => {} } });
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await chooseGovernorate(page, DAMIETTA);
    await page.reload();
    await expect(nameOf(page)).toHaveText(DAMIETTA);
    await ctx.close();
  });

  for (const width of [360, 375, 390, 430, 768, 1024, 1440]) {
    test(`responsive ${width}px: trigger visible, dialog fits, all options reachable, header updates, no horizontal overflow`, async ({ browser }) => {
      const { ctx, page } = await freshGuest(browser, width);
      await page.goto('/');
      await expect(page.getByTestId('delivery-location')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.getByTestId('delivery-location').click();
      const box = await dialog(page).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      // The last governorate in the list is selectable too.
      await dialog(page).getByTestId('delivery-location-select').selectOption({ label: 'جنوب سيناء' });
      await page.keyboard.press('Escape');
      await chooseGovernorate(page, DAMIETTA);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await ctx.close();
    });
  }

  for (const width of [1440, 390]) test(`product page and cart use the selected governorate and the seller’s own rate for it (${width}px)`, async ({ browser }) => {
    const { ctx, page } = await freshGuest(browser, width);
    const prod = await pickProduct();
    await page.goto(`/product/${prod.slug}`);
    const main = page.locator('#main');
    await expect(main.getByTestId('product-delivery-governorate')).toContainText(CAIRO);
    await expect(main.getByTestId('delivery-line').first()).toContainText(formatEGP(prod.cai));
    await chooseGovernorate(page, DAMIETTA);
    await expect(main.getByTestId('product-delivery-governorate')).toContainText(DAMIETTA);
    await expect(main.getByTestId('delivery-line').first()).toContainText(formatEGP(prod.dmt));
    await page.getByRole('button', { name: /ضيف للسلة/ }).click();
    await expect(page.getByText('المنتج اتضاف للسلة').first()).toBeVisible();
    await page.goto('/cart');
    await expect(nameOf(page)).toHaveText(DAMIETTA);
    const group = page.locator('section.card', { hasText: prod.store });
    await expect(group.getByTestId('delivery-line')).toContainText(formatEGP(prod.dmt));
    await ctx.close();
  });
});

test.describe.serial('signed-in customer: header context vs checkout address', () => {
  for (const width of [1440, 390]) test(`header choice never rewrites addresses; checkout shipping comes from the chosen address and recalculates (${width}px)`, async ({ browser }) => {
    test.setTimeout(180_000);
    const prod = await pickProduct();
    const ctx = await browser.newContext({ locale: 'ar-EG', viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.locator('input[name=identifier]').fill(BUYER);
    await page.locator('input[name=password]').fill(DEMO_PASSWORD);
    await page.locator('form button[type=submit]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.waitForLoadState('networkidle');

    const addrsBefore = await q<{ id: string; governorate_id: number; is_default: boolean }>(
      `select a.id, a.governorate_id, a.is_default from addresses a join users u on u.id = a.user_id where u.email = $1 and a.archived_at is null order by a.created_at`,
      [BUYER],
    );
    const cartBefore = await q<{ n: number }>(
      `select coalesce(sum(ci.quantity), 0)::int as n from cart_items ci join carts c on c.id = ci.cart_id join users u on u.id = c.user_id join product_variants v on v.id = ci.variant_id join products p on p.id = v.product_id where u.email = $1 and p.slug = $2`,
      [BUYER, prod.slug],
    );

    // Authenticated selection.
    await page.goto('/');
    await chooseGovernorate(page, DAMIETTA);
    await page.goto('/account');
    await expect(nameOf(page)).toHaveText(DAMIETTA);
    const addrsAfter = await q<{ id: string; governorate_id: number; is_default: boolean }>(
      `select a.id, a.governorate_id, a.is_default from addresses a join users u on u.id = a.user_id where u.email = $1 and a.archived_at is null order by a.created_at`,
      [BUYER],
    );
    expect(addrsAfter, 'header selection must not silently overwrite saved addresses').toEqual(addrsBefore);

    // Product → cart in Damietta context.
    await page.goto(`/product/${prod.slug}`);
    await expect(page.locator('#main').getByTestId('delivery-line').first()).toContainText(formatEGP(prod.dmt));
    if (cartBefore[0].n === 0) {
      await page.getByRole('button', { name: /ضيف للسلة/ }).click();
      await expect(page.getByText('المنتج اتضاف للسلة').first()).toBeVisible();
    }

    // Ensure the buyer has one Damietta address (created once through the real checkout form, never as default).
    let dam = addrsAfter.find((a) => a.governorate_id === 11);
    if (!dam) {
      await page.goto('/checkout');
      await page.getByText('+ ضيف عنوان جديد').click();
      const form = page.locator('form', { has: page.locator('#governorateId') });
      await form.locator('#recipientName').fill('أحمد اختبار دمياط');
      await form.locator('#phone').fill('01000000011');
      await form.locator('#governorateId').selectOption({ label: DAMIETTA });
      await form.locator('#city').fill('دمياط الجديدة');
      await form.locator('#street').fill('شارع الاختبار');
      await form.getByRole('button', { name: 'حفظ العنوان' }).click();
      await page.waitForURL(/\/checkout\?address=/);
      dam = { id: new URL(page.url()).searchParams.get('address')!, governorate_id: 11, is_default: false };
    }
    const other = addrsAfter.find((a) => a.governorate_id !== 11 && a.governorate_id === 1) ?? addrsAfter.find((a) => a.governorate_id !== 11)!;
    const [otherRate] = await q<{ fee: number; name: string }>(
      `select r.fee, g.name_ar as name from seller_shipping_rates r join governorates g on g.id = r.governorate_id join stores s on s.seller_id = r.seller_id where s.name = $1 and r.governorate_id = $2 and r.enabled`,
      [prod.store, other.governorate_id],
    );

    // Checkout with the Damietta address → Damietta rate for this seller.
    await page.goto(`/checkout?address=${dam.id}`);
    await expect(page.getByTestId('checkout-governorate')).toHaveText(DAMIETTA);
    const group = () => page.locator('li', { hasText: `من ${prod.store}` }).first();
    await expect(group()).toContainText(formatEGP(prod.dmt));

    // Switch the checkout address to another governorate: shipping recalculates from that address while the header stays Damietta.
    await page.goto(`/checkout?address=${other.id}`);
    await expect(page.getByTestId('checkout-governorate')).toHaveText(otherRate.name);
    await expect(page.getByTestId('checkout-shipping-basis')).toContainText(`«${DAMIETTA}» مش بتأثر على الطلب ده`);
    await expect(group()).toContainText(formatEGP(Number(otherRate.fee)));
    await expect(nameOf(page)).toHaveText(DAMIETTA);

    // Logout keeps this browser's delivery preference; logging back in keeps it too (cookie preference wins over the default address).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/account');
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await page.waitForLoadState('networkidle');
    await page.goto('/');
    await expect(nameOf(page)).toHaveText(DAMIETTA);

    // Restore the buyer's cart to its previous state (shared demo account).
    if (cartBefore[0].n === 0) {
      await page.goto('/login');
      await page.locator('input[name=identifier]').fill(BUYER);
      await page.locator('input[name=password]').fill(DEMO_PASSWORD);
      await page.locator('form button[type=submit]').first().click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      await expect(nameOf(page)).toHaveText(DAMIETTA);
      await page.goto('/cart');
      const line = page.locator('li', { has: page.locator(`a[href="/product/${prod.slug}"]`) });
      await line.getByRole('button', { name: 'حذف' }).click();
      await expect(page.locator(`a[href="/product/${prod.slug}"]`)).toHaveCount(0);
    }
    await ctx.close();
  });
});
