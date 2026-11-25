import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as adminCustomerDetailRoute } from '@/app/api/v1/admin/customers/[userId]/route';
import { GET as adminCustomersRoute } from '@/app/api/v1/admin/customers/route';
import { ADMIN_API_ROUTES } from '@/server/api/routes';
import { totpCode } from '@/server/auth/totp';
import { checkout, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PKG-I02-04 — Admin App customer search + 360 (read-only) through the REAL route handlers with real
 * login + MFA tokens. Covers: search by name with masked contact data, 360 with counts and recent
 * orders, staff accounts never returned as customers, RBAC (customers.view), 404 without data leakage,
 * and the read-only contract guard.
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function call(h: unknown, path: string, opts: { token?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const method = opts.body !== undefined ? 'POST' : 'GET';
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve(opts.params ?? {}) });
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

describe('Admin App — customer search and 360 (read-only, customers.view)', () => {
  it('searches by name with masked contact data; staff never appear; 360 shows counts and recent orders', async () => {
    const admin = await makeAdmin(['SUPER_ADMIN']);
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 120_00 });
    const c = await makeCustomer();
    await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const support = await staffToken(['CUSTOMER_SUPPORT']);
    const list = await call(adminCustomersRoute, `/admin/customers?q=${encodeURIComponent('عميل اختبار')}`, { token: support.token });
    expect(list.status).toBe(200);
    const mine = list.body.items.find((x: { id: string }) => x.id === c.user.id);
    expect(mine).toBeTruthy();
    expect(mine.orderCount).toBeGreaterThanOrEqual(1);
    expect(mine.email).not.toBe(c.user.email); // masked
    if (mine.email) expect(mine.email).toContain('***');
    expect(list.body.items.some((x: { id: string }) => x.id === support.user.id)).toBe(false); // staff excluded
    const detail = await call(adminCustomerDetailRoute, '/admin/customers/x', { token: support.token, params: { userId: c.user.id } });
    expect(detail.status).toBe(200);
    expect(detail.body.counts.orders).toBeGreaterThanOrEqual(1);
    expect(detail.body.recentOrders.length).toBeGreaterThanOrEqual(1);
    expect(detail.body.phone).not.toBe(c.user.phone); // masked
    expect(detail.body).not.toHaveProperty('passwordHash');
    expect(detail.body).not.toHaveProperty('nationalId');
    // a staff id is not a customer: 404, not data
    expect((await call(adminCustomerDetailRoute, '/admin/customers/x', { token: support.token, params: { userId: support.user.id } })).status).toBe(404);
    expect((await call(adminCustomerDetailRoute, '/admin/customers/x', { token: support.token, params: { userId: randomUUID() } })).status).toBe(404);
  });

  it('refuses staff without customers.view and anonymous callers', async () => {
    const denied = await staffToken(['PAYMENT_REVIEWER']);
    expect((await call(adminCustomersRoute, '/admin/customers', { token: denied.token })).status).toBe(403);
    expect((await call(adminCustomersRoute, '/admin/customers', {})).status).toBe(401);
  });
});

describe('Admin App — customers mobile API is read-only (contract guard)', () => {
  it('registers only the two GET routes', () => {
    const paths = ADMIN_API_ROUTES.filter((r) => r.path.startsWith('/api/v1/admin/customers'));
    expect(paths.map((r) => `${r.method} ${r.path}`).sort()).toEqual(['GET /api/v1/admin/customers', 'GET /api/v1/admin/customers/{userId}']);
  });
});
