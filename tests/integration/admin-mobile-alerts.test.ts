import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as adminAlertsRoute } from '@/app/api/v1/admin/alerts/route';
import { ADMIN_API_ROUTES } from '@/server/api/routes';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import { alertStates } from '@/server/db/schema';
import { makeUser } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PKG-I02-03 — Admin App proactive alerts inbox (read-only) through the REAL route handler with real
 * login + MFA tokens. Covers: rule inventory with open counts, stage filter, RBAC parity with the web
 * console page (notifications.manage OR settings.manage), privacy (references only — no recipient or
 * entity ids), and the read-only contract guard (no mutation routes under /api/v1/admin/alerts).
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function call(h: unknown, path: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve({}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function staffToken(roles: string[]) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
  const token = login.body.tokens.accessToken as string;
  const enroll = await call(adminMfaEnrollRoute, '/admin/auth/mfa/enroll', { body: {}, token });
  expect((await call(adminMfaVerifyRoute, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token })).status).toBe(200);
  return { token, user: u };
}

describe('Admin App — alerts inbox (read-only)', () => {
  it('serves the rule inventory with open counts and the open feed with references only; stage filter works', async () => {
    const officer = await staffToken(['SUPER_ADMIN']);
    await db.insert(alertStates).values({
      rule: 'MKT_PAYMENT_DUE',
      entityType: 'order',
      entityId: randomUUID(),
      recipientUserId: officer.user.id,
      stage: 'DUE',
      severity: 'HIGH',
      sentCount: 1,
      metadata: { ref: '100234' },
    });
    const res = await call(adminAlertsRoute, '/admin/alerts', { token: officer.token });
    expect(res.status).toBe(200);
    const rule = res.body.rules.find((r: { code: string }) => r.code === 'MKT_PAYMENT_DUE');
    expect(rule).toBeTruthy();
    expect(rule.enabled).toBe(true);
    expect(rule.openCount).toBeGreaterThanOrEqual(1);
    // Other files' open alerts share the database (some with later updated_at from sweeps run with a future clock):
    // page through the feed and pick this test's row by its reference.
    type Item = { rule: string; ref: string | null };
    let mine: Item | undefined;
    for (let page = 1, more = true; !mine && more && page <= 50; page++) {
      const p = page === 1 ? res : await call(adminAlertsRoute, `/admin/alerts?page=${page}`, { token: officer.token });
      mine = p.body.items.find((x: Item) => x.rule === 'MKT_PAYMENT_DUE' && x.ref === '100234');
      more = p.body.hasMore;
    }
    expect(mine).toBeTruthy();
    expect(mine!.ref).toBe('100234');
    expect(mine).not.toHaveProperty('recipientUserId');
    expect(mine).not.toHaveProperty('entityId');
    expect(mine).not.toHaveProperty('metadata');
    // stage filter: OVERDUE hides a DUE alert
    const filtered = await call(adminAlertsRoute, '/admin/alerts?stage=OVERDUE', { token: officer.token });
    expect(filtered.status).toBe(200);
    // Other files' OVERDUE alerts of the same rule may exist: this test's DUE row must be absent, every row OVERDUE.
    expect(filtered.body.items.find((x: { ref: string | null }) => x.ref === '100234')).toBeFalsy();
    expect(filtered.body.items.every((x: { stage: string }) => x.stage === 'OVERDUE')).toBe(true);
  });

  it('refuses staff holding neither notifications.manage nor settings.manage, and anonymous callers', async () => {
    const denied = await staffToken(['PAYMENT_REVIEWER']);
    expect((await call(adminAlertsRoute, '/admin/alerts', { token: denied.token })).status).toBe(403);
    expect((await call(adminAlertsRoute, '/admin/alerts', {})).status).toBe(401);
  });
});

describe('Admin App — alerts mobile API is read-only (contract guard)', () => {
  it('registers only GET /api/v1/admin/alerts', () => {
    const paths = ADMIN_API_ROUTES.filter((r) => r.path.startsWith('/api/v1/admin/alerts'));
    expect(paths.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/v1/admin/alerts']);
  });
});
