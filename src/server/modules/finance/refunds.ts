import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { refundMachine, type RefundStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { resolveAttribution, stageOfSellerOrder } from '@/server/modules/pricing/refund-policy';
import type { RefundReasonCode, ResponsibleParty } from '@/server/db/schema';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { proportion } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { journalEntries, journalLines, ledgerAccounts, orderItems, orders, paymentSubmissions, payments, refundItems, refunds, sellerOrders, users } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { takeMovementRequest, completeMovementRequest } from './movements';
import { storeUpload } from '@/server/storage/uploads';
import { formatEGP } from '@/lib/format';
import { transition } from '../_shared';
import { grantApproval } from './approvals';
import { assertNotPaused } from './controls';
import { postEntry, type AccountCode } from './ledger';
import { assertNotSelfDealing } from './self-dealing';

export type Refund = typeof refunds.$inferSelect;
type SellerOrder = typeof sellerOrders.$inferSelect;
type OrderItem = typeof orderItems.$inferSelect;

/** Refund statuses that hold (reserve) part of the refundable amount. */
const ACTIVE_EXCLUDED: RefundStatus[] = ['REJECTED', 'CANCELLED'];

/** Fee split of a sub-order / item. Pre-hardening rows carried the whole fee on the seller. */
export function soFeeSplit(so: Pick<SellerOrder, 'buyerFeeTotal' | 'sellerFeeTotal' | 'commissionTotal'>) {
  return so.buyerFeeTotal + so.sellerFeeTotal === 0 ? { buyer: 0, seller: so.commissionTotal } : { buyer: so.buyerFeeTotal, seller: so.sellerFeeTotal };
}
export function itemFeeSplit(it: Pick<OrderItem, 'buyerFeeAmount' | 'sellerFeeAmount' | 'commissionAmount'>) {
  return it.buyerFeeAmount + it.sellerFeeAmount === 0 ? { buyer: 0, seller: it.commissionAmount } : { buyer: it.buyerFeeAmount, seller: it.sellerFeeAmount };
}

/** What is still refundable on a sub-order, net of every active (requested / approved / paid) refund. */
export async function refundableOf(conn: DbOrTx, so: SellerOrder) {
  const active = await conn
    .select()
    .from(refunds)
    .where(and(eq(refunds.sellerOrderId, so.id), notInArray(refunds.status, ACTIVE_EXCLUDED)));
  const items = await conn.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
  const lines = active.length
    ? await conn
        .select({ orderItemId: refundItems.orderItemId, quantity: refundItems.quantity })
        .from(refundItems)
        .where(inArray(refundItems.refundId, active.map((r) => r.id)))
    : [];
  const fee = soFeeSplit(so);
  const sum = (k: 'amount' | 'shippingAmount' | 'buyerFeeRefund' | 'sellerFeeReversal' | 'principalAmount') => active.reduce((a, r) => a + r[k], 0);
  return {
    total: so.grossTotal - sum('amount'),
    shipping: so.shippingFee - sum('shippingAmount'),
    buyerFee: fee.buyer - sum('buyerFeeRefund'),
    sellerFee: fee.seller - sum('sellerFeeReversal'),
    principal: so.merchandiseSubtotal - so.discountTotal - sum('principalAmount'),
    items: items.map((it) => {
      const reserved = lines.filter((l) => l.orderItemId === it.id).reduce((a, l) => a + l.quantity, 0);
      return { item: it, refundableQty: it.quantity - reserved };
    }),
  };
}

export interface RefundRequestInput {
  sellerOrderId: string;
  sourceType: 'ORDER_CANCELLATION' | 'RETURN' | 'DISPUTE' | 'DELIVERY_FAILURE' | 'ADMIN';
  sourceId: string;
  /** Item lines (unit-level). Omit for a pure amount refund (e.g. dispute partial compensation). */
  items?: { orderItemId: string; quantity: number }[];
  /** Extra principal not tied to units (dispute partial refund). */
  principalAmount?: number;
  shippingAmount?: number;
  /** Fee components; default = the fee snapshotted on the refunded units (never on shipping). */
  buyerFeeRefund?: number;
  sellerFeeReversal?: number;
  reason: string;
  /** Cost attribution (policy matrix). Defaults are derived from the source. */
  reasonCode?: RefundReasonCode;
  responsibleParty?: ResponsibleParty;
}

const DEFAULT_ATTRIBUTION: Record<RefundRequestInput['sourceType'], { reasonCode: RefundReasonCode; responsibleParty: ResponsibleParty }> = {
  ORDER_CANCELLATION: { reasonCode: 'BUYER_CANCELLATION', responsibleParty: 'BUYER' },
  RETURN: { reasonCode: 'BUYER_VOLUNTARY_RETURN', responsibleParty: 'UNDETERMINED' },
  DISPUTE: { reasonCode: 'DISPUTE_RESOLUTION', responsibleParty: 'UNDETERMINED' },
  DELIVERY_FAILURE: { reasonCode: 'NON_DELIVERY', responsibleParty: 'CARRIER' },
  ADMIN: { reasonCode: 'OTHER', responsibleParty: 'UNDETERMINED' },
};
const applyShare = (amount: number, bps: number) => Math.floor((amount * bps + 5000) / 10000);

/**
 * Create a refund REQUEST. Moves no money. The amount is reserved against the refundable ceiling so
 * concurrent requests can never promise more than was paid. Idempotent per (source type, source id).
 */
export async function requestRefundTx(tx: DbOrTx, actor: Actor, input: RefundRequestInput): Promise<Refund> {
  const [existing] = await tx.select().from(refunds).where(and(eq(refunds.sourceType, input.sourceType), eq(refunds.sourceId, input.sourceId)));
  if (existing) return existing;
  const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, input.sellerOrderId)).for('update');
  if (!so) throw notFound('الطلب');
  const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
  const left = await refundableOf(tx, so);
  let principal = input.principalAmount ?? 0;
  let buyerFee = 0;
  let sellerFee = 0;
  const lines: { orderItemId: string; quantity: number; principal: number; buyerFee: number; sellerFee: number }[] = [];
  for (const l of input.items ?? []) {
    const row = left.items.find((x) => x.item.id === l.orderItemId);
    if (!row) throw forbidden();
    if (!Number.isInteger(l.quantity) || l.quantity <= 0 || l.quantity > row.refundableQty) {
      throw validation(`الكمية المستردة من "${row.item.titleSnapshot}" أكبر من المتاح (${row.refundableQty})`);
    }
    const f = itemFeeSplit(row.item);
    // Exact per-unit allocation of the snapshotted fee (the last units absorb the rounding remainder).
    const alreadyQty = row.item.quantity - row.refundableQty;
    const cumBuyer = (q: number) => proportion(f.buyer, q, row.item.quantity);
    const cumSeller = (q: number) => proportion(f.seller, q, row.item.quantity);
    const b = cumBuyer(alreadyQty + l.quantity) - cumBuyer(alreadyQty);
    const s = cumSeller(alreadyQty + l.quantity) - cumSeller(alreadyQty);
    const p = row.item.unitPrice * l.quantity;
    lines.push({ orderItemId: l.orderItemId, quantity: l.quantity, principal: p, buyerFee: b, sellerFee: s });
    principal += p;
    buyerFee += b;
    sellerFee += s;
  }
  if (input.buyerFeeRefund !== undefined) buyerFee = input.buyerFeeRefund;
  if (input.sellerFeeReversal !== undefined) sellerFee = input.sellerFeeReversal;
  // Fee components come from the ORIGINAL immutable snapshot (per unit) — never today's rates — and
  // the fee refund & cost attribution policy decides which share is returned / reversed.
  const attrib = { ...DEFAULT_ATTRIBUTION[input.sourceType], ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}), ...(input.responsibleParty ? { responsibleParty: input.responsibleParty } : {}) };
  const stage = stageOfSellerOrder(so.status, !!so.fundsReleasedAt);
  const policy = await resolveAttribution(tx, { stage, reason: attrib.reasonCode, party: attrib.responsibleParty });
  buyerFee = applyShare(buyerFee, policy.buyerFeeRefundBps);
  sellerFee = applyShare(sellerFee, policy.sellerFeeReversalBps);
  // Shipping is never prorated blindly: only an explicit decision, or FULL / NONE from a published rule.
  const shipping = policy.shippingRefund === 'NONE' ? 0 : policy.shippingRefund === 'FULL' ? (input.shippingAmount ?? left.shipping) : (input.shippingAmount ?? 0);
  for (const [v, max, label] of [
    [principal, left.principal, 'قيمة المنتجات'],
    [shipping, left.shipping, 'الشحن'],
    [buyerFee, left.buyerFee, 'رسوم الخدمة على المشتري'],
    [sellerFee, left.sellerFee, 'رسوم الخدمة على البائع'],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > max) throw validation(`مكوّن الاسترداد «${label}» أكبر من المتبقي (${formatEGP(Math.max(0, max))})`);
  }
  const amount = principal + shipping + buyerFee;
  if (amount <= 0) throw validation('مبلغ الاسترداد لازم يكون أكبر من صفر');
  if (amount > left.total) throw invalidState(`المبلغ القابل للاسترداد لهذا الطلب ${formatEGP(left.total)}`);
  const sellerLiability = principal + shipping - sellerFee;
  const [payment] = await tx.select().from(payments).where(eq(payments.orderId, so.orderId));
  const destination = await originalPaymentDestination(tx, payment);
  const [refund] = await tx
    .insert(refunds)
    .values({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      customerId: order.customerId,
      sellerOrderId: so.id,
      amount,
      commissionReversal: buyerFee + sellerFee,
      principalAmount: principal,
      shippingAmount: shipping,
      buyerFeeRefund: buyerFee,
      sellerFeeReversal: sellerFee,
      sellerLiability,
      status: 'REQUESTED',
      reason: input.reason,
      originalPaymentId: payment?.id ?? null,
      // Authoritative destination: back through the original payment method / payer reference.
      destinationSnapshot: destination ? { source: 'ORIGINAL_PAYMENT', ...destination } : null,
      destinationSource: destination ? 'ORIGINAL_PAYMENT' : null,
      idempotencyKey: `${input.sourceType}:${input.sourceId}`,
      reasonCode: attrib.reasonCode,
      responsibleParty: attrib.responsibleParty,
      lifecycleStage: stage,
      feePolicyVersionId: policy.versionId,
      feePolicySource: policy.source,
      requestedBy: actor.userId,
      createdBy: actor.userId,
    })
    .returning();
  if (lines.length) await tx.insert(refundItems).values(lines.map((l) => ({ refundId: refund.id, ...l })));
  const { recordTransition } = await import('@/server/audit/audit');
  await recordTransition(tx, actor, 'refund', refund.id, null, 'REQUESTED', input.reason);
  await audit(tx, actor, { action: 'refund.requested', entityType: 'refund', entityId: refund.id, newValues: { sellerOrderId: so.id, amount, principal, shipping, buyerFee, sellerFee, source: input.sourceType, reasonCode: attrib.reasonCode, responsibleParty: attrib.responsibleParty, stage, feePolicy: policy.source, manualReview: policy.manualReview } });
  await notify(tx, { event: 'REFUND_UPDATED', userIds: [order.customerId], vars: { status: 'طلب الاسترداد اتسجل وقيد مراجعة الإدارة', amount: formatEGP(amount) }, link: `/account/orders/${order.id}`, dedupeKey: `refund:${refund.id}:requested` });
  return refund;
}

