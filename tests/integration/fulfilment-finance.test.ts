import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { auditLogs, journalEntries, orderItems, orders, productVariants, refunds, sellerOrders, withdrawalRequests } from '@/server/db/schema';
import { cancelSellerOrder, confirmReceipt, confirmSellerOrder, markShipped, saveShipment, sellerOrderForSeller } from '@/server/modules/commerce/fulfilment';
import { createRule } from '@/server/modules/finance/commissions';
import { accountBalance, reconcile, sellerBalances } from '@/server/modules/finance/ledger';
import { approveWithdrawal, cancelWithdrawal, createAdjustment, decideAdjustment, markRefundPaid, markWithdrawalPaid, rejectWithdrawal, requestWithdrawal, revealPayoutDetails } from '@/server/modules/finance/withdrawals';
import { adminActor } from '@/server/auth/actors';
import { addPayoutMethod } from '@/server/modules/sellers/service';
import { checkout, categoryId, ensurePaymentSetup, itemsOf, makeAdmin, makeCustomer, makeProduct, makeSeller, pdf, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

async function deliveredOrder(price = 1000_00, qty = 1) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  return { s, c, order, so, p };
}

describe('shipping & buyer receipt confirmation', () => {
  it('marking shipped requires shipment data AND a waybill; shipping alone never releases funds', async () => {
    const { s, so } = await deliveredOrder();
    await confirmSellerOrder(s.actor, so.id);
    await expect(markShipped(s.actor, so.id)).rejects.toThrow(/بيانات الشحن/);
    await saveShipment(s.actor, so.id, { carrierName: 'أرامكس', trackingNumber: 'X1', shippedAt: new Date() });
    await expect(markShipped(s.actor, so.id)).rejects.toThrow(/بوليصة/);
    await saveShipment(s.actor, so.id, { carrierName: 'أرامكس', trackingNumber: 'X1', shippedAt: new Date() }, { data: pdf(), name: 'w.pdf' });
    await markShipped(s.actor, so.id);
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(b.available).toBe(0);
    expect(b.pending).toBe(so.sellerNet);
  });

  it('EDGE 19 — invalid waybill uploads are rejected (type sniffing, not extension)', async () => {
    const { s, so } = await deliveredOrder();
    await confirmSellerOrder(s.actor, so.id);
    const fake = Buffer.from('<?php system($_GET["c"]); ?>' + ' '.repeat(50));
    await expect(saveShipment(s.actor, so.id, { carrierName: 'XX', shippedAt: new Date() }, { data: fake, name: 'waybill.pdf' })).rejects.toThrow(/غير مدعوم/);
    await expect(saveShipment(s.actor, so.id, { carrierName: 'XX', shippedAt: new Date() }, { data: pdf(), name: 'waybill.exe' })).rejects.toThrow(/امتداد/);
  });

  it('EDGE 10 — buyer confirms receipt twice: funds become available exactly once', async () => {
    const { s, c, so } = await deliveredOrder();
    await shipIt(s.actor, so.id);
    const results = await Promise.allSettled([confirmReceipt(c.actor, so.id), confirmReceipt(c.actor, so.id)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    await confirmReceipt(c.actor, so.id); // later retry
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(b.available).toBe(so.sellerNet);
    expect(b.pending).toBe(0);
    const releases = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `release:${so.id}`));
    expect(releases).toHaveLength(1);
    const [after] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id));
    expect(after.status).toBe('DELIVERED');
    expect(after.receiptConfirmedBy).toBe(c.user.id);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, so.id));
    expect(audit.some((a) => a.action === 'seller_order.receipt_confirmed')).toBe(true);
  });

  it('a seller cannot confirm receipt on behalf of the buyer; other customers cannot either', async () => {
    const { s, so } = await deliveredOrder();
    await shipIt(s.actor, so.id);
    const stranger = await makeCustomer();
    await expect(confirmReceipt(stranger.actor, so.id)).rejects.toThrow(/صلاحية/);
    await expect(confirmReceipt(s.actor, so.id)).rejects.toThrow();
  });
});

describe('commissions', () => {
  it('EDGE 13 — changing a commission later never alters historical orders', async () => {
    const { so } = await deliveredOrder(200_00);
    const before = await itemsOf(so.id);
    await createRule(admin, { categoryId: await categoryId('electronics-accessories'), label: 'زيادة', percentBps: 2000, minFee: null, tiers: null, effectiveFrom: new Date() });
    const after = await itemsOf(so.id);
    expect(after[0].commissionBps).toBe(before[0].commissionBps);
    expect(after[0].commissionAmount).toBe(before[0].commissionAmount);
    const [soAfter] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id));
    expect(soAfter.commissionTotal).toBe(so.commissionTotal);
    // new orders use the new rate
    const fresh = await deliveredOrder(200_00);
    expect((await itemsOf(fresh.so.id))[0].commissionBps).toBe(2000);
  });
});

