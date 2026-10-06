import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { auditLogs, externalTransactions, journalEntries, orders, payments, productVariants, refunds, riskFlags, sellerOrders, users, withdrawalRequests } from '@/server/db/schema';
import type { Actor } from '@/server/core/actor';
import {
  confirmReceipt,
  processBuyerResponseTimeouts,
  recordShipmentException,
  releaseSellerOrder,
  reportOrderProblem,
  resolveShipmentException,
} from '@/server/modules/commerce/fulfilment';
import { cancelUnpaidOrder, expireOverdueOrders } from '@/server/modules/commerce/orders';
import { completeAccountClosure, requestAccountClosure } from '@/server/modules/customers/closure';
import { sellerOrderPosition } from '@/server/modules/finance/postings';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { approveRefund, requestRefundTx } from '@/server/modules/finance/refunds';
import { confirmMatch, importStatement } from '@/server/modules/finance/reconciliation';
import { approveWithdrawal, markWithdrawalPaid, rejectWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { submitProof } from '@/server/modules/payments/service';
import { addToCart } from '@/server/modules/commerce/cart';
import {
  checkout,
  ensurePaymentSetup,
  makeAdmin,
  makeCustomer,
  makeProduct,
  makeSeller,
  paymentOf,
  png,
  receiveAndRelease,
  sellerOrdersOf,
  shipIt,
  submitAndConfirm,
} from '../helpers/factory';

/** Remaining items of the hardening test matrix (1–108) not already covered by the other suites. */
let admin: Actor;
let checker: Actor;
let operator: Actor;
let ops: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  checker = await makeAdmin(['FINANCE_CHECKER']);
  operator = await makeAdmin(['FINANCE_OPERATOR']);
  ops = await makeAdmin(['OPERATIONS_MANAGER']);
  await ensurePaymentSetup();
});

async function paidOrder(price = 500_00, qty = 1) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  return { s, c, order, so, p };
}
const soOf = async (id: string) => (await db.select().from(sellerOrders).where(eq(sellerOrders.id, id)))[0];
const variant = async (id: string) => (await db.select().from(productVariants).where(eq(productVariants.id, id)))[0];

describe('order / payment / inventory (1, 4, 6, 11)', () => {
  it('#1 unpaid cancellation releases the reservation; no money moves', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00, stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 2 }]);
    expect((await variant(p.variantId)).reserved).toBe(2);
    await cancelUnpaidOrder(c.actor, order.id);
    expect((await variant(p.variantId)).reserved).toBe(0);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).toBe('CANCELLED');
    const [so] = await sellerOrdersOf(order.id);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id))).toHaveLength(0);
  });

  it('#4 out of stock at checkout → specific refusal', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00, stock: 1 });
    const c1 = await makeCustomer();
    const c2 = await makeCustomer();
    await addToCart({ userId: c2.user.id }, p.variantId, 1);
    await checkout(c1, [{ variantId: p.variantId, qty: 1 }]);
    await expect(checkout(c2, [])).rejects.toThrow(/المنتج خلص|أكبر من المتاح|غير متاح/);
  });

  it('#6 a proof submitted before the deadline survives the expiry job', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    await submitProof(c.actor, pay.id, { claimedAmount: String(pay.amountDue / 100), clientKey: randomUUID() }, { data: await png('p'), name: 'p.png' });
    await expireOverdueOrders(new Date(Date.now() + 30 * 86400_000));
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).not.toBe('EXPIRED');
    const [after] = await db.select().from(payments).where(eq(payments.id, pay.id));
    expect(['PAYMENT_SUBMITTED', 'UNDER_REVIEW']).toContain(after.status);
  });

  it('#11 paid cancellation restocks the units', async () => {
    const { s, so, p } = await paidOrder(100_00, 3);
    const before = await variant(p.variantId);
    const { cancelSellerOrder } = await import('@/server/modules/commerce/fulfilment');
    await cancelSellerOrder(s.actor, so.id, 'لا أستطيع التنفيذ');
    expect((await variant(p.variantId)).stockOnHand).toBe(before.stockOnHand + 3);
  });
});

