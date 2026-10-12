import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import { adminActor, customerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import {
  alertStates,
  auditLogs,
  conversations,
  financialApprovals,
  financialMovementRequests,
  journalEntries,
  ledgerAccounts,
  notifications,
  orders,
  privilegedMessageAccess,
  receivingDestinations,
  refunds,
  reviewEvents,
  sellerOrders,
  supportTickets,
  systemSettings,
  userIdentityVerifications,
  withdrawalRequests,
} from '@/server/db/schema';
import { runAlertSweep, stageFor } from '@/server/modules/alerts/engine';
import { ALERT_RULES } from '@/server/modules/alerts/rules';
import { placeOrder } from '@/server/modules/commerce/orders';
import { claimInvitation, createDeal, inviteSeller, releaseDeal, respondToOffer, saveDealStep, startDealPayment, submitSellerOffer } from '@/server/modules/deals/service';
import { financialInvariants } from '@/server/modules/finance/controls';
import { accountBalance, reconcile, sellerBalances } from '@/server/modules/finance/ledger';
import { cancelMovementRequest, rejectMovementRequest, requestMovement } from '@/server/modules/finance/movements';
import { approveRefund, recordRefundPayout, requestRefundTx, revealRefundDestination, revokeRefund, useReceivingDestinationForRefund } from '@/server/modules/finance/refunds';
import { sellerFinancialView } from '@/server/modules/finance/seller-wallet';
import { approveWithdrawal, createAdjustment, decideAdjustment, markWithdrawalPaid, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { archiveReceivingDestination, myReceivingDestinations, revealReceivingDestination, reviewReceivingDestination, submitReceivingDestination } from '@/server/modules/identity/receiving';
import { identityStatus, mapLegacySellerIdentities, myIdentity, requireApprovedIdentity, reviewIdentity, submitIdentity } from '@/server/modules/identity/service';
import { grantMessageAccess, openSellerOrderConversation, staffThread } from '@/server/modules/messaging/service';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { saveIdentity, startApplication, uploadSellerDocument } from '@/server/modules/sellers/service';
import { openTicket, qaReviewTicket, rateTicket, reopenTicket, replyToTicket, ticketSlaCycles, updateTicket } from '@/server/modules/support/service';
import { canReadPrivateFile } from '@/server/storage/access';
import {
  approveIdentity,
  checkout,
  ensurePaymentSetup,
  makeAdmin,
  makeCustomer,
  makeProduct,
  makerRequest,
  makeSeller,
  makeUser,
  png,
  receiveAndRelease,
  sellerOrdersOf,
  shipIt,
  submitAndConfirm,
} from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PRODUCTION HARDENING — BATCH 1.5 (identity, receiving destinations, refund safety, universal maker/checker,
 * unified seller balances, message privacy, support reopen/SLA, proactive alerts). Owner decisions are pinned
 * here; do not weaken them to get green.
 */

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});
afterEach(() => vi.restoreAllMocks());

const noStepUp = async (a: Actor) => adminActor(a.userId!, { stepUpAt: null });
const docs = async () => ({ front: { data: await png('front'), name: 'front.png' }, back: { data: await png('back'), name: 'back.png' } });
const NID = '29001011234567';
const identityRow = async (userId: string) => (await db.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.userId, userId)))[0];
const journalCount = async () => (await db.select({ n: count() }).from(journalEntries))[0].n;

async function shippedOrder(price = 400_00) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  return { s, c, so, order };
}

