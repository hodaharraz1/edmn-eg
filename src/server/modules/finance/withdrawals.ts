import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { withdrawalMachine, refundMachine } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireSeller, requireStepUp, SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { parseEgp } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { ledgerAdjustments, refunds, sellerPayoutMethods, sellers, settlements, withdrawalRequests, users, dealPayouts, externalDeals } from '@/server/db/schema';
import { decryptJson } from '@/server/core/crypto';
import { notify } from '@/server/modules/notifications/notify';
import { activePayoutMethod } from '@/server/modules/sellers/service';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { requireReason, transition } from '../_shared';
import { accountBalance, postEntry } from './ledger';
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
 * RequestWithdrawal.
 *  - idempotent on (seller, clientKey) — retries return the same request
 *  - the seller's AVAILABLE account row is locked FOR UPDATE inside postEntry and a guard
 *    asserts the balance stays ≥ 0, so two concurrent requests can never spend the same money
 *  - the amount moves AVAILABLE → WITHDRAWAL_RESERVED immediately
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
    if (seller.payoutHoldUntil && seller.payoutHoldUntil > new Date()) {
      throw invalidState(`تم تغيير بيانات السحب مؤخراً. السحب متاح بعد ${seller.payoutHoldUntil.toLocaleString('ar-EG-u-nu-latn')}`);
    }
    const min = await getSetting('withdrawals.minimumAmount', tx);
    if (amount < min) throw validation(`الحد الأدنى للسحب ${formatEGP(min)}`);
    const pm = await activePayoutMethod(tx, sellerId);
    if (!pm) throw invalidState('لا توجد وسيلة سحب معتمدة. أضف وسيلة سحب وانتظر اعتمادها');
    const slaHours = await getSetting('withdrawals.slaBusinessHours', tx);
    const threshold = await getSetting('withdrawals.dualControlThreshold', tx);
    const [w] = await tx
      .insert(withdrawalRequests)
      .values({
        sellerId,
        amount,
        source: opts.source ?? 'ON_DEMAND',
        settlementId: opts.settlementId ?? null,
        payoutMethodId: pm.id,
        payoutType: pm.type,
        payoutMasked: pm.maskedLabel,
        clientKey: input.clientKey,
        requestedBy: actor.userId,
        slaDueAt: addBusinessHours(new Date(), slaHours),
        requiresDualControl: amount >= threshold,
      })
      .returning();
    await postEntry(tx, actor, {
      entryType: 'WITHDRAWAL_RESERVE',
      sourceType: 'withdrawal',
      sourceId: w.id,
      idempotencyKey: `wd:${w.id}`,
      description: `حجز مبلغ طلب السحب #${w.number}`,
      lines: [
        { account: { code: 'SELLER_AVAILABLE', sellerId }, debit: amount },
        { account: { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId }, credit: amount },
      ],
      guards: [{ account: { code: 'SELLER_AVAILABLE', sellerId }, min: 0 }],
    });
    const { recordTransition } = await import('@/server/audit/audit');
    await recordTransition(tx, actor, 'withdrawal', w.id, null, 'REQUESTED');
    await audit(tx, actor, { action: 'withdrawal.requested', entityType: 'withdrawal', entityId: w.id, newValues: { amount, payout: pm.maskedLabel, source: w.source } });
    await notify(tx, { event: 'WITHDRAWAL_REQUESTED', userIds: [seller.ownerUserId], vars: { wd: w.number, amount: formatEGP(amount) }, link: '/seller/withdrawals' });
    return { withdrawal: w, created: true };
  });
}

async function lockWithdrawal(tx: DbOrTx, id: string) {
  const [w] = await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)).for('update');
  if (!w) throw notFound('طلب السحب');
  return w;
}

async function notifySeller(tx: DbOrTx, w: Withdrawal, status: string) {
  const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, w.sellerId));
  await notify(tx, { event: 'WITHDRAWAL_UPDATED', userIds: [s.ownerUserId], vars: { wd: w.number, status }, link: '/seller/withdrawals' });
}