describe('cancellations & refunds', () => {
  it('EDGE 8 — one seller cancels inside a multi-seller order; the other sub-order is unaffected', async () => {
    const s1 = await makeSeller(admin);
    const s2 = await makeSeller(admin);
    const p1 = await makeProduct(s1.actor, admin, { stock: 3 });
    const p2 = await makeProduct(s2.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p1.variantId, qty: 1 }, { variantId: p2.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [a, b] = await sellerOrdersOf(order.id);
    const seller1 = a.sellerId === s1.actor.sellerId ? s1 : s2;
    const p = a.sellerId === s1.actor.sellerId ? p1 : p2;
    await expect(cancelSellerOrder(seller1.actor, a.id, '')).rejects.toThrow();
    await cancelSellerOrder(seller1.actor, a.id, 'نفاد المخزون لدى المورد');
    const [aa] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, a.id));
    const [bb] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, b.id));
    expect(aa.status).toBe('CANCELLED');
    expect(bb.status).toBe('PAID');
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).toBe('PAID');
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.stockOnHand).toBe(3); // restocked
    const [r] = await db.select().from(refunds).where(eq(refunds.sellerOrderId, a.id));
    expect(r.amount).toBe(a.grossTotal);
    expect(r.commissionReversal).toBe(a.commissionTotal);
    expect((await sellerBalances(db, seller1.actor.sellerId!)).pending).toBe(0);
    // finance pays the refund (step-up required)
    const operator = await makeAdmin(['FINANCE_OPERATOR']);
    await markRefundPaid(operator, r.id, 'REF-123');
    await markRefundPaid(operator, r.id, 'REF-123'); // idempotent
    expect(await accountBalance(db, { code: 'CUSTOMER_REFUNDS_PAYABLE' })).toBe(0 + (await outstandingRefunds()));
  });
});

async function outstandingRefunds() {
  const r = await db.execute<{ s: string }>(sql`select coalesce(sum(amount),0) s from refunds where status = 'PENDING'`);
  return Number(r.rows[0].s);
}