/** Authoritative refund destination: back through the ORIGINAL payment method / payer reference. */
export async function originalPaymentDestination(tx: DbOrTx, payment: typeof payments.$inferSelect | undefined | null) {
  if (!payment) return null;
  const [sub] = await tx.select().from(paymentSubmissions).where(and(eq(paymentSubmissions.paymentId, payment.id), eq(paymentSubmissions.status, 'ACCEPTED')));
  return { method: payment.method, paymentId: payment.id, payerName: sub?.payerName ?? null, payerReference: sub?.reference ?? null };
}

/** Stable comparison of two destination snapshots (key order independent). */
export function sameDestination(a: unknown, b: unknown) {
  const canon = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]) : v);
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
}

export function refundVersion(r: Refund) {
  return `${r.amount}:${r.principalAmount}:${r.shippingAmount}:${r.buyerFeeRefund}:${r.sellerFeeReversal}`;
}

/**
 * Admin approval of a marketplace refund: posts the balanced reversal (seller liability + fee reversal →
 * customer refunds payable) under ONE operation-specific approval. Idempotent: an approved refund returns.
 */
export async function approveRefund(actor: Actor, refundId: string, input: { expectedAmount: number; reason: string }) {
  requirePermission(actor, 'refunds.approve');
  requireStepUp(actor);
  if (!input.reason || input.reason.trim().length < 3) throw validation('اكتب سبب الاعتماد');
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (r.approvalId) return { alreadyApproved: true };
    if (r.status !== 'REQUESTED' && r.status !== 'UNDER_REVIEW') throw invalidState('لا يمكن اعتماد الاسترداد في حالته الحالية');
    if (r.amount !== input.expectedAmount) throw invalidState('المبلغ تغيّر بعد فتح الصفحة. راجع المبلغ الجديد واعتمد تاني');
    await assertNotPaused(tx, 'killswitch.refunds');
    if (r.customerId === actor.userId) throw forbidden('لا يمكنك اعتماد استرداد لنفسك');
    if (r.destinationChangedBy && r.destinationChangedBy === actor.userId) throw forbidden('من غيّر وجهة الاسترداد لا يمكنه اعتماده');
    if (!r.destinationSnapshot) throw invalidState('لا توجد وجهة استرداد أصلية مسجلة لهذا الاسترداد');
    // Universal Maker/Checker: a different authorized person requested exactly this approval.
    const mreq = await takeMovementRequest(tx, actor, 'REFUND_APPROVAL', r.id, r.amount);
    if (mreq.requestedBy === r.destinationChangedBy && r.destinationChangedBy) throw forbidden('من غيّر وجهة الاسترداد لا يمكن أن يكون منشئ اعتماده');
    if (!r.sellerOrderId) {
      if (!r.dealId) throw invalidState('استرداد بدون مصدر');
      const { approveDealRefundTx } = await import('@/server/modules/deals/service');
      const approval = await grantApproval(tx, actor, {
        action: 'DEAL_REFUND',
        entityType: 'refund',
        entityId: r.id,
        amount: r.amount,
        economicVersion: refundVersion(r),
        reason: input.reason,
        idempotencyKey: `refund-approval:${r.id}`,
        destinationSnapshot: r.destinationSnapshot as Record<string, unknown>,
        dualControl: { requestedBy: mreq.requestedBy },
      });
      await approveDealRefundTx(tx, actor, r, approval.id);
      await completeMovementRequest(tx, actor, mreq, approval.id);
      await transition(tx, actor, refundMachine, r.id, r.status, 'APPROVED', input.reason);
      await tx
        .update(refunds)
        .set({ status: 'APPROVED', approvalId: approval.id, approvedBy: actor.userId, approvedAt: new Date(), approvedDestination: r.destinationSnapshot, destinationApprovedBy: actor.userId, destinationReapprovalRequired: false })
        .where(eq(refunds.id, r.id));
      await audit(tx, actor, { action: 'refund.approved', entityType: 'refund', entityId: r.id, newValues: { approvalId: approval.id, amount: r.amount, dealId: r.dealId }, reason: input.reason });
      return { alreadyApproved: false, approvalId: approval.id };
    }
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.sellerOrderId)).for('update');
    await assertNotSelfDealing(tx, actor, so.sellerId);
    if (so.refundedTotal + r.amount > so.grossTotal) throw invalidState('الاسترداد يتجاوز المبلغ المدفوع');
    const approval = await grantApproval(tx, actor, {
      action: 'REFUND_APPROVAL',
      entityType: 'refund',
      entityId: r.id,
      amount: r.amount,
      economicVersion: refundVersion(r),
      reason: input.reason,
      idempotencyKey: `refund-approval:${r.id}`,
      destinationSnapshot: (r.destinationSnapshot as Record<string, unknown>) ?? null,
      dualControl: { requestedBy: mreq.requestedBy },
    });
    await completeMovementRequest(tx, actor, mreq, approval.id);
    const released = !!so.fundsReleasedAt;
    // Fallback for refund records created before components existed: proportional fee reversal.
    const commission = r.principalAmount + r.shippingAmount + r.buyerFeeRefund > 0 ? r.buyerFeeRefund + r.sellerFeeReversal : r.commissionReversal;
    const liability = r.amount - commission;
    await postEntry(tx, actor, {
      entryType: 'REFUND',
      sourceType: 'seller_order',
      sourceId: so.id,
      idempotencyKey: `refund:${r.id}`,
      description: `استرداد معتمد #${r.number} على الطلب الفرعي ${so.suffix}`,
      approvalId: approval.id,
      lines: [
        { account: { code: released ? 'SELLER_AVAILABLE' : 'SELLER_PENDING', sellerId: so.sellerId }, debit: liability, memo: 'seller liability' },
        { account: { code: released ? 'COMMISSION_REVENUE' : 'COMMISSION_DEFERRED' }, debit: commission, memo: 'fee reversal (buyer + seller share)' },
        { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' }, credit: r.amount },
      ],
    });
    await transition(tx, actor, refundMachine, r.id, r.status, 'APPROVED', input.reason);
    // The destination is frozen with the approval: the payout goes exactly there or not at all.
    await tx
      .update(refunds)
      .set({ status: 'APPROVED', approvalId: approval.id, approvedBy: actor.userId, approvedAt: new Date(), approvedDestination: r.destinationSnapshot, destinationApprovedBy: actor.userId, destinationReapprovalRequired: false })
      .where(eq(refunds.id, r.id));
    await tx.update(sellerOrders).set({ refundedTotal: so.refundedTotal + r.amount }).where(eq(sellerOrders.id, so.id));
    const lines = await tx.select().from(refundItems).where(eq(refundItems.refundId, r.id));
    for (const l of lines) {
      const [it] = await tx.select().from(orderItems).where(eq(orderItems.id, l.orderItemId)).for('update');
      await tx.update(orderItems).set({ refundedQuantity: it.refundedQuantity + l.quantity }).where(eq(orderItems.id, it.id));
    }
    await audit(tx, actor, { action: 'refund.approved', entityType: 'refund', entityId: r.id, newValues: { approvalId: approval.id, amount: r.amount, sellerLiability: liability, feeReversal: commission, released }, reason: input.reason });
    await notify(tx, { event: 'REFUND_UPDATED', userIds: [r.customerId], vars: { status: 'تم اعتماد الاسترداد وهو بانتظار التحويل', amount: formatEGP(r.amount) }, link: '/account', dedupeKey: `refund:${r.id}:approved` });
    return { alreadyApproved: false, approvalId: approval.id };
  });
}

