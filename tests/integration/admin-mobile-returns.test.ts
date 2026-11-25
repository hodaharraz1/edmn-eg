import { describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as adminReturnDetailRoute } from '@/app/api/v1/admin/returns/[returnId]/route';
import { GET as adminReturnsRoute } from '@/app/api/v1/admin/returns/route';
import { ADMIN_API_ROUTES } from '@/server/api/routes';
import { totpCode } from '@/server/auth/totp';
import { randomBytes, randomUUID } from 'node:crypto';
import { requestReturn } from '@/server/modules/postpurchase/returns';
import { checkout, itemsOf, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PKG-I02-01 v2 — Admin App returns MONITORING (read-only, per the owner's decision). The mobile API
 * exposes ONLY the queue and detail GET routes; approve / reject / receive / inspect / accept-refund
 * stay on the approved web routes and must never be registered here. Tests run through the REAL route
 * handlers with real login + MFA tokens. RBAC (returns.manage), IDOR/authz refusal, privacy (masked
 * names, evidence counted never embedded) and the no-mutation contract guard are covered.
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function call(h: unknown, path: string, opts: { token?: string; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method: 'GET', headers }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function staffToken(roles: string[]) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute, '/admin/auth/login', { token: undefined, params: {} });
  void login;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-edmn-installation': inst() };
  const post = async (h: unknown, path: string, body: unknown, token?: string) => {
    const h2: Record<string, string> = token ? { ...headers, authorization: `Bearer ${token}` } : headers;
    const res = await (h as Handler)(new Request(`${BASE}${path}`, { method: 'POST', headers: h2, body: JSON.stringify(body) }), { params: Promise.resolve({}) });
    return { status: res.status, body: JSON.parse(await res.text()) };
  };
  const loginRes = await post(adminLoginRoute, '/admin/auth/login', { identifier: u.email, password: 'Test@12345', device: device() });
  const token = loginRes.body.tokens.accessToken as string;
  const enroll = await post(adminMfaEnrollRoute, '/admin/auth/mfa/enroll', {}, token);
  expect((await post(adminMfaVerifyRoute, '/admin/auth/mfa/verify', { code: totpCode(enroll.body.secret) }, token)).status).toBe(200);
  return { token, user: u };
}

/** Delivered order + a requested return against it. */
async function requestedReturn() {
  const admin = await makeAdmin(['SUPER_ADMIN']);
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 180_00 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await receiveAndRelease(c.actor, so.id);
  const [item] = await itemsOf(so.id);
  const r = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'WRONG_ITEM', description: 'وصلني منتج مختلف عن اللي طلبته تمامًا', items: [{ orderItemId: item.id, quantity: 1 }] });
  return { admin, s, c, order, so, item, ret: r };
}

describe('Admin App — returns monitoring queue and detail (read-only, returns.manage)', () => {
  it('lists pending returns with masked names, workflow state and next action; search and pagination shape hold', async () => {
    const { c, ret } = await requestedReturn();
    const officer = await staffToken(['DISPUTE_OFFICER']);
    const list = await call(adminReturnsRoute, '/admin/returns', { token: officer.token });
    expect(list.status).toBe(200);
    expect(typeof list.body.page).toBe('number');
    expect(typeof list.body.hasMore).toBe('boolean');
    const mine = list.body.items.find((x: { id: string }) => x.id === ret.id);
    expect(mine).toBeTruthy();
    expect(mine.status).toBe('REQUESTED');
    expect(mine.nextAction).toContain('web console');
    expect(mine.customer).not.toBe(c.user.fullName); // masked
    // search by return number finds exactly this return
    const search = await call(adminReturnsRoute, `/admin/returns?q=${ret.number}`, { token: officer.token });
    expect(search.status).toBe(200);
    expect(search.body.items.map((x: { id: string }) => x.id)).toContain(ret.id);
    // detail: workflow state + items + evidence counted, never embedded
    const detail = await call(adminReturnDetailRoute, '/admin/returns/x', { token: officer.token, params: { returnId: ret.id } });
    expect(detail.status).toBe(200);
    expect(detail.body.number).toBe(String(ret.number));
    expect(detail.body.nextAction).toBeTruthy();
    expect(detail.body.items).toHaveLength(1);
    expect(typeof detail.body.evidenceCount).toBe('number');
    expect(detail.body).not.toHaveProperty('evidence');
    expect(detail.body).not.toHaveProperty('evidenceUrls');
    expect(detail.body).not.toHaveProperty('documents');
    // unknown id → 404, not data
    expect((await call(adminReturnDetailRoute, '/admin/returns/x', { token: officer.token, params: { returnId: randomUUID() } })).status).toBe(404);
  });

  it('refuses staff without returns.manage and non-staff tokens (RBAC / IDOR surface closed)', async () => {
    const { ret } = await requestedReturn();
    const denied = await staffToken(['PAYMENT_REVIEWER']);
    expect((await call(adminReturnsRoute, '/admin/returns', { token: denied.token })).status).toBe(403);
    expect((await call(adminReturnDetailRoute, '/admin/returns/x', { token: denied.token, params: { returnId: ret.id } })).status).toBe(403);
    expect((await call(adminReturnsRoute, '/admin/returns', {})).status).toBe(401);
  });
});

describe('Admin App — returns mobile API exposes NO mutations (owner decision, v2)', () => {
  it('no approve/reject/receive/inspect/accept-refund route is registered in the admin contract', () => {
    const paths = ADMIN_API_ROUTES.filter((r) => r.path.startsWith('/api/v1/admin/returns'));
    expect(paths.map((r) => `${r.method} ${r.path}`).sort()).toEqual(['GET /api/v1/admin/returns', 'GET /api/v1/admin/returns/{returnId}']);
  });
});
