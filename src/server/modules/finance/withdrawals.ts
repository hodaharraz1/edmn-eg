import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { withdrawalMachine } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireSeller, requireStepUp, SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { parseEgp } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { ledgerAdjustments, receivingDestinations, sellerPayoutMethods, sellers, settlements, withdrawalAllocations, withdrawalRequests, users, dealPayouts, externalDeals } from '@/server/db/schema';
import { allocationsOf, beneficiaryOf, lockBeneficiary, markAllocations, planAllocation, reservedAccount, sourceAccount, sourceCandidates, syncDealPayouts, type Allocation, type Scope } from './withdrawal-allocation';
import { grantApproval } from './approvals';
import { assertNotPaused } from './controls';
import { decryptJson } from '@/server/core/crypto';
import { notify } from '@/server/modules/notifications/notify';
import { activePayoutMethod, assertVerifiedDestination } from '@/server/modules/sellers/service';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';
import { completeMovementRequest, takeMovementRequest } from './movements';
import { storeUpload } from '@/server/storage/uploads';
import { requireReason, transition } from '../_shared';
import { accountBalance, postEntry } from './ledger';
import { assertNotSelfDealing } from './self-dealing';
import { formatEGP } from '@/lib/format';
import { quoteTransfer, type TransferQuote } from '@/server/modules/pricing/payout-costs';
import { transactionCosts } from '@/server/db/schema';

export type Withdrawal = typeof withdrawalRequests.$inferSelect;

/** Adds N business hours (Sun–Thu, Egypt work week; Fri/Sat skipped) — an SLA target, not proof of payment. */
export function addBusinessHours(from: Date, hours: number): Date {
  const d = new Date(from);
  let remaining = hours;
  while (remaining > 0) {
    d.setTime(d.getTime() + 3600_000);
    const day = d.getUTCDay(); // 5 = Friday, 6 = Saturday
    if (day !== 5 && day !== 6) remaining--;
  }
  return d;
}

/**
 * RequestWithdrawal — a REQUEST only. It moves NO money and reserves nothing in the ledger: concurrent
 * requests can never promise money, because the Admin approval re-checks and reserves atomically.
 * Idempotent on (seller, clientKey).
 */
export async function requestWithdrawal(
  actor: Actor,
  input: { amount: string | number; clientKey: string },
  opts: { source?: 'ON_DEMAND' | 'SCHEDULED'; settlementId?: string; sellerId?: string } = {},
) {
  const sellerId = opts.source === 'SCHEDULED' ? opts.sellerId! : requireSeller(actor, 'finance.withdraw');
  let amount: number;
  try {
    amount = typeof input.amount === 'number' ? input.amount : parseEgp(input.amount);
  } catch {
    throw validation('المبلغ غير صحيح');
  }
  if (!input.clientKey || input.clientKey.length < 8) throw validation('طلب غير صالح');
  return db.transaction(async (tx) => {
    const [dupe] = await tx.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.sellerId, sellerId), eq(withdrawalRequests.clientKey, input.clientKey)));
    if (dupe) return { withdrawal: dupe, created: false };
    const [seller] = await tx.select().from(sellers).where(eq(sellers.id, sellerId)).for('update');
    if (!seller || !['APPROVED', 'RESTRICTED'].includes(seller.status)) throw new DomainError('FORBIDDEN', 'السحب غير متاح لحالة حسابك الحالية');
    // Financial seller operation: the store owner's identity must be verified (also for scheduled settlements).
    const { requireApprovedIdentity } = await import('@/server/modules/identity/service');
    await requireApprovedIdentity(tx, actor, 'WITHDRAWAL_REQUEST', seller.ownerUserId);
    // Same account lock as closure: a closing account cannot race a new withdrawal request.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'account:' + seller.ownerUserId}))`);
    const closing = await tx.execute(sql`select 1 from account_closure_requests where user_id = ${seller.ownerUserId} and status = 'PENDING' limit 1`);
    if (closing.rows.length) throw invalidState('فيه طلب إغلاق حساب قيد التنفيذ');
    if (seller.payoutHoldUntil && seller.payoutHoldUntil > new Date()) {
      throw invalidState(`تم تغيير بيانات استلام الأموال مؤخراً. السحب متاح بعد ${seller.payoutHoldUntil.toLocaleString('ar-EG-u-nu-latn')}`);
    }
    const min = await getSetting('withdrawals.minimumAmount', tx);
    if (amount < min) throw validation(`الحد الأدنى للسحب ${formatEGP(min)}`);
    // Early, friendly check only — the authoritative check runs at approval under the account lock.
    // B2: post-release dispute/return holds are not withdrawable.
    const { sellerFundsPosition } = await import('./holds');
    const pos = await sellerFundsPosition(tx, sellerId);
    if (amount > pos.withdrawable) {
      throw new DomainError('INSUFFICIENT_BALANCE', pos.held > 0 ? `المبلغ أكبر من رصيدك القابل للسحب (${formatEGP(pos.withdrawable)}) — جزء من رصيدك محجوز لنزاعات/مرتجعات مفتوحة` : 'المبلغ أكبر من رصيدك المتاح');
    }
    const pm = await activePayoutMethod(tx, sellerId);
    if (!pm) throw invalidState('لا توجد بيانات استلام أموال معتمدة. أضف بيانات استلام الأموال وانتظر اعتمادها');
    // Transfer cost quoted BEFORE the request (frozen at approval). This is never the EDMN sale fee:
    // seller fees were assessed once on each sale and are not charged again here.
    const quote = await quoteTransfer(tx, { payoutType: pm.type, amount, sellerId, payoutMethodId: pm.id });
    const hard = quote.violations.filter((v) => v.startsWith('الحد الأقصى للعملية') || v.startsWith('مبلغ السحب أقل'));
    if (hard.length) throw validation(hard.join('، '));
    const slaHours = await getSetting('withdrawals.slaBusinessHours', tx);
    const [w] = await tx
      .insert(withdrawalRequests)
      .values({
        sellerId,
        userId: seller.ownerUserId,
        sourceType: 'MARKETPLACE',
        isTest: !(await realMoneyEnabled(tx)),
        amount,
        source: opts.source ?? 'ON_DEMAND',
        settlementId: opts.settlementId ?? null,
        payoutMethodId: pm.id,
        payoutType: pm.type,
        payoutMasked: pm.maskedLabel,
        clientKey: input.clientKey,
        requestedBy: actor.userId,
        slaDueAt: addBusinessHours(new Date(), slaHours),
        requiresDualControl: await needsDualControl(tx, sellerId, amount),
        ...transferFields(quote),
      })
      .returning();
    const { recordTransition } = await import('@/server/audit/audit');
    await recordTransition(tx, actor, 'withdrawal', w.id, null, 'REQUESTED');
    await audit(tx, actor, { action: 'withdrawal.requested', entityType: 'withdrawal', entityId: w.id, newValues: { amount, payout: pm.maskedLabel, source: w.source, reserved: false } });
    await notify(tx, { event: 'WITHDRAWAL_REQUESTED', userIds: [seller.ownerUserId], vars: { wd: w.number, amount: formatEGP(amount) }, link: '/seller/withdrawals', dedupeKey: `wd:${w.id}:requested` });
    return { withdrawal: w, created: true };
  });
}

function transferFields(q: TransferQuote) {
  return {
    payoutChannel: q.channel,
    payoutChannelConfigId: q.config.id,
    transferCostPayer: q.payer,
    transferCost: q.payer === 'SELLER_PAYS' ? q.cost : 0,
    netTransferAmount: q.net,
    transferCostSnapshot: { ...q.snapshot, warnings: q.warnings, violations: q.violations },
  };
}

export type AccountDestination = { kind: 'STORE_PAYOUT_METHOD' } | { kind: 'RECEIVING_DESTINATION'; id: string };

/** The store a user owns (Marketplace source + store payout method), if any. */
async function ownedStore(tx: DbOrTx, userId: string) {
  const [s] = await tx.select().from(sellers).where(eq(sellers.ownerUserId, userId)).limit(1);
  return s ?? null;
}

