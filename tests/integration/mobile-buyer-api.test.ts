import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { POST as ackRoute } from '@/app/api/v1/cart/acknowledge-prices/route';
import { PUT as setCartItemRoute } from '@/app/api/v1/cart/items/[variantId]/route';
import { POST as addCartItemRoute } from '@/app/api/v1/cart/items/route';
import { GET as cartRoute } from '@/app/api/v1/cart/route';
import { GET as checkoutRoute } from '@/app/api/v1/checkout/route';
import { GET as fileRoute } from '@/app/api/v1/files/[fileId]/route';
import { DELETE as deleteAddressRoute, PUT as updateAddressRoute } from '@/app/api/v1/me/addresses/[addressId]/route';
import { GET as addressesRoute, POST as createAddressRoute } from '@/app/api/v1/me/addresses/route';
import { POST as passwordRoute } from '@/app/api/v1/me/password/route';
import { GET as meRoute, PATCH as updateMeRoute } from '@/app/api/v1/me/route';
import { POST as cancelRoute } from '@/app/api/v1/orders/[orderId]/cancel/route';
import { GET as orderRoute } from '@/app/api/v1/orders/[orderId]/route';
import { GET as ordersRoute, POST as placeOrderRoute } from '@/app/api/v1/orders/route';
import { POST as proofRoute } from '@/app/api/v1/payments/[paymentId]/proof/route';
import { GET as paymentRoute } from '@/app/api/v1/payments/[paymentId]/route';
import { POST as confirmReceiptRoute } from '@/app/api/v1/seller-orders/[sellerOrderId]/confirm-receipt/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { auditLogs, journalEntries, orders, paymentSubmissions, payments, productVariants, sessions } from '@/server/db/schema';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, png, sellerOrdersOf } from '../helpers/factory';