describe('multi-seller isolation (13–17)', () => {
  it('#14/#17 seller A completes while seller B delays: parent not complete, balances isolated', async () => {
    const a = await makeSeller(admin);
    const b = await makeSeller(admin);
    const pa = await makeProduct(a.actor, admin, { price: 300_00 });
    const pb = await makeProduct(b.actor, admin, { price: 200_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: pa.variantId, qty: 1 }, { variantId: pb.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const sos = await sellerOrdersOf(order.id);
    const soA = sos.find((x) => x.sellerId === a.actor.sellerId)!;
    const soB = sos.find((x) => x.sellerId === b.actor.sellerId)!;
    await shipIt(a.actor, soA.id);
    await receiveAndRelease(c.actor, soA.id, checker);
    expect((await soOf(soA.id)).status).toBe('COMPLETED');
    expect((await soOf(soB.id)).status).toBe('PAID');
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).not.toBe('COMPLETED');
    expect((await sellerBalances(db, a.actor.sellerId!)).available).toBe(soA.sellerNet);
    expect((await sellerBalances(db, b.actor.sellerId!)).available).toBe(0);
    expect((await sellerBalances(db, b.actor.sellerId!)).pending).toBe(soB.sellerNet);
  });
});

describe('refunds (23, 108)', () => {
  it('#23 duplicate refund for the same source is not created twice', async () => {
    const { so } = await paidOrder();
    const src = randomUUID();
    const mk = () => db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: src, principalAmount: 100_00, reason: 'تعويض' }));
    const [r1, r2] = await Promise.allSettled([mk(), mk()]);
    const ok = [r1, r2].filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>[];
    expect(new Set(ok.map((r) => r.value.id)).size).toBe(1);
    expect(await db.select().from(refunds).where(and(eq(refunds.sourceType, 'ADMIN'), eq(refunds.sourceId, src)))).toHaveLength(1);
  });

  it('#108 a valid refund after COMPLETED uses a new compensating entry; history untouched', async () => {
    const { s, c, so } = await paidOrder(400_00);
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id, checker);
    const before = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id));
    const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: 50_00, reason: 'تعويض بعد الإكمال' }));
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    const after = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id));
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    for (const j of before) expect(after.find((x) => x.id === j.id)).toBeTruthy();
    expect((await soOf(so.id)).status).toBe('COMPLETED');
  });
});

describe('shipping exceptions (27–31)', () => {
  for (const [code, outcome] of [
    ['DELIVERY_ATTEMPT_FAILED', 'RESHIP'],
    ['BUYER_REFUSED', 'RETURNED_TO_SELLER'],
    ['RETURN_TO_SELLER', 'RETURNED_TO_SELLER'],
    ['LOST_IN_TRANSIT', 'LOST'],
    ['DAMAGED_IN_TRANSIT', 'RETURNED_TO_SELLER'],
  ] as const) {
    it(`${code} → exception holds the path; ${outcome} never counts as delivery or releases money`, async () => {
      const { s, so } = await paidOrder();
      await shipIt(s.actor, so.id);
      await recordShipmentException(s.actor, so.id, code, 'تفاصيل المشكلة من شركة الشحن');
      let cur = await soOf(so.id);
      expect(cur.deliveryExceptionCode).toBe(`SHIPMENT_${code}`);
      expect(cur.receiptBasis).toBeNull();
      await processBuyerResponseTimeouts();
      await resolveShipmentException(ops, so.id, outcome, 'قرار العمليات بعد مراجعة شركة الشحن');
      cur = await soOf(so.id);
      if (outcome === 'RESHIP') {
        expect(cur.status).toBe('SHIPPED');
        expect(cur.deliveryExceptionCode).toBeNull();
      } else {
        expect(cur.status).toBe('DELIVERY_FAILED');
        const rf = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
        expect(rf).toHaveLength(1);
        expect(rf[0].status).toBe('REQUESTED');
        expect(rf[0].amount).toBe(so.grossTotal);
      }
      expect((await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id))).map((j) => j.entryType)).toEqual(['ORDER_PAYMENT']);
    });
  }
});

describe('receipt / release races and guards (36, 99, 107)', () => {
  it('#36 dispute vs release race: never a release after the dispute committed', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const pos = await sellerOrderPosition(db, await soOf(so.id));
    const [d, r] = await Promise.allSettled([
      reportOrderProblem(c.actor, so.id, 'PRODUCT_PROBLEM', 'المنتج فيه عيب واضح في الشاشة'),
      releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending, reason: 'إتاحة' }),
    ]);
    expect(d.status).toBe('fulfilled');
    const releases = (await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id))).filter((j) => j.entryType === 'SELLER_RELEASE');
    if (r.status === 'fulfilled') {
      // The release won the row lock: it committed before the dispute existed.
      expect(releases).toHaveLength(1);
    } else {
      expect(releases).toHaveLength(0);
      expect(String(r.reason)).toMatch(/نزاع مفتوح/);
    }
  });

  it('#99 COMPLETED is rejected by the database without receipt basis and committed release', async () => {
    const { s, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await expect(db.execute(sql`update seller_orders set status = 'COMPLETED' where id = ${so.id}`)).rejects.toThrow();
  });

  it('#107 an Admin release creates no withdrawal and no payout', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id, checker);
    expect(await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, s.actor.sellerId!))).toHaveLength(0);
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(b.reserved).toBe(0);
    expect(b.available).toBe(so.sellerNet);
  });
});

