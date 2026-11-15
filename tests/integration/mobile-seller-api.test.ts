import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as membershipRoute } from '@/app/api/v1/me/seller/route';
import { GET as fundsRoute } from '@/app/api/v1/seller/funds/route';
import { GET as homeRoute } from '@/app/api/v1/seller/home/route';
import { GET as orderRoute } from '@/app/api/v1/seller/orders/[sellerOrderId]/route';
import { POST as shipmentRoute } from '@/app/api/v1/seller/orders/[sellerOrderId]/shipment/route';
import { POST as stepRoute } from '@/app/api/v1/seller/orders/[sellerOrderId]/steps/route';
import { GET as ordersRoute } from '@/app/api/v1/seller/orders/route';
import { GET as productsRoute } from '@/app/api/v1/seller/products/route';
import { PUT as stockRoute } from '@/app/api/v1/seller/variants/[variantId]/stock/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { journalEntries, productVariants, sellerMembers, sellerOrders } from '@/server/db/schema';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, submitAndConfirm } from '../helpers/factory';

/**
 * Seller Center through the REAL mobile route handlers: store scope from the session, store-role permissions,
 * server-allowed fulfilment steps only, stock floor, read-only funds behind finance.view.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, opts: { method?: string; body?: unknown; form?: FormData; token?: string; params?: Record<string, string>; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email: string) {
  const installationId = key();
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId, platform: 'ANDROID' } } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

/** A paid order for a new seller's product; returns the seller, its token and the sub-order id. */
async function paidOrderFor() {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 200_00, stock: 5 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  const [unpaid] = await sellerOrdersOf(order.id);
  return { s, p, c, order, soId: unpaid.id, token: await login(s.user.email!) };
}

describe('seller membership and scope', () => {
  it('a buyer has no membership and is refused on seller routes with seller_required', async () => {
    const c = await makeCustomer();
    const t = await login(c.user.email!);
    const m = await call(membershipRoute, '/me/seller', { token: t });
    expect(m.status).toBe(200);
    expect(m.body.membership).toBeNull();
    for (const [h, path] of [[homeRoute, '/seller/home'], [ordersRoute, '/seller/orders'], [productsRoute, '/seller/products'], [fundsRoute, '/seller/funds']] as const) {
      const r = await call(h, path, { token: t });
      expect(r.status, path).toBe(403);
      expect(r.body.code).toBe('seller_required');
    }
  });

  it('owner sees an operating membership with all store permissions', async () => {
    const { token } = await paidOrderFor();
    const m = await call(membershipRoute, '/me/seller', { token });
    expect(m.body.membership).toMatchObject({ role: 'STORE_OWNER', canOperate: true });
    expect(m.body.membership.permissions).toEqual(expect.arrayContaining(['orders.manage', 'finance.view', 'inventory.manage']));
  });

  it('an unpaid order is invisible to the seller; once paid it is listed only for its own store', async () => {
    const { soId, token, order, c } = await paidOrderFor();
    const before = await call(ordersRoute, '/seller/orders', { token });
    expect(before.body.items.map((x: { id: string }) => x.id)).not.toContain(soId);
    const hidden = await call(orderRoute, `/seller/orders/${soId}`, { token, params: { sellerOrderId: soId } });
    expect(hidden.status).toBe(403);
    await submitAndConfirm(c, order.id, admin);
    const after = await call(ordersRoute, '/seller/orders', { token });
    expect(after.body.items.map((x: { id: string }) => x.id)).toContain(soId);
    const other = await paidOrderFor();
    const foreign = await call(orderRoute, `/seller/orders/${soId}`, { token: other.token, params: { sellerOrderId: soId } });
    expect([403, 404]).toContain(foreign.status);
    const foreignStep = await call(stepRoute, `/seller/orders/${soId}/steps`, { token: other.token, idem: key(), params: { sellerOrderId: soId }, body: { step: 'CONFIRM_ORDER' } });
    expect([403, 404]).toContain(foreignStep.status);
  });
});

