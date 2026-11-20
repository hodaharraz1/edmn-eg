import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as publicProductRoute } from '@/app/api/v1/catalog/products/[slug]/route';
import { GET as sellerOrderRoute } from '@/app/api/v1/seller/orders/[sellerOrderId]/route';
import { POST as stepsRoute } from '@/app/api/v1/seller/orders/[sellerOrderId]/steps/route';
import { POST as archiveRoute } from '@/app/api/v1/seller/products/[productId]/archive/route';
import { POST as oosRoute } from '@/app/api/v1/seller/products/[productId]/out-of-stock/route';
import { GET as productGet } from '@/app/api/v1/seller/products/[productId]/route';
import { POST as mediaRoute } from '@/app/api/v1/seller/store/media/route';
import { GET as storeGet } from '@/app/api/v1/seller/store/route';
import { PUT as stockRoute } from '@/app/api/v1/seller/variants/[variantId]/stock/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { auditLogs, files, productVariants, products, stores } from '@/server/db/schema';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, png, sellerOrdersOf } from '../helpers/factory';

/**
 * Batch 4 seller security and correctness, through the REAL mobile routes: store logo/banner (secure upload path, own
 * store only, type/size enforced, private nothing), product archive / out-of-stock (own products only, console rules),
 * cross-seller isolation, buyers refused on seller routes, idempotent retries, inventory never below reservations under
 * concurrent seller edits and buyer reservations, and fulfilment steps that cannot skip states.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, o: { method?: string; body?: unknown; form?: FormData; token?: string; params?: Record<string, string>; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.idem) headers['idempotency-key'] = o.idem;
  const method = o.method ?? (o.body !== undefined || o.form ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) }), { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function login(email: string) {
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId: key(), platform: 'ANDROID' } } });
  expect(r.status, r.raw).toBe(200);
  return r.body.tokens.accessToken as string;
}

const image = async (field: string, label: string, form = new FormData()) => {
  form.append(field, new Blob([new Uint8Array(await png(label, 800))], { type: 'image/png' }), `${label}.png`);
  return form;
};

let admin: Actor;
let sellerA: Awaited<ReturnType<typeof makeSeller>>;
let sellerB: Awaited<ReturnType<typeof makeSeller>>;
let tokA: string;
let tokB: string;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
  sellerA = await makeSeller(admin);
  sellerB = await makeSeller(admin);
  tokA = await login(sellerA.user.email!);
  tokB = await login(sellerB.user.email!);
});

describe('store logo and banner (POST /seller/store/media)', () => {
  it('replaces logo and banner through the secure upload path: public URLs, audited, only my store', async () => {
    const form = await image('banner', 'banner', await image('logo', 'logo'));
    const r = await call(mediaRoute, '/seller/store/media', { form, token: tokA, idem: randomUUID() });
    expect(r.status, r.raw).toBe(200);
    expect(r.body.bannerUrl).toBeTruthy();
    expect(r.body.logoUrl).toBeTruthy();
    const [st] = await db.select().from(stores).where(eq(stores.sellerId, sellerA.actor.sellerId!));
    const [banner] = await db.select().from(files).where(eq(files.id, st.bannerFileId!));
    expect(banner.purpose).toBe('STORE_BANNER');
    expect(banner.visibility).toBe('PUBLIC');
    const [row] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'seller.store_media_updated'), eq(auditLogs.entityId, st.id)));
    expect(row.newValues).toMatchObject({ bannerFileId: st.bannerFileId });
    // Seller B's store is untouched (the store is the session's, never a client id).
    const [stB] = await db.select().from(stores).where(eq(stores.sellerId, sellerB.actor.sellerId!));
    expect(stB.bannerFileId).not.toBe(st.bannerFileId);
    expect((await call(storeGet, '/seller/store', { token: tokA })).body.bannerUrl).toBe(r.body.bannerUrl);
  });

  it('refuses no file, a non-image disguised as PNG, a PDF banner, an oversize file, and a buyer token', async () => {
    expect((await call(mediaRoute, '/seller/store/media', { form: new FormData(), token: tokA, idem: randomUUID() })).status).toBe(422);
    const fake = new FormData();
    fake.append('banner', new Blob([new TextEncoder().encode('<script>alert(1)</script>')], { type: 'image/png' }), 'x.png');
    expect((await call(mediaRoute, '/seller/store/media', { form: fake, token: tokA, idem: randomUUID() })).status).toBe(422);
    const pdf = new FormData();
    pdf.append('banner', new Blob([new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: 'application/pdf' }), 'b.pdf');
    expect((await call(mediaRoute, '/seller/store/media', { form: pdf, token: tokA, idem: randomUUID() })).status).toBe(422);
    const big = new FormData();
    big.append('banner', new Blob([new Uint8Array(30 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
    expect((await call(mediaRoute, '/seller/store/media', { form: big, token: tokA, idem: randomUUID() })).status).toBeGreaterThanOrEqual(400);
    const buyer = await makeCustomer();
    const buyerTok = await login(buyer.user.email!);
    expect((await call(mediaRoute, '/seller/store/media', { form: await image('logo', 'l'), token: buyerTok, idem: randomUUID() })).status).toBe(403);
  });

  it('a retried upload with the same idempotency key stores one file', async () => {
    const k = randomUUID();
    const first = await call(mediaRoute, '/seller/store/media', { form: await image('logo', 'retry'), token: tokB, idem: k });
    const again = await call(mediaRoute, '/seller/store/media', { form: await image('logo', 'retry'), token: tokB, idem: k });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.logoUrl).toBe(first.body.logoUrl);
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'seller.store_media_updated'), eq(auditLogs.actorUserId, sellerB.user.id)));
    expect(rows).toHaveLength(1);
  });
});

describe('product archive and out-of-stock', () => {
  it('out-of-stock leaves exactly the reserved units; archive hides the product from buyers', async () => {
    const p = await makeProduct(sellerA.actor, admin, { price: 250_00, stock: 5 });
    const c = await makeCustomer();
    await checkout(c, [{ variantId: p.variantId, qty: 2 }]); // reserves 2 (unpaid)
    const oos = await call(oosRoute, `/seller/products/${p.productId}/out-of-stock`, { token: tokA, params: { productId: p.productId }, body: {}, idem: randomUUID() });
    expect(oos.status, oos.raw).toBe(200);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.stockOnHand).toBe(v.reserved);
    expect(v.reserved).toBe(2);
    // Archive is refused while unpaid orders reserve stock (the console's rule).
    const blocked = await call(archiveRoute, `/seller/products/${p.productId}/archive`, { token: tokA, params: { productId: p.productId }, body: {}, idem: randomUUID() });
    expect(blocked.status).toBe(409);

    const q = await makeProduct(sellerA.actor, admin, { price: 99_00, stock: 3 });
    const [{ slug }] = await db.select({ slug: products.slug }).from(products).where(eq(products.id, q.productId));
    expect((await call(publicProductRoute, `/catalog/products/${slug}`, { params: { slug } })).status).toBe(200);
    const arch = await call(archiveRoute, `/seller/products/${q.productId}/archive`, { token: tokA, params: { productId: q.productId }, body: {}, idem: randomUUID() });
    expect(arch.status, arch.raw).toBe(200);
    expect(arch.body.status).toBe('ARCHIVED');
    expect((await call(publicProductRoute, `/catalog/products/${slug}`, { params: { slug } })).status).toBe(404);
  });

  it('another seller can neither read, archive nor stop my product; a buyer is refused', async () => {
    const p = await makeProduct(sellerA.actor, admin, { price: 120_00, stock: 4 });
    for (const r of [
      await call(productGet, `/seller/products/${p.productId}`, { token: tokB, params: { productId: p.productId } }),
      await call(archiveRoute, `/seller/products/${p.productId}/archive`, { token: tokB, params: { productId: p.productId }, body: {}, idem: randomUUID() }),
      await call(oosRoute, `/seller/products/${p.productId}/out-of-stock`, { token: tokB, params: { productId: p.productId }, body: {}, idem: randomUUID() }),
    ]) expect([403, 404]).toContain(r.status);
    const buyer = await makeCustomer();
    expect((await call(archiveRoute, `/seller/products/${p.productId}/archive`, { token: await login(buyer.user.email!), params: { productId: p.productId }, body: {}, idem: randomUUID() })).status).toBe(403);
    const [prod] = await db.select().from(products).where(eq(products.id, p.productId));
    expect(prod.status).not.toBe('ARCHIVED');
  });
});

describe('inventory and fulfilment invariants', () => {
  it('concurrent seller stock edits and buyer reservations never leave stock below reservations', async () => {
    const p = await makeProduct(sellerA.actor, admin, { price: 80_00, stock: 3 });
    const buyers = await Promise.all([makeCustomer(), makeCustomer(), makeCustomer()]);
    const results = await Promise.allSettled([
      ...buyers.map((b) => checkout(b, [{ variantId: p.variantId, qty: 1 }])),
      call(stockRoute, `/seller/variants/${p.variantId}/stock`, { method: 'PUT', token: tokA, params: { variantId: p.variantId }, body: { stockOnHand: 1 }, idem: randomUUID() }),
      call(stockRoute, `/seller/variants/${p.variantId}/stock`, { method: 'PUT', token: tokA, params: { variantId: p.variantId }, body: { stockOnHand: 0 }, idem: randomUUID() }),
    ]);
    expect(results.length).toBe(5);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.reserved).toBeGreaterThanOrEqual(0);
    expect(v.stockOnHand).toBeGreaterThanOrEqual(v.reserved);
  });

  it("another seller cannot read or advance my order; steps cannot skip states (no shipping before payment)", async () => {
    const p = await makeProduct(sellerA.actor, admin, { price: 150_00, stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const [so] = await sellerOrdersOf(order.id);
    const peek = await call(sellerOrderRoute, `/seller/orders/${so.id}`, { token: tokB, params: { sellerOrderId: so.id } });
    expect([403, 404]).toContain(peek.status);
    expect(peek.raw).not.toContain(c.user.fullName); // nothing of the order leaks
    expect([403, 404]).toContain((await call(stepsRoute, `/seller/orders/${so.id}/steps`, { token: tokB, params: { sellerOrderId: so.id }, body: { step: 'CONFIRM_ORDER' }, idem: randomUUID() })).status);
    // Unpaid: the seller may not confirm, process or ship yet.
    for (const step of ['CONFIRM_ORDER', 'MARK_SHIPPED']) {
      const r = await call(stepsRoute, `/seller/orders/${so.id}/steps`, { token: tokA, params: { sellerOrderId: so.id }, body: { step }, idem: randomUUID() });
      expect([403, 409, 422], `${step}: ${r.raw}`).toContain(r.status);
    }
    expect((await sellerOrdersOf(order.id))[0].status).toBe(so.status); // nothing moved
    const buyerTok = await login(c.user.email!);
    expect((await call(sellerOrderRoute, `/seller/orders/${so.id}`, { token: buyerTok, params: { sellerOrderId: so.id } })).status).toBe(403);
  });
});
