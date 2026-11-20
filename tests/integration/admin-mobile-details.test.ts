import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as dealRoute } from '@/app/api/v1/admin/deals/[dealId]/route';
import { POST as assignRoute } from '@/app/api/v1/admin/disputes/[disputeId]/assign/route';
import { POST as noteRoute } from '@/app/api/v1/admin/disputes/[disputeId]/notes/route';
import { GET as disputeRoute } from '@/app/api/v1/admin/disputes/[disputeId]/route';
import { GET as assigneesRoute } from '@/app/api/v1/admin/disputes/assignees/route';
import { GET as identityRoute } from '@/app/api/v1/admin/identity/reviews/[verificationId]/route';
import { GET as orderRoute } from '@/app/api/v1/admin/orders/[orderId]/route';
import { GET as sellerRoute } from '@/app/api/v1/admin/sellers/[sellerId]/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { customerActor } from '@/server/auth/actors';
import { totpCode } from '@/server/auth/totp';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { auditLogs, disputes, externalDeals, notifications, sellers } from '@/server/db/schema';
import { createDeal } from '@/server/modules/deals/service';
import { submitIdentity } from '@/server/modules/identity/service';
import { disputeGraph, openDispute } from '@/server/modules/postpurchase/disputes';
import { addPayoutMethod, saveIdentity, saveStore, startApplication, submitApplication, uploadSellerDocument } from '@/server/modules/sellers/service';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * Admin App detail views and the two safe dispute actions, through the REAL route handlers: permission per view
 * (same as the console page), refusal before TOTP and for Customer App tokens, 404/422 on bad ids, no personal data
 * beyond masked names, assignment only to eligible staff, internal notes never visible to the parties, rate limits.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'IOS' as const, deviceName: 'iPhone', appVersion: '1.0.0' });

async function call(h: Handler, path: string, o: { body?: unknown; token?: string; params?: Record<string, string>; idem?: string; installation?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': o.installation ?? inst() };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.idem) headers['idempotency-key'] = o.idem;
  const res = await h(new Request(`${BASE}${path}`, { method: o.body !== undefined ? 'POST' : 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }), { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function staff(roles: string[], verify = true) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute as Handler, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
  const token = login.body.tokens.accessToken as string;
  if (verify) {
    const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { body: {}, token });
    expect((await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token })).status).toBe(200);
  }
  return { token, user: u };
}

let admin: Actor;
const ids: Record<string, string> = {};
const secrets: string[] = [];
let claimant: Awaited<ReturnType<typeof makeCustomer>>;

beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
  const applicant = await makeUser({ name: 'سلمى عبد الرحمن' });
  secrets.push(applicant.email!, applicant.phone!, '29001011234567', 'عنوان اختبار طويل');
  const a = customerActor(applicant.id);
  await startApplication(a, 'INDIVIDUAL');
  await saveIdentity(a, { type: 'INDIVIDUAL', legalName: 'سلمى عبد الرحمن حسن', nationalId: '29001011234567', mobile: applicant.phone!, email: applicant.email!, addressLine: 'عنوان اختبار طويل', city: 'القاهرة', governorateId: 1 });
  await saveStore(a, { name: `متجر سلمى ${randomBytes(3).toString('hex')}`, description: 'متجر اختبار', returnAddress: 'عنوان الإرجاع للاختبار', returnGovernorateId: 1 });
  await uploadSellerDocument(a, 'NATIONAL_ID_FRONT', { data: await png('f'), name: 'f.png' });
  await uploadSellerDocument(a, 'NATIONAL_ID_BACK', { data: await png('b'), name: 'b.png' });
  await addPayoutMethod(a, { type: 'INSTAPAY', holderName: 'سلمى', instapayAddress: `salma${randomBytes(3).toString('hex')}@instapay` });
  await submitApplication(a, true);
  ids.seller = (await db.select({ id: sellers.id }).from(sellers).where(eq(sellers.ownerUserId, applicant.id)))[0].id;

  const kyc = await makeUser({ name: 'كريم مصطفى السيد', identity: false });
  secrets.push(kyc.email!, kyc.phone!);
  ids.identity = (await submitIdentity(customerActor(kyc.id), { legalName: 'كريم مصطفى السيد', nationalId: '29001011234567' }, { front: { data: await png('idf'), name: 'front.png' }, back: { data: await png('idb'), name: 'back.png' } })).id;

  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 400_00, stock: 10 });
  claimant = await makeCustomer();
  secrets.push(claimant.user.email!, claimant.user.phone!, claimant.address.street);
  const order = await checkout(claimant, [{ variantId: p.variantId, qty: 1 }]);
  ids.order = order.id;
  await submitAndConfirm(claimant, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  ids.dispute = (await openDispute(claimant.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج المستلم مختلف تماماً عن الوصف المعروض في الإعلان' })).id;

  const deal = await createDeal(claimant.actor, { title: 'لابتوب مستعمل للاختبار', description: 'جهاز بحالة جيدة جداً للاختبار', condition: 'USED', quantity: 1 });
  await db.update(externalDeals).set({ status: 'ACTIVE' }).where(eq(externalDeals.id, deal.id));
  ids.deal = deal.id;
});

const VIEWS = () => [
  { name: 'seller', route: sellerRoute as Handler, path: (id: string) => `/admin/sellers/${id}`, param: 'sellerId', id: ids.seller, allowed: 'SELLER_REVIEWER', denied: 'PAYMENT_REVIEWER' },
  { name: 'identity', route: identityRoute as Handler, path: (id: string) => `/admin/identity/reviews/${id}`, param: 'verificationId', id: ids.identity, allowed: 'SELLER_REVIEWER', denied: 'PAYMENT_REVIEWER' },
  { name: 'order', route: orderRoute as Handler, path: (id: string) => `/admin/orders/${id}`, param: 'orderId', id: ids.order, allowed: 'PAYMENT_REVIEWER', denied: 'CATALOG_REVIEWER' },
  { name: 'deal', route: dealRoute as Handler, path: (id: string) => `/admin/deals/${id}`, param: 'dealId', id: ids.deal, allowed: 'PAYMENT_REVIEWER', denied: 'CATALOG_REVIEWER' },
  { name: 'dispute', route: disputeRoute as Handler, path: (id: string) => `/admin/disputes/${id}`, param: 'disputeId', id: ids.dispute, allowed: 'DISPUTE_OFFICER', denied: 'PAYMENT_REVIEWER' },
];

describe('admin app detail views', () => {
  it('each view: 200 with its permission, 403 without, 401 before TOTP and for a Customer App token, 404 unknown, 422 malformed', async () => {
    const u = await makeUser();
    const cust = (await call(loginRoute as Handler, '/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } })).body.tokens.accessToken;
    const preMfa = (await staff(['SUPER_ADMIN'], false)).token;
    for (const v of VIEWS()) {
      const ok = await call(v.route, v.path(v.id), { token: (await staff([v.allowed])).token, params: { [v.param]: v.id } });
      expect(ok.status, `${v.name}: ${ok.raw}`).toBe(200);
      const denied = await call(v.route, v.path(v.id), { token: (await staff([v.denied])).token, params: { [v.param]: v.id } });
      expect(denied.status, v.name).toBe(403);
      expect((await call(v.route, v.path(v.id), { token: preMfa, params: { [v.param]: v.id } })).status, v.name).toBe(401);
      expect((await call(v.route, v.path(v.id), { token: cust, params: { [v.param]: v.id } })).status, v.name).toBe(401);
      const sa = (await staff(['SUPER_ADMIN'])).token;
      const unknown = randomUUID();
      expect((await call(v.route, v.path(unknown), { token: sa, params: { [v.param]: unknown } })).status, v.name).toBe(404);
      expect((await call(v.route, v.path('not-a-uuid'), { token: sa, params: { [v.param]: 'not-a-uuid' } })).status, v.name).toBe(422);
    }
  });

  it('payloads carry masked names only: no e-mail, phone, national ID, address, file ids, locations or OTP material', async () => {
    const { token } = await staff(['SUPER_ADMIN']);
    for (const v of VIEWS()) {
      const r = await call(v.route, v.path(v.id), { token, params: { [v.param]: v.id } });
      expect(r.status).toBe(200);
      for (const s of secrets) expect(r.raw.includes(s), `${v.name} leaked ${s.slice(0, 4)}…`).toBe(false);
      // JSON keys only (a checklist item may legitimately be *named* "mobile").
      expect(r.raw, v.name).not.toMatch(/"(email|phone|mobile|nationalId\w*|fileId|frontFileId|backFileId|proofFileId|\w*LocationEnc|buyerLocation|sellerLocation|sellerPayoutEnc|otp\w*|internalNote|addressLine|street)":/i);
    }
    const seller = (await call(sellerRoute as Handler, `/admin/sellers/${ids.seller}`, { token, params: { sellerId: ids.seller } })).body;
    expect(seller.applicant).toBe('سلمى ع.');
    expect(seller.checklist.find((c: { key: string }) => c.key === 'id_front').ok).toBe(true);
    expect(seller.documents.map((d: { kind: string }) => d.kind)).toEqual(expect.arrayContaining(['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK']));
    const kyc = (await call(identityRoute as Handler, `/admin/identity/reviews/${ids.identity}`, { token, params: { verificationId: ids.identity } })).body;
    expect(kyc).toMatchObject({ name: 'كريم م.', status: 'PENDING_REVIEW', documentsComplete: true });
    const order = (await call(orderRoute as Handler, `/admin/orders/${ids.order}`, { token, params: { orderId: ids.order } })).body;
    expect(order.sellerOrders[0].shipment).not.toBeNull();
    expect(Number.isInteger(order.totals.grand)).toBe(true);
    expect(order.history.length).toBeGreaterThan(0);
  });

  it('document metadata is shown only with sellers.documents.view (same rule as the console)', async () => {
    const code = `T_SV_${randomBytes(4).toString('hex').toUpperCase()}`;
    const { roles, rolePermissions } = await import('@/server/db/schema');
    await db.insert(roles).values({ code, nameAr: 'عرض بائعين', nameEn: 'Seller viewer' });
    await db.insert(rolePermissions).values({ roleCode: code, permission: 'sellers.view' });
    const r = await call(sellerRoute as Handler, `/admin/sellers/${ids.seller}`, { token: (await staff([code])).token, params: { sellerId: ids.seller } });
    expect(r.status).toBe(200);
    expect(r.body.documents).toBeNull();
  });
});

describe('admin app safe dispute actions', () => {
  it('assignees: only active staff with disputes.manage', async () => {
    const officer = await staff(['DISPUTE_OFFICER']);
    const catalog = await makeUser({ staff: true, roles: ['CATALOG_REVIEWER'] });
    const r = await call(assigneesRoute as Handler, '/admin/disputes/assignees', { token: officer.token });
    expect(r.status).toBe(200);
    const listed = r.body.items.map((i: { id: string }) => i.id);
    expect(listed).toContain(officer.user.id);
    expect(listed).not.toContain(catalog.id);
    expect(r.body.items.find((i: { id: string }) => i.id === officer.user.id).isMe).toBe(true);
    expect((await call(assigneesRoute as Handler, '/admin/disputes/assignees', { token: (await staff(['PAYMENT_REVIEWER'])).token })).status).toBe(403);
  });

  it('assign: to an eligible colleague (audited old→new), never to a customer or to staff without disputes.manage', async () => {
    const lead = await staff(['DISPUTE_OFFICER']);
    const colleague = await makeUser({ staff: true, roles: ['DISPUTE_OFFICER'] });
    const ok = await call(assignRoute as Handler, `/admin/disputes/${ids.dispute}/assign`, { token: lead.token, params: { disputeId: ids.dispute }, body: { assigneeId: colleague.id }, idem: randomUUID() });
    expect(ok.status, ok.raw).toBe(200);
    expect((await db.select().from(disputes).where(eq(disputes.id, ids.dispute)))[0].assignedTo).toBe(colleague.id);
    const [row] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, ids.dispute), eq(auditLogs.action, 'dispute.assigned'))).orderBy(desc(auditLogs.id)).limit(1);
    expect(row.actorUserId).toBe(lead.user.id);
    expect(row.channel).toBe('ADMIN_MOBILE');
    expect(row.newValues).toEqual({ assigneeId: colleague.id });

    for (const bad of [claimant.user.id, (await makeUser({ staff: true, roles: ['CATALOG_REVIEWER'] })).id, randomUUID()]) {
      const r = await call(assignRoute as Handler, `/admin/disputes/${ids.dispute}/assign`, { token: lead.token, params: { disputeId: ids.dispute }, body: { assigneeId: bad }, idem: randomUUID() });
      expect(r.status).toBe(422);
    }
    expect((await db.select().from(disputes).where(eq(disputes.id, ids.dispute)))[0].assignedTo).toBe(colleague.id);
  });

  it('assign: refused without disputes.manage, without an idempotency key, for a malformed body, and on a closed dispute', async () => {
    const officer = await staff(['DISPUTE_OFFICER']);
    const body = { assigneeId: officer.user.id };
    expect((await call(assignRoute as Handler, `/admin/disputes/${ids.dispute}/assign`, { token: (await staff(['PAYMENT_REVIEWER'])).token, params: { disputeId: ids.dispute }, body, idem: randomUUID() })).status).toBe(403);
    expect((await call(assignRoute as Handler, `/admin/disputes/${ids.dispute}/assign`, { token: officer.token, params: { disputeId: ids.dispute }, body })).status).toBeGreaterThanOrEqual(400);
    expect((await call(assignRoute as Handler, `/admin/disputes/${ids.dispute}/assign`, { token: officer.token, params: { disputeId: ids.dispute }, body: { assigneeId: 'me' }, idem: randomUUID() })).status).toBe(422);
    await db.update(disputes).set({ status: 'CLOSED' }).where(eq(disputes.id, ids.dispute));
    try {
      const r = await call(assignRoute as Handler, `/admin/disputes/${ids.dispute}/assign`, { token: officer.token, params: { disputeId: ids.dispute }, body, idem: randomUUID() });
      expect(r.status).toBe(409);
    } finally {
      await db.update(disputes).set({ status: 'OPEN' }).where(eq(disputes.id, ids.dispute));
    }
  });

  it('notes are internal: visible to staff in the detail, invisible to the parties, and notify no one', async () => {
    const officer = await staff(['DISPUTE_OFFICER']);
    const text = `ملاحظة داخلية ${randomBytes(3).toString('hex')}`;
    const before = (await db.select().from(notifications).where(eq(notifications.userId, claimant.user.id))).length;
    const r = await call(noteRoute as Handler, `/admin/disputes/${ids.dispute}/notes`, { token: officer.token, params: { disputeId: ids.dispute }, body: { body: text }, idem: randomUUID() });
    expect(r.status, r.raw).toBe(200);
    const detail = (await call(disputeRoute as Handler, `/admin/disputes/${ids.dispute}`, { token: officer.token, params: { disputeId: ids.dispute } })).body;
    expect(detail.messages.find((m: { body: string }) => m.body === text)).toMatchObject({ internal: true, authorRole: 'ADMIN' });
    const asClaimant = await disputeGraph(claimant.actor, ids.dispute);
    expect(asClaimant.messages.some((m) => m.m.body === text)).toBe(false);
    expect((await db.select().from(notifications).where(eq(notifications.userId, claimant.user.id))).length).toBe(before);
    expect((await call(noteRoute as Handler, `/admin/disputes/${ids.dispute}/notes`, { token: officer.token, params: { disputeId: ids.dispute }, body: { body: ' ' }, idem: randomUUID() })).status).toBe(422);
    expect((await call(noteRoute as Handler, `/admin/disputes/${ids.dispute}/notes`, { token: officer.token, params: { disputeId: ids.dispute }, body: { body: 'x'.repeat(4001) }, idem: randomUUID() })).status).toBe(422);
  });

  it('a retried note with the same idempotency key is stored once', async () => {
    const officer = await staff(['DISPUTE_OFFICER']);
    const key = randomUUID();
    const text = `مرة واحدة ${randomBytes(3).toString('hex')}`;
    for (let i = 0; i < 3; i++) expect((await call(noteRoute as Handler, `/admin/disputes/${ids.dispute}/notes`, { token: officer.token, params: { disputeId: ids.dispute }, body: { body: text }, idem: key })).status).toBe(200);
    const detail = (await call(disputeRoute as Handler, `/admin/disputes/${ids.dispute}`, { token: officer.token, params: { disputeId: ids.dispute } })).body;
    expect(detail.messages.filter((m: { body: string }) => m.body === text)).toHaveLength(1);
  });

  it('notes are rate limited per installation (429 with a stable code)', async () => {
    const officer = await staff(['DISPUTE_OFFICER']);
    const installation = inst();
    let limited = 0;
    for (let i = 0; i < 70 && !limited; i++) {
      const r = await call(noteRoute as Handler, `/admin/disputes/${ids.dispute}/notes`, { token: officer.token, params: { disputeId: ids.dispute }, body: { body: `حد ${i}` }, idem: randomUUID(), installation });
      if (r.status === 429) {
        expect(r.body.code).toBe('rate_limited');
        limited++;
      }
    }
    expect(limited).toBeGreaterThan(0);
  });
});
