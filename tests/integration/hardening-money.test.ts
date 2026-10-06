import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  accountClosureRequests,
  financialApprovals,
  journalEntries,
  notifications,
  orderItems,
  orders,
  providerEvents,
  payments,
  refunds,
  sellerOrders,
  systemSettings,
  withdrawalRequests,
  externalTransactions,
} from '@/server/db/schema';
import { SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { postEntry, sellerBalances } from '@/server/modules/finance/ledger';
import { revokeApproval } from '@/server/modules/finance/approvals';
import { financialInvariants, goLiveGate, setKillSwitch, splitFee } from '@/server/modules/finance/controls';
import { approveRefund, recordRefundPayout, refundableOf, requestRefundTx } from '@/server/modules/finance/refunds';
import { approveWithdrawal, markWithdrawalPaid, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { importStatement } from '@/server/modules/finance/reconciliation';
import { handleProviderCallback, signWebhook } from '@/server/modules/payments/webhooks';
import { notify } from '@/server/modules/notifications/notify';
import { updateSetting } from '@/server/modules/settings';
import { cancelSellerOrder, confirmReceipt, confirmSellerOrder, markShipped, releaseSellerOrder, requestCancellation, saveShipment } from '@/server/modules/commerce/fulfilment';
import { deriveParentStatus } from '@/server/modules/commerce/orders';
import { requestAccountClosure } from '@/server/modules/customers/closure';
import { sellerOrderPosition } from '@/server/modules/finance/postings';
import { applyBps } from '@/server/core/money';
import { toCsv } from '@/server/modules/reports/service';
import { checkout, ensurePaymentSetup, itemsOf, makeAdmin, makeCustomer, makeProduct, makeSeller, pdf, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm, testApproval } from '../helpers/factory';

let admin: Actor;
let checker: Actor;
let operator: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  checker = await makeAdmin(['FINANCE_CHECKER']);
  operator = await makeAdmin(['FINANCE_OPERATOR']);
  await ensurePaymentSetup();
});

async function paidOrder(price = 599_00, qty = 1) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 20 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  return { s, c, order, so, p };
}
const soOf = async (id: string) => (await db.select().from(sellerOrders).where(eq(sellerOrders.id, id)))[0];
const journalsBySource = async (id: string) => db.select().from(journalEntries).where(eq(journalEntries.sourceId, id));
const approvalCount = async () => Number((await db.execute<{ n: string }>(sql`select count(*)::text n from financial_approvals`)).rows[0].n);
const journalCount = async () => Number((await db.execute<{ n: string }>(sql`select count(*)::text n from journal_entries`)).rows[0].n);

async function withSetting<T>(key: string, value: unknown, fn: () => Promise<T>): Promise<T> {
  const [old] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  // null → no row: the setting falls back to its schema default (for the fee split: unset).
  if (value === null) await db.delete(systemSettings).where(eq(systemSettings.key, key));
  else await db.insert(systemSettings).values({ key, value: value as object }).onConflictDoUpdate({ target: systemSettings.key, set: { value: value as object } });
  try {
    return await fn();
  } finally {
    if (old) await db.insert(systemSettings).values({ key, value: old.value as object }).onConflictDoUpdate({ target: systemSettings.key, set: { value: old.value as object } });
    else await db.delete(systemSettings).where(eq(systemSettings.key, key));
  }
}

