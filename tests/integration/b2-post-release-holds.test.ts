import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { journalEntries, ledgerHealthChecks, refunds, sellerFinancialHolds, statusHistory, withdrawalRequests } from '@/server/db/schema';
import type { Actor } from '@/server/core/actor';
import { sellerActor } from '@/server/auth/actors';
import { financialInvariants } from '@/server/modules/finance/controls';
import { reconcile, sellerBalances } from '@/server/modules/finance/ledger';
import { runLedgerHealthCheck } from '@/server/modules/finance/ledger-health';
import { activeHoldsOf, openHold, releaseLapsedReturnHolds, sellerFundsPosition } from '@/server/modules/finance/holds';
import { approveWithdrawal, markWithdrawalFailedBeforeTransfer, markWithdrawalPaid, markWithdrawalProcessing, markWithdrawalTransferUncertain, rejectWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { sellerFinancialView } from '@/server/modules/finance/seller-wallet';
import { approveRefund, recordRefundPayout, rejectRefund, requestRefundTx } from '@/server/modules/finance/refunds';
import { openDispute, resolveDispute } from '@/server/modules/postpurchase/disputes';
import { rejectReturn, requestReturn } from '@/server/modules/postpurchase/returns';
import { runOneJob, SCHEDULE } from '@/server/jobs/worker';
import { SYSTEM_ACTOR } from '@/server/core/actor';
import { approveAndPayWithdrawal, checkout, ensurePaymentSetup, itemsOf, makeAdmin, makeCustomer, makeProduct, makerRequest, makeSeller, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * B2 — POST-RELEASE DISPUTE / RETURN FINANCIAL HOLD (P0 #5 of docs/audits/END_TO_END_TRUST_FRAUD_GAP_AUDIT.md).
 * A dispute/return opened after a seller's funds were released must never be bypassed by a withdrawal.
 */
let admin: Actor;
let checker: Actor;
let operator: Actor;
let officer: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  checker = await makeAdmin(['FINANCE_CHECKER']);
  operator = await makeAdmin(['FINANCE_OPERATOR']);
  officer = await makeAdmin(['DISPUTE_OFFICER']);
  await ensurePaymentSetup();
});
afterAll(async () => {
  await runLedgerHealthCheck('test-b2-teardown');
});

type Seller = Awaited<ReturnType<typeof makeSeller>>;
/** A paid, shipped, buyer-confirmed and Admin-RELEASED order of `seller` (funds now in SELLER_AVAILABLE). */
async function releasedOrder(seller: Seller, lines: { price: number; qty?: number }[]) {
  const c = await makeCustomer();
  const products = [];
  for (const l of lines) products.push(await makeProduct(seller.actor, admin, { price: l.price, stock: 20 }));
  const order = await checkout(c, products.map((p, i) => ({ variantId: p.variantId, qty: lines[i].qty ?? 1 })));
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(seller.actor, so.id);
  await receiveAndRelease(c.actor, so.id);
  return { c, so, products };
}
const sellerId = (s: Seller) => s.actor.sellerId!;
const pos = (s: Seller) => sellerFundsPosition(db, sellerId(s));
const holdsOf = (s: Seller) => db.select().from(sellerFinancialHolds).where(eq(sellerFinancialHolds.sellerId, sellerId(s)));
const dispute400 = (c: { actor: Actor }, soId: string, amount = '400') =>
  openDispute(c.actor, { sellerOrderId: soId, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج مختلف عن الوصف المعروض تماماً', claimedAmount: amount });
const withdraw = (s: Seller, amount: number) => requestWithdrawal(s.actor, { amount, clientKey: randomUUID() });
async function drainTo(s: Seller, keep: number) {
  const { available } = await sellerBalances(db, sellerId(s));
  if (available - keep > 0) {
    const { withdrawal } = await withdraw(s, available - keep);
    await approveAndPayWithdrawal(withdrawal.id, checker, operator);
  }
  expect((await sellerBalances(db, sellerId(s))).available).toBe(keep);
}
const journalCount = async () => Number((await db.execute<{ n: string }>(sql`select count(*)::text n from journal_entries`)).rows[0].n);

/* ═══════════════ Scenarios A–D: hold amount, secured vs unsecured ═══════════════ */

describe('B2 A–D: a post-release dispute/return encumbers exactly the affected amount', () => {
  it('1 · A: funds still available → the disputed 400 is held (secured); the rest stays withdrawable', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    const before = await pos(s);
    expect(before.held).toBe(0);
    const journals = await journalCount();
    const d = await dispute400(c, so.id);
    expect(await journalCount()).toBe(journals); // a hold posts NOTHING to the ledger
    const [h] = await holdsOf(s);
    expect(h).toMatchObject({ kind: 'DISPUTE', sourceId: d.id, disputeId: d.id, amount: 400_00, securedAtOpen: 400_00, unsecuredAtOpen: 0, status: 'ACTIVE' });
    const after = await pos(s);
    expect(after).toMatchObject({ available: before.available, held: 400_00, securedByAvailable: 400_00, securedByReservation: 0, unsecuredExposure: 0, withdrawable: before.available - 400_00 });
    expect((await sellerBalances(db, sellerId(s))).available).toBe(before.available); // the ledger balance is untouched
    await expect(withdraw(s, after.withdrawable + 100)).rejects.toThrow(/محجوز لنزاعات/);
    const { withdrawal } = await withdraw(s, after.withdrawable);
    await approveWithdrawal(checker, withdrawal.id);
    expect((await sellerBalances(db, sellerId(s))).available).toBe(400_00); // exactly the hold remains
  });

  it('2 + 15 · B: only 250 available → 250 secured + 150 unsecured; future funds stay encumbered', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    await drainTo(s, 250_00);
    await dispute400(c, so.id);
    const [h] = await holdsOf(s);
    expect(h).toMatchObject({ amount: 400_00, securedAtOpen: 250_00, unsecuredAtOpen: 150_00 });
    expect(await pos(s)).toMatchObject({ available: 250_00, held: 400_00, securedByAvailable: 250_00, securedByReservation: 0, unsecuredExposure: 150_00, withdrawable: 0 });
    await expect(withdraw(s, 100_00)).rejects.toThrow();
    // 15: future released funds cannot bypass the outstanding exposure.
    await releasedOrder(s, [{ price: 500_00 }]);
    const p = await pos(s);
    expect(p.unsecuredExposure).toBe(0);
    expect(p.withdrawable).toBe(p.available - 400_00);
    await expect(withdraw(s, p.withdrawable + 100)).rejects.toThrow();
    const { withdrawal } = await withdraw(s, p.withdrawable);
    await approveWithdrawal(checker, withdrawal.id);
    expect((await sellerBalances(db, sellerId(s))).available).toBe(400_00);
  });

  it('3 + 8 · C: already withdrawn → the whole exposure is UNSECURED; nothing is pretended held, refunded or moved', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    await drainTo(s, 0);
    const paid = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, sellerId(s)));
    expect(paid.every((w) => w.status === 'PAID')).toBe(true);
    const journals = await journalCount();
    await dispute400(c, so.id);
    expect(await journalCount()).toBe(journals);
    expect(await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id))).toHaveLength(0); // no fake refund
    const [h] = await holdsOf(s);
    expect(h).toMatchObject({ amount: 400_00, securedAtOpen: 0, unsecuredAtOpen: 400_00 });
    expect(await pos(s)).toMatchObject({ available: 0, held: 400_00, securedByAvailable: 0, securedByReservation: 0, unsecuredExposure: 400_00, withdrawable: 0 });
    expect((await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, sellerId(s)))).every((w) => w.status === 'PAID')).toBe(true); // completed withdrawal untouched
  });

  it('4 · D: a return of one item holds only that item, not the whole order', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 300_00 }, { price: 700_00 }]);
    const items = await itemsOf(so.id);
    const cheap = items.find((i) => i.unitPrice === 300_00)!;
    const ret = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'CHANGED_MIND', description: 'المقاس غير مناسب وأرغب في الإرجاع بحالته', items: [{ orderItemId: cheap.id, quantity: 1 }] });
    const [h] = await holdsOf(s);
    expect(h).toMatchObject({ kind: 'RETURN', returnId: ret.id, amount: 300_00 });
    const p = await pos(s);
    expect(p.held).toBe(300_00);
    expect(p.withdrawable).toBe(p.available - 300_00);
  });

  it('a dispute/return BEFORE release needs no hold (the release itself stays blocked)', async () => {
    const s = await makeSeller(admin);
    const c = await makeCustomer();
    const p = await makeProduct(s.actor, admin, { price: 400_00, stock: 5 });
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await dispute400(c, so.id, '100');
    expect(await holdsOf(s)).toHaveLength(0);
  });
});

