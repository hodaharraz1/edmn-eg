import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as attrsRoute } from '@/app/api/v1/catalog/categories/[categoryId]/attributes/route';
import { GET as publicProductRoute } from '@/app/api/v1/catalog/products/[slug]/route';
import { GET as identityGet, POST as identityPost } from '@/app/api/v1/me/identity/route';
import { PUT as appIdentityRoute } from '@/app/api/v1/seller/application/identity/route';
import { POST as appDocsRoute } from '@/app/api/v1/seller/application/documents/route';
import { POST as appPayoutRoute } from '@/app/api/v1/seller/application/payout-account/route';
import { GET as appGet, POST as appStart } from '@/app/api/v1/seller/application/route';
import { POST as appStoreRoute } from '@/app/api/v1/seller/application/store/route';
import { POST as appSubmitRoute } from '@/app/api/v1/seller/application/submit/route';
import { POST as cancelPayoutRoute } from '@/app/api/v1/seller/payout-requests/[requestId]/cancel/route';
import { POST as previewPayoutRoute } from '@/app/api/v1/seller/payout-requests/preview/route';
import { GET as payoutsGet, POST as payoutsPost } from '@/app/api/v1/seller/payout-requests/route';
import { PUT as detailsRoute } from '@/app/api/v1/seller/products/[productId]/details/route';
import { POST as imagesRoute } from '@/app/api/v1/seller/products/[productId]/images/route';
import { PUT as logisticsRoute } from '@/app/api/v1/seller/products/[productId]/logistics/route';
import { GET as productGet } from '@/app/api/v1/seller/products/[productId]/route';
import { POST as submitRoute } from '@/app/api/v1/seller/products/[productId]/submit/route';
import { PUT as variantsRoute } from '@/app/api/v1/seller/products/[productId]/variants/route';
import { POST as visibilityRoute } from '@/app/api/v1/seller/products/[productId]/visibility/route';
import { POST as createProductRoute } from '@/app/api/v1/seller/products/route';
import { GET as ratesGet, PUT as ratesPut } from '@/app/api/v1/seller/shipping-rates/route';
import { GET as storeGet, PUT as storePut } from '@/app/api/v1/seller/store/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { journalEntries, sellerPayoutMethods, sellers, users, withdrawalRequests } from '@/server/db/schema';
import { moderateProduct } from '@/server/modules/catalog/products';
import { reviewIdentity } from '@/server/modules/identity/service';
import { decideSeller, verifyPayoutMethod } from '@/server/modules/sellers/service';
import { categoryId, checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * Flow B through the REAL mobile routes: KYC → seller application → EDMN approval (admin services) → product draft →
 * details / photos / price & stock / return policy / shipping → moderation → published to buyers; payout REQUESTS
 * against released funds only, with the same clientKey never creating two requests.
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
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId: key(), platform: 'IOS' } } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

const file = async (field: string, label: string, form = new FormData()) => {
  form.append(field, new Blob([new Uint8Array(await png(label))], { type: 'image/png' }), `${label}.png`);
  return form;
};

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