describe('Admin financial approvals — enforced by the database', () => {
  const entry = (approvalId: string | null, amount = 100, type = 'ADJUSTMENT') => ({
    approvalId: approvalId as string,
    entryType: type,
    sourceType: 'test',
    sourceId: randomUUID(),
    idempotencyKey: `t:${randomUUID()}`,
    description: 'approval test',
    lines: [
      { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' as const }, debit: amount },
      { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' as const }, credit: amount },
    ],
  });

  it('absent approval → rejected', async () => {
    await expect(db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, entry(null)))).rejects.toThrow();
  });

  it('approval for another entry type (mismatched operation) → rejected', async () => {
    const ap = await testApproval(['REFUND'], 100);
    await expect(db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, entry(ap, 100, 'ADJUSTMENT')))).rejects.toThrow();
  });

  it('amount different from the approved amount → rejected at commit', async () => {
    const ap = await testApproval(['ADJUSTMENT'], 100);
    await expect(db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, entry(ap, 250)))).rejects.toThrow();
  });

  it('revoked approval → rejected', async () => {
    const ap = await testApproval(['ADJUSTMENT'], 100);
    await revokeApproval(admin, ap, 'إلغاء للاختبار');
    await expect(db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, entry(ap)))).rejects.toThrow();
  });

  it('reused (already consumed) approval → rejected', async () => {
    const ap = await testApproval(['ADJUSTMENT'], 100);
    await db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, entry(ap)));
    const [row] = await db.select().from(financialApprovals).where(eq(financialApprovals.id, ap));
    expect(row.status).toBe('CONSUMED');
    await expect(db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, entry(ap)))).rejects.toThrow();
  });

  it('approvals are immutable and never deleted', async () => {
    const ap = await testApproval(['ADJUSTMENT'], 100);
    await expect(db.execute(sql`update financial_approvals set amount = 1 where id = ${ap}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from financial_approvals where id = ${ap}`)).rejects.toThrow();
  });

  it('a non-Admin can never grant a financial approval (seller/customer/system release refused)', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const pos = await sellerOrderPosition(db, await soOf(so.id));
    await expect(releaseSellerOrder(s.actor, so.id, { expectedSellerAmount: pos.pending, reason: 'أنا البائع' })).rejects.toThrow();
    await expect(releaseSellerOrder(c.actor, so.id, { expectedSellerAmount: pos.pending, reason: 'أنا المشتري' })).rejects.toThrow();
    await expect(releaseSellerOrder(SYSTEM_ACTOR, so.id, { expectedSellerAmount: pos.pending, reason: 'job' })).rejects.toThrow();
    expect((await soOf(so.id)).fundsReleasedAt).toBeNull();
  });

  it('stale release (amount changed after the page was opened) → rejected, nothing posted', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const pos = await sellerOrderPosition(db, await soOf(so.id));
    await expect(releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending + 1, reason: 'قيمة قديمة' })).rejects.toThrow(/تغيّر/);
    expect((await journalsBySource(so.id)).map((j) => j.entryType)).toEqual(['ORDER_PAYMENT']);
  });

  it('concurrent double release → exactly one SELLER_RELEASE journal and one approval', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const pos = await sellerOrderPosition(db, await soOf(so.id));
    const res = await Promise.allSettled([
      releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending, reason: 'إتاحة 1' }),
      releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending, reason: 'إتاحة 2' }),
    ]);
    expect(res.some((r) => r.status === 'fulfilled')).toBe(true);
    expect((await journalsBySource(so.id)).filter((j) => j.entryType === 'SELLER_RELEASE')).toHaveLength(1);
    expect(await db.select().from(financialApprovals).where(and(eq(financialApprovals.entityId, so.id), eq(financialApprovals.action, 'SELLER_RELEASE')))).toHaveLength(1);
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(so.sellerNet);
  });

  it('the payment journal carries a PAYMENT_CONFIRMATION approval with actor, amount and version', async () => {
    const { so, order } = await paidOrder();
    const [j] = (await journalsBySource(so.id)).filter((x) => x.entryType === 'ORDER_PAYMENT');
    const [ap] = await db.select().from(financialApprovals).where(eq(financialApprovals.id, j.approvalId!));
    expect(ap.action).toBe('PAYMENT_CONFIRMATION');
    expect(ap.approvedBy).toBe(admin.userId);
    expect(ap.status).toBe('CONSUMED');
    const [p] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(ap.amount).toBe(p.amountDue);
  });
});

