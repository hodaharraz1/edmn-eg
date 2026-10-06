import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { disputes, financialApprovals, journalEntries, riskFlags, sellerOrders } from '@/server/db/schema';
import {
  confirmReceipt,
  flagMissingDeliveryEvidence,
  processBuyerResponseTimeouts,
  recordDeliveryEvent,
  releaseSellerOrder,
  reportOrderProblem,
  reviewDeliveryException,
  setFinancialHold,
  submitDeliveryEvidence,
} from '@/server/modules/commerce/fulfilment';
import { sellerOrderPosition } from '@/server/modules/finance/postings';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { adminActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { checkout, elapse, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * Delivery evidence → buyer window → entitlement → Admin release (business-rule clarification §1):
 * a seller statement alone never proves delivery; the seller's 24h evidence failure never starts the
 * buyer timeout, never creates entitlement and never releases money — it routes to Operations.
 */
let admin: Actor;
let ops: Actor;
let checker: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  ops = await makeAdmin(['OPERATIONS_MANAGER']);
  checker = await makeAdmin(['FINANCE_CHECKER']);
  await ensurePaymentSetup();
});

async function shippedOrder() {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 599_00, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  return { s, c, order, soId: so.id };
}
const evidence = async () => [{ data: await png('pod'), name: 'pod.png' }];
const soOf = async (id: string) => (await db.select().from(sellerOrders).where(eq(sellerOrders.id, id)))[0];
const journalsOf = async (id: string) => db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'seller_order'), eq(journalEntries.sourceId, id)));
const approvalsOf = async (id: string) => db.select().from(financialApprovals).where(eq(financialApprovals.entityId, id));
async function tryRelease(soId: string) {
  const so = await soOf(soId);
  const pos = await sellerOrderPosition(db, so);
  return releaseSellerOrder(checker, soId, { expectedSellerAmount: pos.pending, reason: 'محاولة إتاحة في الاختبار' });
}

describe('CLARIFICATION — seller statement alone cannot prove delivery', () => {
  it('seller evidence with NO authoritative delivery event: still SHIPPED, no buyer window, no entitlement, no release', async () => {
    const { s, soId } = await shippedOrder();
    const r = await submitDeliveryEvidence(s.actor, soId, { carrierReference: 'BOSTA-123 delivered' }, await evidence());
    expect(r.buyerWindowOpened).toBe(false);
    const so = await soOf(soId);
    expect(so.status).toBe('SHIPPED');
    expect(so.buyerResponseDueAt).toBeNull();
    expect(so.receiptBasis).toBeNull();
    expect(so.entitledAt).toBeNull();
    expect(so.deliveryEstablishedAt).toBeNull();
    // Even long afterwards the timeout job cannot touch it (it is not in the buyer window).
    await elapse(soId, 24 * 10);
    await processBuyerResponseTimeouts();
    expect((await soOf(soId)).status).toBe('SHIPPED');
    await expect(tryRelease(soId)).rejects.toThrow(/بعد تأكيد الاستلام/);
    expect((await journalsOf(soId)).map((j) => j.entryType)).toEqual(['ORDER_PAYMENT']);
  });

  it('a seller cannot record the authoritative delivery event itself', async () => {
    const { s, soId } = await shippedOrder();
    await expect(recordDeliveryEvent(s.actor, soId, { reference: 'I delivered it' })).rejects.toThrow();
    expect((await soOf(soId)).deliveryEventAt).toBeNull();
  });

  it('Operations cannot ESTABLISH delivery on the seller statement alone (no carrier event)', async () => {
    const { s, soId } = await shippedOrder();
    await submitDeliveryEvidence(s.actor, soId, { carrierReference: 'REF' }, await evidence());
    await expect(reviewDeliveryException(ops, soId, 'ESTABLISH', 'البائع قال اتسلم')).rejects.toThrow(/كلام البائع لوحده مش دليل/);
    expect((await soOf(soId)).status).toBe('SHIPPED');
  });

  it('a carrier event without seller evidence does not open the buyer window either', async () => {
    const { soId } = await shippedOrder();
    await recordDeliveryEvent(ops, soId, { reference: 'Carrier portal: DELIVERED' });
    const so = await soOf(soId);
    expect(so.status).toBe('SHIPPED');
    expect(so.deliveryReportDueAt!.getTime() - so.deliveryEventAt!.getTime()).toBe(24 * 3600_000);
    expect(so.buyerResponseDueAt).toBeNull();
    await expect(reviewDeliveryException(ops, soId, 'ESTABLISH', 'مفيش دليل')).rejects.toThrow(/مفيش دليل تسليم/);
  });
});