describe('Flow B — a buyer becomes a seller and publishes a product', () => {
  it('KYC → application → approval → product → moderation → visible to buyers', async () => {
    const u = await makeUser({ identity: false });
    const t = await login(u.email!);

    // S03 KYC: the National ID number is accepted but never returned.
    const idForm = await file('back', 'idb', await file('front', 'idf'));
    idForm.set('legalName', 'بائع جديد ثلاثي الاسم');
    idForm.set('nationalId', '29001011234567');
    const kyc = await call(identityPost, '/me/identity', { token: t, idem: key(), form: idForm });
    expect(kyc.status, JSON.stringify(kyc.body)).toBe(200);
    expect(kyc.body.status).toBe('PENDING_REVIEW');
    expect(JSON.stringify(kyc.body)).not.toContain('29001011234567');
    const { identityOf } = await import('@/server/modules/identity/service');
    const idRow = (await identityOf(db, u.id))!;
    await reviewIdentity(await makeAdmin(['SELLER_REVIEWER']), idRow.id, 'APPROVE');
    expect((await call(identityGet, '/me/identity', { token: t })).body.status).toBe('APPROVED');

    // S01/S02/S04/S07: application.
    expect((await call(appGet, '/seller/application', { token: t })).body.seller).toBeNull();
    expect((await call(appStart, '/seller/application', { token: t, body: { type: 'INDIVIDUAL' } })).body.seller.status).toBe('DRAFT');
    const early = await call(appSubmitRoute, '/seller/application/submit', { token: t, idem: key(), body: { acceptAgreement: true } });
    expect(early.status).toBe(422); // checklist incomplete
    const idSave = await call(appIdentityRoute, '/seller/application/identity', {
      method: 'PUT',
      token: t,
      body: { type: 'INDIVIDUAL', legalName: 'بائع جديد ثلاثي الاسم', nationalId: '29001011234567', mobile: u.phone, email: u.email, addressLine: 'شارع التحرير، الدقي', city: 'الجيزة', governorateId: 2 },
    });
    expect(idSave.status, JSON.stringify(idSave.body)).toBe(200);
    expect(idSave.body.seller.hasNationalId).toBe(true);
    expect(JSON.stringify(idSave.body)).not.toContain('29001011234567');
    const storeForm = new FormData();
    for (const [k, v] of Object.entries({ name: `متجر الموبايل ${key().slice(0, 5)}`, description: 'متجر من التطبيق', returnAddress: 'عنوان الإرجاع بالجيزة', returnGovernorateId: '2' })) storeForm.set(k, v);
    expect((await call(appStoreRoute, '/seller/application/store', { token: t, idem: key(), form: storeForm })).status).toBe(200);
    for (const kind of ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK']) {
      const f = await file('file', kind);
      f.set('kind', kind);
      const r = await call(appDocsRoute, '/seller/application/documents', { token: t, idem: key(), form: f });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const payout = await call(appPayoutRoute, '/seller/application/payout-account', { token: t, idem: key(), body: { type: 'INSTAPAY', holderName: 'بائع جديد', instapayAddress: `n${key().slice(0, 6)}@instapay` } });
    expect(payout.status, JSON.stringify(payout.body)).toBe(200);
    expect(payout.body.checklist.every((c: { ok: boolean }) => c.ok)).toBe(true);
    const submitted = await call(appSubmitRoute, '/seller/application/submit', { token: t, idem: key(), body: { acceptAgreement: true } });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.seller.status).toBe('PENDING_REVIEW');
    expect(submitted.body.seller.editable).toBe(false);

    // Admin (existing services) approves the seller and verifies the payout account.
    const [s] = await db.select().from(sellers).where(eq(sellers.ownerUserId, u.id));
    await decideSeller(admin, s.id, 'APPROVE');
    const [pm] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.sellerId, s.id));
    await verifyPayoutMethod(admin, pm.id, true, 'تحقق');

    // S23/S24: shipping rates. S09/S25: store policies.
    const rates = await call(ratesGet, '/seller/shipping-rates', { token: t });
    expect(rates.status).toBe(200);
    const set = await call(ratesPut, '/seller/shipping-rates', { method: 'PUT', token: t, body: { items: [{ governorateId: 1, enabled: true, feePiastres: 4500, etaMinDays: 1, etaMaxDays: 3 }] } });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.items.find((r: { governorateId: number }) => r.governorateId === 1)).toMatchObject({ enabled: true, feePiastres: 4500 });
    const st = await call(storeGet, '/seller/store', { token: t });
    const upd = await call(storePut, '/seller/store', {
      method: 'PUT',
      token: t,
      body: { name: st.body.name, description: 'وصف جديد', returnAddress: st.body.returnAddress, supportPhone: '', acceptsVoluntaryReturns: true, voluntaryReturnDays: 14, defaultProcessingDays: 2, freeShippingThreshold: null },
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body).toMatchObject({ acceptsVoluntaryReturns: true, voluntaryReturnDays: 14 });

    // S12–S20: product.
    const cat = await categoryId('electronics-accessories');
    expect((await call(attrsRoute, `/catalog/categories/${cat}/attributes`, { params: { categoryId: cat } })).status).toBe(200);
    const created = await call(createProductRoute, '/seller/products', { token: t, idem: key(), body: { categoryId: cat, titleAr: 'سماعة بلوتوث من التطبيق', condition: 'NEW' } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const params = { productId: id };
    expect(created.body.submissionProblems.length).toBeGreaterThan(0);
    expect((await call(detailsRoute, `/seller/products/${id}/details`, { method: 'PUT', token: t, params, body: { titleAr: 'سماعة بلوتوث من التطبيق', categoryId: cat, description: 'سماعة لاسلكية بجودة صوت عالية وبطارية طويلة', condition: 'NEW', keyFeatures: ['بلوتوث 5.3'] } })).status).toBe(200);
    const imgs = await file('images', 'p2', await file('images', 'p1'));
    expect((await call(imagesRoute, `/seller/products/${id}/images`, { token: t, idem: key(), params, form: imgs })).body.images).toHaveLength(2);
    const v = await call(variantsRoute, `/seller/products/${id}/variants`, { method: 'PUT', token: t, params, body: { variants: [{ sku: `APP-${key().slice(0, 6)}`, price: 899_00, stockOnHand: 12, options: {} }] } });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.variants[0]).toMatchObject({ pricePiastres: 899_00, stockOnHand: 12 });
    const lg = await call(logisticsRoute, `/seller/products/${id}/logistics`, {
      method: 'PUT',
      token: t,
      params,
      body: { weightGrams: 300, lengthCm: null, widthCm: null, heightCm: null, processingDays: 1, returnPolicyOverride: false, acceptsVoluntaryReturns: null, voluntaryReturnDays: null },
    });
    expect(lg.status, JSON.stringify(lg.body)).toBe(200);
    expect(lg.body.submissionProblems).toEqual([]);
    const sub = await call(submitRoute, `/seller/products/${id}/submit`, { token: t, idem: key(), params });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(['SUBMITTED', 'UNDER_REVIEW']).toContain(sub.body.status);
    // Not public before moderation.
    expect((await call(publicProductRoute, `/catalog/products/${encodeURIComponent(sub.body.slug)}`, { params: { slug: sub.body.slug } })).status).toBe(404);
    await moderateProduct(admin, id, 'APPROVE');
    const live = await call(productGet, `/seller/products/${id}`, { token: t, params });
    expect(live.body).toMatchObject({ status: 'LIVE', isListed: true });
    expect((await call(publicProductRoute, `/catalog/products/${encodeURIComponent(live.body.slug)}`, { params: { slug: live.body.slug } })).status).toBe(200);
    // S22: hide / show.
    const hidden = await call(visibilityRoute, `/seller/products/${id}/visibility`, { token: t, idem: key(), params, body: { listed: false } });
    expect(hidden.body.isListed).toBe(false);
    expect((await call(publicProductRoute, `/catalog/products/${encodeURIComponent(live.body.slug)}`, { params: { slug: live.body.slug } })).status).toBe(404);

    // Another seller can neither read nor edit this product.
    const other = await makeSeller(admin);
    const ot = await login(other.user.email!);
    expect([403, 404]).toContain((await call(productGet, `/seller/products/${id}`, { token: ot, params })).status);
    expect([403, 404]).toContain((await call(variantsRoute, `/seller/products/${id}/variants`, { method: 'PUT', token: ot, params, body: { variants: [{ sku: 'X1', price: 1, stockOnHand: 1, options: {} }] } })).status);
  });
});

