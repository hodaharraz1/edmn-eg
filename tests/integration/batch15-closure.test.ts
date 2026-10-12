import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { adminActor, customerActor, sellerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { auditLogs, dealPayouts, externalDeals, journalEntries, notifications, receivingDestinations, sellerOrders, userIdentityVerifications, withdrawalAllocations, withdrawalRequests } from '@/server/db/schema';
import { runAlertSweep } from '@/server/modules/alerts/engine';
import { cancelSellerOrder, confirmSellerOrder, markShipped, saveShipment, submitDeliveryEvidence } from '@/server/modules/commerce/fulfilment';
import { claimInvitation, confirmDealReceipt, createDeal, dealGraph, deliveryOtpForBuyer, inviteSeller, markDealDelivered, releaseDeal, respondToOffer, saveDealStep, startDealPayment, submitSellerOffer, verifyDeliveryOtp } from '@/server/modules/deals/service';
import { financialInvariants } from '@/server/modules/finance/controls';
import { accountBalance, reconcile } from '@/server/modules/finance/ledger';
import { approveRefund, recordRefundPayout, requestRefundTx } from '@/server/modules/finance/refunds';
import { sellerFinancialView } from '@/server/modules/finance/seller-wallet';
import {
  approveWithdrawal,
  createAdjustment,
  decideAdjustment,
  markDealPayoutPaid,
  markWithdrawalFailedBeforeTransfer,
  markWithdrawalPaid,
  markWithdrawalProcessing,
  markWithdrawalTransferUncertain,
  recordWithdrawalReturned,
  rejectWithdrawal,
  requestAccountWithdrawal,
  requestWithdrawal,
  revealPayoutDetails,
} from '@/server/modules/finance/withdrawals';
import { reviewReceivingDestination, submitReceivingDestination } from '@/server/modules/identity/receiving';
import { mapLegacySellerIdentities, reviewIdentity, submitIdentity } from '@/server/modules/identity/service';
import { openSellerOrderConversation, sendMessage } from '@/server/modules/messaging/service';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { addDisputeMessage, openDispute } from '@/server/modules/postpurchase/disputes';
import { approveReturn, requestReturn } from '@/server/modules/postpurchase/returns';
import { addPayoutMethod, saveIdentity, startApplication, uploadSellerDocument } from '@/server/modules/sellers/service';
import { openTicket } from '@/server/modules/support/service';
import { submitForReview } from '@/server/modules/catalog/products';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makerRequest, makeSeller, makeUser, pdf, png, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * BATCH 1.5 CLOSURE — cross-source seller withdrawal (allocation-attributed), Protected Deal seller payout
 * destination verification, KYC existing-obligation safety, stranded balances, alert concurrency.
 */

let admin: Actor;
let checker: Actor;
let operator: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  checker = await makeAdmin(['FINANCE_CHECKER']);
  operator = await makeAdmin(['FINANCE_OPERATOR']);
  await ensurePaymentSetup();
});
afterEach(() => vi.restoreAllMocks());

const LOC = { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 };
const allocs = async (wId: string) => db.select().from(withdrawalAllocations).where(eq(withdrawalAllocations.withdrawalId, wId)).orderBy(withdrawalAllocations.seq);
const wdOf = async (id: string) => (await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)))[0];
const payoutOf = async (dealId: string) => (await db.select().from(dealPayouts).where(eq(dealPayouts.dealId, dealId)))[0];
const platform = (code: 'DEAL_PAYOUTS_PAYABLE' | 'DEAL_PAYOUTS_RESERVED') => accountBalance(db, { code });
const failing = async () => (await financialInvariants()).checks.filter((c) => c.count > 0).map((c) => `${c.code}:${JSON.stringify(c.sample).slice(0, 200)}`);