/** Rejecting a refund is a financial decision (the customer is not paid): permission, fresh 2FA, reason, audited. */
export async function rejectRefund(actor: Actor, refundId: string, reason: string) {
  requirePermission(actor, 'refunds.approve');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 5) throw validation('اكتب سبب الرفض');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (r.status === 'REJECTED') return;
    if (r.customerId === actor.userId) throw forbidden('لا يمكنك البت في استرداد لنفسك');
    await transition(tx, actor, refundMachine, r.id, r.status, 'REJECTED', reason);
    await tx.update(refunds).set({ status: 'REJECTED', rejectReason: reason }).where(eq(refunds.id, r.id));
    await audit(tx, actor, { action: 'refund.rejected', entityType: 'refund', entityId: r.id, oldValues: { status: r.status }, newValues: { status: 'REJECTED', amount: r.amount }, reason });
    await notify(tx, { event: 'REFUND_UPDATED', userIds: [r.customerId], vars: { status: `طلب الاسترداد اترفض: ${reason}`, amount: formatEGP(r.amount) }, link: '/account', dedupeKey: `refund:${r.id}:rejected` });
  });
}

/** Payout attempt failed / bounced: nothing is reversed — the customer liability stays until paid. */
export async function markRefundFailed(actor: Actor, refundId: string, reason: string) {
  requirePermission(actor, 'refunds.pay');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 3) throw validation('اكتب سبب الفشل');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (r.customerId === actor.userId) throw forbidden('لا يمكنك تعديل استرداد يخصك');
    await transition(tx, actor, refundMachine, r.id, r.status, 'FAILED', reason);
    await tx.update(refunds).set({ status: 'FAILED', failureReason: reason }).where(eq(refunds.id, r.id));
    await audit(tx, actor, { action: 'refund.payout_failed', entityType: 'refund', entityId: r.id, reason });
  });
}