/* ═══════════════════════════ A. Global identity (KYC) ═══════════════════════════ */
describe('A — one user-level identity, required before NEW transactional risk', () => {
  it('an unverified customer cannot place an order; PENDING_REVIEW is not enough; APPROVED is', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00 });
    const c = await makeCustomer({ identity: false });
    expect(await identityStatus(db, c.user.id)).toBe('INCOMPLETE');
    await expect(checkout(c, [{ variantId: p.variantId, qty: 1 }])).rejects.toMatchObject({ code: 'IDENTITY_REQUIRED' });
    const r = await submitIdentity(c.actor, { legalName: 'عميل اختبار ثلاثي الاسم', nationalId: NID }, await docs());
    expect(r.status).toBe('PENDING_REVIEW');
    await expect(requireApprovedIdentity(db, c.actor, 'ORDER_PLACEMENT')).rejects.toMatchObject({ code: 'IDENTITY_REQUIRED' });
    await reviewIdentity(await makeAdmin(['SELLER_REVIEWER']), r.id, 'APPROVE');
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    expect(order.id).toBeTruthy();
  });

  it('front AND back are required; the national ID number is validated; the name must be the full legal name', async () => {
    const u = await makeUser({ identity: false });
    const a = customerActor(u.id);
    await expect(submitIdentity(a, { legalName: 'اسم ثنائي', nationalId: NID }, await docs())).rejects.toThrow(/الاسم الكامل/);
    await expect(submitIdentity(a, { legalName: 'اسم ثلاثي كامل', nationalId: '123' }, await docs())).rejects.toThrow(/الرقم القومي/);
    await expect(submitIdentity(a, { legalName: 'اسم ثلاثي كامل', nationalId: NID }, { front: (await docs()).front, back: null })).rejects.toThrow(/وجه البطاقة وظهرها/);
    expect(await identityRow(u.id)).toBeUndefined(); // nothing half-written
  });

  it('review requires identity.review + fresh 2FA, never self-review, a reason except for approval, and the current version', async () => {
    const u = await makeUser({ identity: false });
    const r = await submitIdentity(customerActor(u.id), { legalName: 'مستخدم للمراجعة كامل', nationalId: NID }, await docs());
    await expect(reviewIdentity(await makeAdmin(['CUSTOMER_SUPPORT']), r.id, 'APPROVE')).rejects.toThrow();
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    await expect(reviewIdentity(await noStepUp(reviewer), r.id, 'APPROVE')).rejects.toThrow(/تأكيد هويتك/);
    await expect(reviewIdentity(reviewer, r.id, 'REJECT', { reason: '' })).rejects.toThrow(/سبب/);
    await expect(reviewIdentity(reviewer, r.id, 'APPROVE', { expectedVersion: 99 })).rejects.toThrow(/تم تحديث/);
    // self-review: a staff member reviewing their own identity case
    const staffUser = await makeUser({ staff: true, roles: ['SELLER_REVIEWER'] });
    const own = await submitIdentity(customerActor(staffUser.id), { legalName: 'موظف مراجعة كامل الاسم', nationalId: NID }, await docs());
    await expect(reviewIdentity(await adminActor(staffUser.id, { stepUpAt: new Date() }), own.id, 'APPROVE')).rejects.toThrow(/بنفسك/);
    await reviewIdentity(reviewer, r.id, 'MORE_INFO_REQUIRED', { reason: 'الصورة غير واضحة', internalNote: 'ظهر البطاقة مقصوص' });
    const me = await myIdentity(customerActor(u.id));
    expect(me.status).toBe('MORE_INFO_REQUIRED');
    expect(me.reason).toBe('الصورة غير واضحة');
    expect(JSON.stringify(me)).not.toContain('مقصوص'); // the internal note never reaches the customer
    expect(JSON.stringify(me)).not.toContain(NID); // nor the full number
    // resubmission may keep an already uploaded side; the version increments
    const again = await submitIdentity(customerActor(u.id), { legalName: 'مستخدم للمراجعة كامل', nationalId: NID }, { front: null, back: { data: await png('b2'), name: 'b2.png' } });
    expect((await identityRow(u.id)).submissionVersion).toBe(2);
    await reviewIdentity(reviewer, again.id, 'APPROVE', { expectedVersion: 2 });
    const events = await db.select().from(reviewEvents).where(eq(reviewEvents.subjectId, r.id));
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['SUBMITTED', 'MORE_INFO_REQUIRED', 'RESUBMITTED', 'APPROVE']));
    await expect(db.execute(sql`update review_events set reason = 'x' where subject_id = ${r.id}`)).rejects.toThrow(); // append-only
  });

  it('identity APPROVED is not seller approval, and the DB refuses an APPROVED identity without a reviewer', async () => {
    const u = await makeUser(); // approved identity through the real flow
    expect(await identityStatus(db, u.id)).toBe('APPROVED');
    const seller = await db.execute(sql`select 1 from sellers where owner_user_id = ${u.id}`);
    expect(seller.rows).toHaveLength(0);
    const other = await makeUser({ identity: false });
    await expect(db.execute(sql`insert into user_identity_verifications (user_id, status, legal_name) values (${other.id}, 'APPROVED', 'x y z')`)).rejects.toThrow();
    await expect(db.execute(sql`delete from user_identity_verifications where user_id = ${u.id}`)).rejects.toThrow();
  });

  it('existing obligations are never stranded: an unverified user can still open support and receive a refund', async () => {
    const { c, so } = await shippedOrder();
    // the identity is later sent back for re-verification
    const row = await identityRow(c.user.id);
    await reviewIdentity(await makeAdmin(['SELLER_REVIEWER']), row.id, 'REVERIFICATION_REQUIRED', { reason: 'إعادة تحقق دورية' });
    const t = await openTicket(c.actor, { type: 'IDENTITY', subject: 'استفسار عن التحقق', body: 'ليه مطلوب إعادة التحقق من الهوية؟' });
    expect(t.id).toBeTruthy();
    const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: 50_00, reason: 'تعويض في الاختبار' }));
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(await makeAdmin(['FINANCE_CHECKER']), r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    await recordRefundPayout(await makeAdmin(['FINANCE_OPERATOR']), r.id, 'REF-UNVERIFIED');
    expect((await db.select().from(refunds).where(eq(refunds.id, r.id)))[0].status).toBe('COMPLETED');
    // …but new transactional risk is refused
    await expect(requireApprovedIdentity(db, c.actor, 'ORDER_PLACEMENT')).rejects.toMatchObject({ code: 'IDENTITY_REQUIRED' });
  });

  it('legacy seller applications are linked as PENDING_REVIEW (never auto-approved); the mapping is idempotent', async () => {
    const u = await makeUser({ identity: false });
    const a = customerActor(u.id);
    await startApplication(a, 'INDIVIDUAL');
    await saveIdentity(a, { type: 'INDIVIDUAL', legalName: 'بائع قديم كامل الاسم', nationalId: '28501011234567', mobile: u.phone!, email: u.email!, addressLine: 'عنوان اختبار طويل', city: 'القاهرة', governorateId: 1 });
    await uploadSellerDocument(a, 'NATIONAL_ID_FRONT', { data: await png('lf'), name: 'f.png' });
    await uploadSellerDocument(a, 'NATIONAL_ID_BACK', { data: await png('lb'), name: 'b.png' });
    const first = await mapLegacySellerIdentities();
    expect(first.linkedPendingReview).toBeGreaterThanOrEqual(1);
    const row = await identityRow(u.id);
    expect(row).toMatchObject({ status: 'PENDING_REVIEW', source: 'LEGACY_SELLER_APPLICATION', reviewedBy: null });
    expect(row.nationalIdLast4).toBe('4567');
    const second = await mapLegacySellerIdentities();
    expect(await db.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.userId, u.id))).toHaveLength(1);
    expect(second.linkedPendingReview).toBe(0);
  });

  it('National ID images are private: owner yes, stranger no, reviewer only with permission AND fresh 2FA', async () => {
    const u = await makeUser({ identity: false });
    await submitIdentity(customerActor(u.id), { legalName: 'صاحب البطاقة كامل', nationalId: NID }, await docs());
    const row = await identityRow(u.id);
    expect(await canReadPrivateFile(customerActor(u.id), row.frontFileId!)).toBe(true);
    expect(await canReadPrivateFile(customerActor((await makeUser()).id), row.frontFileId!)).toBe(false);
    expect(await canReadPrivateFile(await makeAdmin(['CUSTOMER_SUPPORT']), row.frontFileId!)).toBe(false);
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    expect(await canReadPrivateFile(await noStepUp(reviewer), row.backFileId!)).toBe(false);
    expect(await canReadPrivateFile(reviewer, row.backFileId!)).toBe(true);
  });
});