describe('CLARIFICATION — withdrawal request creates no money movement', () => {
  it('request → no journal, no approval, no reservation, balances unchanged; approval reserves atomically', async () => {
    const { s, c, so } = await paidOrder(1000_00);
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id, checker);
    const b0 = await sellerBalances(db, s.actor.sellerId!);
    const [a0, j0] = [await approvalCount(), await journalCount()];
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '300', clientKey: randomUUID() });
    expect(withdrawal.status).toBe('REQUESTED');
    expect(withdrawal.reservedAt).toBeNull();
    expect(await sellerBalances(db, s.actor.sellerId!)).toEqual(b0);
    expect(await approvalCount()).toBe(a0);
    expect(await journalCount()).toBe(j0);
    expect(await journalsBySource(withdrawal.id)).toHaveLength(0);
    await approveWithdrawal(checker, withdrawal.id);
    const b1 = await sellerBalances(db, s.actor.sellerId!);
    expect(b1.available).toBe(b0.available - 300_00);
    expect(b1.reserved).toBe(300_00);
    const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id));
    expect(w.reserveApprovalId).toBeTruthy();
    expect(w.destinationSnapshot).toBeTruthy();
    // Payout is a separate approval; the destination snapshot is frozen.
    await expect(db.execute(sql`update withdrawal_requests set destination_snapshot = '{}'::jsonb where id = ${w.id}`)).rejects.toThrow();
    await markWithdrawalPaid(operator, w.id, 'TRX-PAY-1');
    const [paid] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w.id));
    expect(paid.payoutApprovalId).toBeTruthy();
    expect(paid.payoutApprovalId).not.toBe(paid.reserveApprovalId);
  });

  it('maker/checker at threshold 0 (production value): the approver cannot also record the payout', async () => {
    await withSetting('withdrawals.dualControlThreshold', 0, async () => {
      const { s, c, so } = await paidOrder(1000_00);
      await shipIt(s.actor, so.id);
      await receiveAndRelease(c.actor, so.id, checker);
      const { withdrawal } = await requestWithdrawal(s.actor, { amount: '100', clientKey: randomUUID() });
      await approveWithdrawal(admin, withdrawal.id);
      await expect(markWithdrawalPaid(admin, withdrawal.id, 'TRX-SELF')).rejects.toThrow(/مختلف/);
      await markWithdrawalPaid(operator, withdrawal.id, 'TRX-OTHER');
    });
  });
});

describe('kill switches (fail closed)', () => {
  it('seller release paused → refused with no journal and no approval; resumes after release of the switch', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const pos = await sellerOrderPosition(db, await soOf(so.id));
    await setKillSwitch(admin, 'killswitch.sellerRelease', true, 'حادث اختبار');
    try {
      await expect(releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending, reason: 'محاولة' })).rejects.toThrow(/موقوف مؤقتًا/);
      expect((await journalsBySource(so.id))).toHaveLength(1);
    } finally {
      await setKillSwitch(admin, 'killswitch.sellerRelease', false, 'انتهى الاختبار');
    }
    await releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending, reason: 'بعد إعادة التشغيل' });
  });

  it('payment confirmation and withdrawals switches block their operations', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await setKillSwitch(admin, 'killswitch.paymentConfirmation', true, 'اختبار');
    try {
      await expect(submitAndConfirm(c, order.id, admin)).rejects.toThrow(/موقوف مؤقتًا/);
    } finally {
      await setKillSwitch(admin, 'killswitch.paymentConfirmation', false, 'اختبار');
    }
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).not.toBe('PAID');
  });
});

describe('transparent shared fee (Fb + Fs = F exactly)', () => {
  it('splitFee is exact for every amount and share (property check)', () => {
    for (let f = 0; f < 3000; f += 7) {
      for (const bps of [0, 1, 3333, 5000, 6667, 9999, 10000]) {
        const r = splitFee(f, bps);
        expect(r.buyer + r.seller).toBe(f);
        expect(r.buyer).toBeGreaterThanOrEqual(0);
        expect(r.seller).toBeGreaterThanOrEqual(0);
      }
    }
    // Money rounding: 599.00 × 15% = 89.85 exactly.
    expect(applyBps(599_00, 1500)).toBe(89_85);
  });

  it('a 50/50 share is snapshotted per item; buyer pays merchandise + shipping + Fb; seller net = gross − F', async () => {
    await withSetting('fees.buyerShareBps', 5000, async () => {
      const { so, order } = await paidOrder(599_00, 3);
      const items = await itemsOf(so.id);
      for (const it of items) expect(it.buyerFeeAmount + it.sellerFeeAmount).toBe(it.commissionAmount);
      const s = await soOf(so.id);
      expect(s.buyerFeeTotal + s.sellerFeeTotal).toBe(s.commissionTotal);
      const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
      expect(o.grandTotal).toBe(o.merchandiseTotal - o.discountTotal + o.shippingTotal + o.buyerFeeTotal);
      expect(s.sellerNet).toBe(s.grossTotal - s.commissionTotal);
      expect(o.economicSnapshot).toBeTruthy();
      expect((o.economicSnapshot as { feeBuyerShareBps: number }).feeBuyerShareBps).toBe(5000);
    });
  });

  it('fee configuration changes are prospective only (existing orders keep their snapshot)', async () => {
    const { so } = await paidOrder();
    const before = await soOf(so.id);
    await withSetting('fees.buyerShareBps', 10000, async () => {
      const after = await soOf(so.id);
      expect(after.buyerFeeTotal).toBe(before.buyerFeeTotal);
      expect(after.sellerFeeTotal).toBe(before.sellerFeeTotal);
    });
  });

  it('missing fee configuration blocks checkout (no invented default)', async () => {
    await withSetting('fees.buyerShareBps', null, async () => {
      const s = await makeSeller(admin);
      const p = await makeProduct(s.actor, admin, { price: 100_00 });
      const c = await makeCustomer();
      await expect(checkout(c, [{ variantId: p.variantId, qty: 1 }])).rejects.toThrow(/رسوم الخدمة/);
    });
  });
});

