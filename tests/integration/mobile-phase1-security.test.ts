import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GET as appConfigRoute } from '@/app/api/v1/app/config/route';
import { GET as productsRoute } from '@/app/api/v1/catalog/products/route';
import { GET as productRoute } from '@/app/api/v1/catalog/products/[slug]/route';
import { GET as reviewsRoute } from '@/app/api/v1/catalog/products/[slug]/reviews/route';
import { GET as legalRoute } from '@/app/api/v1/content/legal/[slug]/route';
import { GET as storeRoute } from '@/app/api/v1/stores/[slug]/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as meRoute } from '@/app/api/v1/me/route';
import { POST as revokeOthersRoute } from '@/app/api/v1/me/sessions/revoke-others/route';
import { abandonIdempotent, beginIdempotent, pruneApiIdempotencyKeys } from '@/server/api/idempotency';
import { adminActor, customerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { auditLogs, dealDeliveryOtps, externalDeals, idempotencyKeys, products, riskFlags, sellers, stores, userRoles, users } from '@/server/db/schema';
import { CURRENT_OTP_HASH_VERSION, deliveryCodeHash, deliveryCodeMatches, openBuyerCode, sealBuyerCode } from '@/server/modules/deals/delivery-otp';
import {
  claimInvitation,
  createDeal,
  deliveryOtpForBuyer,
  inviteSeller,
  markDealDelivered,
  reportDeliveryException,
  respondToOffer,
  revealDeliveryOtpForBuyer,
  saveDealStep,
  startDealPayment,
  submitSellerOffer,
  verifyDeliveryOtp,
} from '@/server/modules/deals/service';
import { pendingClosures } from '@/server/modules/customers/closure';
import { recentApprovals } from '@/server/modules/finance/approvals';
import { withdrawalQueue } from '@/server/modules/finance/withdrawals';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { addRiskFlag, resolveRiskFlag } from '@/server/modules/risk/service';
import { adminSettingsView } from '@/server/modules/settings';
import { ticketQueue } from '@/server/modules/support/service';
import { ensurePaymentSetup, makeAdmin, makeProduct, makeSeller, makeUser, pdf, png } from '../helpers/factory';

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const inst = () => randomBytes(18).toString('base64url');
async function call(h: Handler, path: string, opts: { method?: string; body?: unknown; token?: string; params?: Record<string, string>; installation?: string | null; idem?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.installation !== null) headers['x-edmn-installation'] = opts.installation ?? inst();
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await h(new Request(`http://localhost/api/v1${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), {
    params: Promise.resolve(opts.params ?? {}),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}
async function mobileToken(email: string) {
  const installationId = inst();
  const r = await call(loginRoute as Handler, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId, platform: 'IOS' } }, installation: installationId });
  expect(r.status).toBe(200);
  return r.body.tokens.accessToken as string;
}

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

const LOC = { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 };
async function shippedDeal() {
  const buyerUser = await makeUser();
  const buyer = customerActor(buyerUser.id);
  const deal = await createDeal(buyer, { title: 'هاتف للتسليم باليد', description: 'هاتف بحالة جيدة جداً مع العلبة', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '3000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const sellerUser = await makeUser();
  const seller = customerActor(sellerUser.id);
  await claimInvitation(seller, token);
  const { version } = await submitSellerOffer(
    seller,
    deal.id,
    { details: { fullName: 'بائع الصفقة' }, location: LOC, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: `p${inst().slice(0, 6)}@instapay` }, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
    true,
  );
  await respondToOffer(buyer, deal.id, version, 'ACCEPT');
  const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
  const { submission } = await submitProof(buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  await confirmPayment(admin, p.id, submission.id);
  await markDealDelivered(seller, deal.id, 'تم الشحن', [{ data: pdf(), name: 'waybill.pdf' }]);
  const view = await deliveryOtpForBuyer(buyer, deal.id);
  return { buyer, buyerUser, seller, sellerUser, dealId: deal.id, code: view!.testCode! };
}

/* ───────────────────────── Delivery OTP: key separation + buyer-only in-app view ───────────────────────── */
describe('delivery OTP security (decision 2)', () => {
  it('new codes are hashed with the dedicated OTP key (v2), never with SESSION_SECRET; v1 codes still verify', async () => {
    const d = await shippedDeal();
    const [row] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(row.codeHashVersion).toBe(CURRENT_OTP_HASH_VERSION);
    expect(row.codeHash).toBe(deliveryCodeHash(d.dealId, row.id, d.code, 2));
    expect(row.codeHash).not.toBe(deliveryCodeHash(d.dealId, row.id, d.code, 1));
    // Legacy rows (issued before key separation) keep verifying under their own version until they expire.
    const legacy = deliveryCodeHash(d.dealId, row.id, d.code, 1);
    expect(deliveryCodeMatches(legacy, d.dealId, row.id, d.code, 1)).toBe(true);
    expect(deliveryCodeMatches(legacy, d.dealId, row.id, d.code, 2)).toBe(false);
    // The hash version can never be rewritten (DB trigger).
    await expect(db.update(dealDeliveryOtps).set({ codeHashVersion: 1 }).where(eq(dealDeliveryOtps.id, row.id))).rejects.toThrow();
  });

  it('only the buyer can reveal the code in-app; the seller and staff (all permissions) are refused; the audit never holds the code', async () => {
    const d = await shippedDeal();
    const v = await revealDeliveryOtpForBuyer(d.buyer, d.dealId);
    expect(v!.code).toBe(d.code);
    expect(v!.attemptsLeft).toBeGreaterThan(0);
    await expect(revealDeliveryOtpForBuyer(d.seller, d.dealId)).rejects.toThrow();
    await expect(revealDeliveryOtpForBuyer(admin, d.dealId)).rejects.toThrow();
    // Staff who also happens to be the buyer still cannot use a staff session to read it.
    await expect(revealDeliveryOtpForBuyer(await adminActor(d.buyerUser.id), d.dealId)).rejects.toThrow();
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, d.dealId));
    expect(rows.some((r) => r.action === 'deal.delivery_otp_viewed_by_buyer')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(d.code);
    const [otp] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(otp.buyerCodeEnc).not.toContain(d.code);
  });

  it('the sealed copy is bound to its deal and OTP id and is destroyed by the database once used', async () => {
    const d = await shippedDeal();
    const [otp] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(() => openBuyerCode(d.dealId, randomUUID(), otp.buyerCodeEnc!)).toThrow();
    expect(() => openBuyerCode(randomUUID(), otp.id, otp.buyerCodeEnc!)).toThrow();
    // It can be cleared but never replaced with another value.
    await expect(db.update(dealDeliveryOtps).set({ buyerCodeEnc: sealBuyerCode(d.dealId, otp.id, '123456') }).where(eq(dealDeliveryOtps.id, otp.id))).rejects.toThrow();
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    const [used] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.id, otp.id));
    expect(used.usedAt).not.toBeNull();
    expect(used.buyerCodeEnc).toBeNull();
    expect(await revealDeliveryOtpForBuyer(d.buyer, d.dealId)).toBeNull();
  });

  it('an invalidated code (delivery exception) loses its sealed copy too', async () => {
    const d = await shippedDeal();
    await reportDeliveryException(d.buyer, d.dealId, 'المندوب لم يصل في الموعد');
    const [otp] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(otp.invalidatedAt).not.toBeNull();
    expect(otp.buyerCodeEnc).toBeNull();
  });

  it('reveals are rate limited per deal', async () => {
    const d = await shippedDeal();
    for (let i = 0; i < 10; i++) await revealDeliveryOtpForBuyer(d.buyer, d.dealId);
    await expect(revealDeliveryOtpForBuyer(d.buyer, d.dealId)).rejects.toThrow();
  });
});

/* ───────────────────────── S-H1: risk-flag resolution conflict of interest ───────────────────────── */
describe('risk flags (S-H1)', () => {
  async function promoteToStaff(userId: string) {
    await db.update(users).set({ isStaff: true }).where(eq(users.id, userId));
    await db.insert(userRoles).values({ userId, roleCode: 'SUPER_ADMIN' }).onConflictDoNothing();
    return adminActor(userId, { stepUpAt: new Date() });
  }

  it('a staff member who is a party to the deal can never clear its delivery-review release blocker', async () => {
    const d = await shippedDeal();
    await reportDeliveryException(d.seller, d.dealId, 'المشتري لم يحضر للاستلام');
    const [flag] = await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, d.dealId), eq(riskFlags.code, 'DELIVERY_EXCEPTION')));
    const buyerAsStaff = await promoteToStaff(d.buyerUser.id);
    await expect(resolveRiskFlag(buyerAsStaff, flag.id, 'تم التحقق')).rejects.toThrow(/طرف/);
    const sellerAsStaff = await promoteToStaff(d.sellerUser.id);
    await expect(resolveRiskFlag(sellerAsStaff, flag.id, 'تم التحقق')).rejects.toThrow(/طرف/);
    const [still] = await db.select().from(riskFlags).where(eq(riskFlags.id, flag.id));
    expect(still.status).toBe('OPEN');
  });

  it('an independent officer needs deals.manage, fresh 2FA and a reason; resolution and audit commit together', async () => {
    const d = await shippedDeal();
    await reportDeliveryException(d.buyer, d.dealId, 'تعذر التسليم في الموعد');
    const [flag] = await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, d.dealId), eq(riskFlags.code, 'DELIVERY_EXCEPTION')));
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    await expect(resolveRiskFlag(support, flag.id, 'سبب كافٍ')).rejects.toThrow();
    const officer = await makeAdmin(['DISPUTE_OFFICER']);
    await expect(resolveRiskFlag({ ...officer, stepUpAt: new Date(Date.now() - 3600_000) }, flag.id, 'سبب كافٍ')).rejects.toThrow();
    await expect(resolveRiskFlag(officer, flag.id, '')).rejects.toThrow();
    expect(await resolveRiskFlag(officer, flag.id, 'تمت المراجعة مع شركة الشحن')).toEqual({ resolved: true });
    expect(await resolveRiskFlag(officer, flag.id, 'تمت المراجعة مع شركة الشحن')).toEqual({ resolved: false });
    const [row] = await db.select().from(riskFlags).where(eq(riskFlags.id, flag.id));
    expect(row.status).toBe('RESOLVED');
    expect(row.resolvedBy).toBe(officer.userId);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, d.dealId), eq(auditLogs.action, 'risk.flag_resolved')));
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(officer.userId);
  });

  it('a store member who is staff cannot clear a flag on their own store; manual flags are audited', async () => {
    const s = await makeSeller(admin);
    const f = await addRiskFlag(admin, { entityType: 'seller', entityId: s.actor.sellerId!, note: 'مراجعة يدوية للمتجر', severity: 'HIGH' });
    const ownerAsStaff = await promoteToStaff(s.user.id);
    await expect(resolveRiskFlag(ownerAsStaff, f.id, 'لا شيء')).rejects.toThrow(/طرف/);
    expect(await resolveRiskFlag(admin, f.id, null)).toEqual({ resolved: true });
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, s.actor.sellerId!), eq(auditLogs.action, 'risk.flag_added')));
    expect(audits).toHaveLength(1);
    await expect(addRiskFlag(customerActor(s.user.id), { entityType: 'seller', entityId: s.actor.sellerId!, note: 'محاولة' })).rejects.toThrow();
  });
});

/* ───────────────────────── Authorization inside admin query services ───────────────────────── */
describe('admin queries authorize inside the service (not only in pages)', () => {
  it('customers and under-privileged staff are refused; the right permission is accepted', async () => {
    const customer = customerActor((await makeUser()).id);
    const catalog = await makeAdmin(['CATALOG_REVIEWER']);
    for (const actor of [customer, catalog]) {
      await expect(withdrawalQueue(actor, ['REQUESTED'])).rejects.toThrow();
      await expect(recentApprovals(actor)).rejects.toThrow();
      await expect(pendingClosures(actor)).rejects.toThrow();
      await expect(ticketQueue(actor, ['OPEN'])).rejects.toThrow();
      await expect(adminSettingsView(actor)).rejects.toThrow();
    }
    const finance = await makeAdmin(['FINANCE_CHECKER']);
    await expect(recentApprovals(finance)).resolves.toBeInstanceOf(Array);
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    await expect(ticketQueue(support, ['OPEN'])).resolves.toBeInstanceOf(Array);
    await expect(withdrawalQueue(support, ['REQUESTED'])).rejects.toThrow();
  });
});

/* ───────────────────────── Generic idempotency ───────────────────────── */
describe('idempotency (mobile mutations)', () => {
  it('a retry with the same key replays the original response; a different request with the same key is refused', async () => {
    const u = await makeUser();
    const token = await mobileToken(u.email!);
    await mobileToken(u.email!);
    await mobileToken(u.email!);
    const key = inst();
    const first = await call(revokeOthersRoute as Handler, '/me/sessions/revoke-others', { body: {}, token, idem: key });
    expect(first.status).toBe(200);
    expect(first.body.revoked).toBe(2);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    const again = await call(revokeOthersRoute as Handler, '/me/sessions/revoke-others', { body: {}, token, idem: key });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    const reused = await call(revokeOthersRoute as Handler, '/me/sessions/revoke-others', { body: { extra: 1 }, token, idem: key });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('idempotency_key_reused');
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'auth.other_sessions_revoked')));
    expect(audits).toHaveLength(1);
  });

  it('keys are scoped per caller: another user with the same key is unaffected', async () => {
    const key = inst();
    const a = await mobileToken((await makeUser()).email!);
    const b = await mobileToken((await makeUser()).email!);
    expect((await call(revokeOthersRoute as Handler, '/me/sessions/revoke-others', { body: {}, token: a, idem: key })).headers.get('idempotent-replayed')).toBeNull();
    expect((await call(revokeOthersRoute as Handler, '/me/sessions/revoke-others', { body: {}, token: b, idem: key })).headers.get('idempotent-replayed')).toBeNull();
  });

  it('a concurrent attempt gets idempotency_in_progress; a failed attempt releases the key; expired rows are pruned', async () => {
    const req = () => new Request('http://localhost/api/v1/x', { method: 'POST', headers: { 'idempotency-key': key } });
    const key = inst();
    const owner = `u:${randomUUID()}`;
    const o1 = await beginIdempotent(req(), owner, { a: 1 });
    expect(o1.kind).toBe('proceed');
    await expect(beginIdempotent(req(), owner, { a: 1 })).rejects.toMatchObject({ code: 'idempotency_in_progress' });
    if (o1.kind === 'proceed') await abandonIdempotent(o1.claim);
    expect((await beginIdempotent(req(), owner, { a: 1 })).kind).toBe('proceed');
    await db.update(idempotencyKeys).set({ status: 'COMPLETED', responseStatus: 200, responseBody: {}, expiresAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(idempotencyKeys.key, key));
    // Legacy domain keys (status NULL) are never pruned.
    await db.insert(idempotencyKeys).values({ scope: `legacy:${randomUUID()}`, key: 'k', resultRef: 'x' });
    expect(await pruneApiIdempotencyKeys()).toBeGreaterThanOrEqual(1);
    const left = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    expect(left).toHaveLength(0);
    const legacy = await db.execute(sql`select count(*)::int n from idempotency_keys where status is null`);
    expect(Number((legacy.rows[0] as { n: number }).n)).toBeGreaterThan(0);
  });

  it('mutations without Idempotency-Key are refused before any side effect', async () => {
    const token = await mobileToken((await makeUser()).email!);
    const r = await call(revokeOthersRoute as Handler, '/me/sessions/revoke-others', { body: {}, token });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('idempotency_key_required');
  });
});

/* ───────────────────────── Mobile-safe rate limiting ───────────────────────── */
describe('rate limiting (CGNAT-safe)', () => {
  const prevProxy = process.env.TRUSTED_PROXY;
  afterEach(() => {
    if (prevProxy === undefined) delete process.env.TRUSTED_PROXY;
    else process.env.TRUSTED_PROXY = prevProxy;
  });

  it('many app installations behind ONE carrier IP are not locked out by each other', async () => {
    process.env.TRUSTED_PROXY = 'true';
    const ip = `10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}.7`;
    for (let i = 0; i < 150; i++) {
      const r = await call(appConfigRoute as Handler, '/app/config', { headers: { 'x-real-ip': ip } });
      expect(r.status, `installation #${i}`).toBe(200);
    }
  });

  it('one installation that floods is limited (429 + Retry-After + stable code)', async () => {
    const installation = inst();
    let limited: Awaited<ReturnType<typeof call>> | null = null;
    for (let i = 0; i < 125 && !limited; i++) {
      const r = await call(appConfigRoute as Handler, '/app/config', { installation });
      if (r.status === 429) limited = r;
    }
    expect(limited).not.toBeNull();
    expect(limited!.body.code).toBe('rate_limited');
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another installation is unaffected.
    expect((await call(appConfigRoute as Handler, '/app/config')).status).toBe(200);
  });

  it('authenticated limits follow the account, not the network address', async () => {
    process.env.TRUSTED_PROXY = 'true';
    const token = await mobileToken((await makeUser()).email!);
    const other = await mobileToken((await makeUser()).email!);
    const ip = '10.99.99.99';
    await db.execute(sql`insert into rate_limits (key, window_start, count) values (${`api:read:ip:${ip}`}, date_trunc('minute', now()), 100000) on conflict (key, window_start) do update set count = 100000`);
    // The IP bucket is exhausted but signed-in users are counted per user.
    expect((await call(meRoute as Handler, '/me', { token, headers: { 'x-real-ip': ip } })).status).toBe(200);
    expect((await call(meRoute as Handler, '/me', { token: other, headers: { 'x-real-ip': ip } })).status).toBe(200);
  });
});

