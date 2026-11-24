import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as returnRoute } from '@/app/api/v1/returns/[returnId]/route';
import { POST as shipBackRoute } from '@/app/api/v1/returns/[returnId]/ship-back/route';
import { POST as createReturnRoute } from '@/app/api/v1/returns/route';
import { GET as returnOptionsRoute } from '@/app/api/v1/seller-orders/[sellerOrderId]/return-options/route';
import { GET as storeReturnRoute } from '@/app/api/v1/seller/returns/[returnId]/route';
import { POST as storeStepRoute } from '@/app/api/v1/seller/returns/[returnId]/steps/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { journalEntries, productVariants, refunds, returns, sellerOrders, statusHistory } from '@/server/db/schema';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { financialInvariants } from '@/server/modules/finance/controls';
import { approveRefund, markRefundFailed, recordRefundPayout, resolveRefundTransferNotSent } from '@/server/modules/finance/refunds';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makerRequest, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * Batch 6: the APPROVED return lifecycle end to end through the real mobile routes, and its failure cases.
 *   buyer request → store approves → buyer sees where to send it and records the shipment → store receives and
 *   inspects → store accepts (refund REQUEST only) → EDMN maker asks, a different checker approves (reversal journal)
 *   → finance records the TEST payout (payout journal) → return REFUNDED, refund COMPLETED, both parties see it.
 * Failure cases: refund transfer failure and the two-person retry, expired windows, missing evidence, strangers,
 * steps out of order, duplicate and concurrent steps. Nothing pays without the existing approvals; ledger stays balanced.
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
  return { status: res.status, body: text && (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null, raw: text };
}

async function login(email: string) {
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId: key(), platform: 'ANDROID' } } });
  expect(r.status, r.raw).toBe(200);
  return r.body.tokens.accessToken as string;
}

let admin: Actor;
let operator: Actor; // FINANCE_OPERATOR: Maker of the approval request, executor of the payout
let checker: Actor; // FINANCE_CHECKER: approves (a different person)
beforeAll(async () => {
  admin = await makeAdmin();
  operator = await makeAdmin(['FINANCE_OPERATOR']);
  checker = await makeAdmin(['FINANCE_CHECKER']);
  await ensurePaymentSetup();
});

async function deliveredOrder(qty = 2) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 400_00, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await confirmReceipt(c.actor, so.id);
  return { s, p, c, order, so, bt: await login(c.user.email!), st: await login(s.user.email!) };
}

type Ctx = Awaited<ReturnType<typeof deliveredOrder>>;
const itemOf = async (x: Ctx) => (await call(returnOptionsRoute, `/seller-orders/${x.so.id}/return-options`, { token: x.bt, params: { sellerOrderId: x.so.id } })).body.items[0].orderItemId as string;

async function returnForm(x: Ctx, reason: string, qty = 1, withPhoto = false) {
  const f = new FormData();
  f.set('sellerOrderId', x.so.id);
  f.set('reason', reason);
  f.set('description', 'المقاس مش مناسب وعايز أرجّعه بحالته');
  f.set('items', JSON.stringify([{ orderItemId: await itemOf(x), quantity: qty }]));
  if (withPhoto) f.append('evidence', new Blob([new Uint8Array(await png('ev'))], { type: 'image/png' }), 'ev.png');
  return f;
}
const step = (x: Ctx, id: string, body: Record<string, unknown>, idem = key(), token = x.st) => call(storeStepRoute, `/seller/returns/${id}/steps`, { token, idem, params: { returnId: id }, body });
const view = (x: Ctx, id: string, token = x.bt) => call(returnRoute, `/returns/${id}`, { token, params: { returnId: id } });

/** request → approve → ship back → received → inspection → accept: the return is REFUND_PENDING with one refund REQUEST. */
async function toRefundPending(x: Ctx) {
  const r = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, 'CHANGED_MIND') });
  expect(r.status, r.raw).toBe(200);
  const id = r.body.id as string;
  expect((await step(x, id, { step: 'APPROVE', note: 'مقبول، ابعته على عنوان المرتجعات' })).body.status).toBe('APPROVED');
  const sb = await call(shipBackRoute, `/returns/${id}/ship-back`, { token: x.bt, idem: key(), params: { returnId: id }, body: { carrier: 'بوسطة', tracking: 'RET-1001' } });
  expect(sb.status, sb.raw).toBe(200);
  expect((await step(x, id, { step: 'MARK_RECEIVED' })).body.status).toBe('RECEIVED');
  expect((await step(x, id, { step: 'START_INSPECTION' })).body.status).toBe('INSPECTION');
  const acc = await step(x, id, { step: 'ACCEPT', restock: true });
  expect(acc.status, acc.raw).toBe(200);
  expect(acc.body.status).toBe('REFUND_PENDING');
  const [refund] = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'RETURN'), eq(refunds.sourceId, id)));
  return { id, refund };
}