describe('withdrawals', () => {
  async function sellerWithAvailable() {
    const d = await deliveredOrder(1000_00);
    await shipIt(d.s.actor, d.so.id);
    await confirmReceipt(d.c.actor, d.so.id);
    return d;
  }

  it('EDGE 11 — a retried withdrawal request is idempotent', async () => {
    const { s } = await sellerWithAvailable();
    const key = randomUUID();
    const w1 = await requestWithdrawal(s.actor, { amount: '200', clientKey: key });
    const w2 = await requestWithdrawal(s.actor, { amount: '200', clientKey: key });
    expect(w2.created).toBe(false);
    expect(w2.withdrawal.id).toBe(w1.withdrawal.id);
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(b.reserved).toBe(200_00);
  });

  it('full payout details are revealed only to payout operators after step-up, and the reveal is audited', async () => {
    const { s } = await sellerWithAvailable();
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '150', clientKey: randomUUID() });
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    const operator = await makeAdmin(['FINANCE_OPERATOR']);
    await expect(revealPayoutDetails(checker, 'withdrawal', withdrawal.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const stale = await adminActor(operator.userId!, { stepUpAt: new Date(Date.now() - 3600_000) });
    await expect(revealPayoutDetails(stale, 'withdrawal', withdrawal.id)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const rows = await revealPayoutDetails(operator, 'withdrawal', withdrawal.id);
    expect(rows.length).toBeGreaterThan(1);
    expect(withdrawal.payoutMasked).toContain('•');
    expect(rows.some((r) => !r.value.includes('•'))).toBe(true);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, withdrawal.id));
    expect(logs.some((l) => l.action === 'payout.details_revealed' && l.actorUserId === operator.userId)).toBe(true);
  });

  it('EDGE 12 — two concurrent withdrawals cannot spend the same available balance', async () => {
    const { s } = await sellerWithAvailable();
    const available = (await sellerBalances(db, s.actor.sellerId!)).available;
    const amount = String(Math.floor((available * 0.7) / 100));
    const results = await Promise.allSettled([
      requestWithdrawal(s.actor, { amount, clientKey: randomUUID() }),
      requestWithdrawal(s.actor, { amount, clientKey: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(b.available).toBeGreaterThanOrEqual(0);
    expect(b.available + b.reserved).toBe(available);
  });

  it('cannot withdraw more than available; rejection/cancellation returns the reserved amount', async () => {
    const { s } = await sellerWithAvailable();
    const b0 = await sellerBalances(db, s.actor.sellerId!);
    await expect(requestWithdrawal(s.actor, { amount: String(b0.available / 100 + 1), clientKey: randomUUID() })).rejects.toThrow(/غير كاف/);
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '100', clientKey: randomUUID() });
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await rejectWithdrawal(checker, withdrawal.id, 'بيانات الحساب غير مطابقة');
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(b0.available);
    const w2 = await requestWithdrawal(s.actor, { amount: '100', clientKey: randomUUID() });
    await cancelWithdrawal(s.actor, w2.withdrawal.id);
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(b0.available);
  });

  it('EDGE 17 — maker/checker: low-privilege admins cannot approve/pay; dual control enforced above threshold', async () => {
    const { s } = await sellerWithAvailable();
    await db.execute(sql`insert into system_settings (key, value) values ('withdrawals.dualControlThreshold', '10000') on conflict (key) do update set value = '10000'`);
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '150', clientKey: randomUUID() });
    expect(withdrawal.requiresDualControl).toBe(true);
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    await expect(approveWithdrawal(support, withdrawal.id)).rejects.toThrow(/صلاحية/);
    await expect(markWithdrawalPaid(support, withdrawal.id, 'X-1')).rejects.toThrow(/صلاحية/);
    const both = await makeAdmin(['FINANCE_CHECKER', 'FINANCE_OPERATOR']);
    await approveWithdrawal(both, withdrawal.id);
    await expect(markWithdrawalPaid(both, withdrawal.id, 'TRX-1')).rejects.toThrow(/مختلفاً/);
    const operator = await makeAdmin(['FINANCE_OPERATOR']);
    await expect(markWithdrawalPaid({ ...operator, stepUpAt: null }, withdrawal.id, 'TRX-1')).rejects.toThrow(/تأكيد هويتك/);
    await markWithdrawalPaid(operator, withdrawal.id, 'TRX-1');
    await markWithdrawalPaid(operator, withdrawal.id, 'TRX-1'); // idempotent retry
    const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id));
    expect(w.status).toBe('PAID');
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd-paid:${w.id}`))).toHaveLength(1);
    await db.execute(sql`delete from system_settings where key = 'withdrawals.dualControlThreshold'`);
  });

  it('payout detail changes place a withdrawal hold', async () => {
    const { s } = await sellerWithAvailable();
    await addPayoutMethod(s.actor, { type: 'INSTAPAY', holderName: 'اسم جديد', instapayAddress: 'new@instapay' });
    await expect(requestWithdrawal(s.actor, { amount: '100', clientKey: randomUUID() })).rejects.toThrow(/مؤخراً/);
  });
});

describe('manual adjustments (maker/checker)', () => {
  it('require a reason, a different approver, and post to the ledger only once approved', async () => {
    const { s } = await deliveredOrder();
    const maker = await makeAdmin(['FINANCE_OPERATOR']);
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await expect(createAdjustment(maker, { sellerId: s.actor.sellerId!, amount: '50', reasonCode: 'GOODWILL', reason: '' })).rejects.toThrow();
    const adj = await createAdjustment(maker, { sellerId: s.actor.sellerId!, amount: '50', reasonCode: 'GOODWILL', reason: 'تعويض عن تأخير التسوية' });
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(0);
    await expect(decideAdjustment(maker, adj.id, true)).rejects.toThrow(/صلاحية|منشئ/);
    await decideAdjustment(checker, adj.id, true);
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(50_00);
  });
});

describe('ledger integrity', () => {
  it('journal is append-only and every account projection matches its lines', async () => {
    const dbError = (re: RegExp) => expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringMatching(re) }) });
    await expect(db.execute(sql`update journal_lines set debit = debit + 1`)).rejects.toEqual(dbError(/append-only/));
    await expect(db.execute(sql`delete from journal_entries`)).rejects.toEqual(dbError(/append-only/));
    await expect(db.execute(sql`delete from audit_logs`)).rejects.toEqual(dbError(/append-only/));
    const r = await reconcile();
    expect(r.mismatches).toHaveLength(0);
    expect(r.trialBalanceOk).toBe(true);
  });

  it('an unbalanced entry is rejected by the database at commit', async () => {
    await expect(
      db.transaction(async (tx) => {
        const [e] = await tx.execute<{ id: string }>(sql`insert into journal_entries (entry_type, source_type, source_id, idempotency_key, description) values ('X','test','x', ${randomUUID()}, 'bad') returning id`).then((r) => r.rows);
        const [acc] = (await tx.execute<{ id: string }>(sql`select id from ledger_accounts limit 1`)).rows;
        await tx.execute(sql`insert into journal_lines (entry_id, account_id, debit, credit) values (${e.id}, ${acc.id}, 100, 0)`);
      }),
    ).rejects.toEqual(expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringMatching(/unbalanced/) }) }));
  });

  it('EDGE 15 — a seller cannot read or act on another seller’s order', async () => {
    const { so } = await deliveredOrder();
    const other = await makeSeller(admin);
    await expect(sellerOrderForSeller(other.actor, so.id)).rejects.toThrow(/صلاحية/);
    await expect(confirmSellerOrder(other.actor, so.id)).rejects.toThrow(/صلاحية/);
    await expect(cancelSellerOrder(other.actor, so.id, 'محاولة غير مصرح بها')).rejects.toThrow(/صلاحية/);
    void orderItems;
  });
});