/** A store in debt (negative available after a post-release refund) blocks EVERY withdrawal of its owner. */
async function assertNoLiability(tx: DbOrTx, userId: string, lock = false) {
  const store = await ownedStore(tx, userId);
  if (store && (await accountBalance(tx, { code: 'SELLER_AVAILABLE', sellerId: store.id }, lock)) < 0) {
    throw invalidState('على حسابك مديونية (رصيد متاح سالب بعد استرداد). لا يمكن صرف أي سحب قبل تسويتها');
  }
}

/** Resolve and verify the destination of an account-level withdrawal (owner + verification + fingerprint). */
async function resolveAccountDestination(tx: DbOrTx, userId: string, dest: AccountDestination) {
  if (dest.kind === 'STORE_PAYOUT_METHOD') {
    const store = await ownedStore(tx, userId);
    if (!store || !['APPROVED', 'RESTRICTED'].includes(store.status)) throw invalidState('لا يوجد متجر معتمد مرتبط بحسابك');
    if (store.payoutHoldUntil && store.payoutHoldUntil > new Date()) throw invalidState('تم تغيير بيانات استلام الأموال مؤخراً. السحب متاح بعد انتهاء فترة التجميد');
    const pm = await activePayoutMethod(tx, store.id);
    if (!pm) throw invalidState('لا توجد بيانات استلام أموال معتمدة للمتجر');
    assertVerifiedDestination(pm);
    return { sellerId: store.id, scope: 'ALL_FOR_STORE_DESTINATION' as Scope, payoutMethodId: pm.id, receivingDestinationId: null, type: pm.type, masked: pm.maskedLabel, recipientKey: pm.id };
  }
  const { approvedDestinationOf, destinationIntact } = await import('@/server/modules/identity/receiving');
  const d = await approvedDestinationOf(tx, userId, dest.id);
  if (!d) throw invalidState('وجهة الصرف غير متحقق منها أو لا تخصك. أضف «بيانات استلام الأموال» وانتظر التحقق منها');
  if (!destinationIntact(d)) throw invalidState('بيانات وجهة الصرف لا تطابق النسخة المتحقق منها');
  // Marketplace funds only leave through the store's verified payout method → Protected Deal funds only here.
  return { sellerId: null, scope: 'PROTECTED_DEAL' as Scope, payoutMethodId: null, receivingDestinationId: d.id, type: d.type, masked: d.maskedLabel, recipientKey: d.id };
}

/**
 * Account-level (cross-source) withdrawal by the beneficiary user — a Protected-Deal-only seller (no store) or a
 * store owner withdrawing Marketplace + Protected Deal funds together. A REQUEST only: nothing moves and nothing is
 * reserved until an Admin approves; the source split is computed and stored at approval (allocation policy in
 * withdrawal-allocation.ts). Idempotent on (user, clientKey).
 */
