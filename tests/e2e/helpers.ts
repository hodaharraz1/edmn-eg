import { expect, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';
import { totpCode } from '../../src/server/auth/totp';
// Mirrors the development-only demo seed (src/server/db/seed/demo.ts).
// When running against a deployed staging URL these come from the environment (never committed).
const DEMO_TOTP_SECRET = process.env.STAGING_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const DEMO_PASSWORD = process.env.STAGING_DEMO_PASSWORD ?? 'Demo@12345';
const DEMO_ADMIN_PASSWORD = process.env.STAGING_ADMIN_PASSWORD ?? 'Admin@Edmn#2026';

export const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://edmn:edmn@localhost:5432/edmn_e2e';

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** A real 480×480 PNG (uploads below the minimum dimensions are rejected by the server). */
export async function png(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 480, height: 480, channels: 3, background: { r: 30, g: 90, b: 160 } } }).png().toBuffer();
}
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'ascii');

export async function customerLogin(browser: Browser, email: string, password = DEMO_PASSWORD): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('input[name=identifier]').fill(email);
  await page.locator('input[name=password]').fill(password);
  await page.locator('form button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

let lastStep = 0;
/** Staff login + TOTP. Codes are single-use, so wait for a fresh 30s step if the last one was consumed. */
export async function adminLogin(browser: Browser, email = 'admin@edmn.local'): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.goto('/admin/login');
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(DEMO_ADMIN_PASSWORD);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/admin\/2fa/);
  while (Math.floor(Date.now() / 30_000) <= lastStep) await page.waitForTimeout(1000);
  lastStep = Math.floor(Date.now() / 30_000);
  await page.locator('input[name=code]').fill(totpCode(DEMO_TOTP_SECRET));
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => u.pathname === '/admin' || u.pathname === '/admin/');
  return page;
}

export function acceptDialogs(page: Page) {
  page.on('dialog', (d) => void d.accept());
}

/** Submit the form that contains the given button text and wait for the success toast/alert. */
export async function submitAndExpect(page: Page, button: string | RegExp, expectText: string | RegExp = /تم/) {
  await page.getByRole('button', { name: button }).first().click();
  await expect(page.getByText(expectText).first()).toBeVisible();
}
