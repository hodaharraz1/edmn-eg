import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { withdrawalMachine } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireSeller, requireStepUp, SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { parseEgp } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { financialApprovals, ledgerAdjustments, sellerPayoutMethods, sellers, settlements, withdrawalRequests, users, dealPayouts, externalDeals } from '@/server/db/schema';
import { grantApproval } from './approvals';
import { assertNotPaused } from './controls';
import { decryptJson } from '@/server/core/crypto';
import { notify } from '@/server/modules/notifications/notify';
import { activePayoutMethod } from '@/server/modules/sellers/service';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { requireReason, transition } from '../_shared';
import { accountBalance, postEntry } from './ledger';
import { assertNotSelfDealing } from './self-dealing';
import { formatEGP } from '@/lib/format';

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
    // Same account lock as closure: a closing account cannot race a new withdrawal request.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'account:' + seller.ownerUserId}))`);
    const closing = await tx.execute(sql`select 1 from account_closure_requests where user_id = ${seller.ownerUserId} and status = 'PENDING' limit 1`);
    if (closing.rows.length) throw invalidState('فيه طلب إغلاق حساب قيد التنفيذ');
    if (seller.payoutHoldUntil && seller.payoutHoldUntil > new Date()) {
      throw invalidState(`تم تغيير بيانات السحب مؤخراً. السحب متاح بعد ${seller.payoutHoldUntil.toLocaleString('ar-EG-u-nu-latn')}`);
    }
    const min = await getSetting('withdrawals.minimumAmount', tx);
    if (amount < min) throw validation(`الحد الأدنى للسحب ${formatEGP(min)}`);
    const available = await accountBalance(tx, { code: 'SELLER_AVAILABLE', sellerId });
    // Early, friendly check only — the authoritative check runs at approval under the account lock.
    if (amount > available) throw new DomainError('INSUFFICIENT_BALANCE', 'المبلغ أكبر من رصيدك المتاح');
    const pm = await activePayoutMethod(tx, sellerId);
    if (!pm) throw invalidState('لا توجد وسيلة سحب معتمدة. أضف وسيلة سحب وانتظر اعتمادها');
    const slaHours = await getSetting('withdrawals.slaBusinessHours', tx);
    const [w] = await tx
      .insert(withdrawalRequests)
      .values({
        sellerId,
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
      })
      .returning();
    const { recordTransition } = await import('@/server/audit/audit');
    await recordTransition(tx, actor, 'withdrawal', w.id, null, 'REQUESTED');
    await audit(tx, actor, { action: 'withdrawal.requested', entityType: 'withdrawal', entityId: w.id, newValues: { amount, payout: pm.maskedLabel, source: w.source, reserved: false } });
    await notify(tx, { event: 'WITHDRAWAL_REQUESTED', userIds: [seller.ownerUserId], vars: { wd: w.number, amount: formatEGP(amount) }, link: '/seller/withdrawals', dedupeKey: `wd:${w.id}:requested` });
    return { withdrawal: w, created: true };
  });
}

/** Dual control on the seller's rolling 24-hour total (splitting a payout does not avoid a second person). */
async function needsDualControl(tx: DbOrTx, sellerId: string, amount: number) {
  const threshold = await getSetting('withdrawals.dualControlThreshold', tx);
  const recent = await tx.execute<{ total: string }>(sql`select coalesce(sum(amount), 0)::text total from withdrawal_requests
    where seller_id = ${sellerId} and created_at > now() - interval '24 hours' and status not in ('REJECTED','CANCELLED')`);
  return Number(recent.rows[0]?.total ?? 0) + amount >= threshold;
}

async function lockWithdrawal(tx: DbOrTx, id: string) {
  const [w] = await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)).for('update');
  if (!w) throw notFound('طلب السحب');
  return w;
}

async function notifySeller(tx: DbOrTx, w: Withdrawal, status: string, key: string) {
  const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, w.sellerId));
  await notify(tx, { event: 'WITHDRAWAL_UPDATED', userIds: [s.ownerUserId], vars: { wd: w.number, status }, link: '/seller/withdrawals', dedupeKey: `wd:${w.id}:${key}` });
}