/**
 * EXCEPTIONAL destination change (e.g. the original wallet was closed). Dedicated permission, fresh 2FA and a
 * reason; never applied from the buyer's free text or profile. After approval it suspends execution: a
 * DIFFERENT person must re-approve the new destination (reapproveRefundDestination), and the person who
 * changed it can neither re-approve nor execute the payout.
 */
export async function overrideRefundDestination(actor: Actor, refundId: string, destination: { method: string; details: string }, reason: string) {
  requirePermission(actor, 'refunds.destination.override');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 10) throw validation('اكتب سبب تغيير وجهة الاسترداد (10 أحرف على الأقل)');
  if (!destination.method?.trim() || !destination.details?.trim()) throw validation('بيانات الوجهة مطلوبة');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (['COMPLETED', 'PAID', 'REJECTED', 'CANCELLED'].includes(r.status)) throw invalidState('لا يمكن تغيير وجهة استرداد منتهي');
    if (r.customerId === actor.userId) throw forbidden('لا يمكنك تغيير وجهة استرداد لنفسك');
    const next = { method: destination.method.trim(), details: destination.details.trim(), exception: true, previous: r.destinationSnapshot };
    const approved = !!r.approvalId;
    await tx
      .update(refunds)
      .set({ destinationSnapshot: next, destinationOverride: true, destinationChangedBy: actor.userId, destinationChangedAt: new Date(), destinationReapprovalRequired: approved })
      .where(eq(refunds.id, r.id));
    await audit(tx, actor, {
      action: 'refund.destination_overridden',
      entityType: 'refund',
      entityId: r.id,
      oldValues: { destination: r.destinationSnapshot, approvedDestination: r.approvedDestination },
      newValues: { destination: next, reapprovalRequired: approved },
      reason,
    });
  });
}

