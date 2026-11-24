import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as governoratesRoute } from '@/app/api/v1/governorates/route';
import { PUT as appIdentityRoute } from '@/app/api/v1/seller/application/identity/route';
import { GET as appGet, POST as appStart } from '@/app/api/v1/seller/application/route';
import { POST as appStoreRoute } from '@/app/api/v1/seller/application/store/route';
import { GET as ratesGet, PUT as ratesPut } from '@/app/api/v1/seller/shipping-rates/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { governorates, sellerShippingRates, sellers, stores } from '@/server/db/schema';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeSeller, makeUser } from '../helpers/factory';

/**
 * Batch 5: the governorate a seller chooses (application identity, store return address, shipping rates) must be one
 * of the authoritative, active governorates. Before, an unknown id reached the database and failed as a foreign-key
 * error (500), and a deactivated governorate could be saved or offered for delivery. Also: the application returns
 * the stored return governorate (the app's picker shows it), and shipping rates stay per-seller.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, o: { method?: string; body?: unknown; form?: FormData; token?: string; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.idem) headers['idempotency-key'] = o.idem;
  const method = o.method ?? (o.body !== undefined || o.form ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) }), { params: Promise.resolve({}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function login(email: string) {
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId: key(), platform: 'ANDROID' } } });
  expect(r.status, r.raw).toBe(200);
  return r.body.tokens.accessToken as string;
}

const INACTIVE = 9701; // a governorate that exists but is switched off for this test
const UNKNOWN = 9799; // no such governorate

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
  await db.insert(governorates).values({ id: INACTIVE, code: `T${INACTIVE}`, nameAr: 'محافظة موقوفة للاختبار', nameEn: 'Inactive test governorate', sortOrder: 999, isActive: false }).onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(sellerShippingRates).where(eq(sellerShippingRates.governorateId, INACTIVE));
  await db.update(sellers).set({ governorateId: 1 }).where(eq(sellers.governorateId, INACTIVE));
  await db.update(stores).set({ returnGovernorateId: 1 }).where(eq(stores.returnGovernorateId, INACTIVE));
  await db.delete(governorates).where(eq(governorates.id, INACTIVE));
});

describe('the governorate list the app picks from', () => {
  it('lists only active governorates, with Arabic and English names', async () => {
    const r = await call(governoratesRoute, '/governorates');
    expect(r.status).toBe(200);
    const ids = r.body.items.map((g: { id: number }) => g.id);
    expect(ids).not.toContain(INACTIVE);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const g of r.body.items) expect(g.nameAr && g.nameEn).toBeTruthy();
  });
});

describe('seller application: governorate must be active and known', () => {
  let tok: string;
  let user: Awaited<ReturnType<typeof makeUser>>;
  const identity = (governorateId: unknown) => ({
    type: 'INDIVIDUAL',
    legalName: 'بائع محافظات للاختبار',
    nationalId: '29001011234567',
    mobile: user.phone,
    email: user.email,
    addressLine: 'شارع النصر، المنصورة',
    city: 'المنصورة',
    governorateId,
  });
  const storeForm = (returnGovernorateId: string) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: `متجر المحافظات ${key().slice(0, 5)}`, returnAddress: 'عنوان الإرجاع بالمنصورة', returnGovernorateId })) f.set(k, v);
    return f;
  };

  beforeAll(async () => {
    user = await makeUser();
    tok = await login(user.email!);
    expect((await call(appStart, '/seller/application', { token: tok, body: { type: 'INDIVIDUAL' } })).status).toBe(200);
  });

  it('unknown and deactivated governorates are refused with 422 (not a 500), nothing is stored', async () => {
    for (const g of [UNKNOWN, INACTIVE]) {
      const r = await call(appIdentityRoute, '/seller/application/identity', { method: 'PUT', token: tok, body: identity(g) });
      expect(r.status, r.raw).toBe(422);
      expect(r.raw).toContain('governorateId');
    }
    const [s] = await db.select().from(sellers).where(eq(sellers.ownerUserId, user.id));
    expect(s.governorateId).toBeNull();
    for (const g of [String(UNKNOWN), String(INACTIVE)]) {
      const r = await call(appStoreRoute, '/seller/application/store', { token: tok, idem: key(), form: storeForm(g) });
      expect(r.status, r.raw).toBe(422);
    }
    expect(await db.select().from(stores).where(eq(stores.sellerId, s.id))).toHaveLength(0);
  });

  it('an active governorate id is stored as the id, and the application returns the store return governorate', async () => {
    const ok = await call(appIdentityRoute, '/seller/application/identity', { method: 'PUT', token: tok, body: identity(3) });
    expect(ok.status, ok.raw).toBe(200);
    expect(ok.body.seller.governorateId).toBe(3);
    const st = await call(appStoreRoute, '/seller/application/store', { token: tok, idem: key(), form: storeForm('2') });
    expect(st.status, st.raw).toBe(200);
    const app = await call(appGet, '/seller/application', { token: tok });
    expect(app.body.seller.store.returnGovernorateId).toBe(2);
    const [row] = await db.select().from(stores).innerJoin(sellers, eq(sellers.id, stores.sellerId)).where(eq(sellers.ownerUserId, user.id));
    expect(row.stores.returnGovernorateId).toBe(2);
  });
});

describe('shipping rates: active governorates only, per seller', () => {
  let tokA: string;
  let tokB: string;
  let sellerA: Awaited<ReturnType<typeof makeSeller>>;
  let sellerB: Awaited<ReturnType<typeof makeSeller>>;
  beforeAll(async () => {
    sellerA = await makeSeller(admin);
    sellerB = await makeSeller(admin);
    tokA = await login(sellerA.user.email!);
    tokB = await login(sellerB.user.email!);
  });
  const rate = (governorateId: number, enabled: boolean, feePiastres = 4500) => ({ governorateId, enabled, feePiastres, etaMinDays: 1, etaMaxDays: 3 });

  it('refuses an unknown governorate and offering a deactivated one; nothing changes', async () => {
    const before = await db.select().from(sellerShippingRates).where(eq(sellerShippingRates.sellerId, sellerA.actor.sellerId!));
    for (const items of [[rate(UNKNOWN, false)], [rate(INACTIVE, true)], [rate(1, true, 1000), rate(UNKNOWN, true)]]) {
      const r = await call(ratesPut, '/seller/shipping-rates', { method: 'PUT', token: tokA, body: { items } });
      expect(r.status, r.raw).toBe(422);
    }
    const after = await db.select().from(sellerShippingRates).where(eq(sellerShippingRates.sellerId, sellerA.actor.sellerId!));
    expect(after).toEqual(before);
    // A deactivated governorate may still be switched OFF (e.g. a rate left over from before it was deactivated).
    const off = await call(ratesPut, '/seller/shipping-rates', { method: 'PUT', token: tokA, body: { items: [rate(INACTIVE, false)] } });
    expect(off.status, off.raw).toBe(200);
  });

  it('min > max and out-of-range values are refused', async () => {
    for (const items of [[{ ...rate(1, true), etaMinDays: 5, etaMaxDays: 2 }], [{ ...rate(1, true), feePiastres: -1 }], [{ ...rate(1, true), etaMaxDays: 99 }]]) {
      const r = await call(ratesPut, '/seller/shipping-rates', { method: 'PUT', token: tokA, body: { items } });
      expect(r.status, r.raw).toBe(422);
    }
  });

  it('add then modify a rate: persisted for my store only; the other seller and a buyer cannot read or change it', async () => {
    const add = await call(ratesPut, '/seller/shipping-rates', { method: 'PUT', token: tokA, body: { items: [rate(2, true, 6000)] } });
    expect(add.status, add.raw).toBe(200);
    const mod = await call(ratesPut, '/seller/shipping-rates', { method: 'PUT', token: tokA, body: { items: [{ ...rate(2, true, 7550), etaMaxDays: 4 }] } });
    expect(mod.status, mod.raw).toBe(200);
    const [a] = await db.select().from(sellerShippingRates).where(and(eq(sellerShippingRates.sellerId, sellerA.actor.sellerId!), eq(sellerShippingRates.governorateId, 2)));
    expect(a).toMatchObject({ enabled: true, fee: 7550, etaMinDays: 1, etaMaxDays: 4 });
    // Seller B's rows are its own (the seller is the session's, never a client id) and were not touched.
    const listB = await call(ratesGet, '/seller/shipping-rates', { token: tokB });
    expect(listB.body.items.find((r: { governorateId: number }) => r.governorateId === 2)?.feePiastres).not.toBe(7550);
    const [b] = await db.select().from(sellerShippingRates).where(and(eq(sellerShippingRates.sellerId, sellerB.actor.sellerId!), inArray(sellerShippingRates.governorateId, [2])));
    expect(b?.fee ?? 0).not.toBe(7550);
    // A buyer has no seller rates.
    const buyer = await makeCustomer();
    const bt = await login(buyer.user.email!);
    expect((await call(ratesGet, '/seller/shipping-rates', { token: bt })).status).toBe(403);
    expect((await call(ratesPut, '/seller/shipping-rates', { method: 'PUT', token: bt, body: { items: [rate(2, true)] } })).status).toBe(403);
    expect((await call(ratesGet, '/seller/shipping-rates', {})).status).toBe(401);
  });
});