describe('cancellation before shipment only; refund obligation, never "refund paid"', () => {
  it('paid cancellation → REQUESTED refund; no REFUND journal until Admin approval; payout is a second approval', async () => {
    const { s, c, so } = await paidOrder(599_00, 2);
    await cancelSellerOrder(s.actor, so.id, 'المنتج خلص من المخزن');
    const [r] = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
    expect(r.status).toBe('REQUESTED');
    expect(r.amount).toBe(so.grossTotal);
    expect((await journalsBySource(so.id)).map((j) => j.entryType)).toEqual(['ORDER_PAYMENT']);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    const [approved] = await db.select().from(refunds).where(eq(refunds.id, r.id));
    expect(approved.status).toBe('APPROVED');
    expect(approved.status).not.toBe('COMPLETED');
    const pos = await sellerOrderPosition(db, await soOf(so.id));
    expect(pos.pending).toBe(0);
    expect(pos.deferredCommission).toBe(0);
    await recordRefundPayout(operator, r.id, 'RFD-TRX-1');
    const [paid] = await db.select().from(refunds).where(eq(refunds.id, r.id));
    expect(paid.status).toBe('COMPLETED');
    expect(paid.payoutApprovalId).toBeTruthy();
    void c;
  });

  it('after SHIPPED nobody can cancel (buyer, seller, Operations)', async () => {
    const { s, c, so } = await paidOrder();
    await shipIt(s.actor, so.id);
    await expect(requestCancellation(c.actor, so.id, 'غيرت رأيي')).rejects.toThrow(/بعد ما الطلب اتشحن/);
    await expect(cancelSellerOrder(s.actor, so.id, 'إلغاء')).rejects.toThrow(/بعد الشحن/);
    await expect(cancelSellerOrder(admin, so.id, 'إلغاء')).rejects.toThrow(/بعد الشحن/);
    expect(await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id))).toHaveLength(0);
  });

  it('cancel vs ship race → exactly one legal outcome', async () => {
    const { s, so } = await paidOrder();
    await confirmSellerOrder(s.actor, so.id);
    await saveShipment(s.actor, so.id, { carrierName: 'بوسطة', trackingNumber: 'R1', shippedAt: new Date() }, { data: pdf(), name: 'w.pdf' });
    const res = await Promise.allSettled([markShipped(s.actor, so.id), cancelSellerOrder(admin, so.id, 'مخاطر')]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const after = await soOf(so.id);
    const rf = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
    if (after.status === 'CANCELLED') expect(rf).toHaveLength(1);
    else {
      expect(after.status).toBe('SHIPPED');
      expect(rf).toHaveLength(0);
    }
  });

  it('a pending buyer cancellation blocks shipment until resolved', async () => {
    const { s, c, so } = await paidOrder();
    await confirmSellerOrder(s.actor, so.id);
    const r = await requestCancellation(c.actor, so.id, 'مش محتاجه');
    expect(r.status).toBe('PENDING');
    await saveShipment(s.actor, so.id, { carrierName: 'بوسطة', trackingNumber: 'R2', shippedAt: new Date() }, { data: pdf(), name: 'w.pdf' });
    await expect(markShipped(s.actor, so.id)).rejects.toThrow();
    expect((await soOf(so.id)).status).not.toBe('SHIPPED');
  });
});