/* ═══════════════ Scenario E/F: existing withdrawals and races ═══════════════ */

describe('B2 E–F: queued withdrawals are re-checked; arrival order cannot open a hole', () => {
  it('5 · E: a REQUESTED (unapproved) withdrawal cannot be approved over a later hold', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    const { available } = await sellerBalances(db, sellerId(s));
    const { withdrawal } = await withdraw(s, available);
    await dispute400(c, so.id);
    const journals = await journalCount();
    await expect(approveWithdrawal(checker, withdrawal.id)).rejects.toThrow(/لا يغطي|غير كافٍ/);
    expect(await journalCount()).toBe(journals);
    expect((await sellerBalances(db, sellerId(s))).reserved).toBe(0);
  });

  it('6 · E: Maker-approved (reserved) withdrawal + new dispute before the Checker pays → payout refused', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    const { available } = await sellerBalances(db, sellerId(s));
    const { withdrawal } = await withdraw(s, available);
    await approveWithdrawal(checker, withdrawal.id); // Maker: reserved
    await dispute400(c, so.id);
    // the reserved (not transferred) money backs the claim — reported as such, never as available or withdrawable…
    expect(await pos(s)).toMatchObject({ held: 400_00, securedByAvailable: 0, securedByReservation: 400_00, unsecuredExposure: 0, withdrawable: 0 });
    // …but it is exactly that backing, so it must not leave EDMN.
    const journals = await journalCount();
    await expect(markWithdrawalPaid(operator, withdrawal.id, 'REF-AFTER-DISPUTE')).rejects.toThrow(/غير مغطاة/);
    expect(await journalCount()).toBe(journals);
    expect((await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id)))[0].status).toBe('APPROVED');
  });

  it('7 · E: approved but not executed → starting the transfer is refused while exposure is unsecured; covered exposure lets it go', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    const { available } = await sellerBalances(db, sellerId(s));
    const { withdrawal } = await withdraw(s, available - 400_00);
    await approveWithdrawal(checker, withdrawal.id);
    await dispute400(c, so.id); // 400 still available → fully secured
    expect(await pos(s)).toMatchObject({ securedByAvailable: 400_00, unsecuredExposure: 0 });
    await markWithdrawalProcessing(operator, withdrawal.id); // allowed: the remaining available covers the hold
    const s2 = await makeSeller(admin);
    const o2 = await releasedOrder(s2, [{ price: 1000_00 }]);
    const { available: a2 } = await sellerBalances(db, sellerId(s2));
    const { withdrawal: w2 } = await withdraw(s2, a2);
    await approveWithdrawal(checker, w2.id);
    await dispute400(o2.c, o2.so.id);
    await expect(markWithdrawalProcessing(operator, w2.id)).rejects.toThrow(/غير مغطاة/);
    expect((await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w2.id)))[0].status).toBe('APPROVED');
  });

  it('E: a transfer already started (PROCESSING) can still be recorded as paid — the money may have left', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    const { available } = await sellerBalances(db, sellerId(s));
    const { withdrawal } = await withdraw(s, available);
    await approveWithdrawal(checker, withdrawal.id);
    await markWithdrawalProcessing(operator, withdrawal.id);
    await dispute400(c, so.id);
    await markWithdrawalPaid(operator, withdrawal.id, 'REF-IN-FLIGHT');
    expect((await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id)))[0].status).toBe('PAID');
    expect(await pos(s)).toMatchObject({ held: 400_00, securedByReservation: 0, unsecuredExposure: 400_00, withdrawable: 0 }); // money left: no backing
  });

  it('9 · F: concurrent withdrawal approval vs dispute opening → a consistent outcome either way', async () => {
    for (let round = 0; round < 3; round++) {
      const s = await makeSeller(admin);
      const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
      const { available } = await sellerBalances(db, sellerId(s));
      const { withdrawal } = await withdraw(s, available);
      const [appr, disp] = await Promise.allSettled([approveWithdrawal(checker, withdrawal.id), dispute400(c, so.id)]);
      expect(disp.status).toBe('fulfilled');
      const [h] = await holdsOf(s);
      const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id));
      if (appr.status === 'fulfilled') {
        // approval won the lock: nothing left to secure the hold, and the transfer cannot start
        expect(w.status).toBe('APPROVED');
        expect(h).toMatchObject({ amount: 400_00, securedAtOpen: 0, unsecuredAtOpen: 400_00 });
        await expect(markWithdrawalProcessing(operator, w.id)).rejects.toThrow(/غير مغطاة/);
      } else {
        // the dispute won: the approval saw the hold and refused
        expect(w.status).toBe('REQUESTED');
        expect(h).toMatchObject({ amount: 400_00, securedAtOpen: 400_00, unsecuredAtOpen: 0 });
      }
      const p = await pos(s);
      expect(p.available).toBeGreaterThanOrEqual(0);
    }
  });

  it('9 · F: concurrent transfer start vs dispute opening → the transfer never starts after the hold exists', async () => {
    for (let round = 0; round < 3; round++) {
      const s = await makeSeller(admin);
      const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
      const { available } = await sellerBalances(db, sellerId(s));
      const { withdrawal } = await withdraw(s, available);
      await approveWithdrawal(checker, withdrawal.id);
      const [proc] = await Promise.allSettled([markWithdrawalProcessing(operator, withdrawal.id), dispute400(c, so.id)]);
      const [h] = await holdsOf(s);
      if (proc.status === 'fulfilled') {
        const [t] = await db
          .select()
          .from(statusHistory)
          .where(and(eq(statusHistory.entityType, 'withdrawal'), eq(statusHistory.entityId, withdrawal.id), eq(statusHistory.toStatus, 'PROCESSING')))
          .orderBy(desc(statusHistory.id));
        expect(t.createdAt.getTime()).toBeLessThanOrEqual(h.createdAt.getTime());
        expect(h.unsecuredAtOpen).toBe(400_00); // recorded honestly as uncovered
      } else {
        expect((await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id)))[0].status).toBe('APPROVED');
      }
    }
  });
});