/** Second person re-approves an exceptional destination before any payout (fresh 2FA, reason, audited). */
export async function reapproveRefundDestination(actor: Actor, refundId: string, reason: string) {
  requirePermission(actor, 'refunds.approve');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 5) throw validation('اكتب سبب اعتماد الوجهة الجديدة');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (!r.destinationReapprovalRequired) throw invalidState('لا توجد وجهة جديدة بانتظار الاعتماد');
    if (r.destinationChangedBy === actor.userId) throw forbidden('من غيّر وجهة الاسترداد لا يمكنه اعتمادها');
    if (r.customerId === actor.userId) throw forbidden('لا يمكنك اعتماد استرداد لنفسك');
    if (r.sellerOrderId) {
      const [so] = await tx.select({ sellerId: sellerOrders.sellerId }).from(sellerOrders).where(eq(sellerOrders.id, r.sellerOrderId));
      await assertNotSelfDealing(tx, actor, so.sellerId);
    }
    await tx.update(refunds).set({ approvedDestination: r.destinationSnapshot, destinationApprovedBy: actor.userId, destinationReapprovalRequired: false }).where(eq(refunds.id, r.id));
    await audit(tx, actor, { action: 'refund.destination_reapproved', entityType: 'refund', entityId: r.id, oldValues: { approvedDestination: r.approvedDestination }, newValues: { approvedDestination: r.destinationSnapshot }, reason });
  });
}

/**
 * Record that the refund money was actually transferred (execution evidence). Separate approval
 * (REFUND_PAYOUT); above the dual-control threshold the payer must differ from the refund approver.
 */