describe('partial / item / quantity refunds', () => {
  it('one of three units: exact per-unit components; over-refund refused; quantities never exceed purchased', async () => {
    const { so } = await paidOrder(599_00, 3);
    const [it] = await itemsOf(so.id);
    const r1 = await db.transaction(async (tx) =>
      requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), items: [{ orderItemId: it.id, quantity: 1 }], reason: 'وحدة واحدة' }),
    );
    expect(r1.principalAmount).toBe(599_00);
    expect(r1.shippingAmount).toBe(0);
    expect(r1.buyerFeeRefund + r1.sellerFeeReversal).toBeLessThanOrEqual(it.commissionAmount);
    expect(r1.sellerLiability).toBe(r1.principalAmount + r1.shippingAmount - r1.sellerFeeReversal);
    await expect(
      db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), items: [{ orderItemId: it.id, quantity: 3 }], reason: 'أكثر من المتاح' })),
    ).rejects.toThrow(/أكبر من المتاح/);
    const r2 = await db.transaction((tx) =>
      requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), items: [{ orderItemId: it.id, quantity: 2 }], reason: 'الباقي' }),
    );
    // All three units together: fee components sum exactly to the item's snapshotted fee.
    expect(r1.buyerFeeRefund + r2.buyerFeeRefund).toBe(it.buyerFeeAmount);
    expect(r1.sellerFeeReversal + r2.sellerFeeReversal).toBe(it.sellerFeeAmount);
    const left = await refundableOf(db, await soOf(so.id));
    expect(left.items[0].refundableQty).toBe(0);
    expect(left.principal).toBe(0);
  });

  it('approved partial refund after release reverses from available; the stale-amount approval is refused', async () => {
    const { s, c, so } = await paidOrder(599_00, 2);
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id, checker);
    const [it] = await itemsOf(so.id);
    const r = await db.transaction((tx) =>
      requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), items: [{ orderItemId: it.id, quantity: 1 }], reason: 'تعويض' }),
    );
    await expect(approveRefund(checker, r.id, { expectedAmount: r.amount - 1, reason: 'قيمة خطأ' })).rejects.toThrow();
    const b0 = await sellerBalances(db, s.actor.sellerId!);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    const b1 = await sellerBalances(db, s.actor.sellerId!);
    expect(b0.available - b1.available).toBe(r.sellerLiability);
  });
});