export async function requestAccountWithdrawal(actor: Actor, input: { amount: string | number; clientKey: string; destination: AccountDestination }) {
  const userId = actor.userId;
  if (!userId || actor.type !== 'CUSTOMER') throw forbidden();
  let amount: number;
  try {
    amount = typeof input.amount === 'number' ? input.amount : parseEgp(input.amount);
  } catch {
    throw validation('المبلغ غير صحيح');
  }
  if (!input.clientKey || input.clientKey.length < 8) throw validation('طلب غير صالح');
  return db.transaction(async (tx) => {
    const [dupe] = await tx.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.userId, userId), eq(withdrawalRequests.clientKey, input.clientKey)));
    if (dupe) return { withdrawal: dupe, created: false };
    const { requireApprovedIdentity } = await import('@/server/modules/identity/service');
    await requireApprovedIdentity(tx, actor, 'WITHDRAWAL_REQUEST', userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'account:' + userId}))`);
    const closing = await tx.execute(sql`select 1 from account_closure_requests where user_id = ${userId} and status = 'PENDING' limit 1`);
    if (closing.rows.length) throw invalidState('فيه طلب إغلاق حساب قيد التنفيذ');
    const min = await getSetting('withdrawals.minimumAmount', tx);
    if (amount < min) throw validation(`الحد الأدنى للسحب ${formatEGP(min)}`);
    await assertNoLiability(tx, userId);
    const { assertClaimsCoveredByAvailable } = await import('./holds');
    await assertClaimsCoveredByAvailable(tx, userId, false); // friendly; re-checked under locks at approval/execution
    const dest = await resolveAccountDestination(tx, userId, input.destination);
    const { candidates } = await sourceCandidates(tx, { userId, sellerId: dest.sellerId, scope: dest.scope, lock: false });
    const plan = planAllocation(candidates, amount);
    // Early, friendly check only — the authoritative allocation runs at approval under locks.
    if (!plan) throw new DomainError('INSUFFICIENT_BALANCE', 'المبلغ أكبر من رصيدك المتاح للسحب لهذه الوجهة');
    const quote = await quoteTransfer(tx, { payoutType: dest.type, amount, sellerId: dest.sellerId ?? '', payoutMethodId: dest.recipientKey });
    const hard = quote.violations.filter((v) => v.startsWith('الحد الأقصى للعملية') || v.startsWith('مبلغ السحب أقل'));
    if (hard.length) throw validation(hard.join('، '));
    const kinds = new Set(plan.map((x) => x.sourceType));
    const slaHours = await getSetting('withdrawals.slaBusinessHours', tx);
    const [w] = await tx
      .insert(withdrawalRequests)
      .values({
        sellerId: dest.sellerId,
        userId,
        receivingDestinationId: dest.receivingDestinationId,
        sourceType: kinds.size > 1 ? 'MIXED' : kinds.has('PROTECTED_DEAL') ? 'PROTECTED_DEAL' : 'MARKETPLACE',
        isTest: !(await realMoneyEnabled(tx)),
        amount,
        source: 'ACCOUNT',
        payoutMethodId: dest.payoutMethodId,
        payoutType: dest.type,
        payoutMasked: dest.masked,
        clientKey: input.clientKey,
        requestedBy: userId,
        slaDueAt: addBusinessHours(new Date(), slaHours),
        requiresDualControl: true,
        ...transferFields(quote),
      })
      .returning();
    const { recordTransition } = await import('@/server/audit/audit');
    await recordTransition(tx, actor, 'withdrawal', w.id, null, 'REQUESTED');
    await audit(tx, actor, { action: 'withdrawal.requested', entityType: 'withdrawal', entityId: w.id, newValues: { amount, payout: dest.masked, scope: dest.scope, plannedSources: plan.map((x) => ({ source: x.sourceType, amount: x.amount })), reserved: false } });
    await notify(tx, { event: 'WITHDRAWAL_REQUESTED', userIds: [userId], vars: { wd: w.number, amount: formatEGP(amount) }, link: '/account/earnings', dedupeKey: `wd:${w.id}:requested` });
    return { withdrawal: w, created: true };
  });
}

/** Read-only preview of the source split an account-level withdrawal would use now (allocation policy). */
export async function previewAccountWithdrawal(actor: Actor, amountInput: string | number, destination: AccountDestination) {
  const userId = actor.userId;
  if (!userId) throw forbidden();
  const amount = typeof amountInput === 'number' ? amountInput : parseEgp(amountInput);
  const dest = await resolveAccountDestination(db, userId, destination);
  const { candidates } = await sourceCandidates(db, { userId, sellerId: dest.sellerId, scope: dest.scope, lock: false });
  const total = candidates.reduce((n, c) => n + c.available, 0);
  return { amount, available: total, plan: planAllocation(candidates, amount), masked: dest.masked };
}

/**
 * Seller preview before requesting: amount, transfer cost, expected net. Read-only; moves nothing.
 * The EDMN fees already assessed on the sales are shown elsewhere for information only.
 */
export async function previewWithdrawal(actor: Actor, amountInput: string | number) {
  const sellerId = requireSeller(actor, 'finance.withdraw');
  let amount: number;
  try {
    amount = typeof amountInput === 'number' ? amountInput : parseEgp(amountInput);
  } catch {
    throw validation('المبلغ غير صحيح');
  }
  const pm = await activePayoutMethod(db, sellerId);
  if (!pm) throw invalidState('لا توجد بيانات استلام أموال معتمدة');
  const q = await quoteTransfer(db, { payoutType: pm.type, amount, sellerId, payoutMethodId: pm.id });
  return { amount, transferCost: q.payer === 'SELLER_PAYS' ? q.cost : 0, payer: q.payer, net: q.net, channel: q.channel, warnings: q.warnings, violations: q.violations };
}

/** Owner rule (Batch 1.5): every payout is two-person — no threshold. Kept as a function for callers. */
async function needsDualControl(_tx: DbOrTx, _sellerId: string, _amount: number) {
  return true;
}

async function lockWithdrawal(tx: DbOrTx, id: string) {
  const [w] = await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)).for('update');
  if (!w) throw notFound('طلب السحب');
  return w;
}

async function notifySeller(tx: DbOrTx, w: Withdrawal, status: string, key: string) {
  const owner = await beneficiaryOf(tx, w);
  await notify(tx, { event: 'WITHDRAWAL_UPDATED', userIds: [owner], vars: { wd: w.number, status }, link: w.sellerId ? '/seller/withdrawals' : '/account/earnings', dedupeKey: `wd:${w.id}:${key}` });
}

/** Separation of duties: staff never act on a withdrawal of a store they belong to, nor on their own money. */
async function assertNotOwnWithdrawal(tx: DbOrTx, actor: Actor, w: Withdrawal) {
  if (w.sellerId) await assertNotSelfDealing(tx, actor, w.sellerId);
  if (actor.userId && actor.userId === (await beneficiaryOf(tx, w))) throw forbidden('لا يمكنك تنفيذ إجراء على سحب يخصك');
}

/** Destination still verified, owned by the beneficiary and identical to the snapshot frozen at approval. */
async function assertDestinationStillValid(tx: DbOrTx, w: Withdrawal) {
  const snap = (w.destinationSnapshot ?? null) as { payoutMethodId?: string; receivingDestinationId?: string; fingerprint?: string } | null;
  if (snap?.payoutMethodId) {
    const [pm] = await tx.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, snap.payoutMethodId));
    if (!pm || pm.status !== 'ACTIVE') throw invalidState('وجهة الصرف المعتمدة لم تعد صالحة. ارفض الطلب ويُطلب سحب جديد');
    assertVerifiedDestination(pm);
  } else if (snap?.receivingDestinationId) {
    const { destinationIntact } = await import('@/server/modules/identity/receiving');
    const [d] = await tx.select().from(receivingDestinations).where(eq(receivingDestinations.id, snap.receivingDestinationId));
    const owner = await beneficiaryOf(tx, w);
    if (!d || d.userId !== owner || d.status !== 'APPROVED') throw invalidState('وجهة الصرف لم تعد متحققًا منها (اتغيرت أو اتأرشفت أو مطلوب إعادة التحقق). ارفض الطلب ويُطلب سحب جديد');
    if (d.fingerprint !== snap.fingerprint || !destinationIntact(d)) throw invalidState('بيانات وجهة الصرف لا تطابق النسخة المتحقق منها وقت الاعتماد. لا يمكن الصرف');
  }
}

/**
 * Return reserved funds to their SOURCES — per allocation, exactly once (approved, two-person reclassification,
 * Maker = `makerId`): Marketplace → SELLER_AVAILABLE of that store, Protected Deal → DEAL_PAYOUTS_PAYABLE (the
 * deal payout becomes payable again).
 */
async function reverseReservation(tx: DbOrTx, actor: Actor, w: Withdrawal, reason: string, makerId: string) {
  if (!w.reservedAt) return;
  const { rows } = await allocationsOf(tx, w);
  const live = rows.filter((a) => a.status === 'RESERVED');
  if (!live.length) return;
  const total = live.reduce((n, a) => n + a.amount, 0);
  const approval = await grantApproval(tx, actor, {
    dualControl: { requestedBy: makerId },
    action: 'WITHDRAWAL_RELEASE_RESERVATION',
    entityType: 'withdrawal',
    entityId: w.id,
    amount: total,
    economicVersion: `amount:${w.amount}:status:${w.status}:alloc:${live.map((a) => `${a.sourceType}:${a.amount}`).join(',')}`,
    reason,
    idempotencyKey: `wd-reverse:${w.id}`,
  });
  const posted = await postEntry(tx, actor, {
    entryType: 'WITHDRAWAL_REVERSAL',
    sourceType: 'withdrawal',
    sourceId: w.id,
    idempotencyKey: `wd-reverse:${w.id}`,
    description: `إلغاء حجز طلب السحب #${w.number}`,
    approvalId: approval.id,
    lines: live.flatMap((a) => [
      { account: reservedAccount(a), debit: a.amount, memo: `allocation ${a.seq} ${a.sourceType}` },
      { account: sourceAccount(a), credit: a.amount, memo: `restored to ${a.sourceType}` },
    ]),
  });
  for (const a of live) await markAllocations(tx, [a], { status: 'RELEASED', restoredAmount: a.amount, releaseJournalId: posted.entryId || null });
  await syncDealPayouts(tx, actor, live.filter((a) => a.sourceType === 'PROTECTED_DEAL').map((a) => a.sourceEntityId));
}

/** Seller cancels a request that was not yet approved (nothing was reserved, so nothing moves). */
export async function cancelWithdrawal(actor: Actor, id: string) {
  const sellerId = actor.sellerId ? requireSeller(actor, 'finance.withdraw') : null;
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    // Store staff cancel their store's requests; a beneficiary cancels their own account-level request.
    if (sellerId ? w.sellerId !== sellerId : !actor.userId || w.userId !== actor.userId || w.requestedBy !== actor.userId) throw forbidden();
    if (w.status === 'CANCELLED') return;
    if (w.reservedAt) throw invalidState('الطلب ده اتعتمد والمبلغ اتحجز. لإلغائه تواصل مع فريق اضمن');
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'CANCELLED');
    await tx.update(withdrawalRequests).set({ status: 'CANCELLED' }).where(eq(withdrawalRequests.id, w.id));
    await audit(tx, actor, { action: 'withdrawal.cancelled', entityType: 'withdrawal', entityId: w.id });
  });
}

export async function reviewWithdrawal(actor: Actor, id: string) {
  requirePermission(actor, 'withdrawals.approve');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status !== 'REQUESTED') return;
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'UNDER_REVIEW');
    await tx.update(withdrawalRequests).set({ status: 'UNDER_REVIEW', reviewedBy: actor.userId }).where(eq(withdrawalRequests.id, w.id));
    await audit(tx, actor, { action: 'withdrawal.review_started', entityType: 'withdrawal', entityId: w.id });
  });
}

/**
 * Checker step: approve AND atomically reserve (AVAILABLE → WITHDRAWAL_RESERVED) under one approval.
 * Revalidates under locks: seller status, payout hold, ledger/projection agreement, negative position,
 * available ≥ amount (guard), destination still verified. The destination is frozen in a snapshot.
 */