describe('fulfilment through allowed actions only', () => {
  it('confirm → processing → ready → shipment (+ waybill) → shipped; disallowed steps are refused; no money moves', async () => {
    const { soId, token, order, c } = await paidOrderFor();
    await submitAndConfirm(c, order.id, admin);
    const v = await call(orderRoute, `/seller/orders/${soId}`, { token, params: { sellerOrderId: soId } });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.allowedActions).toContain('CONFIRM_ORDER');
    expect(v.body.shipTo.recipientName).toBeTruthy();
    expect(v.body.economics).not.toBeNull(); // owner holds finance.view
    const early = await call(stepRoute, `/seller/orders/${soId}/steps`, { token, idem: key(), params: { sellerOrderId: soId }, body: { step: 'MARK_SHIPPED' } });
    expect(early.status).toBe(403);
    const entriesBefore = (await db.select().from(journalEntries)).length;
    for (const step of ['CONFIRM_ORDER', 'START_PROCESSING', 'MARK_READY_TO_SHIP'] as const) {
      const r = await call(stepRoute, `/seller/orders/${soId}/steps`, { token, idem: key(), params: { sellerOrderId: soId }, body: { step } });
      expect(r.status, `${step} ${JSON.stringify(r.body)}`).toBe(200);
    }
    const f = new FormData();
    f.set('carrierName', 'بوسطة');
    f.set('trackingNumber', 'BST-123456');
    f.set('shippedAt', new Date().toISOString());
    f.set('waybill', new Blob([new Uint8Array(await png('waybill'))], { type: 'image/png' }), 'waybill.png');
    const sh = await call(shipmentRoute, `/seller/orders/${soId}/shipment`, { token, idem: key(), params: { sellerOrderId: soId }, form: f });
    expect(sh.status, JSON.stringify(sh.body)).toBe(200);
    expect(sh.body.shipment).toMatchObject({ carrierName: 'بوسطة', trackingNumber: 'BST-123456', hasWaybill: true });
    const shipped = await call(stepRoute, `/seller/orders/${soId}/steps`, { token, idem: key(), params: { sellerOrderId: soId }, body: { step: 'MARK_SHIPPED' } });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    expect(shipped.body.status).toBe('SHIPPED');
    const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, soId));
    expect(so.status).toBe('SHIPPED');
    // A seller can never mark delivery, and fulfilment steps post nothing to the ledger.
    expect(shipped.body.allowedActions).not.toContain('MARK_DELIVERED');
    expect((await db.select().from(journalEntries)).length).toBe(entriesBefore);
  });
});

describe('inventory and funds permissions', () => {
  it('stock: own variant updates; never below reserved; another store gets forbidden', async () => {
    const { p, token } = await paidOrderFor(); // 1 unit reserved by the unpaid order
    const ok = await call(stockRoute, `/seller/variants/${p.variantId}/stock`, { method: 'PUT', token, params: { variantId: p.variantId }, body: { stockOnHand: 9 } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ stockOnHand: 9, reserved: 1, available: 8 });
    const floor = await call(stockRoute, `/seller/variants/${p.variantId}/stock`, { method: 'PUT', token, params: { variantId: p.variantId }, body: { stockOnHand: 0 } });
    expect(floor.status).toBe(422);
    const other = await paidOrderFor();
    const foreign = await call(stockRoute, `/seller/variants/${p.variantId}/stock`, { method: 'PUT', token: other.token, params: { variantId: p.variantId }, body: { stockOnHand: 1 } });
    expect(foreign.status).toBe(403);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.stockOnHand).toBe(9);
    const list = await call(productsRoute, '/seller/products', { token });
    expect(list.body.items[0].variants[0]).toMatchObject({ stockOnHand: 9, available: 8 });
  });

  it('funds are read-only and need finance.view; withdrawable is never more than available − held', async () => {
    const { s, token } = await paidOrderFor();
    const f = await call(fundsRoute, '/seller/funds', { token });
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    expect(f.body.withdrawablePiastres).toBe(Math.max(0, f.body.availablePiastres - f.body.heldPiastres));
    const home = await call(homeRoute, '/seller/home', { token });
    expect(home.body.sales).not.toBeNull();

    // An order manager of the same store: fulfilment yes, money no.
    const staff = await makeUser();
    await db.insert(sellerMembers).values({ sellerId: s.actor.sellerId!, userId: staff.id, role: 'ORDER_MANAGER' });
    const st = await login(staff.email!);
    const denied = await call(fundsRoute, '/seller/funds', { token: st });
    expect(denied.status).toBe(403);
    const staffHome = await call(homeRoute, '/seller/home', { token: st });
    expect(staffHome.status).toBe(200);
    expect(staffHome.body.sales).toBeNull();
    const orders = await call(ordersRoute, '/seller/orders', { token: st });
    expect(orders.status).toBe(200);
  });
});