describe('payout REQUESTS (request only)', () => {
  it('nothing withdrawable → refused; released funds → one request per clientKey; cancel before approval; no transfer, no ledger posting', async () => {
    const s = await makeSeller(admin);
    const t = await login(s.user.email!);
    const empty = await call(payoutsPost, '/seller/payout-requests', { token: t, body: { amountPiastres: 100_00, clientKey: key() } });
    expect(empty.status).toBeGreaterThanOrEqual(400);
    expect(empty.status).toBeLessThan(500);

    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id);

    const preview = await call(previewPayoutRoute, '/seller/payout-requests/preview', { token: t, body: { amountPiastres: 100_00 } });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.netPiastres).toBeLessThanOrEqual(100_00);
    const entriesBefore = (await db.select().from(journalEntries)).length;
    const ck = key();
    const r1 = await call(payoutsPost, '/seller/payout-requests', { token: t, body: { amountPiastres: 100_00, clientKey: ck } });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body).toMatchObject({ created: true, request: { status: 'REQUESTED', cancellable: true } });
    const r2 = await call(payoutsPost, '/seller/payout-requests', { token: t, body: { amountPiastres: 100_00, clientKey: ck } });
    expect(r2.body).toMatchObject({ created: false, request: { id: r1.body.request.id } });
    expect(await db.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.sellerId, s.actor.sellerId!), eq(withdrawalRequests.clientKey, ck)))).toHaveLength(1);
    expect((await db.select().from(journalEntries)).length).toBe(entriesBefore); // a request posts nothing

    const other = await makeSeller(admin);
    const ot = await login(other.user.email!);
    const foreign = await call(cancelPayoutRoute, `/seller/payout-requests/${r1.body.request.id}/cancel`, { token: ot, idem: key(), params: { requestId: r1.body.request.id } });
    expect(foreign.status).toBe(403);
    const cancel = await call(cancelPayoutRoute, `/seller/payout-requests/${r1.body.request.id}/cancel`, { token: t, idem: key(), params: { requestId: r1.body.request.id } });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.items.find((x: { id: string }) => x.id === r1.body.request.id).status).toBe('CANCELLED');
    const list = await call(payoutsGet, '/seller/payout-requests', { token: t });
    expect(list.status).toBe(200);
  });

  it('a store member without finance.withdraw cannot request a payout', async () => {
    const s = await makeSeller(admin);
    const staff = await makeUser();
    const { sellerMembers } = await import('@/server/db/schema');
    await db.insert(sellerMembers).values({ sellerId: s.actor.sellerId!, userId: staff.id, role: 'ORDER_MANAGER' });
    const t = await login(staff.email!);
    const r = await call(payoutsPost, '/seller/payout-requests', { token: t, body: { amountPiastres: 100, clientKey: key() } });
    expect(r.status).toBe(403);
    const [u] = await db.select().from(users).where(eq(users.id, staff.id));
    expect(u).toBeTruthy();
  });
});