export async function recordRefundPayout(actor: Actor, refundId: string, reference: string, proof?: { data: Buffer; name: string } | null) {
  requirePermission(actor, 'refunds.pay');
  requireStepUp(actor);
  const ref = reference?.trim();
  if (!ref || ref.length < 3) throw validation('رقم مرجع التحويل مطلوب');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (r.status === 'PAID' || r.status === 'COMPLETED') return;
    if (!['APPROVED', 'PROCESSING', 'FAILED', 'PENDING'].includes(r.status)) throw invalidState('يجب اعتماد الاسترداد قبل تسجيل صرفه');
    await assertNotPaused(tx, 'killswitch.payouts');
    if (r.customerId === actor.userId) throw forbidden('لا يمكنك صرف استرداد لنفسك');
    // Destination integrity (C4): only to the destination frozen by the approval, never one changed after it.
    if (!r.approvedDestination) throw invalidState('لا توجد وجهة استرداد معتمدة. يجب اعتماد الوجهة قبل الصرف');
    if (r.destinationReapprovalRequired || !sameDestination(r.approvedDestination, r.destinationSnapshot)) {
      throw invalidState('تم تغيير وجهة الاسترداد بعد الاعتماد. يلزم اعتماد الوجهة الجديدة من شخص آخر قبل الصرف');
    }
    if (r.destinationChangedBy && r.destinationChangedBy === actor.userId) throw forbidden('من غيّر وجهة الاسترداد لا يمكنه تنفيذ صرفه');
    const snapDest = r.approvedDestination as { source?: string; destinationId?: string; fingerprint?: string };
    if (snapDest.source === 'RECEIVING_DESTINATION') {
      const { receivingDestinations } = await import('@/server/db/schema');
      const [d] = await tx.select({ fingerprint: receivingDestinations.fingerprint, userId: receivingDestinations.userId, status: receivingDestinations.status }).from(receivingDestinations).where(eq(receivingDestinations.id, snapDest.destinationId ?? ''));
      if (!d || d.fingerprint !== snapDest.fingerprint || d.userId !== r.customerId) throw invalidState('بيانات استلام الأموال المعتمدة لهذا الاسترداد لم تعد مطابقة. لا يمكن الصرف');
      // Archived by the customer / sent back for re-verification / rejected since approval → never pay there.
      if (d.status !== 'APPROVED') throw invalidState('بيانات استلام الأموال دي لم تعد معتمدة (اتأرشفت أو مطلوب إعادة التحقق). يلزم اختيار وجهة معتمدة واعتمادها من جديد');
    }
    // Owner rule: always two-person — the refund approver is the Maker, the payer must be someone else.
    const maker = r.approvedBy;
    if (!maker) throw invalidState('لا يوجد معتمد مسجل لهذا الاسترداد. لا يمكن الصرف');
    if (maker === actor.userId) throw forbidden('منفذ صرف الاسترداد يجب أن يكون شخصاً مختلفاً عن معتمده');
    const dual = true;
    const approval = await grantApproval(tx, actor, {
      action: 'REFUND_PAYOUT',
      entityType: 'refund',
      entityId: r.id,
      amount: r.amount,
      economicVersion: refundVersion(r),
      reason: `صرف الاسترداد — مرجع ${ref}`,
      idempotencyKey: `refund-payout:${r.id}`,
      destinationSnapshot: r.approvedDestination as Record<string, unknown>,
      dualControl: dual ? { requestedBy: maker } : null,
    });
    const to: RefundStatus = r.status === 'PENDING' ? 'PAID' : 'COMPLETED';
    await transition(tx, actor, refundMachine, r.id, r.status, to);
    const file = proof ? await storeUpload(tx, actor, { purpose: 'REFUND_PROOF', data: proof.data, originalName: proof.name }) : null;
    await tx.update(refunds).set({ status: to, paidReference: ref, paidProofFileId: file?.id ?? null, paidBy: actor.userId, paidAt: new Date(), payoutApprovalId: approval.id }).where(eq(refunds.id, r.id));
    await postEntry(tx, actor, {
      entryType: 'REFUND_PAID',
      sourceType: 'refund',
      sourceId: r.id,
      idempotencyKey: `refund-paid:${r.id}`,
      description: `صرف استرداد #${r.number} للعميل — مرجع ${ref}`,
      approvalId: approval.id,
      lines: [
        { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' }, debit: r.amount },
        { account: { code: 'PLATFORM_CASH' }, credit: r.amount },
      ],
    });
    await audit(tx, actor, { action: 'refund.paid', entityType: 'refund', entityId: r.id, newValues: { amount: r.amount, reference: ref, approvalId: approval.id } });
    await notify(tx, { event: 'REFUND_PAID', userIds: [r.customerId], vars: { amount: formatEGP(r.amount), reference: ref }, link: '/account', dedupeKey: `refund:${r.id}:paid` });
    if (r.sourceType === 'RETURN') {
      const { onReturnRefundPaid } = await import('@/server/modules/postpurchase/returns');
      await onReturnRefundPaid(tx, actor, r.sourceId);
    }
  });
}

/**
 * Refund destination hierarchy (Batch 1.5): (1) the ORIGINAL payment destination when it can safely be used;
 * otherwise (2) an APPROVED «بيانات استلام الأموال» version owned by the SAME customer (beneficiary safety).
 * Never an arbitrary / typed destination. Chosen by the customer for their own refund, or by staff holding
 * the dedicated override permission. Before approval it simply becomes the destination the approval will
 * freeze; after approval it is an exceptional change that suspends payout until a DIFFERENT person re-approves.
 */