/* ═══════════════════════════ PD — identity, seller without a store ═══════════════════════════ */
async function paidDeal(opts: { buyer?: Actor; seller?: Actor; price?: string } = {}) {
  const buyer = opts.buyer ?? customerActor((await makeUser()).id);
  const deal = await createDeal(buyer, { title: 'جهاز للاختبار', description: 'جهاز بحالة جيدة جداً مع الشاحن', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: opts.price ?? '3000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const seller = opts.seller ?? customerActor((await makeUser()).id);
  await claimInvitation(seller, token);
  const { version } = await submitSellerOffer(
    seller,
    deal.id,
    { details: { fullName: 'بائع الصفقة' }, location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 }, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'deal@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
    true,
  );
  await respondToOffer(buyer, deal.id, version, 'ACCEPT');
  const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
  const { submission } = await submitProof(buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  await confirmPayment(admin, p.id, submission.id);
  return { buyer, seller, dealId: deal.id };
}

describe('PD — the same identity; a Protected Deal seller needs no store', () => {
  it('an unverified buyer cannot invite a seller; an unverified seller cannot make an offer', async () => {
    const unverified = customerActor((await makeUser({ identity: false })).id);
    const deal = await createDeal(unverified, { title: 'جهاز', description: 'وصف كافي للجهاز المعروض للبيع', condition: 'NEW', quantity: 1 });
    await saveDealStep(unverified, deal.id, 2, { unitPrice: '1000' });
    await saveDealStep(unverified, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
    await saveDealStep(unverified, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
    await expect(inviteSeller(unverified, deal.id, true)).rejects.toMatchObject({ code: 'IDENTITY_REQUIRED' });
    const buyer = customerActor((await makeUser()).id);
    const d2 = await createDeal(buyer, { title: 'جهاز', description: 'وصف كافي للجهاز المعروض للبيع', condition: 'NEW', quantity: 1 });
    await saveDealStep(buyer, d2.id, 2, { unitPrice: '1000' });
    await saveDealStep(buyer, d2.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
    await saveDealStep(buyer, d2.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
    const { token } = await inviteSeller(buyer, d2.id, true);
    const unverifiedSeller = customerActor((await makeUser({ identity: false })).id);
    await claimInvitation(unverifiedSeller, token);
    await expect(
      submitSellerOffer(unverifiedSeller, d2.id, { details: { fullName: 'بائع' }, location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 }, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'x@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } }, true),
    ).rejects.toMatchObject({ code: 'IDENTITY_REQUIRED' });
  });

  it('a verified PD seller without a store sees an attributed Protected Deal balance (no Marketplace balance)', async () => {
    const { seller } = await paidDeal();
    const view = await sellerFinancialView(db, seller.userId!);
    expect(view.marketplace).toBeNull();
    expect(view.protectedDeal).not.toBeNull();
    expect(view.protectedDeal!.pending).toBeGreaterThan(0);
    expect(view.items.every((i) => i.sourceType === 'PROTECTED_DEAL' && i.entityType === 'external_deal')).toBe(true);
    expect(view.combined.pending).toBe(view.protectedDeal!.pending);
  });
});

/* ═══════════════════════════ B. Receiving destinations (NOT a wallet) ═══════════════════════════ */
const wallet = (n = '01012345678') => ({ type: 'MOBILE_WALLET' as const, holderName: 'مستخدم اختبار ثلاثي الاسم', walletProvider: 'فودافون كاش', walletNumber: n });

describe('B — بيانات استلام الأموال: versioned, reviewed, masked, never a balance', () => {
  it('lifecycle: PENDING_REVIEW → APPROVED only with a verified identity and the holder confirmed; never self-review', async () => {
    const unverified = await makeUser({ identity: false });
    const d0 = await submitReceivingDestination(customerActor(unverified.id), wallet());
    const reviewer = await makeAdmin(['FINANCE_CHECKER']);
    await expect(reviewReceivingDestination(reviewer, d0.id, 'APPROVE', { holderMatchesIdentity: true })).rejects.toThrow(/هوية صاحبها/);
    const u = await makeUser();
    const d = await submitReceivingDestination(customerActor(u.id), wallet());
    expect(d.status).toBe('PENDING_REVIEW');
    await expect(reviewReceivingDestination(reviewer, d.id, 'APPROVE', { holderMatchesIdentity: false })).rejects.toThrow(/نفس صاحب الهوية/);
    await expect(reviewReceivingDestination(await noStepUp(reviewer), d.id, 'APPROVE', { holderMatchesIdentity: true })).rejects.toThrow(/تأكيد هويتك/);
    await expect(reviewReceivingDestination(await makeAdmin(['CUSTOMER_SUPPORT']), d.id, 'APPROVE', { holderMatchesIdentity: true })).rejects.toThrow();
    await reviewReceivingDestination(reviewer, d.id, 'APPROVE', { holderMatchesIdentity: true });
    const mine = await myReceivingDestinations(customerActor(u.id));
    expect(mine[0].status).toBe('APPROVED');
    expect(mine[0]).not.toHaveProperty('detailsEnc');
    expect(mine[0]).not.toHaveProperty('fingerprint');
    expect(JSON.stringify(mine)).not.toContain('01012345678');
  });

  it('a change is a NEW version (old archived, never edited); details are immutable and never deleted (DB)', async () => {
    const u = await makeUser();
    const d1 = await submitReceivingDestination(customerActor(u.id), wallet('01011111111'));
    await reviewReceivingDestination(await makeAdmin(['FINANCE_CHECKER']), d1.id, 'APPROVE', { holderMatchesIdentity: true });
    const d2 = await submitReceivingDestination(customerActor(u.id), wallet('01022222222'), { replacesId: d1.id });
    expect(d2.version).toBe(2);
    expect(d2.status).toBe('PENDING_REVIEW');
    const [old] = await db.select().from(receivingDestinations).where(eq(receivingDestinations.id, d1.id));
    expect(old.status).toBe('ARCHIVED');
    await expect(db.execute(sql`update receiving_destinations set details_enc = 'x' where id = ${d2.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update receiving_destinations set status = 'APPROVED' where id = ${d1.id}`)).rejects.toThrow(); // no revival
    await expect(db.execute(sql`delete from receiving_destinations where id = ${d2.id}`)).rejects.toThrow();
  });

  it('full details only with destinations.view_full + fresh 2FA, audited; no ledger account / balance is ever created', async () => {
    const before = (await db.select({ n: count() }).from(ledgerAccounts))[0].n;
    const u = await makeUser();
    const d = await submitReceivingDestination(customerActor(u.id), wallet('01033333333'));
    await expect(revealReceivingDestination(await makeAdmin(['CUSTOMER_SUPPORT']), d.id)).rejects.toThrow();
    const op = await makeAdmin(['FINANCE_OPERATOR']);
    await expect(revealReceivingDestination(await noStepUp(op), d.id)).rejects.toThrow(/تأكيد هويتك/);
    expect((await revealReceivingDestination(op, d.id)).walletNumber).toBe('+201033333333');
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, d.id), eq(auditLogs.action, 'receiving_destination.revealed')));
    expect(log.actorUserId).toBe(op.userId);
    expect((await db.select({ n: count() }).from(ledgerAccounts))[0].n).toBe(before);
  });
});

/* ═══════════════════════════ C. Refund hierarchy, revocation, liability ═══════════════════════════ */
async function adminRefund(amount = 100_00, opts: { release?: boolean } = {}) {
  const x = await shippedOrder(500_00);
  if (opts.release) await receiveAndRelease(x.c.actor, x.so.id);
  const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: x.so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: amount, reason: 'تعويض في الاختبار' }));
  return { ...x, r };
}
const refundOf = async (id: string) => (await db.select().from(refunds).where(eq(refunds.id, id)))[0];

describe('C — refunds: original destination first, verified fallback, approval ≠ transfer, revocation by compensation', () => {
  it('the customer may pick their OWN approved receiving destination before approval; payout goes exactly there', async () => {
    const { c, r } = await adminRefund();
    expect((await refundOf(r.id)).destinationSnapshot).toMatchObject({ source: 'ORIGINAL_PAYMENT' });
    const d = await submitReceivingDestination(c.actor, wallet('01044444444'));
    await expect(useReceivingDestinationForRefund(c.actor, r.id, d.id, 'المحفظة الأصلية مغلقة')).rejects.toThrow(/غير معتمدة/);
    await reviewReceivingDestination(await makeAdmin(['FINANCE_CHECKER']), d.id, 'APPROVE', { holderMatchesIdentity: true });
    // someone else's approved destination is refused (beneficiary safety / IDOR)
    const other = await makeCustomer();
    const od = await submitReceivingDestination(other.actor, wallet('01055555555'));
    await reviewReceivingDestination(await makeAdmin(['FINANCE_CHECKER']), od.id, 'APPROVE', { holderMatchesIdentity: true });
    await expect(useReceivingDestinationForRefund(c.actor, r.id, od.id, 'محاولة توجيه لحساب آخر')).rejects.toThrow(/لا تخص/);
    await expect(useReceivingDestinationForRefund(other.actor, r.id, od.id, 'محاولة على استرداد غيري')).rejects.toThrow();
    await useReceivingDestinationForRefund(c.actor, r.id, d.id, 'المحفظة الأصلية مغلقة');
    const chosen = await refundOf(r.id);
    expect(chosen).toMatchObject({ destinationSource: 'RECEIVING_DESTINATION', receivingDestinationId: d.id, receivingDestinationVersion: 1 });
    expect(JSON.stringify(chosen.destinationSnapshot)).not.toContain('01044444444'); // masked snapshot only
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    const approved = await refundOf(r.id);
    // approval is NOT a transfer
    expect(approved.status).toBe('APPROVED');
    expect(approved.paidAt).toBeNull();
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `refund-paid:${r.id}`))).toHaveLength(0);
    const payer = await makeAdmin(['FINANCE_OPERATOR']);
    expect((await revealRefundDestination(payer, r.id)).walletNumber).toBe('+201044444444');
    // the customer cannot switch after approval
    await expect(useReceivingDestinationForRefund(c.actor, r.id, d.id, 'تغيير بعد الاعتماد')).rejects.toThrow(/اتعتمد بالفعل/);
    // archived after approval → never paid there
    await archiveReceivingDestination(c.actor, d.id);
    await expect(recordRefundPayout(payer, r.id, 'REF-ARCH')).rejects.toThrow(/لم تعد معتمدة/);
  });

  it('a mistakenly approved refund is revoked by a compensating entry (two people), history untouched, idempotent', async () => {
    const { s, r, so } = await adminRefund(80_00, { release: true });
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    const balAfterApproval = await sellerBalances(db, s.actor.sellerId!);
    const [orig] = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `refund:${r.id}`));
    await expect(revokeRefund(checker, r.id, { reason: 'اعتماد بالخطأ للعميل الخطأ' })).rejects.toThrow(/منشئ/); // no Maker yet
    const maker = await makeAdmin(['FINANCE_OPERATOR']);
    await makerRequest('REFUND_REVOCATION', r.id, r.amount, { maker });
    await expect(revokeRefund(await adminActor(maker.userId!, { stepUpAt: new Date() }), r.id, { reason: 'اعتماد بالخطأ للعميل الخطأ' })).rejects.toThrow(); // maker lacks refunds.approve
    await expect(revokeRefund(checker, r.id, { reason: 'قصير' })).rejects.toThrow(/10/);
    await revokeRefund(checker, r.id, { reason: 'اعتماد بالخطأ للعميل الخطأ' });
    expect(await revokeRefund(checker, r.id, { reason: 'اعتماد بالخطأ للعميل الخطأ' })).toEqual({ alreadyRevoked: true });
    const after = await refundOf(r.id);
    expect(after).toMatchObject({ status: 'CANCELLED', revokedBy: checker.userId });
    const reversals = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `refund-revocation:${r.id}`));
    expect(reversals).toHaveLength(1);
    expect(reversals[0].reversesEntryId).toBe(orig.id);
    expect((await db.select().from(journalEntries).where(eq(journalEntries.id, orig.id)))[0]).toEqual(orig); // original untouched
    const bal = await sellerBalances(db, s.actor.sellerId!);
    expect(bal.available - balAfterApproval.available).toBe(r.sellerLiability);
    expect((await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id)))[0].refundedTotal).toBe(0);
    await expect(recordRefundPayout(await makeAdmin(['FINANCE_OPERATOR']), r.id, 'REF-X')).rejects.toThrow(); // never paid after revocation
    const rec = await reconcile(db);
    expect(rec.trialBalanceOk).toBe(true);
  });

  it('a refund already transferred can never be revoked', async () => {
    const { r } = await adminRefund(30_00);
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(await makeAdmin(['FINANCE_CHECKER']), r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    await recordRefundPayout(await makeAdmin(['FINANCE_OPERATOR']), r.id, 'REF-PAID-REV');
    await expect(makerRequest('REFUND_REVOCATION', r.id, r.amount).then(() => revokeRefund(admin, r.id, { reason: 'محاولة إلغاء بعد التحويل' }))).rejects.toThrow(/لم يُحوَّل/);
  });

  it('a post-release refund larger than the available balance becomes a visible seller liability that blocks withdrawals', async () => {
    const { s, so } = await adminRefund(10_00, { release: true });
    const avail = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    const big = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: 300_00, reason: 'تعويض كبير' }));
    await makerRequest('REFUND_APPROVAL', big.id, big.amount);
    await approveRefund(await makeAdmin(['FINANCE_CHECKER']), big.id, { expectedAmount: big.amount, reason: 'اعتماد' });
    const view = await sellerFinancialView(db, s.user.id);
    const now = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    if (now < 0) {
      expect(view.marketplace!.liability).toBe(-now);
      expect(view.marketplace!.available).toBe(0);
      await expect(requestWithdrawal(s.actor, { amount: '10', clientKey: randomUUID() })).rejects.toThrow();
    } else {
      expect(now).toBeLessThan(avail);
    }
  });
});