/**
 * Customer App buyer API through the REAL route handlers: cart → checkout quote → order → manual payment proof,
 * with ownership isolation between buyers and the server as the only source of prices and allowed actions.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, opts: { method?: string; body?: unknown; form?: FormData; token?: string; params?: Record<string, string>; idem?: string; raw?: boolean } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }), { params: Promise.resolve(opts.params ?? {}) });
  if (opts.raw) return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) as unknown as Record<string, never> };
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function login(email: string, password = 'Test@12345') {
  const installationId = key();
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password, device: { installationId, platform: 'IOS', deviceName: 'iPhone', appVersion: '1.0.0' } } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

async function buyer() {
  const c = await makeCustomer();
  return { ...c, token: await login(c.user.email!) };
}

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

/** Cart → quote → order through the API; returns the order as the buyer sees it. */
async function orderViaApi(b: Awaited<ReturnType<typeof buyer>>, items: { variantId: string; qty: number }[], checkoutKey = key()) {
  for (const i of items) {
    const a = await call(addCartItemRoute, '/cart/items', { token: b.token, idem: key(), body: { variantId: i.variantId, quantity: i.qty } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
  }
  const q = await call(checkoutRoute, `/checkout?addressId=${b.address.id}`, { token: b.token });
  expect(q.status, JSON.stringify(q.body)).toBe(200);
  const placed = await call(placeOrderRoute, '/orders', {
    token: b.token,
    body: { addressId: b.address.id, paymentMethod: 'INSTAPAY', checkoutKey, expectedTotalPiastres: q.body.cart.grandTotalPiastres, expectedPricingVersionId: q.body.cart.pricingVersionId ?? undefined },
  });
  return { quote: q.body, placed, checkoutKey };
}

describe('buyer API requires a customer session', () => {
  it('every buyer route refuses anonymous callers with the stable code', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const probes: [unknown, string, { method?: string; body?: unknown; params?: Record<string, string> }][] = [
      [cartRoute, '/cart', {}],
      [checkoutRoute, '/checkout', {}],
      [ordersRoute, '/orders', {}],
      [orderRoute, `/orders/${id}`, { params: { orderId: id } }],
      [paymentRoute, `/payments/${id}`, { params: { paymentId: id } }],
      [fileRoute, `/files/${id}`, { params: { fileId: id } }],
      [addressesRoute, '/me/addresses', {}],
      [addCartItemRoute, '/cart/items', { body: { variantId: id, quantity: 1 } }],
      [placeOrderRoute, '/orders', { body: {} }],
    ];
    for (const [h, path, o] of probes) {
      const r = await call(h, path, o);
      expect(r.status, path).toBe(401);
      expect(r.body.code).toBe('unauthenticated');
    }
  });
});

describe('addresses', () => {
  it('create, list, update, delete — and another buyer can neither see nor change them', async () => {
    const a = await buyer();
    const b = await buyer();
    const input = { recipientName: 'منى السيد', phone: '01012345678', governorateId: a.address.governorateId, city: 'مدينة نصر', street: 'شارع عباس العقاد', label: 'البيت' };
    const created = await call(createAddressRoute, '/me/addresses', { token: a.token, idem: key(), body: input });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const list = await call(addressesRoute, '/me/addresses', { token: a.token });
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(id);
    expect(JSON.stringify(list.body)).not.toMatch(/userId|archivedAt/);
    const others = await call(addressesRoute, '/me/addresses', { token: b.token });
    expect(others.body.items.map((x: { id: string }) => x.id)).not.toContain(id);

    const hijack = await call(updateAddressRoute, `/me/addresses/${id}`, { method: 'PUT', token: b.token, params: { addressId: id }, body: { ...input, city: 'مخترق' } });
    expect([403, 404]).toContain(hijack.status);
    const hijackDelete = await call(deleteAddressRoute, `/me/addresses/${id}`, { method: 'DELETE', token: b.token, idem: key(), params: { addressId: id } });
    expect([403, 404]).toContain(hijackDelete.status);

    const upd = await call(updateAddressRoute, `/me/addresses/${id}`, { method: 'PUT', token: a.token, params: { addressId: id }, body: { ...input, city: 'المعادي' } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    const after = await call(addressesRoute, '/me/addresses', { token: a.token });
    expect(after.body.items.find((x: { id: string }) => x.id === id).city).toBe('المعادي');
    const del = await call(deleteAddressRoute, `/me/addresses/${id}`, { method: 'DELETE', token: a.token, idem: key(), params: { addressId: id } });
    expect(del.status).toBe(200);
    const gone = await call(addressesRoute, '/me/addresses', { token: a.token });
    expect(gone.body.items.map((x: { id: string }) => x.id)).not.toContain(id);
  });
});

describe('cart and checkout', () => {
  it('multi-seller cart is grouped and priced by the server; the order matches the quote and is idempotent on checkoutKey', async () => {
    const s1 = await makeSeller(admin);
    const s2 = await makeSeller(admin);
    const p1 = await makeProduct(s1.actor, admin, { price: 100_00, stock: 5 });
    const p2 = await makeProduct(s2.actor, admin, { price: 250_00, stock: 5 });
    const b = await buyer();
    const { quote, placed, checkoutKey } = await orderViaApi(b, [{ variantId: p1.variantId, qty: 2 }, { variantId: p2.variantId, qty: 1 }]);
    expect(quote.cart.groups).toHaveLength(2);
    expect(quote.cart.merchandiseTotalPiastres).toBe(450_00);
    expect(quote.cart.canCheckout).toBe(true);
    expect(quote.realMoneyEnabled).toBe(false);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.created).toBe(true);

    const retry = await call(placeOrderRoute, '/orders', { token: b.token, body: { addressId: b.address.id, paymentMethod: 'INSTAPAY', checkoutKey, expectedTotalPiastres: quote.cart.grandTotalPiastres } });
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual({ orderId: placed.body.orderId, created: false });
    expect(await db.select().from(orders).where(eq(orders.customerId, b.user.id))).toHaveLength(1);

    const o = await call(orderRoute, `/orders/${placed.body.orderId}`, { token: b.token, params: { orderId: placed.body.orderId } });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    expect(o.body.grandTotalPiastres).toBe(quote.cart.grandTotalPiastres);
    expect(o.body.sellerOrders).toHaveLength(2);
    expect(o.body.allowedActions).toEqual(['CANCEL_UNPAID']);
    expect(o.body.payment.isTest).toBe(true);
    expect(o.body.payment.allowedActions).toEqual(['SUBMIT_PROOF']);
    // Seller-side economics never reach the buyer.
    expect(JSON.stringify(o.body)).not.toMatch(/commission|sellerNet|sellerFee/i);

    const list = await call(ordersRoute, '/orders', { token: b.token });
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([placed.body.orderId]);
    const empty = await call(cartRoute, '/cart', { token: b.token });
    expect(empty.body.itemCount).toBe(0);
  });

  it('a total the buyer did not see is refused: the client cannot set the price', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00, stock: 5 });
    const b = await buyer();
    await call(addCartItemRoute, '/cart/items', { token: b.token, idem: key(), body: { variantId: p.variantId, quantity: 1 } });
    const r = await call(placeOrderRoute, '/orders', { token: b.token, body: { addressId: b.address.id, paymentMethod: 'INSTAPAY', checkoutKey: key(), expectedTotalPiastres: 1 } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(await db.select().from(orders).where(eq(orders.customerId, b.user.id))).toHaveLength(0);
  });

  it('price change in the cart blocks checkout until acknowledged; stock is enforced on quantity', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00, stock: 2 });
    const b = await buyer();
    await call(addCartItemRoute, '/cart/items', { token: b.token, idem: key(), body: { variantId: p.variantId, quantity: 1 } });
    await db.update(productVariants).set({ price: 120_00 }).where(eq(productVariants.id, p.variantId));
    const changed = await call(cartRoute, `/cart?governorateId=${b.address.governorateId}`, { token: b.token });
    expect(changed.body.groups[0].lines[0].issues).toContain('PRICE_CHANGED');
    expect(changed.body.canCheckout).toBe(false);
    const ack = await call(ackRoute, '/cart/acknowledge-prices', { token: b.token, method: 'POST' });
    expect(ack.status).toBe(200);
    const ok = await call(cartRoute, `/cart?governorateId=${b.address.governorateId}`, { token: b.token });
    expect(ok.body.groups[0].lines[0].issues).toEqual([]);
    expect(ok.body.groups[0].lines[0].unitPricePiastres).toBe(120_00);
    expect(ok.body.canCheckout).toBe(true);

    const tooMany = await call(setCartItemRoute, `/cart/items/${p.variantId}`, { method: 'PUT', token: b.token, params: { variantId: p.variantId }, body: { quantity: 9 } });
    expect(tooMany.status).toBeGreaterThanOrEqual(400);
    const removed = await call(setCartItemRoute, `/cart/items/${p.variantId}`, { method: 'PUT', token: b.token, params: { variantId: p.variantId }, body: { quantity: 0 } });
    expect(removed.status).toBe(200);
    expect((await call(cartRoute, '/cart', { token: b.token })).body.itemCount).toBe(0);
  });

  it("checkout with another buyer's address is refused", async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 5 });
    const a = await buyer();
    const b = await buyer();
    await call(addCartItemRoute, '/cart/items', { token: a.token, idem: key(), body: { variantId: p.variantId, quantity: 1 } });
    const q = await call(checkoutRoute, `/checkout?addressId=${b.address.id}`, { token: a.token });
    expect([403, 404]).toContain(q.status);
    const r = await call(placeOrderRoute, '/orders', { token: a.token, body: { addressId: b.address.id, paymentMethod: 'INSTAPAY', checkoutKey: key(), expectedTotalPiastres: 100 } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(orders).where(eq(orders.customerId, a.user.id))).toHaveLength(0);
  });
});