describe('CLARIFICATION — seller 24h failure', () => {
  it('missed 24h evidence deadline → Operations exception; NO buyer timeout, NO entitlement, NO release, NO journal', async () => {
    const { s, soId } = await shippedOrder();
    await recordDeliveryEvent(ops, soId, { reference: 'Carrier: DELIVERED' });
    const before = await sellerBalances(db, s.actor.sellerId!);
    await elapse(soId, 25);
    expect(await flagMissingDeliveryEvidence()).toBeGreaterThanOrEqual(1);
    let so = await soOf(soId);
    expect(so.deliveryExceptionCode).toBe('SELLER_EVIDENCE_MISSING');
    expect(so.status).toBe('SHIPPED');
    expect(so.buyerResponseDueAt).toBeNull();
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, soId), eq(riskFlags.code, 'SELLER_EVIDENCE_MISSING')));
    expect(flags).toHaveLength(1);
    // Days later: still no buyer timeout and no entitlement.
    await elapse(soId, 24 * 7);
    await processBuyerResponseTimeouts();
    await flagMissingDeliveryEvidence(); // idempotent: no duplicate flag
    so = await soOf(soId);
    expect(so.status).toBe('SHIPPED');
    expect(so.receiptBasis).toBeNull();
    expect(so.entitledAt).toBeNull();
    expect(await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, soId), eq(riskFlags.code, 'SELLER_EVIDENCE_MISSING')))).toHaveLength(1);
    await expect(tryRelease(soId)).rejects.toThrow();
    expect((await journalsOf(soId)).map((j) => j.entryType)).toEqual(['ORDER_PAYMENT']);
    expect((await approvalsOf(soId)).filter((a) => a.action === 'SELLER_RELEASE')).toHaveLength(0);
    expect(await sellerBalances(db, s.actor.sellerId!)).toEqual(before);
  });

  it('LATE evidence (after 24h) → SELLER_EVIDENCE_LATE exception, buyer window NOT opened', async () => {
    const { s, soId } = await shippedOrder();
    await recordDeliveryEvent(ops, soId, { reference: 'Carrier: DELIVERED' });
    await elapse(soId, 30);
    const r = await submitDeliveryEvidence(s.actor, soId, { carrierReference: 'REF' }, await evidence());
    expect(r.late).toBe(true);
    expect(r.buyerWindowOpened).toBe(false);
    const so = await soOf(soId);
    expect(so.status).toBe('SHIPPED');
    expect(so.sellerDeliveryLate).toBe(true);
    expect(so.deliveryExceptionCode).toBe('SELLER_EVIDENCE_LATE');
    expect(so.buyerResponseDueAt).toBeNull();
    // Operations may establish only after review, with a reason; the buyer then gets a full 24h.
    const res = await reviewDeliveryException(ops, soId, 'ESTABLISH', 'تحققنا من شركة الشحن والدليل سليم');
    expect(res.established).toBe(true);
    const after = await soOf(soId);
    expect(after.status).toBe('AWAITING_BUYER_RESPONSE');
    expect(after.deliveryEstablishedBasis).toBe('OPERATIONS_REVIEW');
    expect(after.buyerResponseDueAt!.getTime() - after.deliveryEstablishedAt!.getTime()).toBe(24 * 3600_000);
    expect(after.deliveryExceptionCode).toBeNull();
  });

  it('evidence on time BEFORE the carrier event: the window opens only when the event arrives', async () => {
    const { s, soId } = await shippedOrder();
    await submitDeliveryEvidence(s.actor, soId, { carrierReference: 'REF' }, await evidence());
    expect((await soOf(soId)).status).toBe('SHIPPED');
    await recordDeliveryEvent(ops, soId, { reference: 'Carrier: DELIVERED' });
    const so = await soOf(soId);
    expect(so.status).toBe('AWAITING_BUYER_RESPONSE');
    expect(so.deliveryEstablishedBasis).toBe('AUTO_EVENT_AND_TIMELY_EVIDENCE');
  });
});