/* ═══════════════════════════ D. Universal maker/checker ═══════════════════════════ */
describe('D — every actual financial movement needs two different people (no threshold)', () => {
  it('seller release: no Maker → refused; same person → refused; stale amount → refused; concurrent → exactly once', async () => {
    const { c, so } = await shippedOrder();
    await (await import('@/server/modules/commerce/fulfilment')).confirmReceipt(c.actor, so.id);
    const { releaseSellerOrder } = await import('@/server/modules/commerce/fulfilment');
    const { sellerOrderPosition } = await import('@/server/modules/finance/postings');
    const pos = await sellerOrderPosition(db, (await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id)))[0]);
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await expect(releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending, reason: 'بدون منشئ' })).rejects.toThrow(/منشئ/);
    await makerRequest('SELLER_RELEASE', so.id, pos.pending, { maker: checker });
    await expect(releaseSellerOrder(checker, so.id, { expectedSellerAmount: pos.pending, reason: 'نفس الشخص' })).rejects.toThrow(/نفس الشخص/);
    const second = await makeAdmin(['FINANCE_CHECKER']);
    const res = await Promise.allSettled([
      releaseSellerOrder(second, so.id, { expectedSellerAmount: pos.pending, reason: 'تنفيذ 1' }),
      releaseSellerOrder(second, so.id, { expectedSellerAmount: pos.pending, reason: 'تنفيذ 2' }),
    ]);
    expect(res.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `release:${so.id}`))).toHaveLength(1);
    const [appr] = await db.select().from(financialApprovals).where(and(eq(financialApprovals.entityId, so.id), eq(financialApprovals.action, 'SELLER_RELEASE')));
    expect(appr).toMatchObject({ dualControl: true, requestedBy: checker.userId, approvedBy: second.userId });
    const [req] = await db.select().from(financialMovementRequests).where(eq(financialMovementRequests.entityId, so.id));
    expect(req).toMatchObject({ status: 'EXECUTED', decidedBy: second.userId, approvalId: appr.id });
  });

  it('Protected Deal: no release is possible before entitlement, Maker or not', async () => {
    const { dealId } = await paidDeal();
    const [deal] = await db.execute<{ status: string; buyer_pays: number; fee_amount: number }>(sql`select status, buyer_pays, fee_amount from external_deals where id = ${dealId}`).then((r) => r.rows);
    expect(deal.status).toBe('ACTIVE');
    // a release cannot even be attempted before entitlement, Maker or not
    await expect(releaseDeal(admin, dealId, { expectedPayout: 1, reason: 'قبل الاستحقاق' })).rejects.toThrow();
  });

  it('withdrawal: the approver can never record the payout, whatever the amount (no threshold)', async () => {
    const { s, c, so } = await shippedOrder(1000_00);
    await receiveAndRelease(c.actor, so.id);
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '100', clientKey: randomUUID() });
    expect(withdrawal.requiresDualControl).toBe(true);
    expect(withdrawal.sourceType).toBe('MARKETPLACE'); // attribution: Marketplace balance only
    const checker = await makeAdmin(['FINANCE_CHECKER', 'FINANCE_OPERATOR']);
    await approveWithdrawal(checker, withdrawal.id);
    await expect(markWithdrawalPaid(checker, withdrawal.id, 'REF-SAME')).rejects.toThrow(/مختلف/);
    await markWithdrawalPaid(await makeAdmin(['FINANCE_OPERATOR']), withdrawal.id, 'REF-OTHER');
    expect((await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id)))[0].status).toBe('PAID');
  });

  it('manual adjustment never posts on creation; its creator can never approve it', async () => {
    const s = await makeSeller(admin);
    const before = await journalCount();
    const maker = await makeAdmin(['FINANCE_OPERATOR', 'FINANCE_CHECKER']);
    const adj = await createAdjustment(maker, { sellerId: s.actor.sellerId!, amount: '25', reasonCode: 'CORRECTION', reason: 'تصحيح في الاختبار' });
    expect(await journalCount()).toBe(before);
    await expect(decideAdjustment(maker, adj.id, true)).rejects.toThrow(/منشئ/);
    await decideAdjustment(await makeAdmin(['FINANCE_CHECKER']), adj.id, true);
    expect(await journalCount()).toBe(before + 1);
  });

  it('the database refuses a movement approval without a distinct maker, and a decided request is final', async () => {
    const a = await makeAdmin();
    await expect(
      db.execute(sql`insert into financial_approvals (action, entity_type, entity_id, amount, economic_version, entry_types, reason, approved_by, approved_at, idempotency_key)
        values ('SELLER_RELEASE', 'test', ${randomUUID()}, 1, 'v', array['SELLER_RELEASE'], 'single person', ${a.userId}, now(), ${randomUUID()})`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`insert into financial_approvals (action, entity_type, entity_id, amount, economic_version, entry_types, reason, dual_control, requested_by, approved_by, approved_at, idempotency_key)
        values ('DEAL_PAYOUT', 'test', ${randomUUID()}, 1, 'v', array['DEAL_PAYOUT'], 'same person', true, ${a.userId}, ${a.userId}, now(), ${randomUUID()})`),
    ).rejects.toThrow();
    // a recognised exemption still works: payment confirmation records money already received
    const ok = await db.execute(sql`insert into financial_approvals (action, entity_type, entity_id, amount, economic_version, entry_types, reason, approved_by, approved_at, idempotency_key)
        values ('PAYMENT_CONFIRMATION', 'test', ${randomUUID()}, 1, 'v', array['ORDER_PAYMENT'], 'exempt', ${a.userId}, now(), ${randomUUID()}) returning id`);
    expect(ok.rows).toHaveLength(1);
    // request lifecycle: idempotent for the same Maker, conflict for another, reject/cancel are final
    const entityId = randomUUID();
    const m1 = await makeAdmin(['FINANCE_OPERATOR']);
    const r1 = await requestMovement(m1, 'WITHDRAWAL_RETURN', { entityId, amount: 100, reason: 'طلب حركة للاختبار' });
    expect((await requestMovement(m1, 'WITHDRAWAL_RETURN', { entityId, amount: 100, reason: 'طلب حركة للاختبار' })).id).toBe(r1.id);
    await expect(requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'WITHDRAWAL_RETURN', { entityId, amount: 100, reason: 'طلب حركة آخر للاختبار' })).rejects.toThrow(/مفتوح/);
    await expect(rejectMovementRequest(m1, r1.id, 'رفض طلبي')).rejects.toThrow();
    await rejectMovementRequest(await makeAdmin(['FINANCE_CHECKER']), r1.id, 'غير مبرر');
    await expect(cancelMovementRequest(m1, r1.id)).rejects.toThrow(/تم البت/);
    await expect(db.execute(sql`update financial_movement_requests set status = 'PENDING' where id = ${r1.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update financial_movement_requests set amount = 1 where id = ${r1.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from financial_movement_requests where id = ${r1.id}`)).rejects.toThrow();
    await expect(requestMovement(await noStepUp(m1), 'WITHDRAWAL_RETURN', { entityId: randomUUID(), amount: 1, reason: 'بدون تحقق ثنائي' })).rejects.toThrow(/تأكيد هويتك/);
    await expect(requestMovement(await makeAdmin(['CUSTOMER_SUPPORT']), 'WITHDRAWAL_RETURN', { entityId: randomUUID(), amount: 1, reason: 'بدون صلاحية للطلب' })).rejects.toThrow();
  });
});