/** A completed Protected Deal (two-person release) whose payout is PAYABLE to `seller`. */
async function payableDeal(seller: Actor, price = '1000') {
  const buyer = customerActor((await makeUser()).id);
  const deal = await createDeal(buyer, { title: 'جهاز للصفقة', description: 'جهاز بحالة جيدة جداً مع الشاحن', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: price });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  await claimInvitation(seller, token);
  const { version } = await submitSellerOffer(
    seller,
    deal.id,
    { details: { fullName: 'بائع الصفقة' }, location: LOC, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'typed@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
    true,
  );
  await respondToOffer(buyer, deal.id, version, 'ACCEPT');
  const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
  const { submission } = await submitProof(buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  await confirmPayment(admin, p.id, submission.id);
  await markDealDelivered(seller, deal.id, 'تم التسليم', [{ data: pdf(), name: 'w.pdf' }]);
  const view = await deliveryOtpForBuyer(buyer, deal.id);
  await verifyDeliveryOtp(seller, deal.id, view!.testCode!);
  await confirmDealReceipt(buyer, deal.id);
  const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
  const payout = d.buyerPays! - Math.min(d.feeAmount, d.buyerPays!);
  await makerRequest('DEAL_RELEASE', deal.id, payout);
  await releaseDeal(checker, deal.id, { expectedPayout: payout, reason: 'إتاحة بعد تأكيد المشتري' });
  return { dealId: deal.id, payout: await payoutOf(deal.id), buyer };
}

/** Verified user-level payout destination («بيانات استلام الأموال», InstaPay). */
async function verifiedDestination(user: Actor, address = `pd${randomUUID().slice(0, 6)}@instapay`) {
  const d = await submitReceivingDestination(user, { type: 'INSTAPAY', holderName: 'مستخدم اختبار ثلاثي الاسم', instapayAddress: address });
  await reviewReceivingDestination(checker, d.id, 'APPROVE', { holderMatchesIdentity: true });
  return d;
}

/** A store with Marketplace available funds (released, two-person). */
async function storeWithAvailable(price = 600_00) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await receiveAndRelease(c.actor, so.id);
  return { s, so, c, user: customerActor(s.user.id) };
}

/* ═══════════════════════════ Cross-source withdrawal ═══════════════════════════ */
describe('cross-source withdrawal — allocation is deterministic, stored, and followed at every step', () => {
  it('A — Marketplace-only (store context): one MARKETPLACE allocation, ledger and sum exact', async () => {
    const { s } = await storeWithAvailable();
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '200', clientKey: randomUUID() });
    expect(withdrawal.sourceType).toBe('MARKETPLACE');
    expect(await allocs(withdrawal.id)).toHaveLength(0); // a request reserves and allocates nothing
    await approveWithdrawal(checker, withdrawal.id);
    const a = await allocs(withdrawal.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ sourceType: 'MARKETPLACE', sourceEntityType: 'seller_account', sourceEntityId: s.actor.sellerId, sellerId: s.actor.sellerId, amount: 200_00, status: 'RESERVED' });
    expect(a[0].reservationJournalId).toBeTruthy();
    expect(a[0].userId).toBe(s.user.id);
    await markWithdrawalPaid(operator, withdrawal.id, 'REF-A');
    expect((await allocs(withdrawal.id))[0]).toMatchObject({ status: 'PAID' });
    expect((await allocs(withdrawal.id))[0].payoutJournalId).toBeTruthy();
    expect(await failing()).toEqual([]);
  });

  it('B — Protected-Deal-only seller (no store): oldest payable deal first, partial second, attribution per deal', async () => {
    const seller = customerActor((await makeUser()).id);
    const d1 = await payableDeal(seller, '1000');
    const d2 = await payableDeal(seller, '1500');
    const dest = await verifiedDestination(seller);
    const amount = d1.payout.amount + Math.floor(d2.payout.amount / 2);
    const payable0 = await platform('DEAL_PAYOUTS_PAYABLE');
    const { withdrawal } = await requestAccountWithdrawal(seller, { amount, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: dest.id } });
    expect(withdrawal.sellerId).toBeNull();
    expect(withdrawal.sourceType).toBe('PROTECTED_DEAL');
    await approveWithdrawal(checker, withdrawal.id);
    const a = await allocs(withdrawal.id);
    expect(a.map((x) => [x.sourceType, x.dealId, x.amount])).toEqual([
      ['PROTECTED_DEAL', d1.dealId, d1.payout.amount],
      ['PROTECTED_DEAL', d2.dealId, amount - d1.payout.amount],
    ]);
    expect(await platform('DEAL_PAYOUTS_PAYABLE')).toBe(payable0 - amount);
    expect(await platform('DEAL_PAYOUTS_RESERVED')).toBeGreaterThanOrEqual(amount);
    expect(await failing()).toEqual([]);
    await markWithdrawalPaid(operator, withdrawal.id, 'REF-B');
    expect((await payoutOf(d1.dealId)).status).toBe('PAID'); // fully paid through the withdrawal
    expect((await payoutOf(d2.dealId)).status).toBe('PENDING'); // half still payable
    const v = await sellerFinancialView(db, seller.userId!);
    expect(v.marketplace).toBeNull();
    expect(v.protectedDeal!.available).toBe(d2.payout.amount - (amount - d1.payout.amount));
    expect(v.protectedDeal!.paidOut).toBe(amount);
    expect(await failing()).toEqual([]);
  });

  it('C — mixed: Protected Deal funds first, then Marketplace; the store payout method only; sum == amount', async () => {
    const { s, user } = await storeWithAvailable(600_00);
    const deal = await payableDeal(user, '400');
    const mpAvail = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    const amount = deal.payout.amount + Math.floor(mpAvail / 2);
    const { withdrawal } = await requestAccountWithdrawal(user, { amount, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
    expect(withdrawal.sourceType).toBe('MIXED');
    expect(withdrawal.sellerId).toBe(s.actor.sellerId);
    await approveWithdrawal(checker, withdrawal.id);
    const a = await allocs(withdrawal.id);
    expect(a.map((x) => [x.seq, x.sourceType, x.amount])).toEqual([
      [1, 'PROTECTED_DEAL', deal.payout.amount],
      [2, 'MARKETPLACE', amount - deal.payout.amount],
    ]);
    expect(a.reduce((n, x) => n + x.amount, 0)).toBe(amount);
    expect((await wdOf(withdrawal.id)).sourceType).toBe('MIXED');
    // one balanced reservation journal, one leg pair per allocation
    const [j] = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd:${withdrawal.id}`));
    const lines = await db.execute<{ code: string; debit: string; credit: string }>(sql`select a.code, l.debit::text, l.credit::text from journal_lines l join ledger_accounts a on a.id = l.account_id where l.entry_id = ${j.id} order by a.code`);
    expect(lines.rows).toEqual(expect.arrayContaining([
      { code: 'DEAL_PAYOUTS_PAYABLE', debit: String(deal.payout.amount), credit: '0' },
      { code: 'DEAL_PAYOUTS_RESERVED', debit: '0', credit: String(deal.payout.amount) },
      { code: 'SELLER_AVAILABLE', debit: String(amount - deal.payout.amount), credit: '0' },
      { code: 'SELLER_WITHDRAWAL_RESERVED', debit: '0', credit: String(amount - deal.payout.amount) },
    ]));
    // a user-level receiving destination never carries Marketplace funds
    const dest = await verifiedDestination(user);
    await expect(requestAccountWithdrawal(user, { amount: mpAvail, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: dest.id } })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await markWithdrawalPaid(operator, withdrawal.id, 'REF-C');
    const v = await sellerFinancialView(db, s.user.id);
    expect(v.protectedDeal!.paidOut).toBe(deal.payout.amount);
    expect(v.marketplace!.paidOut).toBeGreaterThanOrEqual(amount - deal.payout.amount);
    expect(await failing()).toEqual([]);
  });

  it('D — insufficient combined balance: refused at request and re-checked at approval', async () => {
    const { s, user } = await storeWithAvailable(300_00);
    const deal = await payableDeal(user, '300');
    const mp = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    await expect(requestAccountWithdrawal(user, { amount: deal.payout.amount + mp + 1, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    // valid at request, insufficient at approval (funds used meanwhile) → refused, nothing reserved
    const w1 = await requestAccountWithdrawal(user, { amount: deal.payout.amount + mp - 100, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
    const w2 = await requestAccountWithdrawal(user, { amount: deal.payout.amount + mp - 100, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
    await approveWithdrawal(checker, w1.withdrawal.id);
    await expect(approveWithdrawal(checker, w2.withdrawal.id)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(await allocs(w2.withdrawal.id)).toHaveLength(0);
  });

  it('E — retry: same client key = same request; approval and payout post exactly once', async () => {
    const seller = customerActor((await makeUser()).id);
    const deal = await payableDeal(seller, '800');
    const dest = await verifiedDestination(seller);
    const key = randomUUID();
    const a = await requestAccountWithdrawal(seller, { amount: deal.payout.amount, clientKey: key, destination: { kind: 'RECEIVING_DESTINATION', id: dest.id } });
    const b = await requestAccountWithdrawal(seller, { amount: deal.payout.amount, clientKey: key, destination: { kind: 'RECEIVING_DESTINATION', id: dest.id } });
    expect(b).toMatchObject({ created: false });
    expect(b.withdrawal.id).toBe(a.withdrawal.id);
    await approveWithdrawal(checker, a.withdrawal.id);
    await approveWithdrawal(checker, a.withdrawal.id);
    expect(await allocs(a.withdrawal.id)).toHaveLength(1);
    await markWithdrawalPaid(operator, a.withdrawal.id, 'REF-E');
    await markWithdrawalPaid(operator, a.withdrawal.id, 'REF-E');
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd-paid:${a.withdrawal.id}`))).toHaveLength(1);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd:${a.withdrawal.id}`))).toHaveLength(1);
  });

  it('F — concurrent approvals of two withdrawals over the same sources: exactly one reserves', async () => {
    const { s, user } = await storeWithAvailable(500_00);
    const deal = await payableDeal(user, '500');
    const total = deal.payout.amount + (await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! }));
    const amount = Math.floor(total * 0.7);
    const w1 = await requestAccountWithdrawal(user, { amount, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
    const w2 = await requestAccountWithdrawal(user, { amount, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
    const r = await Promise.allSettled([approveWithdrawal(checker, w1.withdrawal.id), approveWithdrawal(await makeAdmin(['FINANCE_CHECKER']), w2.withdrawal.id)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const allocated = (await allocs(w1.withdrawal.id)).length + (await allocs(w2.withdrawal.id)).length;
    expect(allocated).toBeGreaterThan(0);
    expect(await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! })).toBeGreaterThanOrEqual(0);
    expect(await failing()).toEqual([]);
  });

  it('G — failed before transfer: every allocation restored to its own source, exactly once', async () => {
    const { s, user } = await storeWithAvailable(500_00);
    const deal = await payableDeal(user, '300');
    const mp0 = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    const payable0 = await platform('DEAL_PAYOUTS_PAYABLE');
    const amount = deal.payout.amount + 100_00;
    const { withdrawal } = await requestAccountWithdrawal(user, { amount, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
    await approveWithdrawal(checker, withdrawal.id);
    await markWithdrawalProcessing(operator, withdrawal.id);
    await makerRequest('WITHDRAWAL_REVERSAL', withdrawal.id, amount, { params: { mode: 'FAILED_BEFORE_TRANSFER' } });
    await markWithdrawalFailedBeforeTransfer(checker, withdrawal.id, { reason: 'كشف الحساب يؤكد عدم خروج التحويل', evidence: 'STMT-G' });
    await markWithdrawalFailedBeforeTransfer(checker, withdrawal.id, { reason: 'إعادة المحاولة', evidence: 'STMT-G' });
    const a = await allocs(withdrawal.id);
    expect(a.map((x) => [x.sourceType, x.status, x.restoredAmount])).toEqual([
      ['PROTECTED_DEAL', 'RELEASED', deal.payout.amount],
      ['MARKETPLACE', 'RELEASED', 100_00],
    ]);
    expect(await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! })).toBe(mp0);
    expect(await platform('DEAL_PAYOUTS_PAYABLE')).toBe(payable0);
    expect((await payoutOf(deal.dealId)).status).toBe('PENDING');
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd-reverse:${withdrawal.id}`))).toHaveLength(1);
    expect(await failing()).toEqual([]);
  });

  it('H — uncertain transfer: every allocation stays RESERVED; nothing returns, nothing is paid', async () => {
    const { s, user } = await storeWithAvailable(500_00);
    const deal = await payableDeal(user, '300');
    const amount = deal.payout.amount + 100_00;
    const { withdrawal } = await requestAccountWithdrawal(user, { amount, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
    await approveWithdrawal(checker, withdrawal.id);
    await markWithdrawalProcessing(operator, withdrawal.id);
    const reserved = await accountBalance(db, { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: s.actor.sellerId! });
    await markWithdrawalTransferUncertain(operator, withdrawal.id, 'انقطع الاتصال بالبنك أثناء التحويل');
    expect((await allocs(withdrawal.id)).every((x) => x.status === 'RESERVED')).toBe(true);
    expect(await accountBalance(db, { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: s.actor.sellerId! })).toBe(reserved);
    expect((await payoutOf(deal.dealId)).status).toBe('PENDING');
    await expect(rejectWithdrawal(checker, withdrawal.id, 'غير مؤكد')).rejects.toThrow(/بدأ التحويل بالفعل/);
    expect(await failing()).toEqual([]);
  });

  it('I — returned payout: restored per original allocation (allocation order), compensating entry, destination re-verified', async () => {
    const seller = customerActor((await makeUser()).id);
    const d1 = await payableDeal(seller, '600');
    const d2 = await payableDeal(seller, '600');
    const dest = await verifiedDestination(seller);
    const amount = d1.payout.amount + d2.payout.amount;
    const { withdrawal } = await requestAccountWithdrawal(seller, { amount, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: dest.id } });
    await approveWithdrawal(checker, withdrawal.id);
    await markWithdrawalPaid(operator, withdrawal.id, 'REF-I');
    const paid = await wdOf(withdrawal.id);
    const [paidJournal] = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd-paid:${withdrawal.id}`));
    expect((await payoutOf(d1.dealId)).status).toBe('PAID');
    const back = paid.netTransferAmount!;
    await makerRequest('WITHDRAWAL_RETURN', withdrawal.id, back);
    await recordWithdrawalReturned(checker, withdrawal.id, { amount: back, reference: 'RET-I', reason: 'الحساب مغلق لدى البنك' });
    await recordWithdrawalReturned(checker, withdrawal.id, { amount: back, reference: 'RET-I', reason: 'تكرار' });
    const a = await allocs(withdrawal.id);
    expect(a[0]).toMatchObject({ status: 'RETURNED', restoredAmount: Math.min(back, d1.payout.amount) });
    expect(a[1]).toMatchObject({ status: 'RETURNED', restoredAmount: back - Math.min(back, d1.payout.amount) });
    expect((await payoutOf(d1.dealId)).status).toBe('PENDING'); // payable again
    expect((await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `wd-paid:${withdrawal.id}`)))[0]).toEqual(paidJournal);
    const [rd] = await db.select().from(receivingDestinations).where(eq(receivingDestinations.id, dest.id));
    expect(rd.status).toBe('REVERIFICATION_REQUIRED');
    expect(await failing()).toEqual([]);
  });

  it('J — a store liability blocks every withdrawal of its owner; Protected Deal provenance stays intact', async () => {
    const { s, so, user } = await storeWithAvailable(300_00);
    const deal = await payableDeal(user, '500');
    const avail = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: 290_00, reason: 'تعويض بعد الإتاحة' }));
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(await makeAdmin(['FINANCE_CHECKER']), r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    const after = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    expect(after).toBeLessThan(avail);
    if (after < 0) {
      const dest = await verifiedDestination(user);
      await expect(requestAccountWithdrawal(user, { amount: 100_00, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: dest.id } })).rejects.toThrow(/مديونية/);
      const v = await sellerFinancialView(db, s.user.id);
      expect(v.marketplace!.liability).toBe(-after);
      expect(v.protectedDeal!.available).toBe(deal.payout.amount); // never netted against the store debt
    }
    expect((await payoutOf(deal.dealId)).status).toBe('PENDING');
    expect(await failing()).toEqual([]);
  });
});

/* ═══════════════════════════ Protected Deal seller payout destination ═══════════════════════════ */
describe('Protected Deal seller payout destination — verified, fingerprinted, never the typed offer details', () => {
  it('no store: unverified → blocked; verified → paid; change invalidates; old snapshot unchanged; least privilege', async () => {
    const seller = customerActor((await makeUser()).id);
    const d1 = await payableDeal(seller, '700');
    const d2 = await payableDeal(seller, '700');
    expect(await db.execute(sql`select 1 from sellers where owner_user_id = ${seller.userId}`).then((r) => r.rows)).toHaveLength(0);
    // direct payout to the typed offer destination is closed
    await expect(markDealPayoutPaid(operator, d1.payout.id, 'REF-DIRECT')).rejects.toThrow(/متحقق منها/);
    // unverified destination → refused
    const pending = await submitReceivingDestination(seller, { type: 'INSTAPAY', holderName: 'مستخدم اختبار ثلاثي الاسم', instapayAddress: 'first@instapay' });
    expect(pending.status).toBe('PENDING_REVIEW');
    await expect(requestAccountWithdrawal(seller, { amount: d1.payout.amount, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: pending.id } })).rejects.toThrow(/غير متحقق/);
    // only an authorized verifier, with fresh 2FA
    await expect(reviewReceivingDestination(await makeAdmin(['CUSTOMER_SUPPORT']), pending.id, 'APPROVE', { holderMatchesIdentity: true })).rejects.toThrow();
    await expect(reviewReceivingDestination(await adminActor(checker.userId!, { stepUpAt: null }), pending.id, 'APPROVE', { holderMatchesIdentity: true })).rejects.toThrow(/تأكيد هويتك/);
    await reviewReceivingDestination(checker, pending.id, 'APPROVE', { holderMatchesIdentity: true });
    const [verified] = await db.select().from(receivingDestinations).where(eq(receivingDestinations.id, pending.id));
    expect(verified).toMatchObject({ status: 'APPROVED', reviewedBy: checker.userId });
    expect(verified.reviewedAt).not.toBeNull();
    expect(verified.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // IDOR: another user's verified destination cannot be used
    const stranger = customerActor((await makeUser()).id);
    await expect(requestAccountWithdrawal(stranger, { amount: 100_00, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: pending.id } })).rejects.toThrow(/لا تخصك|غير متحقق/);
    // paid only after verification; the payer differs from the approver
    const w1 = await requestAccountWithdrawal(seller, { amount: d1.payout.amount, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: pending.id } });
    await approveWithdrawal(checker, w1.withdrawal.id);
    await expect(markWithdrawalPaid(checker, w1.withdrawal.id, 'REF-SAME')).rejects.toThrow();
    // full details: payout executors only, fresh 2FA, audited
    await expect(revealPayoutDetails(await makeAdmin(['CUSTOMER_SUPPORT']), 'withdrawal', w1.withdrawal.id)).rejects.toThrow();
    const rows = await revealPayoutDetails(operator, 'withdrawal', w1.withdrawal.id);
    expect(rows.find((r) => r.value === 'first@instapay')).toBeTruthy();
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, w1.withdrawal.id), eq(auditLogs.action, 'payout.details_revealed')))).toHaveLength(1);
    await markWithdrawalPaid(operator, w1.withdrawal.id, 'REF-PD1');
    const paidSnap = (await wdOf(w1.withdrawal.id)).destinationSnapshot;
    expect(paidSnap).toMatchObject({ receivingDestinationId: pending.id, fingerprint: verified.fingerprint });
    // second withdrawal approved, then the seller changes the destination → old version archived → payout blocked
    const w2 = await requestAccountWithdrawal(seller, { amount: d2.payout.amount, clientKey: randomUUID(), destination: { kind: 'RECEIVING_DESTINATION', id: pending.id } });
    await approveWithdrawal(checker, w2.withdrawal.id);
    const next = await submitReceivingDestination(seller, { type: 'INSTAPAY', holderName: 'مستخدم اختبار ثلاثي الاسم', instapayAddress: 'second@instapay' }, { replacesId: pending.id });
    expect(next.status).toBe('PENDING_REVIEW');
    await expect(markWithdrawalPaid(operator, w2.withdrawal.id, 'REF-PD2')).rejects.toThrow(/لم تعد متحققًا/);
    expect((await wdOf(w1.withdrawal.id)).destinationSnapshot).toEqual(paidSnap); // history unchanged
    // a tampered fingerprint is refused too (direct DB tampering is itself blocked by the trigger)
    await expect(db.execute(sql`update receiving_destinations set fingerprint = 'x' where id = ${next.id}`)).rejects.toThrow();
    expect(await failing()).toEqual([]);
  });

  it('sensitive destination details never reach logs or notifications', async () => {
    const seller = customerActor((await makeUser()).id);
    const errSpy = vi.spyOn(console, 'error');
    const logSpy = vi.spyOn(console, 'log');
    await verifiedDestination(seller, 'secret-handle@instapay');
    const logged = [...errSpy.mock.calls, ...logSpy.mock.calls].flat().map(String).join(' ');
    expect(logged).not.toContain('secret-handle');
    const notes = await db.select().from(notifications).where(eq(notifications.userId, seller.userId!));
    expect(notes.map((n) => `${n.title} ${n.body}`).join(' ')).not.toContain('secret-handle');
    const audits = await db.execute(sql`select new_values::text v from audit_logs where actor_user_id = ${seller.userId} or entity_id in (select id::text from receiving_destinations where user_id = ${seller.userId})`);
    expect(audits.rows.map((r) => String(r.v)).join(' ')).not.toContain('secret-handle');
  });
});

/* ═══════════════════════════ KYC existing-obligation matrix ═══════════════════════════ */
describe('KYC — identity not APPROVED: new transactional risk fails closed, existing obligations stay resolvable', () => {
  it('matrix for PENDING_REVIEW, MORE_INFO_REQUIRED and REVERIFICATION_REQUIRED', async () => {
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    const s = await makeSeller(admin);
    const product = await makeProduct(s.actor, admin, { price: 200_00, stock: 50 });
    const draft = await makeProduct(s.actor, admin, { price: 100_00, approve: false });
    // three paid orders (one per state) + one PD deal in progress, all created while the identity was APPROVED
    const orders = [];
    for (let i = 0; i < 3; i++) {
      const c = await makeCustomer();
      const o = await checkout(c, [{ variantId: product.variantId, qty: 1 }]);
      await submitAndConfirm(c, o.id, admin);
      orders.push({ c, so: (await sellerOrdersOf(o.id))[0] });
    }
    const pdSeller = customerActor(s.user.id);
    const deal = await payableDeal(pdSeller, '300');
    const sa = (await sellerActor(s.user.id))!;
    const idRow = async () => (await db.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.userId, s.user.id)))[0];
    // APPROVED → REVERIFICATION_REQUIRED → (resubmit) PENDING_REVIEW → MORE_INFO_REQUIRED
    const states: string[] = [];
    const matrix: Record<string, Record<string, 'ALLOWED' | 'BLOCKED'>> = {};
    const check = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        return 'ALLOWED' as const;
      } catch (e) {
        if ((e as { code?: string }).code === 'IDENTITY_REQUIRED' || /تتحقق من هويتك|مش بيستقبل طلبات جديدة/.test((e as Error).message)) return 'BLOCKED' as const;
        throw new Error(`${label}: ${(e as Error).message}`);
      }
    };
    for (const [i, step] of (['REVERIFICATION_REQUIRED', 'PENDING_REVIEW', 'MORE_INFO_REQUIRED'] as const).entries()) {
      if (step === 'REVERIFICATION_REQUIRED') await reviewIdentity(reviewer, (await idRow()).id, 'REVERIFICATION_REQUIRED', { reason: 'إعادة تحقق دورية' });
      if (step === 'PENDING_REVIEW') await submitIdentity(customerActor(s.user.id), { legalName: 'بائع اختبار كامل الاسم', nationalId: '29001011234567' }, { front: { data: await png('f2'), name: 'f.png' }, back: { data: await png('b2'), name: 'b.png' } });
      if (step === 'MORE_INFO_REQUIRED') await reviewIdentity(reviewer, (await idRow()).id, 'MORE_INFO_REQUIRED', { reason: 'الصورة غير واضحة' });
      expect((await idRow()).status).toBe(step);
      states.push(step);
      const { c, so } = orders[i];
      const conv = await openSellerOrderConversation(c.actor, so.id);
      const buyer2 = await makeCustomer();
      const m: Record<string, 'ALLOWED' | 'BLOCKED'> = {};
      m.login = await check('login', async () => {
        const { login } = await import('@/server/auth/service');
        await login(s.user.email!, 'Test@12345', 'WEB', { ip: `10.9.${i}.1`, userAgent: 'vitest' });
      });
      m.viewExistingOrder = await check('view order', async () => {
        const { sellerOrderForSeller } = await import('@/server/modules/commerce/fulfilment');
        await sellerOrderForSeller(sa, so.id);
      });
      m.viewExistingProtectedDeal = await check('view deal', () => dealGraph(pdSeller, deal.dealId));
      m.communicate = await check('message', () => sendMessage(sa, conv.id, { body: 'هيتشحن النهارده', clientKey: randomUUID() }));
      m.fulfillExistingOrder = await check('ship', async () => {
        await confirmSellerOrder(sa, so.id);
        await saveShipment(sa, so.id, { carrierName: 'بوسطة', trackingNumber: `T${i}`, shippedAt: new Date() }, { data: pdf(), name: 'w.pdf' });
        await markShipped(sa, so.id);
      });
      m.deliveryEvidence = await check('evidence', async () => submitDeliveryEvidence(sa, so.id, { carrierReference: `POD-${i}` }, [{ data: await png('pod'), name: 'pod.png' }]));
      const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج مختلف عن الوصف المعروض تماماً' });
      m.respondToDispute = await check('dispute reply', () => addDisputeMessage(sa, d.id, 'المنتج مطابق والصور مرفقة'));
      m.uploadDisputeEvidence = await check('dispute evidence', async () => addDisputeMessage(sa, d.id, 'دليل إضافي', false, { data: await png('ev'), name: 'ev.png' }));
      m.contactSupport = await check('support', () => openTicket(customerActor(s.user.id), { type: 'IDENTITY', subject: 'استفسار التحقق', body: 'محتاج أعرف المطلوب لاستكمال التحقق' }));
      m.resolveExistingLiability = await check('liability adjustment', async () => {
        const adj = await createAdjustment(operator, { sellerId: s.actor.sellerId!, amount: '1', reasonCode: 'CORRECTION', reason: 'تسوية مديونية قائمة' });
        await decideAdjustment(checker, adj.id, true);
      });
      m.createNewProduct = await check('new product', () => submitForReview(sa, draft.productId));
      m.createNewSale = await check('new sale', () => checkout(buyer2, [{ variantId: product.variantId, qty: 1 }]));
      m.createNewProtectedDealCommitment = await check('new deal offer', async () => {
        const b = customerActor((await makeUser()).id);
        const nd = await createDeal(b, { title: 'جهاز جديد', description: 'جهاز جديد للبيع بحالة ممتازة', condition: 'NEW', quantity: 1 });
        await saveDealStep(b, nd.id, 2, { unitPrice: '500' });
        await saveDealStep(b, nd.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
        await saveDealStep(b, nd.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
        const { token } = await inviteSeller(b, nd.id, true);
        await claimInvitation(pdSeller, token);
        await submitSellerOffer(pdSeller, nd.id, { details: { fullName: 'بائع' }, location: LOC, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'x@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } }, true);
      });
      m.addPayoutDestination = await check('payout method', () => addPayoutMethod(sa, { type: 'INSTAPAY', holderName: 'بائع اختبار', instapayAddress: `new${i}@instapay` }));
      m.requestNewWithdrawal = await check('withdrawal', () => requestWithdrawal(sa, { amount: '100', clientKey: randomUUID() }));
      matrix[step] = m;
    }
    // a return on an existing order (separate order delivered earlier) stays answerable
    const expected = {
      login: 'ALLOWED', viewExistingOrder: 'ALLOWED', viewExistingProtectedDeal: 'ALLOWED', communicate: 'ALLOWED', fulfillExistingOrder: 'ALLOWED', deliveryEvidence: 'ALLOWED',
      respondToDispute: 'ALLOWED', uploadDisputeEvidence: 'ALLOWED', contactSupport: 'ALLOWED', resolveExistingLiability: 'ALLOWED',
      createNewProduct: 'BLOCKED', createNewSale: 'BLOCKED', createNewProtectedDealCommitment: 'BLOCKED', addPayoutDestination: 'BLOCKED', requestNewWithdrawal: 'BLOCKED',
    };
    for (const st of states) expect(matrix[st], st).toEqual(expected);
    console.info('KYC_MATRIX', JSON.stringify(matrix));
  });

  it('returns and refunds on existing orders remain resolvable while the seller identity is under review', async () => {
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 300_00 });
    const c = await makeCustomer();
    const o = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, o.id, admin);
    const [so] = await sellerOrdersOf(o.id);
    await shipIt(s.actor, so.id);
    await (await import('@/server/modules/commerce/fulfilment')).confirmReceipt(c.actor, so.id);
    const [row] = await db.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.userId, s.user.id));
    await reviewIdentity(reviewer, row.id, 'REVERIFICATION_REQUIRED', { reason: 'إعادة تحقق دورية' });
    const [it] = await (await import('../helpers/factory')).itemsOf(so.id);
    const ret = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'CHANGED_MIND', description: 'المقاس غير مناسب وأرغب في الإرجاع بحالته', items: [{ orderItemId: it.id, quantity: 1 }] });
    await approveReturn((await sellerActor(s.user.id))!, ret.id, 'موافقة على الإرجاع');
    const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: 50_00, reason: 'تعويض قائم' }));
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    await recordRefundPayout(operator, r.id, 'REF-KYC');
  });

  it('the legacy seller with incomplete documents has a reachable path into PENDING_REVIEW', async () => {
    const u = await makeUser({ identity: false });
    const a = customerActor(u.id);
    await startApplication(a, 'INDIVIDUAL');
    await saveIdentity(a, { type: 'INDIVIDUAL', legalName: 'بائع ناقص المستندات', nationalId: '28501011234567', mobile: u.phone!, email: u.email!, addressLine: 'عنوان اختبار طويل', city: 'القاهرة', governorateId: 1 });
    await uploadSellerDocument(a, 'NATIONAL_ID_FRONT', { data: await png('only-front'), name: 'f.png' }); // back missing
    const report = await mapLegacySellerIdentities();
    expect(report.leftIncomplete).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.userId, u.id))).toHaveLength(0);
    const r = await submitIdentity(a, { legalName: 'بائع ناقص المستندات كامل', nationalId: '28501011234567' }, { front: { data: await png('f'), name: 'f.png' }, back: { data: await png('b'), name: 'b.png' } });
    expect(r.status).toBe('PENDING_REVIEW');
  });
});

/* ═══════════════════════════ Alerts ═══════════════════════════ */
describe('alerts — concurrency and resolved suppression', () => {
  it('two concurrent sweeps never duplicate a notification; a resolved alert stays silent', async () => {
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    const u = await makeUser({ identity: false });
    await submitIdentity(customerActor(u.id), { legalName: 'عميل ينتظر المراجعة كامل', nationalId: '29001011234567' }, { front: { data: await png('a'), name: 'a.png' }, back: { data: await png('b'), name: 'b.png' } });
    const now = new Date(Date.now() + 1000 * 3600_000);
    const [row] = await db.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.userId, u.id));
    // notifications for THIS case only (other aging cases of earlier tests are independent alerts)
    const forCase = async () => (await db.execute<{ n: number }>(sql`select count(*)::int n from notifications where user_id = ${reviewer.userId} and event = 'OPS_ALERT' and dedupe_key like ${`alert:KYC_REVIEW_AGING:${row.id}:${reviewer.userId}:%`}`)).rows[0].n;
    await Promise.allSettled([runAlertSweep({ only: ['KYC_REVIEW_AGING'], now }), runAlertSweep({ only: ['KYC_REVIEW_AGING'], now }), runAlertSweep({ only: ['KYC_REVIEW_AGING'], now })]);
    const states = await db.execute<{ n: number }>(sql`select count(*)::int n from alert_states where entity_id = ${row.id} and recipient_user_id = ${reviewer.userId}`);
    expect(states.rows[0].n).toBe(1); // one alert state per (rule, entity, recipient)
    expect(await forCase()).toBe(1); // concurrent sweeps → exactly one notification (dedupe key)
    // resolve the condition (decision), sweep again much later: no new notification for this case
    await reviewIdentity(reviewer, row.id, 'APPROVE');
    await runAlertSweep({ only: ['KYC_REVIEW_AGING'], now: new Date(now.getTime() + 500 * 3600_000) });
    await runAlertSweep({ only: ['KYC_REVIEW_AGING'], now: new Date(now.getTime() + 900 * 3600_000) });
    const [st] = (await db.execute<{ stage: string }>(sql`select stage from alert_states where entity_id = ${row.id} and recipient_user_id = ${reviewer.userId}`)).rows;
    expect(st.stage).toBe('RESOLVED');
    expect(await forCase()).toBe(1);
  });
});

/* ═══════════════════════════ Stranded balances ═══════════════════════════ */
describe('stranded balance — every closed order and every withdrawal is fully explained', () => {
  it('cancellation, partial cancellation, full/partial/post-release refunds, return+refund, withdrawal lifecycle, mixed source', async () => {
    // cancellation (paid, before shipment) → refund approved & paid
    {
      const s = await makeSeller(admin);
      const p = await makeProduct(s.actor, admin, { price: 250_00 });
      const c = await makeCustomer();
      const o = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
      await submitAndConfirm(c, o.id, admin);
      const [so] = await sellerOrdersOf(o.id);
      await cancelSellerOrder(s.actor, so.id, 'المنتج خلص من المخزن');
      const [r] = await db.select().from((await import('@/server/db/schema')).refunds).where(eq((await import('@/server/db/schema')).refunds.sellerOrderId, so.id));
      await makerRequest('REFUND_APPROVAL', r.id, r.amount);
      await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
      await recordRefundPayout(operator, r.id, 'REF-CANCEL');
    }
    // partial cancellation: one seller of a multi-seller order cancels, the other completes
    {
      const s1 = await makeSeller(admin);
      const s2 = await makeSeller(admin);
      const p1 = await makeProduct(s1.actor, admin, { price: 150_00 });
      const p2 = await makeProduct(s2.actor, admin, { price: 180_00 });
      const c = await makeCustomer();
      const o = await checkout(c, [{ variantId: p1.variantId, qty: 1 }, { variantId: p2.variantId, qty: 1 }]);
      await submitAndConfirm(c, o.id, admin);
      const sos = await sellerOrdersOf(o.id);
      const so1 = sos.find((x) => x.sellerId === s1.actor.sellerId)!;
      const so2 = sos.find((x) => x.sellerId === s2.actor.sellerId)!;
      await cancelSellerOrder(s1.actor, so1.id, 'المنتج خلص من المخزن');
      const [r] = await db.select().from((await import('@/server/db/schema')).refunds).where(eq((await import('@/server/db/schema')).refunds.sellerOrderId, so1.id));
      await makerRequest('REFUND_APPROVAL', r.id, r.amount);
      await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
      await shipIt(s2.actor, so2.id);
      await receiveAndRelease(c.actor, so2.id);
    }
    // full refund + partial refund + post-release refund
    for (const principal of [null, 40_00]) {
      const { so } = await storeWithAvailable(200_00);
      const [row] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id));
      const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: principal ?? row.merchandiseSubtotal, reason: 'تعويض' }));
      await makerRequest('REFUND_APPROVAL', r.id, r.amount);
      await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    }
    // withdrawal reservation, failure, uncertain, returned, mixed source
    {
      const { s, user } = await storeWithAvailable(800_00);
      await payableDeal(user, '400');
      const w = await requestAccountWithdrawal(user, { amount: 500_00, clientKey: randomUUID(), destination: { kind: 'STORE_PAYOUT_METHOD' } });
      await approveWithdrawal(checker, w.withdrawal.id);
      await markWithdrawalProcessing(operator, w.withdrawal.id);
      await markWithdrawalTransferUncertain(operator, w.withdrawal.id, 'نتيجة غير مؤكدة من البنك');
      await makerRequest('WITHDRAWAL_REVERSAL', w.withdrawal.id, 500_00, { params: { mode: 'FAILED_BEFORE_TRANSFER' } });
      await markWithdrawalFailedBeforeTransfer(checker, w.withdrawal.id, { reason: 'تأكد عدم خروج التحويل', evidence: 'STMT-S' });
      const w2 = await requestWithdrawal(s.actor, { amount: '150', clientKey: randomUUID() });
      await approveWithdrawal(checker, w2.withdrawal.id);
      await markWithdrawalPaid(operator, w2.withdrawal.id, 'REF-S2');
      const paid = await wdOf(w2.withdrawal.id);
      await makerRequest('WITHDRAWAL_RETURN', w2.withdrawal.id, paid.netTransferAmount!);
      await recordWithdrawalReturned(checker, w2.withdrawal.id, { amount: paid.netTransferAmount!, reference: 'RET-S2', reason: 'الحساب مغلق' });
    }
    const inv = await financialInvariants();
    const stranded = inv.checks.find((c) => c.code === 'STRANDED_BALANCE')!;
    expect(stranded.count).toBe(0);
    expect(await failing()).toEqual([]);
    expect(inv.totals.difference).toBe(0);
    const rec = await reconcile(db);
    expect(rec.trialBalanceOk).toBe(true);
    console.info('STRANDED_BALANCE', stranded.count, 'DIFFERENCE', inv.totals.difference);
  });
});