/** Return reserved funds to AVAILABLE — itself an Admin-approved reclassification. */
async function reverseReservation(tx: DbOrTx, actor: Actor, w: Withdrawal, reason: string) {
  if (!w.reservedAt) return;
  const approval = await grantApproval(tx, actor, {
    action: 'WITHDRAWAL_RELEASE_RESERVATION',
    entityType: 'withdrawal',
    entityId: w.id,
    amount: w.amount,
    economicVersion: `amount:${w.amount}:status:${w.status}`,
    reason,
    idempotencyKey: `wd-reverse:${w.id}`,
  });
  await postEntry(tx, actor, {
    entryType: 'WITHDRAWAL_REVERSAL',
    sourceType: 'withdrawal',
    sourceId: w.id,
    idempotencyKey: `wd-reverse:${w.id}`,
    description: `إلغاء حجز طلب السحب #${w.number}`,
    approvalId: approval.id,
    lines: [
      { account: { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: w.sellerId }, debit: w.amount },
      { account: { code: 'SELLER_AVAILABLE', sellerId: w.sellerId }, credit: w.amount },
    ],
  });
}

/** Seller cancels a request that was not yet approved (nothing was reserved, so nothing moves). */
export async function cancelWithdrawal(actor: Actor, id: string) {
  const sellerId = requireSeller(actor, 'finance.withdraw');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.sellerId !== sellerId) throw forbidden();
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
    await assertNotSelfDealing(tx, actor, w.sellerId);
    const [seller] = await tx.select().from(sellers).where(eq(sellers.id, w.sellerId)).for('update');
    if (seller.status === 'SUSPENDED') throw invalidState('حساب البائع موقوف. لا يمكن اعتماد السحب');
    if (seller.payoutHoldUntil && seller.payoutHoldUntil > new Date()) throw invalidState('على البائع تجميد صرف مؤقت (تغيير بيانات السحب)');
    const { sellerLedgerDrift } = await import('@/server/modules/commerce/fulfilment');
    if (await sellerLedgerDrift(tx, w.sellerId)) throw invalidState('أرصدة البائع المخزنة لا تطابق دفتر الأستاذ — تم إيقاف الاعتماد');
    const [pm] = w.payoutMethodId ? await tx.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, w.payoutMethodId)) : [];
    if (!pm || pm.status !== 'ACTIVE') throw invalidState('وسيلة السحب المطلوبة لم تعد معتمدة. ارفض الطلب واطلب من البائع طلبًا جديدًا');
    const dual = w.requiresDualControl || (await needsDualControl(tx, w.sellerId, 0));
    const destination = { payoutMethodId: pm.id, type: pm.type, masked: pm.maskedLabel, holderName: pm.holderName, verifiedAt: pm.verifiedAt?.toISOString() ?? null };
    const approval = await grantApproval(tx, actor, {
      action: 'WITHDRAWAL_RESERVATION',
      entityType: 'withdrawal',
      entityId: w.id,
      amount: w.amount,
      economicVersion: `amount:${w.amount}:pm:${pm.id}`,
      reason: note?.trim() || 'اعتماد طلب السحب وحجز المبلغ',
      idempotencyKey: `wd:${w.id}`,
      destinationSnapshot: destination,
    });
    await postEntry(tx, actor, {
      entryType: 'WITHDRAWAL_RESERVE',
      sourceType: 'withdrawal',
      sourceId: w.id,
      idempotencyKey: `wd:${w.id}`,
      description: `حجز مبلغ طلب السحب #${w.number} عند الاعتماد`,
      approvalId: approval.id,
      lines: [
        { account: { code: 'SELLER_AVAILABLE', sellerId: w.sellerId }, debit: w.amount },
        { account: { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: w.sellerId }, credit: w.amount },
      ],
      guards: [{ account: { code: 'SELLER_AVAILABLE', sellerId: w.sellerId }, min: 0 }],
    });
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'APPROVED', note);
    await tx
      .update(withdrawalRequests)
      .set({ status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date(), reservedAt: new Date(), reserveApprovalId: approval.id, destinationSnapshot: destination, requiresDualControl: dual })
      .where(eq(withdrawalRequests.id, w.id));
    await audit(tx, actor, { action: 'withdrawal.approved', entityType: 'withdrawal', entityId: w.id, newValues: { amount: w.amount, approvalId: approval.id, reserved: true, dualControl: dual }, reason: note ?? null });
    await notifySeller(tx, w, 'تم الاعتماد وحجز المبلغ', 'approved');
  });
}

