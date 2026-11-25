import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as adminCodRoute } from '@/app/api/v1/admin/cod/route';
import { ADMIN_API_ROUTES } from '@/server/api/routes';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import type { Actor } from '@/server/core/actor';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { recordCodRemittance } from '@/server/modules/payments/service';
import { updateSetting } from '@/server/modules/settings';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, makerRequest, paymentOf, sellerOrdersOf, shipIt } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PKG-ADMIN-03: Admin App COD monitor (read-only, payments.view). Real route handlers with real login + MFA tokens.
 * Covers: a delivered COD order appears under "awaiting" with the server-computed expected amount; after a SHORT
 * courier statement it leaves "awaiting" and appears under "shortfalls" with the exact gap; names are masked; staff
 * without payments.view and anonymous callers are refused; the contract exposes ONE GET and no mutation.
 * Author run only (no Playwright, no device).
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


let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

async function deliveredCodOrder() {
  await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { stock: 4 });
  const c = await makeCustomer();
  await addToCart({ userId: c.user.id }, p.variantId, 1);
  const lines = await cartLines(db, { userId: c.user.id });
  const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
  const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'COD', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await confirmReceipt(c.actor, so.id);
  const pay = await paymentOf(order.id);
  return { order, c, pay };
}

type Item = { paymentId: string; orderNumber: string | null; customer: string | null; expectedAmount: number; shortfallAmount: number | null; statementRef: string | null };

describe('Admin App: COD monitor (read-only, payments.view)', () => {
  it('awaiting tab lists a delivered COD order; a short statement moves it to shortfalls with the exact gap', async () => {
    const { order, c, pay } = await deliveredCodOrder();
    const staff = await staffToken(['PAYMENT_REVIEWER']);

    const before = await call(adminCodRoute, '/admin/cod?tab=awaiting', { token: staff.token });
    expect(before.status).toBe(200);
    const mine = (before.body.items as Item[]).find((x) => x.paymentId === pay.id);
    expect(mine).toBeTruthy();
    expect(mine!.orderNumber).toBe(String(order.number));
    expect(mine!.expectedAmount).toBe(pay.amountDue);
    expect(mine!.customer).not.toBe(c.user.fullName); // masked
    expect(typeof before.body.hasMore).toBe('boolean');

    await makerRequest('COD_REMITTANCE', pay.id, pay.amountDue, { maker: await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']) });
    await recordCodRemittance(admin, pay.id, { reason: 'تسجيل كشف شركة الشحن رقم ٧٧', actualAmount: pay.amountDue - 500, statementRef: 'ST-77' });

    const after = await call(adminCodRoute, '/admin/cod?tab=awaiting', { token: staff.token });
    expect((after.body.items as Item[]).some((x) => x.paymentId === pay.id)).toBe(false);
    const sf = await call(adminCodRoute, '/admin/cod?tab=shortfalls', { token: staff.token });
    expect(sf.status).toBe(200);
    const gap = (sf.body.items as Item[]).find((x) => x.paymentId === pay.id);
    expect(gap).toBeTruthy();
    expect(gap!.shortfallAmount).toBe(500);
    expect(gap!.expectedAmount).toBe(pay.amountDue);
    expect(gap!.statementRef).toBe('ST-77');
  });

  it('refuses staff without payments.view and anonymous callers; rejects an unknown tab (422 validation)', async () => {
    const denied = await staffToken(['CATALOG_REVIEWER']);
    expect((await call(adminCodRoute, '/admin/cod', { token: denied.token })).status).toBe(403);
    expect((await call(adminCodRoute, '/admin/cod', {})).status).toBe(401);
    const ok = await staffToken(['PAYMENT_REVIEWER']);
    expect((await call(adminCodRoute, '/admin/cod?tab=everything', { token: ok.token })).status).toBe(422);
  });

  it('the admin contract exposes exactly one COD route and it is a GET', () => {
    const paths = ADMIN_API_ROUTES.filter((r) => r.path.includes('/admin/cod'));
    expect(paths.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/v1/admin/cod']);
  });
});
