import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as auditRoute } from '@/app/api/v1/admin/audit/route';
import { GET as dealsRoute } from '@/app/api/v1/admin/deals/route';
import { GET as disputesRoute } from '@/app/api/v1/admin/disputes/route';
import { GET as identityRoute } from '@/app/api/v1/admin/identity/reviews/route';
import { GET as ordersRoute } from '@/app/api/v1/admin/orders/route';
import { GET as sellersRoute } from '@/app/api/v1/admin/sellers/applications/route';
import { customerActor } from '@/server/auth/actors';
import { totpCode } from '@/server/auth/totp';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { externalDeals, sellers } from '@/server/db/schema';
import { maskName } from '@/server/modules/admin-mobile/monitoring';
import { createDeal } from '@/server/modules/deals/service';
import { submitIdentity } from '@/server/modules/identity/service';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { addPayoutMethod, saveIdentity, saveStore, startApplication, submitApplication, uploadSellerDocument } from '@/server/modules/sellers/service';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * Admin App monitoring through the REAL route handlers: each list answers only with the web console's permission for
 * the same page, refuses before TOTP and to Customer App tokens, and never carries contact data, national IDs or
 * full personal names.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function call(h: Handler, path: string, opts: { body?: unknown; token?: string; method?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await h(new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve({}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function staffToken(roles: string[]) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute as Handler, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
  const token = login.body.tokens.accessToken as string;
  const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { method: 'POST', body: {}, token });
  expect((await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token })).status).toBe(200);
  return { token, user: u };
}

const LISTS: { name: string; route: Handler; path: string; allowed: string; denied: string }[] = [
  { name: 'seller applications', route: sellersRoute as Handler, path: '/admin/sellers/applications', allowed: 'SELLER_REVIEWER', denied: 'CATALOG_REVIEWER' },
  { name: 'identity reviews', route: identityRoute as Handler, path: '/admin/identity/reviews', allowed: 'SELLER_REVIEWER', denied: 'PAYMENT_REVIEWER' },
  { name: 'orders', route: ordersRoute as Handler, path: '/admin/orders', allowed: 'PAYMENT_REVIEWER', denied: 'CATALOG_REVIEWER' },
  { name: 'deals', route: dealsRoute as Handler, path: '/admin/deals', allowed: 'PAYMENT_REVIEWER', denied: 'CATALOG_REVIEWER' },
  { name: 'disputes', route: disputesRoute as Handler, path: '/admin/disputes', allowed: 'DISPUTE_OFFICER', denied: 'PAYMENT_REVIEWER' },
  { name: 'audit trail', route: auditRoute as Handler, path: '/admin/audit', allowed: 'SUPER_ADMIN', denied: 'DISPUTE_OFFICER' },
];

let admin: Actor;
const ids: Record<string, string> = {};
const secrets: string[] = [];
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();

  // A seller application awaiting review.
  const applicant = await makeUser({ name: 'سلمى عبد الرحمن' });
  secrets.push(applicant.email!, applicant.phone!);
  const a = customerActor(applicant.id);
  await startApplication(a, 'INDIVIDUAL');
  await saveIdentity(a, { type: 'INDIVIDUAL', legalName: 'سلمى عبد الرحمن حسن', nationalId: '29001011234567', mobile: applicant.phone!, email: applicant.email!, addressLine: 'عنوان اختبار طويل', city: 'القاهرة', governorateId: 1 });
  await saveStore(a, { name: `متجر سلمى ${randomBytes(3).toString('hex')}`, description: 'متجر اختبار', returnAddress: 'عنوان الإرجاع للاختبار', returnGovernorateId: 1 });
  await uploadSellerDocument(a, 'NATIONAL_ID_FRONT', { data: await png('f'), name: 'f.png' });
  await uploadSellerDocument(a, 'NATIONAL_ID_BACK', { data: await png('b'), name: 'b.png' });
  await addPayoutMethod(a, { type: 'INSTAPAY', holderName: 'سلمى', instapayAddress: `s${randomBytes(3).toString('hex')}@instapay` });
  await submitApplication(a, true);
  ids.seller = (await db.select({ id: sellers.id }).from(sellers).where(eq(sellers.ownerUserId, applicant.id)))[0].id;

  // A national ID verification awaiting review.
  const kyc = await makeUser({ name: 'كريم مصطفى السيد', identity: false });
  secrets.push(kyc.email!, kyc.phone!, '29001011234567');
  ids.identity = (await submitIdentity(customerActor(kyc.id), { legalName: 'كريم مصطفى السيد', nationalId: '29001011234567' }, { front: { data: await png('idf'), name: 'front.png' }, back: { data: await png('idb'), name: 'back.png' } })).id;

  // A paid, shipped order with a dispute on it.
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 400_00, stock: 10 });
  const c = await makeCustomer();
  secrets.push(c.user.email!, c.user.phone!);
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  ids.order = order.id;
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  ids.dispute = (await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج المستلم مختلف تماماً عن الوصف المعروض في الإعلان' })).id;

  // A protected deal in progress.
  const deal = await createDeal(c.actor, { title: 'لابتوب مستعمل للاختبار', description: 'جهاز بحالة جيدة جداً للاختبار', condition: 'USED', quantity: 1 });
  await db.update(externalDeals).set({ status: 'ACTIVE' }).where(eq(externalDeals.id, deal.id));
  ids.deal = deal.id;
});