/* ═══════════════ Scenario G: duplicates and independence ═══════════════ */

describe('B2 G: duplicates are idempotent; independent cases stay independent', () => {
  it('10 + 19 · duplicate dispute requests (sequential and concurrent) create ONE dispute and ONE hold', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    const results = await Promise.allSettled([dispute400(c, so.id), dispute400(c, so.id), dispute400(c, so.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(dispute400(c, so.id)).rejects.toThrow();
    expect(await holdsOf(s)).toHaveLength(1);
    // A retried hold creation for the same source returns the same hold.
    const d = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value;
    const again = await db.transaction(async (tx) => openHold(tx, admin, { so: (await sellerOrdersOf(so.orderId))[0], kind: 'DISPUTE', sourceId: d.id, disputeId: d.id, requested: 400_00, reason: 'retry' }));
    expect((await holdsOf(s))[0].id).toBe(again!.id);
    expect(await holdsOf(s)).toHaveLength(1);
  });

  it('G · overlapping cases on one order never hold more than its released funds', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 300_00 }, { price: 700_00 }]);
    const items = await itemsOf(so.id);
    for (const it of items) await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'CHANGED_MIND', description: 'المقاس غير مناسب وأرغب في الإرجاع بحالته', items: [{ orderItemId: it.id, quantity: 1 }] });
    await dispute400(c, so.id, '5000');
    const [fresh] = await sellerOrdersOf(so.orderId);
    const released = (await sellerBalances(db, sellerId(s))).available;
    const holds = await holdsOf(s);
    expect(holds.reduce((n, h) => n + h.amount, 0)).toBeLessThanOrEqual(released);
    expect(fresh.id).toBe(so.id);
  });

  it('11 + 12 + 13 + 20 · independent disputes; seller-win releases only its hold; buyer-win converts then consumes only its case', async () => {
    const s = await makeSeller(admin);
    const o1 = await releasedOrder(s, [{ price: 600_00 }]);
    const o2 = await releasedOrder(s, [{ price: 800_00 }]);
    const d1 = await dispute400(o1.c, o1.so.id, '300');
    const d2 = await dispute400(o2.c, o2.so.id, '500');
    let holds = await holdsOf(s);
    expect(holds.map((h) => h.sourceId).sort()).toEqual([d1.id, d2.id].sort()); // 11: traceable, independent
    expect((await pos(s)).held).toBe(800_00);
    // 12: seller wins d1 → only d1's hold is released.
    await resolveDispute(officer, d1.id, { decision: 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'لا توجد أدلة كافية على الشكوى' });
    holds = await holdsOf(s);
    expect(holds.find((h) => h.disputeId === d1.id)!.status).toBe('RELEASED');
    expect(holds.find((h) => h.disputeId === d2.id)!.status).toBe('ACTIVE');
    expect((await pos(s)).held).toBe(500_00);
    // 13: buyer wins d2 (full refund) → d2's hold becomes exactly the refund's seller liability.
    const journals = await journalCount();
    await resolveDispute(officer, d2.id, { decision: 'FULL_REFUND', reasonCode: 'ITEM_NOT_AS_DESCRIBED', note: 'الأدلة تثبت اختلاف المنتج عن الوصف' });
    expect(await journalCount()).toBe(journals); // the decision moves no money
    const [r] = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'DISPUTE'), eq(refunds.sourceId, d2.id)));
    holds = await holdsOf(s);
    expect(holds.find((h) => h.disputeId === d2.id)!.status).toBe('CONVERTED');
    const refundHold = holds.find((h) => h.refundId === r.id)!;
    expect(refundHold).toMatchObject({ kind: 'REFUND', status: 'ACTIVE', amount: r.sellerLiability });
    const availBefore = (await sellerBalances(db, sellerId(s))).available;
    // 20: approval (Maker/Checker) books the liability and consumes the hold; it is NOT a transfer.
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد الاسترداد بقرار النزاع' });
    expect((await db.select().from(refunds).where(eq(refunds.id, r.id)))[0].status).toBe('APPROVED');
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `refund-paid:${r.id}`))).toHaveLength(0);
    expect((await holdsOf(s)).find((h) => h.refundId === r.id)!.status).toBe('CONSUMED');
    expect((await sellerBalances(db, sellerId(s))).available).toBe(availBefore - r.sellerLiability);
    expect((await pos(s)).held).toBe(0);
    await expect(recordRefundPayout(checker, r.id, 'REF-SAME-PERSON')).rejects.toThrow(); // payer ≠ approver
    await recordRefundPayout(operator, r.id, 'REF-REFUND-PAID');
    expect((await db.select().from(refunds).where(eq(refunds.id, r.id)))[0].status).toBe('COMPLETED');
  });

  it('14 · a partial decision holds only the decided allocation; the rest of the case hold is freed', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    const d = await dispute400(c, so.id);
    await resolveDispute(officer, d.id, { decision: 'PARTIAL_REFUND', amount: '150', reasonCode: 'PARTIAL_COMPENSATION', note: 'تعويض جزئي بعد مراجعة الأدلة المقدمة' });
    const [r] = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'DISPUTE'), eq(refunds.sourceId, d.id)));
    expect(r.amount).toBe(150_00);
    const holds = await holdsOf(s);
    expect(holds.find((h) => h.kind === 'DISPUTE')!.status).toBe('CONVERTED');
    expect(holds.find((h) => h.kind === 'REFUND')).toMatchObject({ status: 'ACTIVE', amount: r.sellerLiability });
    expect((await pos(s)).held).toBe(r.sellerLiability);
    expect(r.sellerLiability).toBeLessThanOrEqual(150_00);
    // A rejected refund releases its hold (nothing booked, nothing paid).
    await rejectRefund(checker, r.id, 'رفض الاسترداد بعد المراجعة');
    expect((await holdsOf(s)).find((h) => h.kind === 'REFUND')!.status).toBe('RELEASED');
    expect((await pos(s)).held).toBe(0);
  });

  it('H · a seller rejecting a return does not lift its hold; it lapses only after the escalation window', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 500_00 }]);
    const [it] = await itemsOf(so.id);
    const ret = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'CHANGED_MIND', description: 'المقاس غير مناسب وأرغب في الإرجاع بحالته', items: [{ orderItemId: it.id, quantity: 1 }] });
    await rejectReturn((await sellerActor(s.user.id))!, ret.id, 'المنتج تم استخدامه ولا يقبل الإرجاع');
    expect((await holdsOf(s))[0].status).toBe('ACTIVE');
    expect(await db.transaction((tx) => releaseLapsedReturnHolds(tx, SYSTEM_ACTOR))).toBe(0);
    await db.execute(sql`update seller_orders set delivered_at = now() - interval '400 days' where id = ${so.id}`);
    expect(await db.transaction((tx) => releaseLapsedReturnHolds(tx, SYSTEM_ACTOR))).toBe(1);
    expect((await holdsOf(s))[0].status).toBe('RELEASED');
  });
});