describe('orders, payment proof and files: ownership', () => {
  it('proof upload queues the payment for review (never paid), is single-shot per clientKey, and strangers get nothing', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00, stock: 5 });
    const a = await buyer();
    const stranger = await buyer();
    const { placed } = await orderViaApi(a, [{ variantId: p.variantId, qty: 1 }]);
    const orderId = placed.body.orderId as string;
    const [pay] = await db.select().from(payments).where(eq(payments.orderId, orderId));

    for (const [h, path, params] of [
      [orderRoute, `/orders/${orderId}`, { orderId }],
      [paymentRoute, `/payments/${pay.id}`, { paymentId: pay.id }],
    ] as const) {
      const r = await call(h, path, { token: stranger.token, params });
      expect([403, 404], path).toContain(r.status);
    }
    const strangerCancel = await call(cancelRoute, `/orders/${orderId}/cancel`, { method: 'POST', token: stranger.token, idem: key(), params: { orderId } });
    expect([403, 404]).toContain(strangerCancel.status);

    const form = async (clientKey: string) => {
      const f = new FormData();
      f.set('claimedAmount', String(pay.amountDue / 100));
      f.set('reference', 'IPN-778899');
      f.set('clientKey', clientKey);
      f.set('proof', new Blob([new Uint8Array(await png('receipt'))], { type: 'image/png' }), 'receipt.png');
      return f;
    };
    const strangerProof = await call(proofRoute, `/payments/${pay.id}/proof`, { token: stranger.token, params: { paymentId: pay.id }, form: await form(key()) });
    expect([403, 404]).toContain(strangerProof.status);
    const noFile = new FormData();
    noFile.set('claimedAmount', '100');
    noFile.set('clientKey', key());
    const missing = await call(proofRoute, `/payments/${pay.id}/proof`, { token: a.token, params: { paymentId: pay.id }, form: noFile });
    expect(missing.status).toBe(422);
    const asJson = await call(proofRoute, `/payments/${pay.id}/proof`, { token: a.token, params: { paymentId: pay.id }, body: { claimedAmount: '100', clientKey: key() } });
    expect(asJson.status).toBe(422);

    const ck = key();
    const up = await call(proofRoute, `/payments/${pay.id}/proof`, { token: a.token, params: { paymentId: pay.id }, form: await form(ck) });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    await call(proofRoute, `/payments/${pay.id}/proof`, { token: a.token, params: { paymentId: pay.id }, form: await form(ck) });
    const subs = await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.paymentId, pay.id));
    expect(subs).toHaveLength(1);

    const view = await call(paymentRoute, `/payments/${pay.id}`, { token: a.token, params: { paymentId: pay.id } });
    expect(view.status).toBe(200);
    expect(view.body.status).toBe('PAYMENT_SUBMITTED');
    expect(view.body.confirmedAt).toBeNull();
    expect(view.body.allowedActions).toEqual([]);
    expect(view.body.submissions).toHaveLength(1);
    // No money moved: an uploaded receipt is a claim, not a payment.
    expect(await db.select().from(journalEntries).where(inArray(journalEntries.sourceId, [orderId, pay.id]))).toHaveLength(0);
    expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0].paidAt).toBeNull();
    const o = await call(orderRoute, `/orders/${orderId}`, { token: a.token, params: { orderId } });
    expect(o.body.allowedActions).toEqual([]);
    const lateCancel = await call(cancelRoute, `/orders/${orderId}/cancel`, { method: 'POST', token: a.token, idem: key(), params: { orderId } });
    expect(lateCancel.status).toBeGreaterThanOrEqual(400);

    const fileId = view.body.submissions[0].proofFileId as string;
    const mine = await call(fileRoute, `/files/${fileId}`, { token: a.token, params: { fileId }, raw: true });
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toContain('no-store');
    expect(mine.headers.get('x-content-type-options')).toBe('nosniff');
    expect((mine.body as unknown as Buffer).length).toBeGreaterThan(100);
    const theirs = await call(fileRoute, `/files/${fileId}`, { token: stranger.token, params: { fileId } });
    expect(theirs.status).toBe(404);
    // The seller of the order is not a party to the buyer's bank receipt either.
    const sellerToken = await login(s.user.email!);
    const sellers = await call(fileRoute, `/files/${fileId}`, { token: sellerToken, params: { fileId } });
    expect(sellers.status).toBe(404);
  });

  it('cancel unpaid releases the reservation; receipt cannot be confirmed by a stranger or before delivery', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const a = await buyer();
    const stranger = await buyer();
    const { placed } = await orderViaApi(a, [{ variantId: p.variantId, qty: 2 }]);
    const orderId = placed.body.orderId as string;
    const [so] = await sellerOrdersOf(orderId);
    const early = await call(confirmReceiptRoute, `/seller-orders/${so.id}/confirm-receipt`, { method: 'POST', token: a.token, idem: key(), params: { sellerOrderId: so.id } });
    expect(early.status).toBeGreaterThanOrEqual(400);
    const foreign = await call(confirmReceiptRoute, `/seller-orders/${so.id}/confirm-receipt`, { method: 'POST', token: stranger.token, idem: key(), params: { sellerOrderId: so.id } });
    expect([403, 404]).toContain(foreign.status);

    const idem = key();
    const c1 = await call(cancelRoute, `/orders/${orderId}/cancel`, { method: 'POST', token: a.token, idem, params: { orderId } });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    const c2 = await call(cancelRoute, `/orders/${orderId}/cancel`, { method: 'POST', token: a.token, idem, params: { orderId } });
    expect(c2.status).toBe(200);
    expect(c2.headers.get('idempotent-replayed')).toBe('true');
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.reserved).toBe(0);
    const o = await call(orderRoute, `/orders/${orderId}`, { token: a.token, params: { orderId } });
    expect(o.body.status).toBe('CANCELLED');
    expect(o.body.allowedActions).toEqual([]);
  });
});

