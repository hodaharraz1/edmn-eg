import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { refundMachine, type RefundStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { resolveAttribution, stageOfSellerOrder } from '@/server/modules/pricing/refund-policy';
import type { RefundReasonCode, ResponsibleParty } from '@/server/db/schema';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { proportion } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { orderItems, orders, paymentSubmissions, payments, refundItems, refunds, sellerOrders, users } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { formatEGP } from '@/lib/format';
import { transition } from '../_shared';
import { grantApproval } from './approvals';
import { assertNotPaused } from './controls';
import { postEntry } from './ledger';
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
  const [sub] = payment
    ? await tx.select().from(paymentSubmissions).where(and(eq(paymentSubmissions.paymentId, payment.id), eq(paymentSubmissions.status, 'ACCEPTED')))
    : [];
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
      destinationSnapshot: payment ? { method: payment.method, paymentId: payment.id, payerName: sub?.payerName ?? null, payerReference: sub?.reference ?? null } : null,
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
      });
      await approveDealRefundTx(tx, actor, r, approval.id);
      await transition(tx, actor, refundMachine, r.id, r.status, 'APPROVED', input.reason);
      await tx.update(refunds).set({ status: 'APPROVED', approvalId: approval.id, approvedBy: actor.userId, approvedAt: new Date() }).where(eq(refunds.id, r.id));
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
    });
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
    await tx.update(refunds).set({ status: 'APPROVED', approvalId: approval.id, approvedBy: actor.userId, approvedAt: new Date() }).where(eq(refunds.id, r.id));
    await tx.update(sellerOrders).set({ refundedTotal: so.refundedTotal + r.amount }).where(eq(sellerOrders.id, so.id));
    const lines = await tx.select().from(refundItems).where(eq(refundItems.refundId, r.id));
    for (const l of lines) {
      const [it] = await tx.select().from(orderItems).where(eq(orderItems.id, l.orderItemId)).for('update');
      await tx.update(orderItems).set({ refundedQuantity: it.refundedQuantity + l.quantity }).where(eq(orderItems.id, it.id));
    }
    await audit(tx, actor, { action: 'refund.approved', entityType: 'refund', entityId: r.id, newValues: { approvalId: approval.id, amount: r.amount, sellerLiability: liability, feeReversal: commission, released }, reason: input.reason });
    await notify(tx, { event: 'REFUND_UPDATED', userIds: [r.customerId], vars: { status: 'الاسترداد اتعتمد وجاري التحويل', amount: formatEGP(r.amount) }, link: '/account', dedupeKey: `refund:${r.id}:approved` });
    return { alreadyApproved: false, approvalId: approval.id };
  });
}

export async function rejectRefund(actor: Actor, refundId: string, reason: string) {
  requirePermission(actor, 'refunds.approve');
  if (!reason || reason.trim().length < 3) throw validation('اكتب سبب الرفض');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (r.status === 'REJECTED') return;
    await transition(tx, actor, refundMachine, r.id, r.status, 'REJECTED', reason);
    await tx.update(refunds).set({ status: 'REJECTED', rejectReason: reason }).where(eq(refunds.id, r.id));
    await audit(tx, actor, { action: 'refund.rejected', entityType: 'refund', entityId: r.id, reason });
    await notify(tx, { event: 'REFUND_UPDATED', userIds: [r.customerId], vars: { status: `طلب الاسترداد اترفض: ${reason}`, amount: formatEGP(r.amount) }, link: '/account', dedupeKey: `refund:${r.id}:rejected` });
  });
}

/** Payout attempt failed / bounced: nothing is reversed — the customer liability stays until paid. */
export async function markRefundFailed(actor: Actor, refundId: string, reason: string) {
  requirePermission(actor, 'refunds.pay');
  if (!reason || reason.trim().length < 3) throw validation('اكتب سبب الفشل');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    await transition(tx, actor, refundMachine, r.id, r.status, 'FAILED', reason);
    await tx.update(refunds).set({ status: 'FAILED', failureReason: reason }).where(eq(refunds.id, r.id));
    await audit(tx, actor, { action: 'refund.payout_failed', entityType: 'refund', entityId: r.id, reason });
  });
}

/**
 * Manual destination exception (e.g. the original wallet was closed). Fresh 2FA, reason, audited; never
 * applied silently from the buyer's current profile, and impossible once the refund was paid out.
 */
export async function overrideRefundDestination(actor: Actor, refundId: string, destination: { method: string; details: string }, reason: string) {
  requirePermission(actor, 'refunds.approve');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 5) throw validation('اكتب سبب تغيير وجهة الاسترداد');
  if (!destination.details?.trim()) throw validation('بيانات الوجهة مطلوبة');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r) throw notFound('الاسترداد');
    if (['COMPLETED', 'PAID', 'REJECTED', 'CANCELLED'].includes(r.status)) throw invalidState('لا يمكن تغيير وجهة استرداد منتهي');
    const next = { method: destination.method, details: destination.details.trim(), overriddenBy: actor.userId, previous: r.destinationSnapshot };
    await tx.update(refunds).set({ destinationSnapshot: next, destinationOverride: true }).where(eq(refunds.id, r.id));
    await audit(tx, actor, { action: 'refund.destination_overridden', entityType: 'refund', entityId: r.id, oldValues: { destination: r.destinationSnapshot }, newValues: { destination: next }, reason });
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
    const threshold = await getSetting('withdrawals.dualControlThreshold', tx);
    const maker = r.approvedBy ?? r.createdBy;
    const dual = r.amount >= threshold && !!maker;
    if (dual && maker === actor.userId) throw forbidden('هذا المبلغ يتطلب أن يكون منفذ الصرف شخصاً مختلفاً عن معتمد الاسترداد');
    const approval = await grantApproval(tx, actor, {
      action: 'REFUND_PAYOUT',
      entityType: 'refund',
      entityId: r.id,
      amount: r.amount,
      economicVersion: refundVersion(r),
      reason: `صرف الاسترداد — مرجع ${ref}`,
      idempotencyKey: `refund-payout:${r.id}`,
      destinationSnapshot: (r.destinationSnapshot as Record<string, unknown>) ?? null,
      dualControl: dual ? { requestedBy: maker! } : null,
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