/* ═══════════ Reserved-withdrawal correction: R backs claims, never leaves while needed, facts are recorded ═══════════ */

describe('B2 R: an APPROVED (reserved, not transferred) withdrawal vs a later dispute / refund debt', () => {
  /** Seller with EXACTLY `keep` in SELLER_AVAILABLE, from one released order (the dispute target). */
  async function funded(keep = 1000_00) {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1600_00 }]);
    await drainTo(s, keep);
    return { s, c, so };
  }
  const wStatus = async (id: string) => (await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)))[0].status;
  const journalsOf = async (id: string, type: string) =>
    db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'withdrawal'), eq(journalEntries.sourceId, id), eq(journalEntries.entryType, type)));
  /** Buyer wins `amount` on dispute d; the refund is approved (Maker/Checker) → the seller liability is BOOKED. */
  async function buyerWins(dId: string, amount: string) {
    await resolveDispute(officer, dId, { decision: 'PARTIAL_REFUND', amount, reasonCode: 'PARTIAL_COMPENSATION', note: 'تعويض بعد مراجعة الأدلة المقدمة' });
    const [r] = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'DISPUTE'), eq(refunds.sourceId, dId)));
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد الاسترداد بقرار النزاع' });
    return r;
  }

  it('EXACT: 1000 available, 800 Maker-approved, 400 dispute → 200 by available + 200 by reservation; buyer win cannot release the reserve; full unwind; only the remainder is withdrawable', async () => {
    const { s, c, so } = await funded(1000_00);
    const { withdrawal: w } = await withdraw(s, 800_00);
    await approveWithdrawal(checker, w.id); // Maker: AVAILABLE → WITHDRAWAL_RESERVED
    expect(await sellerBalances(db, sellerId(s))).toMatchObject({ available: 200_00, reserved: 800_00 });
    const d = await dispute400(c, so.id);
    // 1 · partially backed by AVAILABLE and partially by the reservation; R counted once, never as available.
    expect(await pos(s)).toEqual({ available: 200_00, reservedNotStarted: 800_00, held: 400_00, securedByAvailable: 200_00, securedByReservation: 200_00, unsecuredExposure: 0, bookedDebt: 0, withdrawable: 0 });
    const view = (await sellerFinancialView(db, s.actor.userId!)).marketplace!;
    expect(view).toMatchObject({ available: 0, held: 200_00, reserved: 800_00, reservedBackingClaims: 200_00, disputeExposure: 0 });
    // 3 · reservation backing never becomes withdrawable.
    await expect(withdraw(s, 1)).rejects.toThrow();
    // the reserve is the backing → it cannot leave.
    await expect(markWithdrawalProcessing(operator, w.id)).rejects.toThrow(/غير مغطاة/);
    await expect(markWithdrawalPaid(operator, w.id, 'REF-R-1')).rejects.toThrow(/غير مغطاة/);
    // 4 · buyer wins 400: the refund approval books the real seller liability and CONSUMES the hold (H → 0).
    const r = await buyerWins(d.id, '400');
    const L = r.sellerLiability;
    expect(L).toBeGreaterThan(200_00); // the scenario really creates a debt (commission reversal included)
    expect(await pos(s)).toMatchObject({ available: 200_00 - L, held: 0, bookedDebt: L - 200_00, unsecuredExposure: 0, withdrawable: 0 });
    const journals = await journalCount();
    // the consumed hold is NOT a bypass: the reserve still covers the booked debt and must stay inside EDMN.
    await expect(markWithdrawalProcessing(operator, w.id)).rejects.toThrow(/مديونية/);
    await expect(markWithdrawalPaid(operator, w.id, 'REF-R-2')).rejects.toThrow(/مديونية/);
    expect(await wStatus(w.id)).toBe('APPROVED');
    expect(await journalCount()).toBe(journals);
    expect((await sellerBalances(db, sellerId(s))).reserved).toBe(800_00);
    // 6 · the existing full Maker/Checker reversal is the unwind (no automatic movement, no partial reduction).
    await makerRequest('WITHDRAWAL_REVERSAL', w.id, w.amount, { params: { mode: 'REJECT' } });
    await rejectWithdrawal(checker, w.id, 'السحب يغطي مديونية نزاع محسوم لصالح المشتري');
    expect(await wStatus(w.id)).toBe('REJECTED');
    expect(await journalsOf(w.id, 'WITHDRAWAL_REVERSAL')).toHaveLength(1);
    expect(await sellerBalances(db, sellerId(s))).toMatchObject({ available: 1000_00 - L, reserved: 0 });
    expect(await pos(s)).toEqual({ available: 1000_00 - L, reservedNotStarted: 0, held: 0, securedByAvailable: 0, securedByReservation: 0, unsecuredExposure: 0, bookedDebt: 0, withdrawable: 1000_00 - L });
    // the seller may only request the newly calculated remainder.
    await expect(withdraw(s, 1000_00 - L + 1)).rejects.toThrow();
    const { withdrawal: again } = await withdraw(s, 1000_00 - L);
    expect(again.amount).toBe(1000_00 - L);
  });

  it('2 + 3 · a hold fully backed by the reservation: reported as such, never withdrawable, transfer refused', async () => {
    const { s, c, so } = await funded(1000_00);
    const { withdrawal: w } = await withdraw(s, 1000_00);
    await approveWithdrawal(checker, w.id);
    await dispute400(c, so.id);
    expect(await pos(s)).toMatchObject({ available: 0, reservedNotStarted: 1000_00, held: 400_00, securedByAvailable: 0, securedByReservation: 400_00, unsecuredExposure: 0, withdrawable: 0 });
    await expect(withdraw(s, 1)).rejects.toThrow();
    await expect(markWithdrawalProcessing(operator, w.id)).rejects.toThrow(/غير مغطاة/);
    expect(await wStatus(w.id)).toBe('APPROVED');
  });

  it('5 · partial buyer win (150) after the reservation: AVAILABLE covers the claim → the transfer may proceed; no debt', async () => {
    const { s, c, so } = await funded(1000_00);
    const { withdrawal: w } = await withdraw(s, 800_00);
    await approveWithdrawal(checker, w.id);
    const d = await dispute400(c, so.id);
    await resolveDispute(officer, d.id, { decision: 'PARTIAL_REFUND', amount: '150', reasonCode: 'PARTIAL_COMPENSATION', note: 'تعويض جزئي بعد مراجعة الأدلة المقدمة' });
    const [r] = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'DISPUTE'), eq(refunds.sourceId, d.id)));
    expect(await pos(s)).toMatchObject({ available: 200_00, held: r.sellerLiability, securedByAvailable: r.sellerLiability, securedByReservation: 0, unsecuredExposure: 0 });
    await markWithdrawalProcessing(operator, w.id); // the 800 is not needed: AVAILABLE covers the 150 claim
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد الاسترداد الجزئي' });
    expect(await pos(s)).toMatchObject({ available: 200_00 - r.sellerLiability, held: 0, bookedDebt: 0 });
    await markWithdrawalPaid(operator, w.id, 'REF-R-150');
    expect(await wStatus(w.id)).toBe('PAID');
  });

  it('7 + 10 + 11 · PROCESSING, then a refund debt: the confirmed transfer is recorded PAID exactly once; debt, holds and AVAILABLE untouched', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1600_00 }]);
    const other = await releasedOrder(s, [{ price: 500_00 }]); // an unrelated case on another order
    await drainTo(s, 1000_00);
    const { withdrawal: w } = await withdraw(s, 800_00);
    await approveWithdrawal(checker, w.id);
    await markWithdrawalProcessing(operator, w.id); // started while everything was covered
    const d = await dispute400(c, so.id);
    const unrelated = await dispute400(other.c, other.so.id, '100');
    // money may have left → the reservation is NOT backing.
    expect(await pos(s)).toMatchObject({ reservedNotStarted: 0, securedByReservation: 0 });
    const r = await buyerWins(d.id, '400');
    const before = await pos(s);
    expect(before.available).toBe(200_00 - r.sellerLiability);
    expect(before.bookedDebt).toBe(r.sellerLiability - 200_00); // a real booked debt exists before the fact is recorded
    const unrelatedHold = (await holdsOf(s)).find((h) => h.disputeId === unrelated.id)!;
    expect(unrelatedHold.status).toBe('ACTIVE');
    // duplicate callbacks / reconciliation retries, concurrently and sequentially → one fact, one entry.
    const results = await Promise.allSettled([markWithdrawalPaid(operator, w.id, 'REF-P-1'), markWithdrawalPaid(operator, w.id, 'REF-P-1')]);
    expect(results.some((x) => x.status === 'fulfilled')).toBe(true);
    await markWithdrawalPaid(operator, w.id, 'REF-P-1');
    expect(await wStatus(w.id)).toBe('PAID');
    expect(await journalsOf(w.id, 'WITHDRAWAL_PAID')).toHaveLength(1);
    // recording the fact moved only this withdrawal's own reservation: no debt cleared, no hold touched, no new entitlement.
    expect(await pos(s)).toEqual({ ...before, reservedNotStarted: 0 });
    expect((await sellerBalances(db, sellerId(s))).reserved).toBe(0);
    expect((await holdsOf(s)).find((h) => h.id === unrelatedHold.id)).toMatchObject({ status: 'ACTIVE', amount: unrelatedHold.amount });
    // and no NEW money can be sent while the debt exists.
    await expect(withdraw(s, 1)).rejects.toThrow();
  });

  it('8 + 10 · TRANSFER_UNCERTAIN, then a refund debt: reconciliation confirms the transfer → PAID recorded exactly once', async () => {
    const { s, c, so } = await funded(1000_00);
    const { withdrawal: w } = await withdraw(s, 800_00);
    await approveWithdrawal(checker, w.id);
    await markWithdrawalProcessing(operator, w.id);
    await markWithdrawalTransferUncertain(operator, w.id, 'مهلة مزود الدفع بدون نتيجة واضحة');
    const d = await dispute400(c, so.id);
    const r = await buyerWins(d.id, '400');
    const before = await pos(s);
    expect(before.bookedDebt).toBe(r.sellerLiability - 200_00);
    await markWithdrawalPaid(operator, w.id, 'REF-U-1');
    await markWithdrawalPaid(operator, w.id, 'REF-U-1');
    expect(await wStatus(w.id)).toBe('PAID');
    expect(await journalsOf(w.id, 'WITHDRAWAL_PAID')).toHaveLength(1);
    expect(await pos(s)).toEqual({ ...before, reservedNotStarted: 0 });
  });

  it('9 · TRANSFER_UNCERTAIN confirmed NOT sent: the authorized resolution returns the reservation and covers the debt', async () => {
    const { s, c, so } = await funded(1000_00);
    const { withdrawal: w } = await withdraw(s, 800_00);
    await approveWithdrawal(checker, w.id);
    await markWithdrawalProcessing(operator, w.id);
    await markWithdrawalTransferUncertain(operator, w.id, 'مهلة مزود الدفع بدون نتيجة واضحة');
    const d = await dispute400(c, so.id);
    const r = await buyerWins(d.id, '400');
    await makerRequest('WITHDRAWAL_REVERSAL', w.id, w.amount, { params: { mode: 'FAILED_BEFORE_TRANSFER' } });
    await markWithdrawalFailedBeforeTransfer(checker, w.id, { reason: 'المزود أكد رفض التحويل', evidence: 'PROVIDER-REJECT-77' });
    await markWithdrawalFailedBeforeTransfer(checker, w.id, { reason: 'المزود أكد رفض التحويل', evidence: 'PROVIDER-REJECT-77' }); // idempotent
    expect(await wStatus(w.id)).toBe('FAILED_BEFORE_TRANSFER');
    expect(await journalsOf(w.id, 'WITHDRAWAL_REVERSAL')).toHaveLength(1);
    expect(await sellerBalances(db, sellerId(s))).toMatchObject({ available: 1000_00 - r.sellerLiability, reserved: 0 });
    expect(await pos(s)).toMatchObject({ bookedDebt: 0, held: 0, withdrawable: 1000_00 - r.sellerLiability });
    await expect(markWithdrawalPaid(operator, w.id, 'REF-LATE')).rejects.toThrow(); // a closed outcome cannot flip to PAID
  });

  it('12 · the books stay balanced after every reserved-withdrawal path', async () => {
    const rec = await reconcile(db);
    expect(rec.mismatches).toHaveLength(0);
    expect(rec.trialBalanceOk).toBe(true);
    expect((await financialInvariants(db)).totals.difference).toBe(0);
  });
});