export async function approveWithdrawal(actor: Actor, id: string, note?: string) {
  requirePermission(actor, 'withdrawals.approve');
  requireStepUp(actor);
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'APPROVED' || w.reservedAt) return;
    await assertNotPaused(tx, 'killswitch.withdrawals');
    await assertNotOwnWithdrawal(tx, actor, w);
    const owner = await beneficiaryOf(tx, w);
    await lockBeneficiary(tx, owner);
    // B2: the store's funds lock comes before any ledger-row lock (one lock order with holds and refund approval).
    const { assertClaimsCoveredByAvailable, lockOwnerStoreFunds } = await import('./holds');
    await lockOwnerStoreFunds(tx, owner);
    const { identityStatus } = await import('@/server/modules/identity/service');
    if ((await identityStatus(tx, owner)) !== 'APPROVED') throw invalidState('هوية صاحب السحب غير متحقق منها حاليًا. لا يمكن اعتماد سحب جديد');
    await assertNoLiability(tx, owner, true);
    await assertClaimsCoveredByAvailable(tx, owner, false);
    let destination: Record<string, unknown>;
    if (w.sellerId) {
      const [seller] = await tx.select().from(sellers).where(eq(sellers.id, w.sellerId)).for('update');
      if (seller.status === 'SUSPENDED') throw invalidState('حساب البائع موقوف. لا يمكن اعتماد السحب');
      if (seller.payoutHoldUntil && seller.payoutHoldUntil > new Date()) throw invalidState('على البائع تجميد صرف مؤقت (تغيير بيانات استلام الأموال)');
      const { sellerLedgerDrift } = await import('@/server/modules/commerce/fulfilment');
      if (await sellerLedgerDrift(tx, w.sellerId)) throw invalidState('أرصدة البائع المخزنة لا تطابق دفتر الأستاذ — تم إيقاف الاعتماد');
      const [pm] = w.payoutMethodId ? await tx.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, w.payoutMethodId)) : [];
      if (!pm || pm.status !== 'ACTIVE') throw invalidState('بيانات استلام الأموال المطلوبة لم تعد معتمدة. ارفض الطلب واطلب من البائع طلبًا جديدًا');
      assertVerifiedDestination(pm);
      destination = { payoutMethodId: pm.id, type: pm.type, masked: pm.maskedLabel, holderName: pm.holderName, verifiedAt: pm.verifiedAt?.toISOString() ?? null };
    } else {
      const { approvedDestinationOf, destinationIntact } = await import('@/server/modules/identity/receiving');
      const d = w.receivingDestinationId ? await approvedDestinationOf(tx, owner, w.receivingDestinationId) : null;
      if (!d || !destinationIntact(d)) throw invalidState('وجهة الصرف لم تعد متحققًا منها. ارفض الطلب ويُطلب سحب جديد');
      destination = { receivingDestinationId: d.id, version: d.version, type: d.type, masked: d.maskedLabel, holderName: d.holderName, fingerprint: d.fingerprint, verifiedAt: d.reviewedAt?.toISOString() ?? null, verifiedBy: d.reviewedBy };
    }
    // Authoritative source allocation under locks (policy: withdrawal-allocation.ts).
    // Store requests (store context / scheduled settlement) use Marketplace funds only; account requests use the
    // beneficiary's Protected Deal payables, plus Marketplace funds when paid to the store's own payout method.
    const scope: Scope = w.source !== 'ACCOUNT' ? 'MARKETPLACE' : w.sellerId ? 'ALL_FOR_STORE_DESTINATION' : 'PROTECTED_DEAL';
    const { candidates, marketplaceHeld } = await sourceCandidates(tx, { userId: owner, sellerId: w.sellerId, scope, lock: true });
    const plan = planAllocation(candidates, w.amount);
    if (!plan) throw new DomainError('INSUFFICIENT_BALANCE', 'الرصيد المتاح من المصادر المسموح بها لا يغطي مبلغ السحب الآن');
    const recipientKey = w.payoutMethodId ?? w.receivingDestinationId;
    const tq = await quoteTransfer(tx, { payoutType: w.payoutType, amount: w.amount, sellerId: w.sellerId ?? '', payoutMethodId: recipientKey, excludeWithdrawalId: w.id });
    if (tq.violations.length) throw invalidState(`تجاوز حدود قناة التحويل: ${tq.violations.join('، ')}. لا يتم تقسيم السحب أو تغيير القناة تلقائيًا`);
    const approval = await grantApproval(tx, actor, {
      action: 'WITHDRAWAL_RESERVATION',
      entityType: 'withdrawal',
      entityId: w.id,
      amount: w.amount,
      economicVersion: `amount:${w.amount}:dest:${recipientKey}:alloc:${plan.map((x) => `${x.sourceType}:${x.sourceEntityId}:${x.amount}`).join(',')}`,
      reason: note?.trim() || 'اعتماد طلب السحب وحجز المبلغ',
      idempotencyKey: `wd:${w.id}`,
      destinationSnapshot: destination,
    });
    const rows = await tx
      .insert(withdrawalAllocations)
      .values(plan.map((x, i) => ({ withdrawalId: w.id, seq: i + 1, userId: owner, sellerId: x.sourceType === 'MARKETPLACE' ? x.sourceEntityId : null, sourceType: x.sourceType, sourceEntityType: x.sourceEntityType, sourceEntityId: x.sourceEntityId, dealId: x.dealId, amount: x.amount })))
      .returning();
    const posted = await postEntry(tx, actor, {
      entryType: 'WITHDRAWAL_RESERVE',
      sourceType: 'withdrawal',
      sourceId: w.id,
      idempotencyKey: `wd:${w.id}`,
      description: `حجز مبلغ طلب السحب #${w.number} عند الاعتماد`,
      approvalId: approval.id,
      lines: rows.flatMap((a) => [
        { account: sourceAccount(a), debit: a.amount, memo: `allocation ${a.seq} ${a.sourceType}${a.dealId ? ` deal ${a.dealId}` : ''}` },
        { account: reservedAccount(a), credit: a.amount, memo: `reserved for withdrawal #${w.number}` },
      ]),
      guards: [
        // B2: after the reservation the store must still cover its active holds (SELLER_AVAILABLE ≥ held).
        ...rows.filter((a) => a.sourceType === 'MARKETPLACE').map((a) => ({ account: sourceAccount(a), min: marketplaceHeld })),
        ...(rows.some((a) => a.sourceType === 'PROTECTED_DEAL') ? [{ account: { code: 'DEAL_PAYOUTS_PAYABLE' as const }, min: 0 }] : []),
      ],
    });
    await markAllocations(tx, rows, { reservationJournalId: posted.entryId || null });
    const kinds = new Set(rows.map((a) => a.sourceType));
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'APPROVED', note);
    await tx
      .update(withdrawalRequests)
      .set({ status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date(), reservedAt: new Date(), reserveApprovalId: approval.id, destinationSnapshot: destination, requiresDualControl: true, userId: owner, sourceType: kinds.size > 1 ? 'MIXED' : kinds.has('PROTECTED_DEAL') ? 'PROTECTED_DEAL' : 'MARKETPLACE', ...transferFields(tq) })
      .where(eq(withdrawalRequests.id, w.id));
    await audit(tx, actor, { action: 'withdrawal.approved', entityType: 'withdrawal', entityId: w.id, newValues: { amount: w.amount, approvalId: approval.id, reserved: true, dualControl: true, allocations: rows.map((a) => ({ seq: a.seq, source: a.sourceType, entity: a.sourceEntityId, amount: a.amount })) }, reason: note ?? null });
    await notifySeller(tx, w, 'تم الاعتماد وحجز المبلغ', 'approved');
  });
}

export async function markWithdrawalProcessing(actor: Actor, id: string) {
  requirePermission(actor, 'withdrawals.pay');
  requireStepUp(actor); // from here on the money may leave EDMN: the request can no longer be "rejected"
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'PROCESSING') return;
    // B2: starting the transfer is the point of no return ("may we send money?") — full revalidation against the
    // CURRENT position: every hold and every booked debt must be covered by AVAILABLE. The reservation itself never
    // counts (a consumed hold must not let reserved money that backs a booked debt leave EDMN).
    const owner = await beneficiaryOf(tx, w);
    const { assertClaimsCoveredByAvailable, lockOwnerStoreFunds } = await import('./holds');
    await lockOwnerStoreFunds(tx, owner);
    await assertClaimsCoveredByAvailable(tx, owner, false);
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'PROCESSING');
    await tx.update(withdrawalRequests).set({ status: 'PROCESSING', processingBy: actor.userId }).where(eq(withdrawalRequests.id, w.id));
    await audit(tx, actor, { action: 'withdrawal.processing', entityType: 'withdrawal', entityId: w.id });
    await notifySeller(tx, w, 'جارٍ التحويل', 'processing');
  });
}

/**
 * Maker step: record that the money was actually transferred. Separate approval (WITHDRAWAL_PAYOUT);
 * with dual control the payer must be a different person from the approver (DB CHECK). Idempotent.
 * Recording a payout never proves it succeeded externally — reconciliation matches it later.
 */