export async function useReceivingDestinationForRefund(actor: Actor, refundId: string, destinationId: string, reason: string) {
  const uid = actor.userId;
  if (!uid) throw forbidden();
  const why = reason?.trim();
  if (!why || why.length < 5) throw validation('اكتب سبب استخدام بيانات استلام الأموال بدل وسيلة الدفع الأصلية');
  const staff = actor.type === 'ADMIN';
  if (staff) {
    requirePermission(actor, 'refunds.destination.override');
    requireStepUp(actor);
  }
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (!staff && r.customerId !== uid) throw notFound('الاسترداد');
    if (['COMPLETED', 'PAID', 'REJECTED', 'CANCELLED'].includes(r.status) || r.paidAt) throw invalidState('لا يمكن تغيير وجهة استرداد منتهي');
    if (!staff && r.approvalId) throw invalidState('الاسترداد اتعتمد بالفعل. تغيير الوجهة بعد الاعتماد يتم عن طريق فريق اضمن فقط');
    const { approvedDestinationOf, destinationIntact } = await import('@/server/modules/identity/receiving');
    const d = await approvedDestinationOf(tx, r.customerId, destinationId);
    if (!d) throw invalidState('بيانات استلام الأموال غير معتمدة أو لا تخص صاحب الاسترداد');
    if (!destinationIntact(d)) throw invalidState('بيانات استلام الأموال لا تطابق النسخة المعتمدة');
    const snapshot = { source: 'RECEIVING_DESTINATION', destinationId: d.id, version: d.version, type: d.type, holderName: d.holderName, masked: d.maskedLabel, fingerprint: d.fingerprint, selectionReason: why, selectedBy: uid, selectedAt: new Date().toISOString() };
    const approved = !!r.approvalId;
    await tx
      .update(refunds)
      .set({
        destinationSnapshot: snapshot,
        destinationSource: 'RECEIVING_DESTINATION',
        receivingDestinationId: d.id,
        receivingDestinationVersion: d.version,
        destinationFingerprint: d.fingerprint,
        destinationSelectionReason: why,
        ...(approved ? { destinationOverride: true, destinationChangedBy: uid, destinationChangedAt: new Date(), destinationReapprovalRequired: true } : {}),
      })
      .where(eq(refunds.id, r.id));
    await audit(tx, actor, { action: 'refund.receiving_destination_selected', entityType: 'refund', entityId: r.id, oldValues: { destination: r.destinationSnapshot }, newValues: { destinationId: d.id, version: d.version, fingerprint: d.fingerprint, reapprovalRequired: approved }, reason: why });
    return { reapprovalRequired: approved };
  });
}

/** Transfer fields for the person executing an approved refund payout (refunds.pay + fresh 2FA), audited. */
export async function revealRefundDestination(actor: Actor, refundId: string) {
  requirePermission(actor, 'refunds.pay');
  requireStepUp(actor);
  const [r] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!r?.approvedDestination) throw notFound('وجهة الاسترداد المعتمدة');
  const snap = r.approvedDestination as { source?: string; destinationId?: string; fingerprint?: string };
  let details: Record<string, unknown> = { ...snap };
  if (snap.source === 'RECEIVING_DESTINATION' && snap.destinationId) {
    const { receivingDestinations } = await import('@/server/db/schema');
    const { decryptJson } = await import('@/server/core/crypto');
    const [d] = await db.select().from(receivingDestinations).where(eq(receivingDestinations.id, snap.destinationId));
    if (!d || d.fingerprint !== snap.fingerprint) throw invalidState('نسخة بيانات استلام الأموال لا تطابق اللقطة المعتمدة');
    details = { ...decryptJson<Record<string, unknown>>(d.detailsEnc), masked: d.maskedLabel };
  }
  await audit(db, actor, { action: 'refund.destination_revealed', entityType: 'refund', entityId: r.id });
  return details;
}

/**
 * Revocation of an APPROVED refund that has NOT been executed (owner rule: never a deletion). Two-person:
 * a Maker requests REFUND_REVOCATION, a different Checker (refunds.approve, fresh 2FA, reason) executes it.
 * Posts a compensating REFUND_REVERSAL (the exact mirror of the approval journal); the original journal and
 * the refund row stay as evidence (status CANCELLED + revoked_* fields). Allowed only where the underlying order
 * stays consistent (ADMIN / DISPUTE refunds on a sub-order that is not cancelled); a money transfer that already
 * happened is never "cancelled" — that needs a separate compensating recovery outside this workflow.
 */