async function ledgerOk() {
  const inv = await financialInvariants(db);
  expect(inv.checks.find((c) => c.code === 'TRIAL_BALANCE')!.count).toBe(0);
  expect(inv.checks.find((c) => c.code === 'UNBALANCED_ENTRY')!.count).toBe(0);
}
const entriesFor = (sourceId: string) => db.select().from(journalEntries).where(eq(journalEntries.sourceId, sourceId));

describe('approved return → EDMN refund (TEST mode) → both parties see it', () => {
  it('runs the whole lifecycle; money moves only after maker/checker approval and the recorded payout', async () => {
    const x = await deliveredOrder(2);
    const stockBefore = (await db.select().from(productVariants).where(eq(productVariants.id, x.p.variantId)))[0].stockOnHand;
    const r = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, 'CHANGED_MIND') });
    const id = r.body.id as string;
    // The buyer sees no address before approval; after approval: where to send it, and the ship-back step.
    expect((await view(x, id)).body.shipBackTo).toBeNull();
    await step(x, id, { step: 'APPROVE', note: 'مقبول' });
    const approved = await view(x, id);
    expect(approved.body.allowedActions).toEqual(['SHIP_BACK']);
    expect(approved.body.shipBackTo.address).toBeTruthy();
    // The buyer records the return shipment; the store sees carrier and tracking.
    await call(shipBackRoute, `/returns/${id}/ship-back`, { token: x.bt, idem: key(), params: { returnId: id }, body: { carrier: 'بوسطة', tracking: 'RET-777' } });
    const sv = await call(storeReturnRoute, `/seller/returns/${id}`, { token: x.st, params: { returnId: id } });
    expect(sv.body).toMatchObject({ status: 'RETURN_IN_TRANSIT', returnCarrier: 'بوسطة', returnTracking: 'RET-777' });
    expect(sv.body.allowedActions).toContain('MARK_RECEIVED');
    await step(x, id, { step: 'MARK_RECEIVED' });
    await step(x, id, { step: 'START_INSPECTION' });
    const before = await entriesFor(x.so.id);
    await step(x, id, { step: 'ACCEPT', restock: true });
    const [refund] = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'RETURN'), eq(refunds.sourceId, id)));
    expect(refund).toMatchObject({ status: 'REQUESTED', principalAmount: 400_00 }); // the unit's price (+ its buyer-fee share)
    expect((await db.select().from(productVariants).where(eq(productVariants.id, x.p.variantId)))[0].stockOnHand).toBe(stockBefore + 1); // restocked
    expect(await entriesFor(x.so.id)).toHaveLength(before.length); // a REQUEST posts nothing

    // Checker cannot approve without a different person's request (maker/checker).
    await expect(approveRefund(checker, refund.id, { expectedAmount: refund.amount, reason: 'اعتماد' })).rejects.toThrow();
    // Payout is refused before approval.
    await expect(recordRefundPayout(operator, refund.id, 'TEST-PAY-1')).rejects.toThrow();
    await makerRequest('REFUND_APPROVAL', refund.id, refund.amount, { maker: operator });
    await approveRefund(checker, refund.id, { expectedAmount: refund.amount, reason: 'إرجاع مستلم ومفحوص' });
    expect((await db.select().from(refunds).where(eq(refunds.id, refund.id)))[0].status).toBe('APPROVED');
    expect((await view(x, id)).body.refunds[0]).toMatchObject({ status: 'APPROVED', reference: null }); // not paid yet
    await recordRefundPayout(operator, refund.id, 'TEST-PAY-1');
    await recordRefundPayout(operator, refund.id, 'TEST-PAY-1'); // replay: recorded once
    const done = (await db.select().from(refunds).where(eq(refunds.id, refund.id)))[0];
    expect(done).toMatchObject({ status: 'COMPLETED', paidReference: 'TEST-PAY-1' });
    expect((await entriesFor(refund.id)).filter((e) => e.entryType === 'REFUND_PAID')).toHaveLength(1);

    // Both parties see the final state; the buyer sees the transfer reference (was hidden for COMPLETED refunds).
    const bv = await view(x, id);
    expect(bv.body).toMatchObject({ status: 'REFUNDED', allowedActions: [] });
    expect(bv.body.refunds[0]).toMatchObject({ status: 'COMPLETED', amountPiastres: refund.amount, reference: 'TEST-PAY-1' });
    const sv2 = await call(storeReturnRoute, `/seller/returns/${id}`, { token: x.st, params: { returnId: id } });
    expect(sv2.body).toMatchObject({ status: 'REFUNDED', allowedActions: [] });
    expect((await db.select().from(sellerOrders).where(eq(sellerOrders.id, x.so.id)))[0].refundedTotal).toBe(refund.amount);
    // No seller release happened along the way; the ledger is balanced.
    expect((await entriesFor(x.so.id)).filter((e) => e.entryType === 'SELLER_RELEASE')).toHaveLength(0);
    await ledgerOk();
  });

  it('a failed refund transfer blocks payment until a second person establishes no money left; then it is paid once', async () => {
    const x = await deliveredOrder(1);
    const { id, refund } = await toRefundPending(x);
    await makerRequest('REFUND_APPROVAL', refund.id, refund.amount, { maker: operator });
    await approveRefund(checker, refund.id, { expectedAmount: refund.amount, reason: 'اعتماد' });
    await markRefundFailed(operator, refund.id, 'رفض التحويل من البنك (اختبار)');
    expect((await view(x, id)).body.refunds[0]).toMatchObject({ status: 'FAILED', reference: null });
    await expect(recordRefundPayout(operator, refund.id, 'TEST-PAY-2')).rejects.toThrow(/فاشلة/);
    // The person who recorded the failure cannot resolve it (and an operator lacks the permission anyway).
    await expect(resolveRefundTransferNotSent(operator, refund.id, { reason: 'تأكدنا من البنك', evidence: 'كشف حساب' })).rejects.toThrow();
    await resolveRefundTransferNotSent(checker, refund.id, { reason: 'كشف الحساب يثبت عدم خروج التحويل', evidence: 'STATEMENT-TEST-1' });
    expect((await db.select().from(refunds).where(eq(refunds.id, refund.id)))[0].status).toBe('APPROVED');
    await recordRefundPayout(operator, refund.id, 'TEST-PAY-2');
    expect((await db.select().from(refunds).where(eq(refunds.id, refund.id)))[0]).toMatchObject({ status: 'COMPLETED', paidReference: 'TEST-PAY-2' });
    expect((await entriesFor(refund.id)).filter((e) => e.entryType === 'REFUND_PAID')).toHaveLength(1);
    expect((await view(x, id)).body.status).toBe('REFUNDED');
    await ledgerOk();
  });
});