export async function markWithdrawalPaid(actor: Actor, id: string, reference: string, proof?: { data: Buffer; name: string } | null, actualTransferCostInput?: number | null) {
  requirePermission(actor, 'withdrawals.pay');
  requireStepUp(actor);
  const ref = reference?.trim();
  if (!ref || ref.length < 3) throw validation('رقم مرجع التحويل مطلوب');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'PAID' || w.status === 'RETURNED') return;
    if (w.status !== 'APPROVED' && w.status !== 'PROCESSING' && w.status !== 'TRANSFER_UNCERTAIN') throw invalidState('يجب اعتماد طلب السحب قبل تسجيل الصرف');
    if (!w.reservedAt) throw invalidState('المبلغ لم يُحجز بعد. يجب اعتماده أولاً');
    await assertNotPaused(tx, 'killswitch.payouts');
    // Owner rule: always two-person — the reservation approver is the Maker, the payer must be someone else.
    if (!w.approvedBy) throw invalidState('لا يوجد معتمد مسجل لهذا السحب. لا يمكن الصرف');
    if (w.approvedBy === actor.userId) throw forbidden('منفذ الصرف يجب أن يكون شخصاً مختلفاً عن معتمد السحب');
    await assertNotOwnWithdrawal(tx, actor, w);
    if (w.isTest && (await realMoneyEnabled(tx))) throw invalidState('هذا سحب تجريبي (TEST) ولا يمكن صرفه بعد تفعيل الأموال الحقيقية');
    // B2: lock the store's funds before any ledger-row lock. Two different questions:
    //  - APPROVED → PAID sends money now ("may we send?"): full revalidation — holds and booked debt must be
    //    covered by AVAILABLE, and no seller debt.
    //  - PROCESSING / TRANSFER_UNCERTAIN → PAID records an external transfer that was ALREADY initiated under that
    //    same check ("did money leave?"): a debt or hold that appeared afterwards must not block recording the fact.
    //    The entry only consumes this withdrawal's own reservation (RESERVED → out): it never touches
    //    SELLER_AVAILABLE, the debt or any hold, and it is recorded once (status guard + idempotency key).
    const payee = await beneficiaryOf(tx, w);
    const { assertClaimsCoveredByAvailable, lockOwnerStoreFunds } = await import('./holds');
    await lockOwnerStoreFunds(tx, payee);
    const sendsNow = w.status === 'APPROVED';
    if (sendsNow) await assertClaimsCoveredByAvailable(tx, payee, false);
    if (w.sellerId) {
      const [seller] = await tx.select().from(sellers).where(eq(sellers.id, w.sellerId)).for('update');
      if (!seller || seller.status === 'SUSPENDED') throw invalidState('حساب البائع موقوف. لا يمكن صرف السحب');
      if (seller.payoutHoldUntil && seller.payoutHoldUntil > new Date()) throw invalidState('على البائع تجميد صرف مؤقت (تغيير بيانات استلام الأموال). لا يمكن الصرف الآن');
      if (sendsNow && (await accountBalance(tx, { code: 'SELLER_AVAILABLE', sellerId: w.sellerId }, true)) < 0) {
        throw invalidState('على البائع مديونية (رصيد متاح سالب بعد استرداد). يجب تسويتها قبل صرف أي سحب');
      }
    }
    if (sendsNow) await assertNoLiability(tx, payee, true);
    await assertDestinationStillValid(tx, w);
    const { rows: allocations } = await allocationsOf(tx, w);
    const live = allocations.filter((a) => a.status === 'RESERVED');
    if (live.reduce((n, a) => n + a.amount, 0) !== w.amount) throw invalidState('توزيع مصادر السحب لا يطابق مبلغه. تم إيقاف الصرف وإبلاغ المالية');
    // Transfer cost: the seller never pays more than the cost quoted and frozen at approval; any excess
    // (or the whole cost under EDMN_PAYS) is an EDMN expense. The EDMN sale fees are NOT charged here.
    const quoted = w.transferCost;
    const actual = actualTransferCostInput ?? quoted;
    if (!Number.isSafeInteger(actual) || actual < 0) throw validation('رسوم التحويل الفعلية غير صحيحة');
    const sellerPays = (w.transferCostPayer ?? 'SELLER_PAYS') === 'SELLER_PAYS' && !!w.transferCostPayer;
    const sellerCharge = sellerPays ? Math.min(actual, quoted) : 0;
    const edmnCost = actual - sellerCharge;
    const net = w.amount - sellerCharge;
    if (net <= 0) throw invalidState('صافي التحويل غير صالح');
    if (w.payoutChannel) {
      const tq = await quoteTransfer(tx, { payoutType: w.payoutType, amount: w.amount, sellerId: w.sellerId ?? '', payoutMethodId: w.payoutMethodId ?? w.receivingDestinationId, excludeWithdrawalId: w.id });
      if (tq.violations.length) throw invalidState(`تجاوز حدود قناة التحويل: ${tq.violations.join('، ')}`);
    }
    const approval = await grantApproval(tx, actor, {
      action: 'WITHDRAWAL_PAYOUT',
      entityType: 'withdrawal',
      entityId: w.id,
      amount: w.amount + edmnCost,
      economicVersion: `amount:${w.amount}:reserve:${w.reserveApprovalId ?? 'legacy'}:cost:${actual}:seller:${sellerCharge}`,
      reason: `تسجيل صرف — مرجع ${ref}`,
      idempotencyKey: `wd-paid:${w.id}`,
      destinationSnapshot: (w.destinationSnapshot as Record<string, unknown>) ?? { masked: w.payoutMasked, type: w.payoutType },
      dualControl: { requestedBy: w.approvedBy },
    });
    const file = proof ? await storeUpload(tx, actor, { purpose: 'WITHDRAWAL_PROOF', data: proof.data, originalName: proof.name }) : null;
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'PAID');
    await tx
      .update(withdrawalRequests)
      .set({ status: 'PAID', paidBy: actor.userId, paidAt: new Date(), paidReference: ref, proofFileId: file?.id ?? null, payoutApprovalId: approval.id, actualTransferCost: actual, netTransferAmount: net })
      .where(eq(withdrawalRequests.id, w.id));
    const posted = await postEntry(tx, actor, {
      entryType: 'WITHDRAWAL_PAID',
      sourceType: 'withdrawal',
      sourceId: w.id,
      idempotencyKey: `wd-paid:${w.id}`,
      description: `صرف طلب السحب #${w.number} — مرجع ${ref}`,
      approvalId: approval.id,
      lines: [
        ...live.map((a) => ({ account: reservedAccount(a), debit: a.amount, memo: `allocation ${a.seq} ${a.sourceType} paid out` })),
        { account: { code: 'PLATFORM_CASH' }, credit: net, memo: 'net transferred to the seller' },
        ...(sellerCharge > 0 ? [{ account: { code: 'PLATFORM_CASH' as const }, credit: sellerCharge, memo: 'transfer cost paid to the provider (borne by the seller)' }] : []),
        ...(edmnCost > 0
          ? [
              { account: { code: 'TRANSFER_COST_EXPENSE' as const }, debit: edmnCost, memo: 'transfer cost borne by EDMN' },
              { account: { code: 'PLATFORM_CASH' as const }, credit: edmnCost, memo: 'transfer cost paid to the provider (borne by EDMN)' },
            ]
          : []),
      ],
    });
    for (const [borneBy, amt] of [['SELLER', sellerCharge], ['EDMN', edmnCost]] as const) {
      if (amt > 0) {
        await tx.insert(transactionCosts).values({ entityType: 'withdrawal', entityId: w.id, costType: 'PAYOUT_TRANSFER', nature: 'ACTUAL', borneBy, amount: amt, reference: ref, journalEntryId: posted.entryId || null, idempotencyKey: `wd-cost:${w.id}:${borneBy}`, createdBy: actor.userId }).onConflictDoNothing();
      }
    }
    await markAllocations(tx, live, { status: 'PAID', payoutJournalId: posted.entryId || null });
    await syncDealPayouts(tx, actor, live.filter((a) => a.sourceType === 'PROTECTED_DEAL').map((a) => a.sourceEntityId), { reference: ref, approvalId: approval.id });
    await audit(tx, actor, { action: 'withdrawal.paid', entityType: 'withdrawal', entityId: w.id, newValues: { amount: w.amount, reference: ref, approvalId: approval.id, allocations: live.map((a) => ({ seq: a.seq, source: a.sourceType, amount: a.amount })) } });
    await notifySeller(tx, w, 'تم التحويل', 'paid');
  });
}