async function reverseReservation(tx: DbOrTx, actor: Actor, w: Withdrawal) {
  await postEntry(tx, actor, {
    entryType: 'WITHDRAWAL_REVERSAL',
    sourceType: 'withdrawal',
    sourceId: w.id,
    idempotencyKey: `wd-reverse:${w.id}`,
    description: `إلغاء حجز طلب السحب #${w.number}`,
    lines: [
      { account: { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: w.sellerId }, debit: w.amount },
      { account: { code: 'SELLER_AVAILABLE', sellerId: w.sellerId }, credit: w.amount },
    ],
  });
}

export async function cancelWithdrawal(actor: Actor, id: string) {
  const sellerId = requireSeller(actor, 'finance.withdraw');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.sellerId !== sellerId) throw forbidden();
    if (w.status === 'CANCELLED') return;
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'CANCELLED');
    await tx.update(withdrawalRequests).set({ status: 'CANCELLED' }).where(eq(withdrawalRequests.id, w.id));
    await reverseReservation(tx, actor, w);
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

/** Checker step: approve the request for payment. */
export async function approveWithdrawal(actor: Actor, id: string, note?: string) {
  requirePermission(actor, 'withdrawals.approve');
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'APPROVED') return;
    const [seller] = await tx.select().from(sellers).where(eq(sellers.id, w.sellerId));
    if (seller.status === 'SUSPENDED') throw invalidState('حساب البائع موقوف. لا يمكن اعتماد السحب');
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'APPROVED', note);
    await tx.update(withdrawalRequests).set({ status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date() }).where(eq(withdrawalRequests.id, w.id));
    await audit(tx, actor, { action: 'withdrawal.approved', entityType: 'withdrawal', entityId: w.id, newValues: { amount: w.amount }, reason: note ?? null });
    await notifySeller(tx, w, 'تم الاعتماد');
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
    await notifySeller(tx, w, 'جارٍ التحويل');
  });
}

/**
 * Maker step: record that the money was actually transferred. Requires the transfer reference
 * (and optionally proof), a recent step-up, and — above the dual-control threshold — that the
 * payer is a different person from the approver. Idempotent.
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
    if (w.requiresDualControl && w.approvedBy === actor.userId) throw forbidden('هذا المبلغ يتطلب أن يكون منفذ الصرف شخصاً مختلفاً عن المعتمد');
    const file = proof ? await storeUpload(tx, actor, { purpose: 'WITHDRAWAL_PROOF', data: proof.data, originalName: proof.name }) : null;
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'PAID');
    await tx
      .update(withdrawalRequests)
      .set({ status: 'PAID', paidBy: actor.userId, paidAt: new Date(), paidReference: ref, proofFileId: file?.id ?? null })
      .where(eq(withdrawalRequests.id, w.id));
    await postEntry(tx, actor, {
      entryType: 'WITHDRAWAL_PAID',
      sourceType: 'withdrawal',
      sourceId: w.id,
      idempotencyKey: `wd-paid:${w.id}`,
      description: `صرف طلب السحب #${w.number} — مرجع ${ref}`,
      lines: [
        { account: { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: w.sellerId }, debit: w.amount },
        { account: { code: 'PLATFORM_CASH' }, credit: w.amount },
      ],
    });
    await audit(tx, actor, { action: 'withdrawal.paid', entityType: 'withdrawal', entityId: w.id, newValues: { amount: w.amount, reference: ref } });
    await notifySeller(tx, w, 'تم التحويل');
  });
}

export async function rejectWithdrawal(actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'withdrawals.approve');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status === 'REJECTED') return;
    await transition(tx, actor, withdrawalMachine, w.id, w.status, 'REJECTED', why);
    await tx.update(withdrawalRequests).set({ status: 'REJECTED', rejectReason: why }).where(eq(withdrawalRequests.id, w.id));
    await reverseReservation(tx, actor, w);
    await audit(tx, actor, { action: 'withdrawal.rejected', entityType: 'withdrawal', entityId: w.id, reason: why });
    await notifySeller(tx, w, `مرفوض: ${why}`);
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
  const credit = adj.amount > 0;
  const abs = Math.abs(adj.amount);
  const entry = await postEntry(tx, actor, {
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
    if (approve) await postAdjustment(tx, actor, id, false);
    else {
      const why = requireReason(reason);
      await tx.update(ledgerAdjustments).set({ status: 'REJECTED', approvedBy: actor.userId, decidedAt: new Date(), rejectReason: why }).where(eq(ledgerAdjustments.id, id));
    }
    await audit(tx, actor, { action: approve ? 'ledger.adjustment_approved' : 'ledger.adjustment_rejected', entityType: 'ledger_adjustment', entityId: id, newValues: { amount: adj.amount }, reason: reason ?? null });
  });
}

/* ───────── Refund payouts (to customers) & external-deal payouts ───────── */