describe('return failure and security cases', () => {
  it('expired windows: a change-of-mind return after the window, and any return after the dispute window, are refused', async () => {
    const x = await deliveredOrder(1);
    await db.update(sellerOrders).set({ deliveredAt: new Date(Date.now() - 400 * 86400_000) }).where(eq(sellerOrders.id, x.so.id));
    for (const [reason, photo] of [['CHANGED_MIND', false], ['DAMAGED', true]] as const) {
      const r = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, reason, 1, photo) });
      expect(r.status, r.raw).toBeGreaterThanOrEqual(400);
      expect(r.raw).toMatch(/انتهت مدة الإرجاع/);
    }
    expect(await db.select().from(returns).where(eq(returns.sellerOrderId, x.so.id))).toHaveLength(0);
  });

  it('missing evidence: a damaged / not-as-described claim needs photos; nothing is stored without them', async () => {
    const x = await deliveredOrder(1);
    for (const reason of ['DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM']) {
      const r = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, reason) });
      expect(r.status, r.raw).toBe(422);
    }
    expect(await db.select().from(returns).where(eq(returns.sellerOrderId, x.so.id))).toHaveLength(0);
  });

  it('strangers: another buyer, another store, a buyer on store steps and anonymous calls are refused; nothing changes', async () => {
    const x = await deliveredOrder(1);
    const other = await deliveredOrder(1);
    const r = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, 'CHANGED_MIND') });
    const id = r.body.id as string;
    const p = { returnId: id };
    expect((await view(x, id, other.bt)).status).toBe(404);
    expect((await call(storeReturnRoute, `/seller/returns/${id}`, { token: other.st, params: p })).status).toBe(404);
    expect((await step(x, id, { step: 'APPROVE' }, key(), other.st)).status).toBe(404);
    expect((await step(x, id, { step: 'APPROVE' }, key(), x.bt)).status).toBe(403); // a buyer token on the store route
    expect((await call(storeStepRoute, `/seller/returns/${id}/steps`, { idem: key(), params: p, body: { step: 'APPROVE' } })).status).toBe(401);
    // Another buyer trying to create a return on this order.
    const f = await returnForm(x, 'CHANGED_MIND');
    expect((await call(createReturnRoute, '/returns', { token: other.bt, idem: key(), form: f })).status).toBeGreaterThanOrEqual(403);
    await step(x, id, { step: 'APPROVE' });
    // Ship-back by someone else: another buyer, and the store's own owner.
    expect((await call(shipBackRoute, `/returns/${id}/ship-back`, { token: other.bt, idem: key(), params: p, body: { carrier: 'أرامكس', tracking: 'X-1' } })).status).toBe(404);
    expect((await call(shipBackRoute, `/returns/${id}/ship-back`, { token: x.st, idem: key(), params: p, body: { carrier: 'أرامكس', tracking: 'X-1' } })).status).toBeGreaterThanOrEqual(403);
    expect((await db.select().from(returns).where(eq(returns.id, id)))[0].status).toBe('APPROVED');
  });

  it('steps out of order are refused (server state machine), and a rejected return cannot be approved or shipped', async () => {
    const x = await deliveredOrder(2);
    const r = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, 'CHANGED_MIND') });
    const id = r.body.id as string;
    const p = { returnId: id };
    for (const s of ['MARK_RECEIVED', 'START_INSPECTION', 'ACCEPT']) expect((await step(x, id, { step: s })).status, s).toBe(409);
    expect((await call(shipBackRoute, `/returns/${id}/ship-back`, { token: x.bt, idem: key(), params: p, body: { carrier: 'بوسطة', tracking: 'T' } })).status).toBeGreaterThanOrEqual(400);
    await step(x, id, { step: 'APPROVE' });
    expect((await step(x, id, { step: 'ACCEPT' })).status).toBe(409); // not received yet
    await call(shipBackRoute, `/returns/${id}/ship-back`, { token: x.bt, idem: key(), params: p, body: { carrier: 'بوسطة', tracking: 'T' } });
    expect((await call(shipBackRoute, `/returns/${id}/ship-back`, { token: x.bt, idem: key(), params: p, body: { carrier: 'بوسطة', tracking: 'T2' } })).status).toBeGreaterThanOrEqual(400); // twice
    expect((await db.select().from(returns).where(eq(returns.id, id)))[0].returnTracking).toBe('T');

    const r2 = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, 'CHANGED_MIND') });
    const id2 = r2.body.id as string;
    await step(x, id2, { step: 'REJECT', reason: 'المنتج اتفتح واستخدم' });
    expect((await step(x, id2, { step: 'APPROVE' })).status).toBe(409);
    expect((await call(shipBackRoute, `/returns/${id2}/ship-back`, { token: x.bt, idem: key(), params: { returnId: id2 }, body: { carrier: 'بوسطة', tracking: 'T' } })).status).toBeGreaterThanOrEqual(400);
    expect((await view(x, id2)).body.allowedActions).toEqual(['ESCALATE']);
  });

  it('duplicates and concurrency: no more units than bought; concurrent approvals and acceptances act once', async () => {
    const x = await deliveredOrder(1);
    const r = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, 'CHANGED_MIND') });
    const id = r.body.id as string;
    // A second return for the same (only) unit is refused while the first is open.
    const dup = await call(createReturnRoute, '/returns', { token: x.bt, idem: key(), form: await returnForm(x, 'CHANGED_MIND') });
    expect(dup.status, dup.raw).toBe(422);
    // Two store devices approve at the same moment with different keys: one wins, one transition recorded.
    const [a, b] = await Promise.all([step(x, id, { step: 'APPROVE' }), step(x, id, { step: 'APPROVE' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const approvals = await db.select().from(statusHistory).where(and(eq(statusHistory.entityId, id), eq(statusHistory.toStatus, 'APPROVED')));
    expect(approvals).toHaveLength(1);
    await call(shipBackRoute, `/returns/${id}/ship-back`, { token: x.bt, idem: key(), params: { returnId: id }, body: { carrier: 'بوسطة', tracking: 'C1' } });
    await step(x, id, { step: 'MARK_RECEIVED' });
    const [c, d] = await Promise.all([step(x, id, { step: 'ACCEPT' }), step(x, id, { step: 'ACCEPT' })]);
    expect([c.status, d.status]).toContain(200);
    expect(await db.select().from(refunds).where(and(eq(refunds.sourceType, 'RETURN'), eq(refunds.sourceId, id)))).toHaveLength(1);
    await ledgerOk();
  });
});