/**
 * Reject a request BEFORE any transfer started (REQUESTED / UNDER_REVIEW / APPROVED). A reserved amount
 * returns to AVAILABLE through an approved reversal. Once PROCESSING, EDMN may already have sent the money:
 * a rejection is refused — use the transfer-outcome workflow (uncertain / failed before transfer / paid).
 */
export async function rejectWithdrawal(actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'withdrawals.approve');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'REJECTED') return;
    if (!['REQUESTED', 'UNDER_REVIEW', 'APPROVED'].includes(w.status)) {
      throw invalidState(
        w.status === 'PROCESSING' || w.status === 'TRANSFER_UNCERTAIN'
          ? 'بدأ التحويل بالفعل: لا يمكن الرفض. سجّل نتيجة التحويل (تم الصرف / فشل قبل التحويل / نتيجة غير مؤكدة)'
          : 'لا يمكن رفض طلب سحب في حالته الحالية',
      );
    }
    // A reserved amount going back to AVAILABLE is a financial movement: Maker (request) + different Checker.
    let mreq: Awaited<ReturnType<typeof takeMovementRequest>> | null = null;
    if (w.reservedAt) {
      requireStepUp(actor);
      mreq = await takeMovementRequest(tx, actor, 'WITHDRAWAL_REVERSAL', w.id, w.amount);
      if ((mreq.params as { mode?: string }).mode !== 'REJECT') throw invalidState('طلب المنشئ ليس طلب رفض');
    }
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'REJECTED', why);
    await tx.update(withdrawalRequests).set({ status: 'REJECTED', rejectReason: why }).where(eq(withdrawalRequests.id, w.id));
    if (mreq) {
      await reverseReservation(tx, actor, w, why, mreq.requestedBy);
      await completeMovementRequest(tx, actor, mreq, null);
    }
    await audit(tx, actor, { action: 'withdrawal.rejected', entityType: 'withdrawal', entityId: w.id, reason: why, oldValues: { status: w.status }, newValues: { status: 'REJECTED', reservationReturned: !!w.reservedAt } });
    await notifySeller(tx, w, `مرفوض: ${why}`, 'rejected');
  });
}

/**
 * The executor cannot tell whether the transfer went out (provider timeout, unclear statement…). Moves NO
 * money: the amount stays RESERVED until the outcome is established. Idempotent.
 */
export async function markWithdrawalTransferUncertain(actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'withdrawals.pay');
  requireStepUp(actor);
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'TRANSFER_UNCERTAIN') return;
    if (w.status !== 'PROCESSING') throw invalidState('نتيجة التحويل غير المؤكدة تُسجل لطلب جارٍ تحويله فقط');
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'TRANSFER_UNCERTAIN', why);
    await tx.update(withdrawalRequests).set({ status: 'TRANSFER_UNCERTAIN', transferUncertainAt: new Date(), transferUncertainBy: actor.userId }).where(eq(withdrawalRequests.id, w.id));
    await audit(tx, actor, { action: 'withdrawal.transfer_uncertain', entityType: 'withdrawal', entityId: w.id, oldValues: { status: w.status }, newValues: { status: 'TRANSFER_UNCERTAIN', reserved: true }, reason: why });
  });
}

/**
 * Established that NO money left EDMN for this request (e.g. the provider rejected it before execution).
 * Needs evidence, fresh 2FA and a SECOND person (not the executor who started/flagged the transfer); only
 * then is the reservation released (approved reversal). Idempotent: a retry never credits twice.
 */
export async function markWithdrawalFailedBeforeTransfer(actor: Actor, id: string, input: { reason: string; evidence: string }) {
  requirePermission(actor, 'withdrawals.approve');
  requireStepUp(actor);
  const why = requireReason(input.reason);
  const evidence = input.evidence?.trim();
  if (!evidence || evidence.length < 3) throw validation('مرجع/دليل عدم خروج التحويل مطلوب (كشف الحساب أو رد مزود الدفع)');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'FAILED_BEFORE_TRANSFER') return;
    if (w.status !== 'PROCESSING' && w.status !== 'TRANSFER_UNCERTAIN') throw invalidState('هذا الإجراء لطلب جارٍ تحويله أو نتيجته غير مؤكدة فقط');
    if (w.processingBy === actor.userId || w.transferUncertainBy === actor.userId) throw forbidden('إثبات عدم خروج التحويل يجب أن يتم بواسطة شخص غير منفذ التحويل');
    await assertNotOwnWithdrawal(tx, actor, w);
    const mreq = await takeMovementRequest(tx, actor, 'WITHDRAWAL_REVERSAL', w.id, w.amount);
    if ((mreq.params as { mode?: string }).mode !== 'FAILED_BEFORE_TRANSFER') throw invalidState('طلب المنشئ ليس طلب فشل قبل التحويل');
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'FAILED_BEFORE_TRANSFER', why);
    await tx
      .update(withdrawalRequests)
      .set({ status: 'FAILED_BEFORE_TRANSFER', transferFailedAt: new Date(), transferFailedBy: actor.userId, transferFailureReason: why, transferFailureEvidence: evidence })
      .where(eq(withdrawalRequests.id, w.id));
    await reverseReservation(tx, actor, w, `فشل قبل التحويل: ${why}`, mreq.requestedBy);
    await completeMovementRequest(tx, actor, mreq, null);
    await audit(tx, actor, { action: 'withdrawal.failed_before_transfer', entityType: 'withdrawal', entityId: w.id, oldValues: { status: w.status }, newValues: { status: 'FAILED_BEFORE_TRANSFER', reservationReturned: !!w.reservedAt, evidence }, reason: why });
    await notifySeller(tx, w, 'لم يتم التحويل — أُعيد المبلغ لرصيدك المتاح', 'failed-before-transfer');
  });
}

/**
 * A payout recorded PAID came back (wrong/closed account…). Compensating, approved entry — the original
 * WITHDRAWAL_PAID journal is never touched: PLATFORM_CASH (received back) → SELLER_AVAILABLE. Admin approval,
 * fresh 2FA, reason, external reference; a different person than the payer; idempotent (one return per
 * withdrawal). The destination that bounced must be re-verified before any further payout.
 */