export async function markWithdrawalProcessing(actor: Actor, id: string) {
  requirePermission(actor, 'withdrawals.pay');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'PROCESSING') return;
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
export async function markWithdrawalPaid(actor: Actor, id: string, reference: string, proof?: { data: Buffer; name: string } | null) {
  requirePermission(actor, 'withdrawals.pay');
  requireStepUp(actor);
  const ref = reference?.trim();
  if (!ref || ref.length < 3) throw validation('رقم مرجع التحويل مطلوب');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'PAID') return;
    if (w.status !== 'APPROVED' && w.status !== 'PROCESSING') throw invalidState('يجب اعتماد طلب السحب قبل تسجيل الصرف');
    if (!w.reservedAt) throw invalidState('المبلغ لم يُحجز بعد. يجب اعتماده أولاً');
    await assertNotPaused(tx, 'killswitch.payouts');
    if (w.requiresDualControl && w.approvedBy === actor.userId) throw forbidden('هذا المبلغ يتطلب أن يكون منفذ الصرف شخصاً مختلفاً عن المعتمد');
    await assertNotSelfDealing(tx, actor, w.sellerId);
    if (w.isTest && (await realMoneyEnabled(tx))) throw invalidState('هذا سحب تجريبي (TEST) ولا يمكن صرفه بعد تفعيل الأموال الحقيقية');
    const [seller] = await tx.select().from(sellers).where(eq(sellers.id, w.sellerId)).for('update');
    if (!seller || seller.status === 'SUSPENDED') throw invalidState('حساب البائع موقوف. لا يمكن صرف السحب');
    if (seller.payoutHoldUntil && seller.payoutHoldUntil > new Date()) throw invalidState('على البائع تجميد صرف مؤقت (تغيير بيانات السحب). لا يمكن الصرف الآن');
    if ((await accountBalance(tx, { code: 'SELLER_AVAILABLE', sellerId: w.sellerId }, true)) < 0) {
      throw invalidState('على البائع مديونية (رصيد متاح سالب بعد استرداد). يجب تسويتها قبل صرف أي سحب');
    }
    const snap = (w.destinationSnapshot ?? null) as { payoutMethodId?: string } | null;
    if (snap?.payoutMethodId) {
      const [pm] = await tx.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, snap.payoutMethodId));
      if (!pm || pm.status !== 'ACTIVE') throw invalidState('وجهة الصرف المعتمدة لم تعد صالحة. ارفض الطلب ويُطلب سحب جديد');
    }
    const approval = await grantApproval(tx, actor, {
      action: 'WITHDRAWAL_PAYOUT',
      entityType: 'withdrawal',
      entityId: w.id,
      amount: w.amount,
      economicVersion: `amount:${w.amount}:reserve:${w.reserveApprovalId ?? 'legacy'}`,
      reason: `تسجيل صرف — مرجع ${ref}`,
      idempotencyKey: `wd-paid:${w.id}`,
      destinationSnapshot: (w.destinationSnapshot as Record<string, unknown>) ?? { masked: w.payoutMasked, type: w.payoutType },
      dualControl: w.requiresDualControl && w.approvedBy ? { requestedBy: w.approvedBy } : null,
    });
    const file = proof ? await storeUpload(tx, actor, { purpose: 'WITHDRAWAL_PROOF', data: proof.data, originalName: proof.name }) : null;
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'PAID');
    await tx
      .update(withdrawalRequests)
      .set({ status: 'PAID', paidBy: actor.userId, paidAt: new Date(), paidReference: ref, proofFileId: file?.id ?? null, payoutApprovalId: approval.id })
      .where(eq(withdrawalRequests.id, w.id));
    await postEntry(tx, actor, {
      entryType: 'WITHDRAWAL_PAID',
      sourceType: 'withdrawal',
      sourceId: w.id,
      idempotencyKey: `wd-paid:${w.id}`,
      description: `صرف طلب السحب #${w.number} — مرجع ${ref}`,
      approvalId: approval.id,
      lines: [
        { account: { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: w.sellerId }, debit: w.amount },
        { account: { code: 'PLATFORM_CASH' }, credit: w.amount },
      ],
    });
    await audit(tx, actor, { action: 'withdrawal.paid', entityType: 'withdrawal', entityId: w.id, newValues: { amount: w.amount, reference: ref, approvalId: approval.id } });
    await notifySeller(tx, w, 'تم التحويل', 'paid');
  });
}