export async function revokeRefund(actor: Actor, refundId: string, input: { reason: string }) {
  requirePermission(actor, 'refunds.approve');
  requireStepUp(actor);
  const why = input.reason?.trim();
  if (!why || why.length < 10) throw validation('اكتب سبب إلغاء الاسترداد (10 أحرف على الأقل)');
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (r.status === 'CANCELLED' && r.revokedAt) return { alreadyRevoked: true };
    if (r.status !== 'APPROVED' || r.paidAt || r.payoutApprovalId) throw invalidState('الإلغاء متاح فقط لاسترداد معتمد لم يُحوَّل. ما تم تحويله لا يُلغى');
    if (!r.sellerOrderId || !['ADMIN', 'DISPUTE'].includes(r.sourceType)) throw invalidState('إلغاء هذا النوع من الاسترداد غير متاح (إلغاء طلب / إرجاع / صفقة محمية) — يلزم قرار تصحيحي منفصل');
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.sellerOrderId)).for('update');
    if (so.status === 'CANCELLED') throw invalidState('الطلب الفرعي ملغي؛ إلغاء الاسترداد سيترك مبالغ غير قابلة للإتاحة');
    await assertNotSelfDealing(tx, actor, so.sellerId);
    const mreq = await takeMovementRequest(tx, actor, 'REFUND_REVOCATION', r.id, r.amount);
    const [orig] = await tx.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `refund:${r.id}`));
    if (!orig) throw invalidState('قيد اعتماد الاسترداد غير موجود');
    const lines = await tx.select({ l: journalLines, code: ledgerAccounts.code, sellerId: ledgerAccounts.sellerId }).from(journalLines).innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId)).where(eq(journalLines.entryId, orig.id));
    const approval = await grantApproval(tx, actor, {
      action: 'REFUND_REVOCATION',
      entityType: 'refund',
      entityId: r.id,
      amount: r.amount,
      economicVersion: `revoke:${refundVersion(r)}:entry:${orig.id}`,
      reason: why,
      idempotencyKey: `refund-revocation:${r.id}`,
      dualControl: { requestedBy: mreq.requestedBy },
    });
    // Exact mirror of the approval entry (debits ↔ credits) — a compensating entry, never an edit.
    await postEntry(tx, actor, {
      entryType: 'REFUND_REVERSAL',
      sourceType: 'seller_order',
      sourceId: so.id,
      idempotencyKey: `refund-revocation:${r.id}`,
      description: `إلغاء استرداد معتمد #${r.number} قبل التحويل (قيد تعويضي)`,
      approvalId: approval.id,
      reversesEntryId: orig.id,
      lines: lines.map(({ l, code, sellerId }) => ({ account: { code: code as AccountCode, sellerId }, debit: l.credit || undefined, credit: l.debit || undefined, memo: `reversal of ${l.memo ?? code}` })),
    });
    await transition(tx, actor, refundMachine, r.id, r.status, 'CANCELLED', why);
    await tx.update(refunds).set({ status: 'CANCELLED', revokedAt: new Date(), revokedBy: actor.userId, revokeReason: why }).where(eq(refunds.id, r.id));
    await tx.update(sellerOrders).set({ refundedTotal: Math.max(0, so.refundedTotal - r.amount) }).where(eq(sellerOrders.id, so.id));
    for (const l of await tx.select().from(refundItems).where(eq(refundItems.refundId, r.id))) {
      const [it] = await tx.select().from(orderItems).where(eq(orderItems.id, l.orderItemId)).for('update');
      await tx.update(orderItems).set({ refundedQuantity: Math.max(0, it.refundedQuantity - l.quantity) }).where(eq(orderItems.id, it.id));
    }
    await completeMovementRequest(tx, actor, mreq, approval.id);
    await audit(tx, actor, { action: 'refund.revoked', entityType: 'refund', entityId: r.id, oldValues: { status: r.status }, newValues: { status: 'CANCELLED', approvalId: approval.id, maker: mreq.requestedBy, reversedEntryId: orig.id }, reason: why });
    await notify(tx, { event: 'REFUND_UPDATED', userIds: [r.customerId], vars: { status: 'تم إلغاء اعتماد الاسترداد قبل التحويل — لم يتم تحويل أي مبلغ', amount: formatEGP(r.amount) }, link: '/account', dedupeKey: `refund:${r.id}:revoked` });
    return { alreadyRevoked: false, approvalId: approval.id };
  });
}

/* ───────── Reads ───────── */

export async function refundQueue(statuses: RefundStatus[], limit = 50, offset = 0) {
  return db
    .select({ r: refunds, customer: users.fullName, orderNumber: orders.number, suffix: sellerOrders.suffix })
    .from(refunds)
    .innerJoin(users, eq(users.id, refunds.customerId))
    .leftJoin(sellerOrders, eq(sellerOrders.id, refunds.sellerOrderId))
    .leftJoin(orders, eq(orders.id, sellerOrders.orderId))
    .where(inArray(refunds.status, statuses))
    .orderBy(desc(refunds.createdAt), desc(refunds.id))
    .limit(limit)
    .offset(offset);
}

export async function refundsForSellerOrder(conn: DbOrTx, soId: string) {
  return conn.select().from(refunds).where(eq(refunds.sellerOrderId, soId)).orderBy(desc(refunds.createdAt));
}

export async function refundDetail(refundId: string) {
  const [r] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!r) throw notFound('الاسترداد');
  const lines = await db
    .select({ l: refundItems, title: orderItems.titleSnapshot })
    .from(refundItems)
    .innerJoin(orderItems, eq(orderItems.id, refundItems.orderItemId))
    .where(eq(refundItems.refundId, r.id));
  const [customer] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, r.customerId));
  return { refund: r, lines, customer };
}

export async function openRefundTotal(conn: DbOrTx, userId: string) {
  const res = await conn.execute<{ n: string }>(
    sql`select count(*)::text n from refunds where customer_id = ${userId} and status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','FAILED','PENDING')`,
  );
  return Number(res.rows[0]?.n ?? 0);
}