export async function recordWithdrawalReturned(actor: Actor, id: string, input: { amount: number; reference: string; reason: string }) {
  requirePermission(actor, 'withdrawals.approve');
  requireStepUp(actor);
  const why = requireReason(input.reason);
  const ref = input.reference?.trim();
  if (!ref || ref.length < 3) throw validation('مرجع الارتداد من البنك/المزود مطلوب');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw validation('المبلغ المرتد غير صحيح');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'RETURNED') return;
    if (w.status !== 'PAID') throw invalidState('تسجيل الارتداد متاح لسحب تم صرفه فقط');
    if (w.paidBy === actor.userId) throw forbidden('تسجيل ارتداد التحويل يجب أن يتم بواسطة شخص غير منفذ الصرف');
    await assertNotOwnWithdrawal(tx, actor, w);
    const transferred = w.netTransferAmount ?? w.amount;
    if (input.amount > transferred) throw validation(`المبلغ المرتد أكبر من المبلغ المحوّل (${formatEGP(transferred)})`);
    const mreq = await takeMovementRequest(tx, actor, 'WITHDRAWAL_RETURN', w.id, input.amount);
    // Restored per ORIGINAL allocation, in allocation order (seq), each up to what it contributed; a shortfall
    // (the transfer cost actually paid to the provider) stays on the last allocations. Never pooled.
    const { rows: allocations } = await allocationsOf(tx, w);
    const paidAllocs = allocations.filter((a) => a.status === 'PAID');
    let left = input.amount;
    const parts = paidAllocs.map((a) => {
      const part = Math.min(left, a.amount);
      left -= part;
      return { a, part };
    }).filter((x) => x.part > 0);
    if (left !== 0) throw invalidState('المبلغ المرتد أكبر مما صُرف من مصادر هذا السحب');
    const approval = await grantApproval(tx, actor, {
      dualControl: { requestedBy: mreq.requestedBy },
      action: 'WITHDRAWAL_PAYOUT_RETURN',
      entityType: 'withdrawal',
      entityId: w.id,
      amount: input.amount,
      economicVersion: `paid:${w.payoutApprovalId ?? 'legacy'}:returned:${input.amount}`,
      reason: `ارتداد تحويل — مرجع ${ref}: ${why}`,
      idempotencyKey: `wd-returned:${w.id}`,
      destinationSnapshot: (w.destinationSnapshot as Record<string, unknown>) ?? { masked: w.payoutMasked, type: w.payoutType },
    });
    const posted = await postEntry(tx, actor, {
      entryType: 'WITHDRAWAL_RETURNED',
      sourceType: 'withdrawal',
      sourceId: w.id,
      idempotencyKey: `wd-returned:${w.id}`,
      description: `ارتداد تحويل السحب #${w.number} — مرجع ${ref}`,
      approvalId: approval.id,
      lines: [
        { account: { code: 'PLATFORM_CASH' }, debit: input.amount, memo: 'payout returned by the bank/provider' },
        ...parts.map(({ a, part }) => ({ account: sourceAccount(a), credit: part, memo: `returned payout restored to allocation ${a.seq} ${a.sourceType}` })),
      ],
    });
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'RETURNED', why);
    await tx
      .update(withdrawalRequests)
      .set({ status: 'RETURNED', returnedAmount: input.amount, returnedAt: new Date(), returnedBy: actor.userId, returnedReference: ref, returnReason: why, returnApprovalId: approval.id })
      .where(eq(withdrawalRequests.id, w.id));
    await completeMovementRequest(tx, actor, mreq, approval.id);
    for (const { a, part } of parts) await markAllocations(tx, [a], { status: 'RETURNED', restoredAmount: part, returnJournalId: posted.entryId || null });
    await syncDealPayouts(tx, actor, parts.filter(({ a }) => a.sourceType === 'PROTECTED_DEAL').map(({ a }) => a.sourceEntityId));
    // A bounced user-level destination must be verified again before any further payout.
    if (w.receivingDestinationId) {
      await tx.update(receivingDestinations).set({ status: 'REVERIFICATION_REQUIRED', reviewReason: `ارتد تحويل السحب #${w.number}` }).where(and(eq(receivingDestinations.id, w.receivingDestinationId), eq(receivingDestinations.status, 'APPROVED')));
    }
    // The destination that bounced is no longer trusted: it must be verified again before any payout.
    if (w.payoutMethodId) {
      await tx.update(sellerPayoutMethods).set({ status: 'PENDING_VERIFICATION', isDefault: false }).where(and(eq(sellerPayoutMethods.id, w.payoutMethodId), eq(sellerPayoutMethods.status, 'ACTIVE')));
    }
    await audit(tx, actor, { action: 'withdrawal.payout_returned', entityType: 'withdrawal', entityId: w.id, oldValues: { status: w.status }, newValues: { status: 'RETURNED', amount: input.amount, reference: ref, approvalId: approval.id, destinationReverification: !!(w.payoutMethodId || w.receivingDestinationId), restored: parts.map(({ a, part }) => ({ seq: a.seq, source: a.sourceType, amount: part })) }, reason: why });
    await notifySeller(tx, w, 'ارتد التحويل — أُعيد المبلغ لرصيدك المتاح ويلزم إعادة اعتماد بيانات استلام الأموال', 'returned');
  });
}

/* ───────── Scheduled settlements (hybrid model) ───────── */

export async function runScheduledSettlement(date = new Date()) {
  const mode = await getSetting('settlement.mode');
  if (mode === 'ON_REQUEST') return { created: 0, skipped: 'mode' };
  const days = await getSetting('settlement.daysOfMonth');
  const cairoDay = Number(new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Africa/Cairo' }).format(date));
  if (!days.includes(cairoDay)) return { created: 0, skipped: 'not a settlement day' };
  const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(date);
  const min = Math.max(await getSetting('settlement.minimumAmount'), await getSetting('withdrawals.minimumAmount'));
  const settlement = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(settlements).where(eq(settlements.scheduledFor, isoDate));
    if (existing) return existing;
    const [s] = await tx.insert(settlements).values({ scheduledFor: isoDate }).returning();
    await audit(tx, SYSTEM_ACTOR, { action: 'settlement.batch_created', entityType: 'settlement', entityId: s.id, newValues: { date: isoDate } });
    return s;
  });
  const candidates = await db.select().from(sellers).where(and(inArray(sellers.status, ['APPROVED', 'RESTRICTED']), eq(sellers.autoSettlement, true)));
  let created = 0;
  let total = 0;
  for (const s of candidates) {
    // B2: only the withdrawable part (post-release dispute/return holds excluded) is requested.
    const { sellerFundsPosition } = await import('./holds');
    const available = (await sellerFundsPosition(db, s.id)).withdrawable;
    if (available < min) continue;
    try {
      const r = await requestWithdrawal(SYSTEM_ACTOR, { amount: available, clientKey: `settlement:${isoDate}` }, { source: 'SCHEDULED', settlementId: settlement.id, sellerId: s.id });
      if (r.created) {
        created++;
        total += available;
      }
    } catch {
      /* seller not eligible (hold, no payout method…) — skipped; visible in seller finance */
    }
  }
  await db
    .update(settlements)
    .set({ itemCount: sql`(select count(*) from withdrawal_requests where settlement_id = ${settlement.id})`, totalAmount: sql`(select coalesce(sum(amount),0) from withdrawal_requests where settlement_id = ${settlement.id})` })
    .where(eq(settlements.id, settlement.id));
  return { created, total, settlementId: settlement.id };
}

/* ───────── Manual ledger adjustments (maker/checker) ───────── */

export async function createAdjustment(actor: Actor, input: { sellerId: string; amount: string; reasonCode: string; reason: string; sellerOrderId?: string | null }) {
  requirePermission(actor, 'ledger.adjust.create');
  requireStepUp(actor);
  await assertNotPaused(db, 'killswitch.adjustments');
  const why = requireReason(input.reason);
  let amount: number;
  try {
    amount = parseEgp(input.amount);
  } catch {
    throw validation('المبلغ غير صحيح');
  }
  if (amount === 0) throw validation('المبلغ لا يمكن أن يكون صفراً');
  if (!/^[A-Z_]{3,40}$/.test(input.reasonCode)) throw validation('كود السبب غير صالح');
  return db.transaction(async (tx) => {
    const [seller] = await tx.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, input.sellerId));
    if (!seller) throw notFound('البائع');
    await assertNotSelfDealing(tx, actor, input.sellerId);
    const [adj] = await tx
      .insert(ledgerAdjustments)
      .values({ sellerId: input.sellerId, sellerOrderId: input.sellerOrderId ?? null, amount, reasonCode: input.reasonCode, reason: why, createdBy: actor.userId! })
      .returning();
    await audit(tx, actor, { action: 'ledger.adjustment_created', entityType: 'ledger_adjustment', entityId: adj.id, newValues: { amount, sellerId: input.sellerId, reasonCode: input.reasonCode }, reason: why });
    // Owner rule: every adjustment is two-person (creator = Maker; a different person decides) — no threshold.
    return adj;
  });
}