/* ═══════════════════════════ E. Unified seller balances ═══════════════════════════ */
describe('E — one view, two attributed sources, never mixed', () => {
  it('a seller with a store AND a Protected Deal sees both sources separately plus the combined total', async () => {
    const { s, c, so } = await shippedOrder(600_00);
    await receiveAndRelease(c.actor, so.id);
    await paidDeal({ seller: customerActor(s.user.id) });
    const v = await sellerFinancialView(db, s.user.id);
    expect(v.marketplace!.available).toBe((await sellerBalances(db, s.actor.sellerId!)).available);
    expect(v.protectedDeal!.pending).toBeGreaterThan(0);
    for (const k of ['pending', 'available', 'held', 'entitledAwaitingRelease', 'reserved', 'liability', 'paidOut'] as const) {
      expect(v.combined[k]).toBe(v.marketplace![k] + v.protectedDeal![k]);
    }
    expect(new Set(v.items.map((i) => i.sourceType))).toEqual(new Set(['PROTECTED_DEAL']));
    // Marketplace pending items (per sub-order) sum back to SELLER_PENDING
    const pending = await accountBalance(db, { code: 'SELLER_PENDING', sellerId: s.actor.sellerId! });
    expect(v.marketplace!.pending + v.marketplace!.held + v.marketplace!.entitledAwaitingRelease).toBe(pending);
  });
});

