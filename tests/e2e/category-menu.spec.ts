import { expect, test, type Page } from '@playwright/test';
import { customerLogin } from './helpers';

/**
 * Desktop «التصنيفات» mega menu: open/close interaction only (layout unchanged). Mobile keeps its drawer.
 */
test.describe.configure({ mode: 'serial' });

const BUYER = 'ahmed@demo.edmn.local';
const trigger = (p: Page) => p.getByTestId('category-menu-trigger');
const panel = (p: Page) => p.getByTestId('category-menu-panel');

async function openMenu(page: Page) {
  if ((await trigger(page).getAttribute('aria-expanded')) !== 'true') await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
}
async function expectClosed(page: Page) {
  await expect(panel(page)).toBeHidden();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
}
async function home(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

test('desktop: open, toggle close, no flicker, inside click stays open, ESC returns focus (1, 2, 11, 12, 16)', async ({ browser }) => {
  const page = await customerLogin(browser, BUYER);
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  await expectClosed(page);
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(400);
  await expect(panel(page)).toBeVisible(); // 16 — no immediate close/reopen
  await expect(trigger(page)).toHaveAttribute('aria-controls', (await panel(page).getAttribute('id'))!);
  await trigger(page).click();
  await expectClosed(page);
  await page.waitForTimeout(400);
  await expectClosed(page); // 16 — no reopen
  // 12 — a click on non-link space inside the panel keeps it open
  await openMenu(page);
  const box = (await panel(page).boundingBox())!;
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 8);
  await page.waitForTimeout(200);
  await expect(panel(page)).toBeVisible();
  // 11 — ESC closes and focus returns to the trigger
  await page.keyboard.press('Escape');
  await expectClosed(page);
  await expect(trigger(page)).toBeFocused();
  await page.context().close();
});

test('desktop: closes on outside / page content / search / header actions / other nav items (3-10)', async ({ browser }) => {
  const page = await customerLogin(browser, BUYER);
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  const cases: [string, (p: Page) => Promise<void>][] = [
    ['outside (blank page area)', async (p) => p.mouse.click(1400, 860)],
    ['page content (a product card)', async (p) => p.locator('main a[href^="/product/"]').first().click({ trial: false, modifiers: [] })],
    ['search input', async (p) => p.locator('#site-search').click()],
    ['search button', async (p) => p.getByRole('button', { name: 'بحث' }).first().click()],
    ['messages', async (p) => p.getByTestId('header-messages').click()],
    ['notifications', async (p) => p.getByTestId('header-notifications').click()],
    ['account', async (p) => p.locator('header a[href="/account"]').first().click()],
    ['orders', async (p) => p.locator('header a[href="/account/orders"]').first().click()],
    ['cart', async (p) => p.locator('header a[href="/cart"]').first().click()],
    ['logo', async (p) => p.locator('header a[href="/"]').first().click()],
    ['wishlist', async (p) => p.getByRole('link', { name: 'المفضلة' }).first().click()],
    ['other nav item (العروض)', async (p) => p.getByRole('navigation', { name: 'التنقل الرئيسي' }).getByRole('link', { name: 'العروض' }).click()],
    ['other nav item (اضمن صفقة)', async (p) => p.getByRole('navigation', { name: 'التنقل الرئيسي' }).locator('a[href="/protected-deal"]').click()],
    ['other nav item (بيع على اضمن)', async (p) => p.getByRole('navigation', { name: 'التنقل الرئيسي' }).locator('a[href="/sell"]').click()],
  ];
  for (const [name, act] of cases) {
    await home(page);
    await openMenu(page);
    await act(page);
    await expect(panel(page), `closes after: ${name}`).toBeHidden();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  }
  await page.context().close();
});

test('desktop: category link closes and navigates; route change and back/forward close (13, 14)', async ({ browser }) => {
  const page = await customerLogin(browser, BUYER);
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  await openMenu(page);
  const link = panel(page).locator('a[href^="/category/"]').nth(1);
  const href = (await link.getAttribute('href'))!;
  await link.click();
  await page.waitForURL((u) => decodeURIComponent(u.pathname) === decodeURIComponent(href));
  await expectClosed(page);
  // Back/forward: open on the category page, go back → closed
  await openMenu(page);
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/');
  await expectClosed(page);
  await openMenu(page);
  await page.goForward();
  await page.waitForURL((u) => decodeURIComponent(u.pathname) === decodeURIComponent(href));
  await expectClosed(page);
  await page.context().close();
});

test('desktop: only one header overlay — the location picker and the mega menu exclude each other (15)', async ({ browser }) => {
  const page = await customerLogin(browser, BUYER);
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  await openMenu(page);
  await page.getByTestId('delivery-location').click();
  await expect(page.getByRole('dialog').first()).toBeVisible();
  await expectClosed(page);
  // and opening the menu dismisses the location picker
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole('dialog').first()).toBeHidden();
  await page.context().close();
});

test('keyboard: Enter opens, Tab moves into links, tabbing out closes', async ({ browser }) => {
  const page = await customerLogin(browser, BUYER);
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(panel(page).locator('a').first()).toBeFocused();
  // Shift+Tab back to the trigger then out of the menu
  await page.keyboard.press('Shift+Tab');
  await expect(trigger(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expectClosed(page);
  await page.context().close();
});

for (const width of [390, 768, 1440]) {
  test(`responsive ${width}px: RTL, no overflow, mobile drawer unaffected (17-21)`, async ({ browser }) => {
    const page = await customerLogin(browser, BUYER);
    await page.setViewportSize({ width, height: 900 });
    await home(page);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    if (width >= 1024) {
      await openMenu(page);
      // RTL: the panel opens from the inline-start (right) edge of the trigger
      const t = (await trigger(page).boundingBox())!;
      const pnl = (await panel(page).boundingBox())!;
      expect(Math.abs(pnl.x + pnl.width - (t.x + t.width))).toBeLessThanOrEqual(2);
      expect(pnl.x).toBeGreaterThanOrEqual(0);
    } else {
      await expect(trigger(page)).toBeHidden(); // desktop menu not used on small screens
      await page.getByRole('button', { name: 'القائمة' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'التصنيفات' }).first();
      await expect(drawer).toBeVisible();
      const cat = drawer.locator('a[href^="/category/"]').first();
      const href = (await cat.getAttribute('href'))!;
      await cat.click();
      await page.waitForURL((u) => decodeURIComponent(u.pathname) === decodeURIComponent(href));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.context().close();
  });
}