describe('buyer window, timeout entitlement and explicit Admin release', () => {
  async function inBuyerWindow() {
    const o = await shippedOrder();
    await recordDeliveryEvent(ops, o.soId, { reference: 'Carrier: DELIVERED' });
    await submitDeliveryEvidence(o.s.actor, o.soId, { carrierReference: 'REF' }, await evidence());
    return o;
  }

  it('timely evidence + event → 24h buyer window; timeout → TIMEOUT_ENTITLEMENT with NO money movement; release needs Admin', async () => {
    const { s, soId } = await inBuyerWindow();
    let so = await soOf(soId);
    expect(so.status).toBe('AWAITING_BUYER_RESPONSE');
    const due = so.buyerResponseDueAt!;
    expect(due.getTime() - so.deliveryEstablishedAt!.getTime()).toBe(24 * 3600_000);
    // Before the deadline the job does nothing.
    expect(await processBuyerResponseTimeouts()).toBe(0);
    await elapse(soId, 25);
    await processBuyerResponseTimeouts();
    so = await soOf(soId);
    expect(so.status).toBe('DELIVERED');
    expect(so.receiptBasis).toBe('TIMEOUT_ENTITLEMENT');
    expect(so.receiptConfirmationSource).not.toBe('BUYER');
    expect(so.fundsReleasedAt).toBeNull();
    expect((await journalsOf(soId)).map((j) => j.entryType)).toEqual(['ORDER_PAYMENT']);
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(0);
    // Second run is a no-op.
    await processBuyerResponseTimeouts();
    expect((await journalsOf(soId))).toHaveLength(1);
    const r = await tryRelease(soId);
    expect(r.completed).toBe(true);
    so = await soOf(soId);
    expect(so.status).toBe('COMPLETED');
    expect(so.releaseApprovalId).toBe(r.approvalId);
    const js = await journalsOf(soId);
    expect(js.map((j) => j.entryType).sort()).toEqual(['ORDER_PAYMENT', 'SELLER_RELEASE']);
    expect(js.find((j) => j.entryType === 'SELLER_RELEASE')!.approvalId).toBe(r.approvalId);
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(so.sellerNet);
  });

  it('delayed worker: entitlement time is the real processing time (not backdated) and the deadline is unchanged', async () => {
    const { soId } = await inBuyerWindow();
    await elapse(soId, 24 * 3);
    const before = await soOf(soId);
    const t0 = Date.now();
    await processBuyerResponseTimeouts();
    const so = await soOf(soId);
    expect(so.buyerResponseDueAt!.getTime()).toBe(before.buyerResponseDueAt!.getTime());
    expect(so.entitledAt!.getTime()).toBeGreaterThanOrEqual(t0 - 5000);
  });

  it('buyer confirmation is BUYER_CONFIRMED (distinguishable from timeout) and moves no money', async () => {
    const { s, c, soId } = await inBuyerWindow();
    await confirmReceipt(c.actor, soId);
    const so = await soOf(soId);
    expect(so.receiptBasis).toBe('BUYER_CONFIRMED');
    expect(so.status).toBe('DELIVERED');
    expect((await journalsOf(soId))).toHaveLength(1);
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(0);
  });

  it('only the buyer can confirm receipt — not the seller, not an Admin', async () => {
    const { s, soId } = await inBuyerWindow();
    await expect(confirmReceipt(s.actor, soId)).rejects.toThrow(/للمشتري نفسه فقط/);
    await expect(confirmReceipt(admin, soId)).rejects.toThrow(/للمشتري نفسه فقط/);
    expect((await soOf(soId)).receiptBasis).toBeNull();
  });

  it('deadlines are immutable in the database (cannot be restarted or shortened)', async () => {
    const { soId } = await inBuyerWindow();
    await expect(db.execute(sql`update seller_orders set buyer_response_due_at = now() + interval '5 days' where id = ${soId}`)).rejects.toThrow();
    await expect(db.execute(sql`update seller_orders set delivery_report_due_at = now() where id = ${soId}`)).rejects.toThrow();
  });

  it('re-submitting evidence never restarts the clock', async () => {
    const { s, soId } = await inBuyerWindow();
    const before = await soOf(soId);
    const r = await submitDeliveryEvidence(s.actor, soId, { carrierReference: 'REF2' }, await evidence());
    expect(r.firstSubmission).toBe(false);
    const after = await soOf(soId);
    expect(after.sellerDeliveryConfirmedAt!.getTime()).toBe(before.sellerDeliveryConfirmedAt!.getTime());
    expect(after.buyerResponseDueAt!.getTime()).toBe(before.buyerResponseDueAt!.getTime());
  });

  it('exact-deadline race: buyer problem report vs timeout job → never both an unblocked entitlement and a release', async () => {
    const { c, soId } = await inBuyerWindow();
    await elapse(soId, 24);
    await Promise.allSettled([reportOrderProblem(c.actor, soId, 'NOT_RECEIVED', 'الشحنة ما وصلتش لحد دلوقتي'), processBuyerResponseTimeouts()]);
    const open = await db.select().from(disputes).where(eq(disputes.sellerOrderId, soId));
    expect(open).toHaveLength(1);
    // Whichever committed first, the open dispute blocks the Admin release.
    await expect(tryRelease(soId)).rejects.toThrow(/نزاع مفتوح|بعد تأكيد الاستلام/);
    expect((await journalsOf(soId))).toHaveLength(1);
  });
});