export async function rejectWithdrawal(actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'withdrawals.approve');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'REJECTED') return;
    if (w.status === 'PROCESSING') {
      // A transfer may already be on its way: only a different staff member, freshly re-authenticated,
      // may state that it did not happen and return the money to the seller's available balance.
      requireStepUp(actor);
      if (w.processingBy === actor.userId) throw forbidden('رفض طلب جارٍ تحويله يجب أن يتم بواسطة شخص غير منفذ التحويل');
    }
    if (w.reservedAt) requireStepUp(actor);
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'REJECTED', why);
    await tx.update(withdrawalRequests).set({ status: 'REJECTED', rejectReason: why }).where(eq(withdrawalRequests.id, w.id));
    await reverseReservation(tx, actor, w, why);
    await audit(tx, actor, { action: 'withdrawal.rejected', entityType: 'withdrawal', entityId: w.id, reason: why, newValues: { reservationReturned: !!w.reservedAt } });
    await notifySeller(tx, w, `مرفوض: ${why}`, 'rejected');
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
    const available = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.id });
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
    const threshold = await getSetting('ledger.adjustmentDualControlThreshold', tx);
    if (threshold > 0 && Math.abs(amount) < threshold) await postAdjustment(tx, actor, adj.id, true);
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
  requirePermission(actor, 'deals.payout');
  requireStepUp(actor);
  const ref = reference?.trim();
  if (!ref || ref.length < 3) throw validation('رقم مرجع التحويل مطلوب');
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(dealPayouts).where(eq(dealPayouts.id, payoutId)).for('update');
    if (!p) throw notFound('المستحق');
    if (p.status === 'PAID') return;
    if (p.status !== 'PENDING') throw invalidState('حالة المستحق لا تسمح بالصرف');
    if (p.payeeUserId === actor.userId) throw forbidden('لا يمكنك صرف مستحق لنفسك');
    await assertNotPaused(tx, 'killswitch.payouts');
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, p.dealId));
    const threshold = await getSetting('withdrawals.dualControlThreshold', tx);
    const releaser = deal.releaseApprovalId ? (await tx.select({ by: financialApprovals.approvedBy }).from(financialApprovals).where(eq(financialApprovals.id, deal.releaseApprovalId)))[0]?.by : null;
    const dual = p.amount >= threshold && !!releaser;
    if (dual && releaser === actor.userId) throw forbidden('هذا المبلغ يتطلب أن يكون منفذ الصرف شخصاً مختلفاً عن معتمد التسوية');
    const approval = await grantApproval(tx, actor, {
      action: 'DEAL_PAYOUT',
      entityType: 'deal_payout',
      entityId: p.id,
      amount: p.amount,
      economicVersion: `amount:${p.amount}`,
      reason: `صرف مستحق صفقة — مرجع ${ref}`,
      idempotencyKey: `deal-payout-paid:${p.id}`,
      destinationSnapshot: { masked: deal.sellerPayoutMasked, type: deal.sellerPayoutType },
      dualControl: dual ? { requestedBy: releaser! } : null,
    });
    const file = proof ? await storeUpload(tx, actor, { purpose: 'WITHDRAWAL_PROOF', data: proof.data, originalName: proof.name }) : null;
    await tx.update(dealPayouts).set({ status: 'PAID', paidReference: ref, paidProofFileId: file?.id ?? null, paidBy: actor.userId, paidAt: new Date(), payoutApprovalId: approval.id }).where(eq(dealPayouts.id, p.id));
    await postEntry(tx, actor, {
      approvalId: approval.id,
      entryType: 'DEAL_PAYOUT_PAID',
      sourceType: 'external_deal',
      sourceId: p.dealId,
      idempotencyKey: `deal-payout-paid:${p.id}`,
      description: `صرف مستحق البائع للصفقة #${deal.number} — مرجع ${ref}`,
      lines: [
        { account: { code: 'DEAL_PAYOUTS_PAYABLE' }, debit: p.amount },
        { account: { code: 'PLATFORM_CASH' }, credit: p.amount },
      ],
    });
    await audit(tx, actor, { action: 'deal.payout_paid', entityType: 'deal_payout', entityId: p.id, newValues: { amount: p.amount, reference: ref } });
  });
}

export async function withdrawalQueue(statuses: string[], limit = 50, offset = 0) {
  return db
    .select({ w: withdrawalRequests, seller: { id: sellers.id, legalName: sellers.legalName, status: sellers.status, payoutHoldUntil: sellers.payoutHoldUntil }, requester: users.fullName })
    .from(withdrawalRequests)
    .innerJoin(sellers, eq(sellers.id, withdrawalRequests.sellerId))
    .leftJoin(users, eq(users.id, withdrawalRequests.requestedBy))
    .where(inArray(withdrawalRequests.status, statuses as Withdrawal['status'][]))
    .orderBy(withdrawalRequests.slaDueAt)
    .limit(limit)
    .offset(offset);
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
    if (!w?.payoutMethodId) throw notFound('طلب السحب');
    const [pm] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, w.payoutMethodId));
    if (!pm) throw notFound('وسيلة السحب');
    details = { type: pm.type, holderName: pm.holderName, ...decryptJson<Record<string, unknown>>(pm.detailsEnc) };
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