/* ───────────────────────── Public READ-ONLY catalog ───────────────────────── */
describe('public catalog API (read-only)', () => {
  it('lists and shows live products in piastres without stock counts; hidden products are 404', async () => {
    const s = await makeSeller(admin);
    const title = `سماعة لاسلكية ${inst().slice(0, 6)}`;
    const live = await makeProduct(s.actor, admin, { price: 12345, stock: 7, title });
    const [p] = await db.select().from(products).where(eq(products.id, live.productId));
    const list = await call(productsRoute as Handler, `/catalog/products?q=${encodeURIComponent(title)}`);
    expect(list.status).toBe(200);
    const card = list.body.items.find((i: { id: string }) => i.id === p.id);
    expect(card).toBeTruthy();
    expect(card.minPricePiastres).toBe(12345);
    expect(card.inStock).toBe(true);
    expect(list.headers.get('cache-control')).toMatch(/public/);
    const detail = await call(productRoute as Handler, `/catalog/products/${p.slug}`, { params: { slug: p.slug } });
    expect(detail.status).toBe(200);
    expect(detail.body.variants[0].pricePiastres).toBe(12345);
    expect(detail.body.variants[0].available).toBe(true);
    const raw = JSON.stringify(detail.body);
    for (const leak of ['stockOnHand', 'reserved', 'sellerId', 'costPrice', 'commission', 'nationalId', 'payout']) expect(raw).not.toContain(leak);
    expect((await call(reviewsRoute as Handler, `/catalog/products/${p.slug}/reviews`, { params: { slug: p.slug } })).status).toBe(200);
    const draft = await makeProduct(s.actor, admin, { approve: false });
    const [dp] = await db.select().from(products).where(eq(products.id, draft.productId));
    expect((await call(productRoute as Handler, `/catalog/products/${dp.slug}`, { params: { slug: dp.slug } })).status).toBe(404);
    expect((await call(reviewsRoute as Handler, `/catalog/products/${dp.slug}/reviews`, { params: { slug: dp.slug } })).status).toBe(404);
    // A suspended seller's products and store disappear.
    const [store] = await db.select().from(stores).where(eq(stores.sellerId, s.actor.sellerId!));
    expect((await call(storeRoute as Handler, `/stores/${store.slug}`, { params: { slug: store.slug } })).status).toBe(200);
    await db.update(sellers).set({ status: 'SUSPENDED' }).where(eq(sellers.id, s.actor.sellerId!));
    expect((await call(productRoute as Handler, `/catalog/products/${p.slug}`, { params: { slug: p.slug } })).status).toBe(404);
    expect((await call(storeRoute as Handler, `/stores/${store.slug}`, { params: { slug: store.slug } })).status).toBe(404);
  });

  it('query validation returns stable problem codes; unknown legal documents are 404', async () => {
    const bad = await call(productsRoute as Handler, '/catalog/products?pageSize=1000&sort=cheapest');
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('validation_failed');
    expect(bad.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['pageSize', 'sort']);
    expect((await call(legalRoute as Handler, '/content/legal/nope', { params: { slug: 'nope' } })).status).toBe(404);
  });

  it('app config exposes Real Money read-only (OFF) and server-side minimum versions', async () => {
    const r = await call(appConfigRoute as Handler, '/app/config');
    expect(r.status).toBe(200);
    expect(r.body.realMoneyEnabled).toBe(false);
    expect(r.body.defaultLocale).toBe('ar');
    expect(r.body.currency).toBe('EGP');
    expect(r.body.minSupportedVersion.customer).toMatch(/^\d+\.\d+\.\d+$/);
    const [rm] = await db.select().from(externalDeals).limit(1);
    expect(rm === undefined || typeof rm.id === 'string').toBe(true);
  });
});
