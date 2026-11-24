// Shared harness for the Customer App UI journeys (Flutter web build, LOCAL server and demo DB, Real Money OFF).
// The app is driven only through its accessibility tree (what a screen reader sees); every step is checked against
// the HTTP call the UI made and the database row it produced.
import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

export const BASE = process.env.JOURNEY_APP_URL ?? 'http://localhost:8099/'; // not APP_URL: that names the backend
export const API = process.env.JOURNEY_API_URL ?? 'http://localhost:8099/api/v1';
export const DB = process.env.JOURNEY_DB ?? 'postgresql://edmn:edmn@127.0.0.1:55432/edmn_device';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('journeys write demo data: local databases only');

export const sql = (q) => execSync(`psql ${DB} -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
export const staff = (cmd, arg) => execSync(`npx tsx docs/mobile/journeys/staff-step.ts ${cmd} ${arg}`, { env: { ...process.env, DATABASE_URL: DB } }).toString().trim().split('\n').pop();

export const results = [];
export const check = (name, ok, detail) => {
  const l = `${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`;
  results.push(l);
  console.log(l);
};

/** Direct API call (NOT a UI step: used only for authorization denials that the UI cannot attempt). */
export async function apiAs(email, password, path, init = {}) {
  const inst = `journey-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edmn-installation': inst }, body: JSON.stringify({ identifier: email, password, device: { installationId: inst, platform: 'ANDROID' } }) });
  const token = (await login.json()).tokens.accessToken;
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'x-edmn-installation': inst } });
  return { status: r.status, text: await r.text() };
}

/**
 * The server limits sign-ins (10 per account and 30 per address per 15-minute window). A long run from one address
 * reaches that limit: when the last sign-in answered 429, wait for the next window (the limit is respected, never
 * bypassed) and tell the caller to sign in once more.
 */
export async function waitOutLoginLimit(calls) {
  const last = calls.filter((c) => c.startsWith('POST /api/v1/auth/login')).pop();
  if (!last?.endsWith(' 429')) return false;
  const ms = 900_000 - (Date.now() % 900_000) + 5_000;
  console.log(`(login rate limit reached: waiting ${Math.round(ms / 1000)} s for the next window)`);
  await new Promise((r) => setTimeout(r, ms));
  return true;
}

export async function session(b, out, email, password, fn) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage();
  const calls = [];
  p.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.request().method() !== 'GET') calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
  });
  const sem = async () => {
    await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
    await p.waitForTimeout(600);
  };
  const go = async (hash) => {
    await p.goto(BASE + '#' + hash, { waitUntil: 'networkidle' });
    await p.waitForTimeout(3500);
    await sem();
  };
  const shot = async (n) => {
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${n}.png` });
  };
  const type = async (loc, text) => {
    await loc.click();
    await p.waitForTimeout(600);
    await p.keyboard.type(text, { delay: 25 });
  };
  const tap = async (name, opts = {}) => {
    await p.getByRole(opts.role ?? 'button', { name, exact: opts.exact }).last().click();
    await p.waitForTimeout(opts.wait ?? 3000);
    await sem();
  };
  // Flutter web moves semantics nodes when the page scrolls: bring the target into view, refresh, then click.
  const tapFresh = async (loc, wait = 800) => {
    await loc.scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
    await sem();
    await loc.click();
    await p.waitForTimeout(wait);
    await sem();
  };
  // Scroll the page body until the locator is visible (long lists render lazily).
  const reveal = async (loc, max = 14) => {
    await p.mouse.move(195, 500);
    for (let i = 0; i < max && !(await loc.isVisible().catch(() => false)); i++) {
      await p.mouse.wheel(0, 350);
      await p.waitForTimeout(500);
      await sem();
    }
  };
  const confirmDialog = async () => {
    if (await p.getByRole('alertdialog').count()) {
      await p.getByRole('alertdialog').getByRole('button').last().click();
      await p.waitForTimeout(3500);
      await sem();
    }
  };
  const has = async (text) => (await p.locator(`flt-semantics:has-text("${text}"), [aria-label*="${text}"]`).count()) > 0;
  const unnamedButtons = () => p.locator('flt-semantics[role="button"]').evaluateAll((els) => els.filter((e) => !(e.getAttribute('aria-label') || e.textContent || '').trim()).length);
  const dump = async (tag) =>
    console.log(`--- ${tag}\n` + (await p.locator('flt-semantics [role]').evaluateAll((els) => els.map((e) => `${e.getAttribute('role')}: ${(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').slice(0, 90)}`))).join('\n'));
  const who = email.split('@')[0];
  try {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.waitForTimeout(3000);
    await sem();
    try {
      await p.getByRole('button', { name: 'تخطي' }).first().click();
      await p.waitForTimeout(1500);
    } catch {}
    await go('/sign-in');
    try {
      await p.getByRole('textbox').first().waitFor({ timeout: 15000 });
    } catch {
      await go('/sign-in');
      await p.getByRole('textbox').first().waitFor({ timeout: 20000 });
    }
    await type(p.getByRole('textbox').nth(0), email);
    await type(p.getByRole('textbox').nth(1), password);
    await tap('تسجيل الدخول');
    await p.waitForTimeout(1500);
    if (await waitOutLoginLimit(calls)) {
      // A full reload: the sign-in fields keep their text across in-app navigation (and Ctrl+A does not select it).
      await p.reload({ waitUntil: 'networkidle' });
      await go('/sign-in');
      await p.getByRole('textbox').first().waitFor({ timeout: 20000 });
      await type(p.getByRole('textbox').nth(0), email);
      await type(p.getByRole('textbox').nth(1), password);
      await tap('تسجيل الدخول');
      await p.waitForTimeout(1500);
    }
    check(`${who}: sign-in`, calls.some((c) => c.startsWith('POST /api/v1/auth/login 200')), calls.filter((c) => c.includes('login')).join(' | '));
    await fn({ p, go, shot, type, tap, tapFresh, reveal, confirmDialog, has, unnamedButtons, sem, calls, dump });
  } catch (e) {
    check(`${who}: journey error`, false, String(e).split('\n')[0]);
    await shot(`error-${who}-${Date.now() % 10000}`).catch(() => {});
  }
  await ctx.close();
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for the demo staff accounts of the LOCAL demo database. */
export function totp(secretBase32, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