export async function markRefundPaid(actor: Actor, refundId: string, reference: string, proof?: { data: Buffer; name: string } | null) {
  requirePermission(actor, 'refunds.pay');
  requireStepUp(actor);
  const ref = reference?.trim();
  if (!ref || ref.length < 3) throw validation('رقم مرجع التحويل مطلوب');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (r.status === 'PAID') return;
    await transition(tx, actor, refundMachine, r.id, r.status, 'PAID');
    const file = proof ? await storeUpload(tx, actor, { purpose: 'REFUND_PROOF', data: proof.data, originalName: proof.name }) : null;
    await tx.update(refunds).set({ status: 'PAID', paidReference: ref, paidProofFileId: file?.id ?? null, paidBy: actor.userId, paidAt: new Date() }).where(eq(refunds.id, r.id));
    await postEntry(tx, actor, {
      entryType: 'REFUND_PAID',
      sourceType: 'refund',
      sourceId: r.id,
      idempotencyKey: `refund-paid:${r.id}`,
      description: `صرف استرداد #${r.number} للعميل — مرجع ${ref}`,
      lines: [
        { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' }, debit: r.amount },
        { account: { code: 'PLATFORM_CASH' }, credit: r.amount },
      ],
    });
    await audit(tx, actor, { action: 'refund.paid', entityType: 'refund', entityId: r.id, newValues: { amount: r.amount, reference: ref } });
    await notify(tx, { event: 'REFUND_PAID', userIds: [r.customerId], vars: { amount: formatEGP(r.amount), reference: ref }, link: '/account' });
    if (r.sourceType === 'RETURN') {
      const { onReturnRefundPaid } = await import('@/server/modules/postpurchase/returns');
      await onReturnRefundPaid(tx, actor, r.sourceId);
    }
    if (r.sourceType === 'DEAL' && r.dealId) {
      const { onDealRefundPaid } = await import('@/server/modules/deals/service');
      await onDealRefundPaid(tx, actor, r.dealId);
    }
  });
}

export async function markDealPayoutPaid(actor: Actor, payoutId: string, reference: string, proof?: { data: Buffer; name: string } | null) {
  requirePermission(actor, 'deals.payout');
  requireStepUp(actor);
  const ref = reference?.trim();
  if (!ref || ref.length < 3) throw validation('رقم مرجع التحويل مطلوب');
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(dealPayouts).where(eq(dealPayouts.id, payoutId)).for('update');
    if (!p) throw notFound('المستحق');
    if (p.status === 'PAID') return;
    const file = proof ? await storeUpload(tx, actor, { purpose: 'WITHDRAWAL_PROOF', data: proof.data, originalName: proof.name }) : null;
    await tx.update(dealPayouts).set({ status: 'PAID', paidReference: ref, paidProofFileId: file?.id ?? null, paidBy: actor.userId, paidAt: new Date() }).where(eq(dealPayouts.id, p.id));
    const [deal] = await tx.select({ number: externalDeals.number }).from(externalDeals).where(eq(externalDeals.id, p.dealId));
    await postEntry(tx, actor, {
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