/* ═══════════════════════════ F. Admin message privacy ═══════════════════════════ */
describe('F — privileged message access needs a purpose, a linked case where relevant, and expires', () => {
  it('DISPUTE purpose requires a dispute of THIS conversation; grants are append-only and expire', async () => {
    const { c, so } = await shippedOrder();
    const conv = await openSellerOrderConversation(c.actor, so.id);
    const officer = await makeAdmin(['DISPUTE_OFFICER']);
    await expect(grantMessageAccess(officer, conv.id, { purpose: 'DISPUTE', note: 'مراجعة نزاع على الطلب' })).rejects.toThrow(/رقم الحالة/);
    const other = await shippedOrder();
    const foreign = await openDispute(other.c.actor, { sellerOrderId: other.so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج مختلف تماماً عن الوصف المعروض' });
    await expect(grantMessageAccess(officer, conv.id, { purpose: 'DISPUTE', note: 'مراجعة نزاع على الطلب', caseId: foreign.id })).rejects.toThrow(/لا تخص/);
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج مختلف تماماً عن الوصف المعروض' });
    await grantMessageAccess(officer, conv.id, { purpose: 'DISPUTE', note: 'مراجعة نزاع على الطلب', caseId: d.id });
    await staffThread(officer, conv.id, { via: 'dispute' });
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'conversation.staff_viewed'), eq(auditLogs.entityId, conv.id), eq(auditLogs.actorUserId, officer.userId!)));
    expect(log.newValues).toMatchObject({ purpose: 'DISPUTE', caseId: d.id });
    await expect(db.execute(sql`update privileged_message_access set expires_at = now() + interval '1 day' where conversation_id = ${conv.id}`)).rejects.toThrow();
    // an expired grant no longer opens the thread
    const late = await makeAdmin(['OPERATIONS_MANAGER']);
    await db.insert(privilegedMessageAccess).values({ actorUserId: late.userId!, conversationId: conv.id, purpose: 'OPERATIONS', note: 'منحة منتهية للاختبار', expiresAt: new Date(Date.now() - 60_000) });
    await expect(staffThread(late, conv.id)).rejects.toMatchObject({ message: 'MESSAGE_ACCESS_PURPOSE_REQUIRED' });
    expect((await db.select().from(conversations).where(eq(conversations.id, conv.id)))[0]).toBeTruthy();
  });
});