describe('CLARIFICATION — protective hold fails closed without prior financial approval', () => {
  it('buyer problem report opens a hold with NO financial approval; timeout is blocked into Operations; release refused', async () => {
    const o = await shippedOrder();
    await recordDeliveryEvent(ops, o.soId, { reference: 'Carrier: DELIVERED' });
    await submitDeliveryEvidence(o.s.actor, o.soId, { carrierReference: 'REF' }, await evidence());
    const approvalsBefore = (await approvalsOf(o.soId)).length;
    await reportOrderProblem(o.c.actor, o.soId, 'PRODUCT_PROBLEM', 'المنتج وصل مكسور من الجنب');
    expect((await approvalsOf(o.soId)).length).toBe(approvalsBefore);
    await elapse(o.soId, 25);
    await processBuyerResponseTimeouts();
    const so = await soOf(o.soId);
    expect(so.status).toBe('AWAITING_BUYER_RESPONSE');
    expect(so.receiptBasis).toBeNull();
    expect(so.deliveryExceptionCode).toBe('TIMEOUT_BLOCKED');
    expect((await journalsOf(o.soId))).toHaveLength(1);
  });

  it('Operations hold needs no 2FA/approval to place, but lifting it needs fresh 2FA; release blocked while held', async () => {
    const o = await shippedOrder();
    const u = await makeUser({ staff: true, roles: ['OPERATIONS_MANAGER'] });
    const noStepUp = await adminActor(u.id, {});
    const before = (await db.select().from(financialApprovals)).length;
    await setFinancialHold(noStepUp, o.soId, true, 'اشتباه احتيال');
    expect((await db.select().from(financialApprovals)).length).toBe(before);
    expect((await soOf(o.soId)).financialHold).toBe(true);
    await expect(setFinancialHold(noStepUp, o.soId, false, 'رفع التجميد')).rejects.toThrow();
    expect((await soOf(o.soId)).financialHold).toBe(true);
    // Lifting (with 2FA) is not a release: nothing posts.
    await setFinancialHold(ops, o.soId, false, 'تم التحقق');
    expect((await journalsOf(o.soId))).toHaveLength(1);
  });

  it('a held, entitled order cannot be released', async () => {
    const o = await shippedOrder();
    await confirmReceipt(o.c.actor, o.soId);
    await setFinancialHold(ops, o.soId, true, 'مراجعة');
    await expect(tryRelease(o.soId)).rejects.toThrow(/تجميد مالي/);
    expect((await journalsOf(o.soId))).toHaveLength(1);
  });
});