async function postAdjustment(tx: DbOrTx, actor: Actor, id: string, selfApproved: boolean) {
  const [adj] = await tx.select().from(ledgerAdjustments).where(eq(ledgerAdjustments.id, id)).for('update');
  if (adj.status !== 'PENDING_APPROVAL') return;
  await assertNotPaused(tx, 'killswitch.adjustments');
  const credit = adj.amount > 0;
  const abs = Math.abs(adj.amount);
  const approval = await grantApproval(tx, actor, {
    action: 'MANUAL_ADJUSTMENT',
    entityType: 'ledger_adjustment',
    entityId: adj.id,
    amount: abs,
    economicVersion: `amount:${adj.amount}:seller:${adj.sellerId}`,
    reason: `${adj.reasonCode}: ${adj.reason}`,
    idempotencyKey: `adj:${adj.id}`,
    dualControl: selfApproved ? null : { requestedBy: adj.createdBy },
  });
  const entry = await postEntry(tx, actor, {
    approvalId: approval.id,
    entryType: 'ADJUSTMENT',
    sourceType: adj.sellerOrderId ? 'seller_order' : 'ledger_adjustment',
    sourceId: adj.sellerOrderId ?? adj.id,
    idempotencyKey: `adj:${adj.id}`,
    description: `تسوية يدوية #${adj.number} (${adj.reasonCode}): ${adj.reason}`,
    lines: credit
      ? [
          { account: { code: 'ADJUSTMENTS_EXPENSE' }, debit: abs },
          { account: { code: 'SELLER_AVAILABLE', sellerId: adj.sellerId }, credit: abs },
        ]
      : [
          { account: { code: 'SELLER_AVAILABLE', sellerId: adj.sellerId }, debit: abs },
          { account: { code: 'ADJUSTMENTS_EXPENSE' }, credit: abs },
        ],
  });
  await tx
    .update(ledgerAdjustments)
    .set({ status: 'POSTED', approvedBy: selfApproved ? null : actor.userId, decidedAt: new Date(), journalEntryId: entry.entryId })
    .where(eq(ledgerAdjustments.id, adj.id));
}

export async function decideAdjustment(actor: Actor, id: string, approve: boolean, reason?: string) {
  requirePermission(actor, 'ledger.adjust.approve');
  requireStepUp(actor);
  await db.transaction(async (tx) => {
    const [adj] = await tx.select().from(ledgerAdjustments).where(eq(ledgerAdjustments.id, id)).for('update');
    if (!adj) throw notFound('التسوية');
    if (adj.status !== 'PENDING_APPROVAL') throw invalidState('تم البت في هذه التسوية بالفعل');
    if (adj.createdBy === actor.userId) throw forbidden('لا يمكن لمنشئ التسوية اعتمادها (مبدأ الفصل بين المهام)');
    await assertNotSelfDealing(tx, actor, adj.sellerId);
    if (approve) await postAdjustment(tx, actor, id, false);
    else {
      const why = requireReason(reason);
      await tx.update(ledgerAdjustments).set({ status: 'REJECTED', approvedBy: actor.userId, decidedAt: new Date(), rejectReason: why }).where(eq(ledgerAdjustments.id, id));
    }
    await audit(tx, actor, { action: approve ? 'ledger.adjustment_approved' : 'ledger.adjustment_rejected', entityType: 'ledger_adjustment', entityId: id, newValues: { amount: adj.amount }, reason: reason ?? null });
  });
}

/* ───────── Refund payouts (to customers) & external-deal payouts ───────── */

/** Refund payout recording lives in refunds.ts (approval-gated); kept here for existing callers. */
export { recordRefundPayout as markRefundPaid } from './refunds';

export async function markDealPayoutPaid(actor: Actor, payoutId: string, reference: string, proof?: { data: Buffer; name: string } | null) {
  // Batch 1.5 closure: a Protected Deal payout is NEVER sent to the unverified destination typed into the offer.
  // It is paid only through a withdrawal by the beneficiary to a VERIFIED destination (allocation-attributed,
  // two-person approval + payout). This direct path is closed (fail closed); history stays as recorded.
  void actor; void payoutId; void reference; void proof;
  throw invalidState('مستحقات الصفقات المحمية تُصرف فقط عبر طلب سحب من البائع إلى وجهة صرف متحقق منها');
}

export async function withdrawalQueue(statuses: string[], limit = 50, offset = 0) {
  return db
    .select({ w: withdrawalRequests, seller: { id: sellers.id, legalName: sellers.legalName, status: sellers.status, payoutHoldUntil: sellers.payoutHoldUntil }, requester: users.fullName })
    .from(withdrawalRequests)
    .leftJoin(sellers, eq(sellers.id, withdrawalRequests.sellerId))
    .leftJoin(users, eq(users.id, withdrawalRequests.requestedBy))
    .where(inArray(withdrawalRequests.status, statuses as Withdrawal['status'][]))
    .orderBy(withdrawalRequests.slaDueAt)
    .limit(limit)
    .offset(offset);
}

/** A beneficiary's own withdrawals (account-level and store requests they own), with their source allocations. */
export async function accountWithdrawals(userId: string) {
  const rows = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.userId, userId)).orderBy(desc(withdrawalRequests.createdAt)).limit(50);
  const allocs = rows.length ? await db.select().from(withdrawalAllocations).where(inArray(withdrawalAllocations.withdrawalId, rows.map((r) => r.id))) : [];
  return rows.map((w) => ({ w, allocations: allocs.filter((a) => a.withdrawalId === w.id).sort((x, y) => x.seq - y.seq) }));
}

export async function withdrawalAllocationsOf(withdrawalId: string): Promise<Allocation[]> {
  return db.select().from(withdrawalAllocations).where(eq(withdrawalAllocations.withdrawalId, withdrawalId)).orderBy(withdrawalAllocations.seq);
}

export async function sellerWithdrawals(sellerId: string) {
  return db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, sellerId)).orderBy(desc(withdrawalRequests.createdAt)).limit(100);
}

/* ───────── Payout details for the person executing the transfer ───────── */

const PAYOUT_FIELD_LABELS: Record<string, string> = {
  type: 'النوع',
  holderName: 'اسم صاحب الحساب',
  bankName: 'البنك',
  accountNumber: 'رقم الحساب',
  iban: 'IBAN',
  instapayAddress: 'عنوان إنستاباي',
  walletProvider: 'مزود المحفظة',
  walletNumber: 'رقم المحفظة',
};

function labelled(details: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(details)
    .filter(([k, v]) => k in PAYOUT_FIELD_LABELS && v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => ({ label: PAYOUT_FIELD_LABELS[k], value: String(v) }));
}

/**
 * Full (decrypted) payout destination of a withdrawal or an external-deal payout. Only for staff who
 * execute transfers, after a fresh 2FA step-up; every reveal is audit-logged.
 */
export async function revealPayoutDetails(actor: Actor, kind: 'withdrawal' | 'deal_payout', id: string) {
  requirePermission(actor, kind === 'withdrawal' ? 'withdrawals.pay' : 'deals.payout');
  requireStepUp(actor);
  let details: Record<string, unknown>;
  if (kind === 'withdrawal') {
    const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id));
    if (!w) throw notFound('طلب السحب');
    if (w.payoutMethodId) {
      const [pm] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, w.payoutMethodId));
      if (!pm) throw notFound('بيانات استلام الأموال');
      details = { type: pm.type, holderName: pm.holderName, ...decryptJson<Record<string, unknown>>(pm.detailsEnc) };
    } else if (w.receivingDestinationId) {
      const [d] = await db.select().from(receivingDestinations).where(eq(receivingDestinations.id, w.receivingDestinationId));
      if (!d) throw notFound('وجهة الصرف');
      details = { ...decryptJson<Record<string, unknown>>(d.detailsEnc), type: d.type, holderName: d.holderName };
    } else throw notFound('وجهة الصرف');
  } else {
    const [p] = await db.select().from(dealPayouts).where(eq(dealPayouts.id, id));
    if (!p) throw notFound('المستحق');
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, p.dealId));
    if (!d?.sellerPayoutEnc) throw notFound('بيانات الصرف');
    details = { type: d.sellerPayoutType, ...decryptJson<Record<string, unknown>>(d.sellerPayoutEnc) };
  }
  await audit(db, actor, { action: 'payout.details_revealed', entityType: kind, entityId: id });
  return labelled(details);
}