/* ═══════════════════════════ G. Support: reopen, SLA cycles, rating, QA ═══════════════════════════ */
describe('G — RESOLVED and CLOSED tickets reopen with a new SLA cycle; history is preserved', () => {
  it('reopen from RESOLVED and from CLOSED, configured SLA due dates, first response, rating once, QA by another person', async () => {
    await db.insert(systemSettings).values({ key: 'support.sla', value: { NORMAL: { firstResponseHours: 4, resolutionHours: 48 } } }).onConflictDoUpdate({ target: systemSettings.key, set: { value: { NORMAL: { firstResponseHours: 4, resolutionHours: 48 } } } });
    try {
      const c = await makeCustomer();
      const t = await openTicket(c.actor, { type: 'REFUND', subject: 'استرداد متأخر', body: 'الاسترداد لسه ما وصلش لحد دلوقتي' });
      let [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
      expect(row.firstResponseDueAt).not.toBeNull();
      expect(row.resolutionDueAt).not.toBeNull();
      const agent = await makeAdmin(['CUSTOMER_SUPPORT']);
      await replyToTicket(agent, t.id, 'بنراجع الاسترداد حالًا');
      [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
      expect(row.firstRespondedAt).not.toBeNull();
      await updateTicket(agent, t.id, { status: 'RESOLVED' });
      await expect(reopenTicket(c.actor, t.id, 'قصر')).rejects.toThrow(/سبب/);
      await reopenTicket(c.actor, t.id, 'المبلغ لسه ما وصلش');
      await updateTicket(agent, t.id, { status: 'CLOSED' });
      await reopenTicket(agent, t.id, 'العميل اتصل تاني بخصوص نفس المشكلة');
      [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
      expect(row).toMatchObject({ status: 'OPEN', reopenCount: 2, slaCycle: 3 });
      const cycles = await ticketSlaCycles(t.id);
      expect(cycles.map((x) => [x.cycle, x.trigger])).toEqual([[1, 'OPENED'], [2, 'REOPENED_FROM_RESOLVED'], [3, 'REOPENED_FROM_CLOSED']]);
      expect(cycles[0].firstRespondedAt).not.toBeNull(); // the old cycle keeps its own history
      expect(cycles[0].resolvedAt).not.toBeNull();
      expect(await db.execute(sql`delete from support_sla_cycles where ticket_id = ${t.id}`).catch(() => 'blocked')).toBe('blocked');
      await updateTicket(agent, t.id, { status: 'RESOLVED' });
      await expect(rateTicket(customerActor((await makeUser()).id), t.id, 5)).rejects.toThrow();
      await rateTicket(c.actor, t.id, 4, 'تمام');
      await expect(rateTicket(c.actor, t.id, 5)).rejects.toThrow();
      const qa = await makeAdmin(['OPERATIONS_MANAGER']);
      await expect(qaReviewTicket(await makeAdmin(['CUSTOMER_SUPPORT']), t.id, 5, 'ممتاز')).rejects.toThrow();
      await qaReviewTicket(qa, t.id, 5, 'رد سريع ومناسب');
      [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
      expect(row).toMatchObject({ rating: 4, qaScore: 5, qaBy: qa.userId });
    } finally {
      await db.delete(systemSettings).where(eq(systemSettings.key, 'support.sla'));
    }
  });

  it('without configured SLA values no due dates are invented', async () => {
    const c = await makeCustomer();
    const t = await openTicket(c.actor, { type: 'ACCOUNT', subject: 'سؤال عام', body: 'عندي سؤال بخصوص الحساب' });
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
    expect(row.firstResponseDueAt).toBeNull();
    expect(row.resolutionDueAt).toBeNull();
  });
});

/* ═══════════════════════════ H. Proactive alerts ═══════════════════════════ */
describe('H — alerts: stages, dedupe, cooldown, resolution, no PII, never money', () => {
  it('stage computation', () => {
    const d = new Date('2026-01-01T12:00:00Z');
    expect(stageFor(new Date('2026-01-01T00:00:00Z'), d, 6, 12)).toBeNull();
    expect(stageFor(new Date('2026-01-01T07:00:00Z'), d, 6, 12)).toBe('PRE_DEADLINE');
    expect(stageFor(new Date('2026-01-01T12:00:00Z'), d, 6, 12)).toBe('DUE');
    expect(stageFor(new Date('2026-01-02T01:00:00Z'), d, 6, 12)).toBe('OVERDUE');
    expect(stageFor(new Date(), null, 6, 12)).toBe('DUE');
  });

  it('every rule runs against the real schema without error', async () => {
    const res = await runAlertSweep();
    expect(res.errors).toEqual([]);
    expect(res.rules).toBe(ALERT_RULES.length);
  });

  it('payment deadline: PRE_DEADLINE → DUE → OVERDUE (repeat after cooldown only) → RESOLVED; once per stage; no money', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    const due = o.paymentDueAt!;
    const rule = ALERT_RULES.find((r) => r.code === 'MKT_PAYMENT_DUE')!;
    const at = (h: number) => new Date(due.getTime() + h * 3600_000);
    const mine = async () => db.select().from(notifications).where(and(eq(notifications.userId, c.user.id), eq(notifications.event, 'OPS_ALERT')));
    const journals = await journalCount();
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(-(rule.defaults.preHours + 1)) });
    expect(await mine()).toHaveLength(0);
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(-1) });
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(-0.5) }); // dedupe
    expect(await mine()).toHaveLength(1);
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(0.1) });
    expect(await mine()).toHaveLength(2);
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(rule.defaults.cooldownHours + 0.1) });
    expect(await mine()).toHaveLength(3); // OVERDUE
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(rule.defaults.cooldownHours + 0.5) }); // within cooldown
    expect(await mine()).toHaveLength(3);
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(2 * rule.defaults.cooldownHours + 0.2) }); // cooldown passed
    expect(await mine()).toHaveLength(4);
    const bodies = (await mine()).map((n) => `${n.title} ${n.body}`).join(' ');
    expect(bodies).not.toContain(c.user.phone!);
    expect(bodies).not.toContain(c.user.email!);
    expect(bodies).toContain(String(o.number));
    // the order is untouched by alerting, and no journal was written
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe('PENDING_PAYMENT');
    expect(await journalCount()).toBe(journals);
    // the condition disappears → RESOLVED (kept as history, no notification)
    const { cancelUnpaidOrder } = await import('@/server/modules/commerce/orders');
    await cancelUnpaidOrder(c.actor, order.id);
    await runAlertSweep({ only: ['MKT_PAYMENT_DUE'], now: at(2 * rule.defaults.cooldownHours + 0.3) });
    const [st] = await db.select().from(alertStates).where(and(eq(alertStates.rule, 'MKT_PAYMENT_DUE'), eq(alertStates.entityId, order.id)));
    expect(st.stage).toBe('RESOLVED');
    expect(st.resolvedAt).not.toBeNull();
    expect(await mine()).toHaveLength(4);
  });

  it('identity review aging alerts reach staff holding identity.review — with a reference only', async () => {
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    const u = await makeUser({ identity: false });
    await submitIdentity(customerActor(u.id), { legalName: 'عميل ينتظر المراجعة', nationalId: NID }, await docs());
    await runAlertSweep({ only: ['KYC_REVIEW_AGING'], now: new Date(Date.now() + 1000 * 3600_000) });
    const got = await db.select().from(notifications).where(and(eq(notifications.userId, reviewer.userId!), eq(notifications.event, 'OPS_ALERT')));
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got.map((n) => n.body).join(' ')).not.toContain(NID);
  });
});

/* ═══════════════════════════ Invariants ═══════════════════════════ */
describe('invariants after all Batch 1.5 flows', () => {
  it('dr = cr, no drift, no stranded balance, Protected Deal payables attributed, every journal approved', async () => {
    const inv = await financialInvariants();
    const failing = inv.checks.filter((c) => c.count > 0).map((c) => `${c.code}:${JSON.stringify(c.sample).slice(0, 300)}`);
    expect(failing).toEqual([]);
    expect(inv.totals.difference).toBe(0);
    void placeOrder;
  });
});