/* ═══════════════ Integrity, B1 gates, retries ═══════════════ */

describe('B2 integrity: holds are append-only evidence; B1 gates still fail closed', () => {
  it('holds cannot be deleted, re-amounted or re-opened (DB)', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    await dispute400(c, so.id);
    const [h] = await holdsOf(s);
    await expect(db.execute(sql`delete from seller_financial_holds where id = ${h.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update seller_financial_holds set amount = 1 where id = ${h.id}`)).rejects.toThrow();
    await db.execute(sql`update seller_financial_holds set status = 'RELEASED', closed_at = now() where id = ${h.id}`);
    await expect(db.execute(sql`update seller_financial_holds set status = 'ACTIVE', closed_at = null where id = ${h.id}`)).rejects.toThrow();
  });

  it('16 · B1 ledger-health gate still blocks withdrawal approval when health is missing / stale', async () => {
    const s = await makeSeller(admin);
    await releasedOrder(s, [{ price: 1000_00 }]);
    const { withdrawal } = await withdraw(s, 200_00);
    const replace = async (rows: { checkedAt: Date }[]) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`alter table ledger_health_checks disable trigger user`);
        await tx.execute(sql`delete from ledger_health_checks`);
        for (const r of rows) await tx.insert(ledgerHealthChecks).values({ status: 'OK', debits: 0, credits: 0, difference: 0, criticalChecks: [], warningChecks: [], trigger: 'test-b2', checkedAt: r.checkedAt });
        await tx.execute(sql`alter table ledger_health_checks enable trigger user`);
      });
    try {
      await replace([]);
      await expect(approveWithdrawal(checker, withdrawal.id)).rejects.toThrow(/سلامة دفتر الأستاذ/);
      await replace([{ checkedAt: new Date(Date.now() - 3 * 3600_000) }]);
      await expect(approveWithdrawal(checker, withdrawal.id)).rejects.toThrow(/سلامة دفتر الأستاذ/);
    } finally {
      await runLedgerHealthCheck('test-b2-restore');
    }
    await approveWithdrawal(checker, withdrawal.id);
  });

  it('17 · B1 kill switch still fails closed (ambiguous value = paused)', async () => {
    const s = await makeSeller(admin);
    await releasedOrder(s, [{ price: 1000_00 }]);
    const { withdrawal } = await withdraw(s, 200_00);
    await db.execute(sql`update system_settings set value = '"false"'::jsonb where key = 'killswitch.withdrawals'`);
    try {
      await expect(approveWithdrawal(checker, withdrawal.id)).rejects.toThrow(/موقوف مؤقتًا/);
    } finally {
      await db.execute(sql`update system_settings set value = 'false'::jsonb where key = 'killswitch.withdrawals'`);
    }
    await approveWithdrawal(checker, withdrawal.id);
  });

  it('19 · worker passes and a retried refund request never duplicate holds', async () => {
    const s = await makeSeller(admin);
    const { c, so } = await releasedOrder(s, [{ price: 1000_00 }]);
    await dispute400(c, so.id);
    const before = (await holdsOf(s)).map((h) => `${h.id}:${h.status}`);
    for (let pass = 0; pass < 2; pass++) {
      for (const job of SCHEDULE) await job.run();
      while (await runOneJob()) { /* drain */ }
    }
    expect((await holdsOf(s)).map((h) => `${h.id}:${h.status}`)).toEqual(before);
    const src = randomUUID();
    const make = () => db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: src, principalAmount: 50_00, reason: 'تعويض إداري' }));
    const r1 = await make();
    const r2 = await make();
    expect(r2.id).toBe(r1.id);
    expect((await holdsOf(s)).filter((h) => h.refundId === r1.id)).toHaveLength(1);
  });

  it('18 · the books stay balanced and every projection reconciles', async () => {
    const inv = await financialInvariants(db);
    expect(inv.totals.difference).toBe(0);
    const rec = await reconcile(db);
    expect(rec.mismatches).toHaveLength(0);
    expect(rec.trialBalanceOk).toBe(true);
    expect((await runLedgerHealthCheck('test-b2-final')).status).not.toBe('CRITICAL');
    // No hold ever references a non-released order or carries an inconsistent split.
    const bad = await db.execute(sql`select h.id from seller_financial_holds h join seller_orders so on so.id = h.seller_order_id where so.funds_released_at is null`);
    expect(bad.rows).toHaveLength(0);
    const all = await activeHoldsOf(db, (await db.select().from(sellerFinancialHolds).limit(1))[0].sellerId);
    expect(Array.isArray(all)).toBe(true);
  });
});