describe('admin app monitoring lists', () => {
  it('maskName keeps the first name and one initial', () => {
    expect(maskName('أحمد محمد علي')).toBe('أحمد م.');
    expect(maskName('Omar')).toBe('Omar');
    expect(maskName('  ')).toBeNull();
    expect(maskName(null)).toBeNull();
  });

  for (const l of LISTS) {
    it(`${l.name}: 200 with its console permission, 403 without it`, async () => {
      const ok = await call(l.route, l.path, { token: (await staffToken([l.allowed])).token });
      expect(ok.status, ok.raw).toBe(200);
      const denied = await call(l.route, l.path, { token: (await staffToken([l.denied])).token });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('forbidden');
    });
  }

  it('every list refuses a Customer App token', async () => {
    const u = await makeUser();
    const { POST: loginRoute } = await import('@/app/api/v1/auth/login/route');
    const s = await call(loginRoute as Handler, '/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
    for (const l of LISTS) expect((await call(l.route, l.path, { token: s.body.tokens.accessToken })).status, l.name).toBe(401);
  });

  it('lists show the real queue items, masked, with no e-mail, phone or national ID anywhere in the payload', async () => {
    const { token } = await staffToken(['SUPER_ADMIN']);
    const sellersRes = await call(sellersRoute as Handler, '/admin/sellers/applications', { token });
    const app = sellersRes.body.items.find((i: { id: string }) => i.id === ids.seller);
    expect(app.applicant).toBe('سلمى ع.');
    expect(app.status).toBe('PENDING_REVIEW');

    const idRes = await call(identityRoute as Handler, '/admin/identity/reviews', { token });
    const kyc = idRes.body.items.find((i: { id: string }) => i.id === ids.identity);
    expect(kyc).toMatchObject({ name: 'كريم م.', status: 'PENDING_REVIEW', documentsComplete: true });

    const orderRes = await call(ordersRoute as Handler, '/admin/orders', { token });
    const o = orderRes.body.items.find((i: { id: string }) => i.id === ids.order);
    expect(Number.isInteger(o.total)).toBe(true);
    expect(o.customer).toBe('عميل ا.');

    const dealRes = await call(dealsRoute as Handler, '/admin/deals?tab=active', { token });
    expect(dealRes.body.items.find((i: { id: string }) => i.id === ids.deal)).toMatchObject({ title: 'لابتوب مستعمل للاختبار', status: 'ACTIVE' });

    const dispRes = await call(disputesRoute as Handler, '/admin/disputes', { token });
    expect(dispRes.body.items.find((i: { id: string }) => i.id === ids.dispute)).toMatchObject({ kind: 'ORDER', status: 'OPEN', assignedToMe: false });

    for (const r of [sellersRes, idRes, orderRes, dealRes, dispRes]) {
      for (const s of secrets) expect(r.raw.includes(s), `leaked ${s.slice(0, 3)}…`).toBe(false);
      expect(r.raw).not.toMatch(/"(email|phone|nationalId|nationalIdEnc|frontFileId|backFileId)"/);
    }
  });

  it('orders: filters by status and number, the follow-up tab, and validates the query', async () => {
    const { token } = await staffToken(['OPERATIONS_MANAGER']);
    const paid = await call(ordersRoute as Handler, '/admin/orders?status=PENDING_PAYMENT', { token });
    expect(paid.status).toBe(200);
    for (const i of paid.body.items) expect(i.status).toBe('PENDING_PAYMENT');
    expect((await call(ordersRoute as Handler, '/admin/orders?tab=followup', { token })).status).toBe(200);
    expect((await call(ordersRoute as Handler, '/admin/orders?status=NOPE', { token })).status).toBe(422);
    expect((await call(ordersRoute as Handler, '/admin/orders?page=0', { token })).status).toBe(422);
  });

  it('disputes: "mine" lists only disputes assigned to the caller', async () => {
    const { token } = await staffToken(['DISPUTE_OFFICER']);
    const mine = await call(disputesRoute as Handler, '/admin/disputes?tab=mine', { token });
    expect(mine.status).toBe(200);
    for (const i of mine.body.items) expect(i.assignedToMe).toBe(true);
  });

  it('audit trail: newest first, keyset paging, filters; no before/after values, IP or user agent', async () => {
    const { token } = await staffToken(['SUPER_ADMIN']);
    const first = await call(auditRoute as Handler, '/admin/audit', { token });
    expect(first.status).toBe(200);
    const items = first.body.items as { id: number }[];
    expect(items.length).toBeGreaterThan(0);
    for (let i = 1; i < items.length; i++) expect(items[i].id).toBeLessThan(items[i - 1].id);
    expect(first.raw).not.toMatch(/"(oldValues|newValues|ip|userAgent|reason)"/);
    if (first.body.nextBefore) {
      const next = await call(auditRoute as Handler, `/admin/audit?before=${first.body.nextBefore}`, { token });
      for (const i of next.body.items) expect(i.id).toBeLessThan(first.body.nextBefore);
    }
    const seller = await call(auditRoute as Handler, '/admin/audit?actorType=SELLER', { token });
    for (const i of seller.body.items) expect(i.actorType).toBe('SELLER');
    expect((await call(auditRoute as Handler, '/admin/audit?actorType=ROOT', { token })).status).toBe(422);
    expect((await call(auditRoute as Handler, "/admin/audit?entityType=x'%3B--", { token })).status).toBe(422);
  });
});