describe('account', () => {
  it('profile update is audited; password change signs out every other device and re-issues tokens for this one', async () => {
    const c = await makeCustomer();
    const t1 = await login(c.user.email!);
    const t2 = await login(c.user.email!);
    const upd = await call(updateMeRoute, '/me', { method: 'PATCH', token: t1, body: { fullName: 'هدى حراز' } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.fullName).toBe('هدى حراز');
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, c.user.id), eq(auditLogs.action, 'account.profile_updated')))).toHaveLength(1);

    const wrong = await call(passwordRoute, '/me/password', { token: t1, body: { current: 'not-it', next: 'N3w@Passw0rd!' } });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect((await call(meRoute, '/me', { token: t2 })).status).toBe(200);

    const ok = await call(passwordRoute, '/me/password', { token: t1, body: { current: 'Test@12345', next: 'N3w@Passw0rd!' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.accessToken).toMatch(/^em1\./);
    expect((await call(meRoute, '/me', { token: t1 })).status).toBe(401);
    expect((await call(meRoute, '/me', { token: t2 })).status).toBe(401);
    expect((await call(meRoute, '/me', { token: ok.body.accessToken })).status).toBe(200);
    const live = await db.select().from(sessions).where(and(eq(sessions.userId, c.user.id)));
    expect(live.filter((x) => !x.revokedAt).map((x) => x.scope)).toEqual(['MOBILE']);
    await login(c.user.email!, 'N3w@Passw0rd!');
  });
});
