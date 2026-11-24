import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as adminDashboardRoute } from '@/app/api/v1/admin/dashboard/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import { rolePermissions, roles } from '@/server/db/schema';
import { makeUser } from '../helpers/factory';

/** Admin App operations, through the real route handlers: permission, MFA gate, audience, read-only shape. */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = (installationId = inst()) => ({ installationId, platform: 'IOS' as const, deviceName: 'iPhone', appVersion: '1.0.0' });

async function call(h: Handler, path: string, opts: { body?: unknown; token?: string; method?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await h(new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve({}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function staff(roles: string[], verify = true) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute as Handler, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  const token = login.body.tokens.accessToken as string;
  if (verify) {
    const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { method: 'POST', body: {}, token });
    const v = await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token });
    expect(v.status).toBe(200);
  }
  return token;
}

describe('admin app: operational dashboard', () => {
  it('returns read-only KPIs and queues in integer piastres, flagged as test money while Real Money is OFF', async () => {
    const token = await staff(['SUPER_ADMIN']);
    const r = await call(adminDashboardRoute as Handler, '/admin/dashboard?range=7d', { token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.range).toBe('7d');
    expect(r.body.realMoney).toBe(false);
    for (const v of [r.body.kpis.gmv, r.body.kpis.revenue, r.body.queues.pendingWithdrawalsAmount]) expect(Number.isInteger(v)).toBe(true);
    expect(Object.keys(r.body.queues)).toContain('openDisputes');
  });

  it('defaults to 30 days and rejects an unknown range', async () => {
    const token = await staff(['SUPER_ADMIN']);
    expect((await call(adminDashboardRoute as Handler, '/admin/dashboard', { token })).body.range).toBe('30d');
    expect((await call(adminDashboardRoute as Handler, '/admin/dashboard?range=forever', { token })).status).toBe(422);
  });

  it('is refused (403) to a staff role without dashboard.view', async () => {
    // Every seeded role has dashboard.view, so the denial is proven with a custom role holding one unrelated permission.
    const code = `T_NO_DASH_${randomBytes(4).toString('hex').toUpperCase()}`;
    await db.insert(roles).values({ code, nameAr: 'دور اختبار', nameEn: 'Test role' });
    await db.insert(rolePermissions).values({ roleCode: code, permission: 'reviews.moderate' });
    const token = await staff([code]);
    const r = await call(adminDashboardRoute as Handler, '/admin/dashboard', { token });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('forbidden');
  });

  it('is refused before TOTP is verified on this session', async () => {
    const token = await staff(['SUPER_ADMIN'], false);
    expect((await call(adminDashboardRoute as Handler, '/admin/dashboard', { token })).status).toBe(401);
  });

  it('a Customer App token is never accepted', async () => {
    const u = await makeUser();
    const s = await call(loginRoute as Handler, '/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
    expect(s.status).toBe(200);
    expect((await call(adminDashboardRoute as Handler, '/admin/dashboard', { token: s.body.tokens.accessToken })).status).toBe(401);
  });
});