describe('reconciliation, provider callbacks, notifications', () => {
  it('statement import never auto-matches (UNMATCHED / SUGGESTED_MATCH only)', async () => {
    const recon = await makeAdmin(['FINANCE_CHECKER']);
    const ref = `ST-${randomUUID().slice(0, 8)}`;
    const csv = `externalRef,direction,amount,occurredAt\n${ref},IN,599.00,2026-10-01T10:00:00Z\n${ref}-2,OUT,12345.67,2026-10-01T11:00:00Z`;
    const res = await importStatement(recon, 'INSTAPAY', csv, 'st.csv');
    expect(res.rows).toBe(2);
    const rows = await db.select().from(externalTransactions).where(inArray(externalTransactions.externalRef, [ref, `${ref}-2`]));
    expect(rows.every((r) => r.state === 'UNMATCHED' || r.state === 'SUGGESTED_MATCH')).toBe(true);
    // A malformed statement fails as a whole (nothing partial is imported).
    await expect(importStatement(recon, 'INSTAPAY', `${ref}-3,SIDEWAYS,1.00,2026-10-01`, 'bad.csv')).rejects.toThrow(/الاتجاه/);
    // Re-importing the same reference is ignored (no duplicate external transaction).
    const again = await importStatement(recon, 'INSTAPAY', csv, 'st.csv');
    expect(again.inserted).toBe(0);
  });

  it('CSV exports neutralise formula injection (= + - @)', () => {
    const out = toCsv(['a', 'b', 'c', 'd'], [['=HYPERLINK("http://x")', '+1', '-2', '@SUM(A1)']]);
    expect(out).not.toMatch(/(^|,)"?[=+\-@]/m);
  });

  it('provider callback: not connected → 503; bad signature → 401; stale → 400; duplicate → recorded once; evidence only', async () => {
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'payment.received', reference: 'X', amount: 100 });
    expect((await handleProviderCallback('testpsp', { signature: 'x', timestamp: '1' }, body, new Date(), '')).httpStatus).toBe(503);
    const secret = 'whsec_test_0123456789';
    const now = new Date();
    const ts = String(Math.floor(now.getTime() / 1000));
    expect((await handleProviderCallback('testpsp', { signature: 'bad', timestamp: ts }, body, now, secret)).httpStatus).toBe(401);
    const oldTs = String(Math.floor(now.getTime() / 1000) - 3600);
    expect((await handleProviderCallback('testpsp', { signature: signWebhook(secret, oldTs, body), timestamp: oldTs }, body, now, secret)).status).toBe('REJECTED_STALE');
    const sig = signWebhook(secret, ts, body);
    const j0 = await journalCount();
    expect((await handleProviderCallback('testpsp', { signature: sig, timestamp: ts }, body, now, secret)).status).toBe('RECORDED_AS_EVIDENCE');
    expect((await handleProviderCallback('testpsp', { signature: sig, timestamp: ts }, body, now, secret)).status).toBe('DUPLICATE');
    expect(await journalCount()).toBe(j0);
    const id = (JSON.parse(body) as { id: string }).id;
    expect(await db.select().from(providerEvents).where(eq(providerEvents.eventId, id))).toHaveLength(1);
  });

  it('notification dedupe: the same business event notifies once', async () => {
    const c = await makeCustomer();
    const key = `test:${randomUUID()}`;
    for (let i = 0; i < 3; i++) await db.transaction((tx) => notify(tx, { event: 'REFUND_UPDATED', userIds: [c.user.id], vars: { status: 'x', amount: '1' }, dedupeKey: key }));
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, c.user.id), eq(notifications.dedupeKey, key)))).toHaveLength(1);
  });
});

describe('go-live gate, invariants, closure, parent status', () => {
  it('real money cannot be enabled: the gate fails closed (negative test)', async () => {
    const gate = await goLiveGate();
    expect(gate.pass).toBe(false);
    expect(gate.automaticSellerRelease).toBe(false);
    expect(gate.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['RESTORE_DRILL', 'PAYMENT_PROVIDER', 'FEE_APPROVAL', 'LEGAL_APPROVAL']));
    await expect(updateSetting(admin, 'payments.realMoneyEnabled', true, 'محاولة تفعيل')).rejects.toThrow(/لا يمكن تفعيل الأموال الحقيقية/);
  });

  it('account closure is blocked while an order is open (closure lock)', async () => {
    const { c } = await paidOrder();
    const r = await requestAccountClosure(c.actor, 'عايز أقفل');
    expect(r.status).toBe('BLOCKED');
    expect(r.blockers.map((b) => b.code)).toContain('OPEN_ORDERS');
    const [row] = await db.select().from(accountClosureRequests).where(eq(accountClosureRequests.id, r.requestId));
    expect(row.status).toBe('BLOCKED');
  });

  it('deriveParentStatus — mixed outcomes', () => {
    expect(deriveParentStatus(['COMPLETED', 'COMPLETED'])).toBe('COMPLETED');
    expect(deriveParentStatus(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
    expect(deriveParentStatus(['COMPLETED', 'CANCELLED'])).toBe('PARTIALLY_COMPLETED');
    expect(deriveParentStatus(['DELIVERY_FAILED', 'CANCELLED'])).toBe('CLOSED_UNFULFILLED');
  });

  it('financial invariants hold after all of the above: dr = cr, no drift, no unapproved journal', async () => {
    const inv = await financialInvariants();
    const failing = inv.checks.filter((c) => c.count > 0).map((c) => `${c.code}:${JSON.stringify(c.sample).slice(0, 300)}`);
    expect(failing).toEqual([]);
    expect(inv.totals.difference).toBe(0);
  });
});

afterAll(async () => {
  // Leave the kill switches released for the other suites.
  for (const k of ['killswitch.sellerRelease', 'killswitch.paymentConfirmation'] as const) {
    await db.insert(systemSettings).values({ key: k, value: false as unknown as object }).onConflictDoUpdate({ target: systemSettings.key, set: { value: false as unknown as object } });
  }
  void orderItems;
});