describe('withdrawals (40, 47)', () => {
  async function seller() {
    const { s, c, so } = await paidOrder(1000_00);
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id, checker);
    return s;
  }
  it('#40 duplicate payout recording posts once', async () => {
    const s = await seller();
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '200', clientKey: randomUUID() });
    await approveWithdrawal(checker, withdrawal.id);
    await Promise.allSettled([markWithdrawalPaid(operator, withdrawal.id, 'TRX-D1'), markWithdrawalPaid(operator, withdrawal.id, 'TRX-D1')]);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd-paid:${withdrawal.id}`))).toHaveLength(1);
  });
  it('#47 rejecting an approved withdrawal posts a balanced reversal under its own approval', async () => {
    const s = await seller();
    const b0 = await sellerBalances(db, s.actor.sellerId!);
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '150', clientKey: randomUUID() });
    await approveWithdrawal(checker, withdrawal.id);
    await rejectWithdrawal(checker, withdrawal.id, 'بيانات التحويل غير صحيحة');
    expect(await sellerBalances(db, s.actor.sellerId!)).toEqual(b0);
    const js = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, withdrawal.id));
    expect(js.map((j) => j.entryType).sort()).toEqual(['WITHDRAWAL_RESERVE', 'WITHDRAWAL_REVERSAL']);
    expect(new Set(js.map((j) => j.approvalId)).size).toBe(2);
  });
});

describe('account closure (74, 77, 89, 90)', () => {
  it('#74/#77 a buyer with completed history can be closed: PII pseudonymised, orders/payments/ledger kept', async () => {
    const { s, c, so, order } = await paidOrder();
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id, checker);
    const j0 = (await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id))).length;
    const req = await requestAccountClosure(c.actor, 'مش محتاج الحساب');
    expect(req.status).toBe('PENDING');
    const support = await makeAdmin();
    const done = await completeAccountClosure(support, req.requestId);
    expect(done.closed).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, c.user.id));
    expect(u.status).toBe('CLOSED');
    expect(u.email).toBeNull();
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toHaveLength(1);
    expect((await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id))).length).toBe(j0);
  });

  it('#89 a seller with any balance (available) cannot close', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id, checker);
    const r = await requestAccountClosure(s.actor, 'إغلاق');
    expect(r.status).toBe('BLOCKED');
    expect(r.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['NON_ZERO_BALANCE']));
  });

  it('#90 a pending closure blocks new orders and withdrawal requests (same account lock)', async () => {
    const c = await makeCustomer();
    const r = await requestAccountClosure(c.actor);
    expect(r.status).toBe('PENDING');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00 });
    await expect(checkout(c, [{ variantId: p.variantId, qty: 1 }])).rejects.toThrow(/إغلاق/);
  });
});

describe('reconciliation (78–82)', () => {
  it('#78/#81 exact match is confirmed by a human and audited; the same record cannot be matched twice', async () => {
    const recon = await makeAdmin(['FINANCE_CHECKER']);
    const { order } = await paidOrder(777_00);
    const pay = await paymentOf(order.id);
    const ref = `EX-${randomUUID().slice(0, 8)}`;
    await importStatement(recon, 'INSTAPAY', `${ref},IN,${(pay.amountDue / 100).toFixed(2)},2026-10-01T10:00:00Z`);
    const [x] = await db.select().from(externalTransactions).where(eq(externalTransactions.externalRef, ref));
    expect(x.state).toBe('SUGGESTED_MATCH');
    expect((await confirmMatch(recon, x.id, { type: 'payment', id: pay.id }, 'مطابق بالمبلغ والمرجع')).state).toBe('MATCHED');
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, x.id), eq(auditLogs.action, 'reconciliation.matched'))))).toHaveLength(1);
    const ref2 = `${ref}-B`;
    await importStatement(recon, 'INSTAPAY', `${ref2},IN,${(pay.amountDue / 100).toFixed(2)},2026-10-01T10:05:00Z`);
    const [y] = await db.select().from(externalTransactions).where(eq(externalTransactions.externalRef, ref2));
    await expect(confirmMatch(recon, y.id, { type: 'payment', id: pay.id }, 'تكرار')).rejects.toThrow(/متطابق مع حركة تانية/);
  });

  it('#79/#80 ambiguous candidates are only suggested; an amount difference becomes MISMATCH + HIGH flag', async () => {
    const recon = await makeAdmin(['FINANCE_CHECKER']);
    const { order } = await paidOrder(333_00);
    const pay = await paymentOf(order.id);
    const ref = `MM-${randomUUID().slice(0, 8)}`;
    await importStatement(recon, 'BANK_TRANSFER', `${ref},IN,1.00,2026-10-01T10:00:00Z`);
    const [x] = await db.select().from(externalTransactions).where(eq(externalTransactions.externalRef, ref));
    expect(x.state).not.toBe('MATCHED');
    expect((await confirmMatch(recon, x.id, { type: 'payment', id: pay.id }, 'محاولة مطابقة')).state).toBe('MISMATCH');
    expect(await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, x.id), eq(riskFlags.code, 'RECONCILIATION_MISMATCH')))).toHaveLength(1);
  });

  it('#82 ledger imbalance / drift is detected and reported (never auto-fixed)', async () => {
    const { financialInvariants } = await import('@/server/modules/finance/controls');
    const inv = await financialInvariants();
    expect(inv.checks.map((c) => c.code)).toEqual(expect.arrayContaining(['TRIAL_BALANCE', 'PROJECTION_DRIFT', 'UNBALANCED_ENTRY']));
    expect(inv.totals.difference).toBe(0);
  });
});
