import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { dealMachine, disputeMachine, returnMachine, type DisputeDecision, type DisputeStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireUser, type Actor } from '@/server/core/actor';
import { conflict, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { parseEgp } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { disputeEvidence, disputeMessages, disputes, externalDeals, orders, returnItems, returns, sellerOrders, sellers, users } from '@/server/db/schema';
import { releaseIfEligible } from '@/server/modules/commerce/fulfilment';
import { createSellerOrderRefund } from '@/server/modules/finance/postings';
import { notify } from '@/server/modules/notifications/notify';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason, transition } from '../_shared';
import { getSetting } from '@/server/modules/settings';
import { acceptReturnRefundTx } from './returns';

export type Dispute = typeof disputes.$inferSelect;
const OPEN: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'];

export const openDisputeSchema = z.object({
  sellerOrderId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  reasonCode: z.string().trim().min(3).max(60),
  description: z.string().trim().min(20, 'اشرح المشكلة بتفصيل (20 حرفاً على الأقل)').max(4000),
  claimedAmount: z.string().trim().optional().default(''),
});

export async function openDispute(actor: Actor, input: z.input<typeof openDisputeSchema>, evidence: { data: Buffer; name: string }[] = []) {
  const userId = requireUser(actor);
  const d = parse(openDisputeSchema, input);
  if (!!d.sellerOrderId === !!d.dealId) throw validation('حدد الطلب أو الصفقة');
  let claimed: number | null = null;
  if (d.claimedAmount) {
    try {
      claimed = parseEgp(d.claimedAmount);
    } catch {
      throw validation('المبلغ غير صحيح');
    }
  }
  return db.transaction(async (tx) => {
    const dispute = await openDisputeTx(tx, actor, { sellerOrderId: d.sellerOrderId, dealId: d.dealId, reasonCode: d.reasonCode, description: d.description, claimedAmount: claimed, claimantUserId: userId });
    for (const e of evidence.slice(0, 8)) {
      const f = await storeUpload(tx, actor, { purpose: 'DISPUTE_EVIDENCE', data: e.data, originalName: e.name });
      await tx.insert(disputeEvidence).values({ disputeId: dispute.id, fileId: f.id, uploadedBy: userId });
    }
    return dispute;
  });
}

export async function openDisputeTx(
  tx: DbOrTx,
  actor: Actor,
  input: { sellerOrderId?: string; dealId?: string; reasonCode: string; description: string; claimedAmount?: number | null; claimantUserId: string; returnId?: string },
) {
  let respondentSellerId: string | null = null;
  let respondentUserId: string | null = null;
  if (input.sellerOrderId) {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, input.sellerOrderId)).for('update');
    if (!so) throw notFound('الطلب');
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    const isBuyer = order.customerId === actor.userId;
    const isSellerSide = actor.type === 'SELLER' && actor.sellerId === so.sellerId;
    if (!isBuyer && !isSellerSide && !hasPermission(actor, 'disputes.manage') && !hasPermission(actor, 'returns.manage')) throw forbidden();
    if (['PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'CANCELLED'].includes(so.status)) throw invalidState('لا يمكن فتح نزاع على هذا الطلب في حالته الحالية');
    const windowDays = await getSetting('disputes.windowDays', tx);
    if (so.deliveredAt && Date.now() - so.deliveredAt.getTime() > windowDays * 86_400_000) throw invalidState(`انتهت مدة فتح النزاع (${windowDays} يوماً من الاستلام)`);
    const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
    respondentSellerId = so.sellerId;
    respondentUserId = s.ownerUserId;
    input.claimantUserId = order.customerId;
  } else if (input.dealId) {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, input.dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    const isBuyer = deal.buyerId === actor.userId;
    const isSeller = deal.sellerUserId === actor.userId;
    if (!isBuyer && !isSeller) throw forbidden();
    if (!['ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING'].includes(deal.status)) throw invalidState('لا يمكن فتح نزاع على الصفقة في حالتها الحالية');
    input.claimantUserId = actor.userId!;
    respondentUserId = isBuyer ? deal.sellerUserId : deal.buyerId;
    await transition(tx, actor, dealMachine, deal.id, deal.status, 'DISPUTED', input.description.slice(0, 200));
    await tx.update(externalDeals).set({ status: 'DISPUTED' }).where(eq(externalDeals.id, deal.id));
  }
  const existing = await tx
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(input.sellerOrderId ? eq(disputes.sellerOrderId, input.sellerOrderId) : eq(disputes.dealId, input.dealId!), inArray(disputes.status, OPEN)));
  if (existing.length) throw conflict('يوجد نزاع مفتوح بالفعل على هذا الطلب');
  const [dispute] = await tx
    .insert(disputes)
    .values({
      sellerOrderId: input.sellerOrderId ?? null,
      dealId: input.dealId ?? null,
      returnId: input.returnId ?? null,
      claimantUserId: input.claimantUserId,
      respondentSellerId,
      respondentUserId,
      reasonCode: input.reasonCode,
      description: input.description,
      claimedAmount: input.claimedAmount ?? null,
    })
    .returning();
  const { recordTransition } = await import('@/server/audit/audit');
  await recordTransition(tx, actor, 'dispute', dispute.id, null, 'OPEN');
  await audit(tx, actor, { action: 'dispute.opened', entityType: 'dispute', entityId: dispute.id, newValues: { sellerOrderId: input.sellerOrderId, dealId: input.dealId, reasonCode: input.reasonCode } });
  await notify(tx, { event: 'DISPUTE_OPENED', userIds: [input.claimantUserId, respondentUserId], vars: { dispute: dispute.number }, link: `/account/disputes/${dispute.id}` });
  return dispute;
}

function partyRole(actor: Actor, d: Dispute): 'CLAIMANT' | 'RESPONDENT' | 'ADMIN' | null {
  if (actor.type === 'ADMIN' && hasPermission(actor, 'disputes.manage')) return 'ADMIN';
  if (actor.userId === d.claimantUserId) return 'CLAIMANT';
  if (actor.userId === d.respondentUserId) return 'RESPONDENT';
  if (actor.type === 'SELLER' && d.respondentSellerId && actor.sellerId === d.respondentSellerId) return 'RESPONDENT';
  return null;
}

export async function addDisputeMessage(actor: Actor, disputeId: string, body: string, internal = false, attachment?: { data: Buffer; name: string } | null) {
  requireUser(actor);
  const text = body?.trim();
  if (!text || text.length < 2) throw validation('اكتب رسالتك');
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for('update');
    if (!d) throw notFound('النزاع');
    const role = partyRole(actor, d);
    if (!role) throw forbidden();
    if (internal && role !== 'ADMIN') throw forbidden();
    if (!OPEN.includes(d.status) && role !== 'ADMIN') throw invalidState('النزاع مغلق');
    await tx.insert(disputeMessages).values({ disputeId: d.id, authorUserId: actor.userId!, authorRole: role, body: text.slice(0, 4000), isInternal: internal });
    if (attachment) {
      const f = await storeUpload(tx, actor, { purpose: 'DISPUTE_EVIDENCE', data: attachment.data, originalName: attachment.name });
      await tx.insert(disputeEvidence).values({ disputeId: d.id, fileId: f.id, uploadedBy: actor.userId!, note: text.slice(0, 200) });
    }
    if (role !== 'ADMIN' && d.status === 'AWAITING_INFORMATION') {
      await transition(tx, actor, disputeMachine, d.id, d.status, 'UNDER_REVIEW');
      await tx.update(disputes).set({ status: 'UNDER_REVIEW' }).where(eq(disputes.id, d.id));
    }
    if (!internal) {
      const others = [d.claimantUserId, d.respondentUserId].filter((u) => u && u !== actor.userId);
      await notify(tx, { event: 'DISPUTE_UPDATED', userIds: others, vars: { dispute: d.number }, link: `/account/disputes/${d.id}` });
    }
  });
}

export async function setDisputeStatus(actor: Actor, disputeId: string, to: 'UNDER_REVIEW' | 'AWAITING_INFORMATION', note?: string) {
  requirePermission(actor, 'disputes.manage');
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for('update');
    if (!d) throw notFound('النزاع');
    await transition(tx, actor, disputeMachine, d.id, d.status, to, note);
    await tx.update(disputes).set({ status: to, assignedTo: d.assignedTo ?? actor.userId }).where(eq(disputes.id, d.id));
    await audit(tx, actor, { action: 'dispute.status_changed', entityType: 'dispute', entityId: d.id, newValues: { status: to }, reason: note ?? null });
  });
}

export async function assignDispute(actor: Actor, disputeId: string, assigneeId: string) {
  requirePermission(actor, 'disputes.manage');
  await db.transaction(async (tx) => {
    await tx.update(disputes).set({ assignedTo: assigneeId }).where(eq(disputes.id, disputeId));
    await audit(tx, actor, { action: 'dispute.assigned', entityType: 'dispute', entityId: disputeId, newValues: { assigneeId } });
  });
}

export const decisionSchema = z.object({
  decision: z.enum(['FULL_REFUND', 'PARTIAL_REFUND', 'RETURN_REQUIRED', 'REPLACEMENT', 'RELEASE_TO_SELLER', 'REJECT_CLAIM']),
  amount: z.string().trim().optional().default(''),
  reasonCode: z.string().trim().min(3).max(60),
  note: z.string().trim().min(10, 'اكتب تسبيب القرار (10 أحرف على الأقل)').max(4000),
});

/**
 * Resolve a dispute. Financial outcomes only create refund records / ledger postings inside the
 * implemented manual workflow — no money is moved outside it.
 */
export async function resolveDispute(actor: Actor, disputeId: string, input: z.input<typeof decisionSchema>) {
  requirePermission(actor, 'disputes.manage');
  const d = parse(decisionSchema, input);
  let amount: number | null = null;
  if (d.decision === 'PARTIAL_REFUND') {
    try {
      amount = parseEgp(d.amount);
    } catch {
      throw validation('حدد مبلغ الاسترداد الجزئي');
    }
  }
  return db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for('update');
    if (!dispute) throw notFound('النزاع');
    if (!OPEN.includes(dispute.status)) throw invalidState('تم حسم هذا النزاع بالفعل');
    await transition(tx, actor, disputeMachine, dispute.id, dispute.status, 'RESOLVED', d.note);
    await tx
      .update(disputes)
      .set({ status: 'RESOLVED', decision: d.decision, decisionAmount: amount, decisionReasonCode: d.reasonCode, decisionNote: d.note, decidedBy: actor.userId, decidedAt: new Date() })
      .where(eq(disputes.id, dispute.id));

    if (dispute.sellerOrderId) await applyOrderDecision(tx, actor, dispute, d.decision, amount, d.note);
    else if (dispute.dealId) {
      const { applyDealDecision } = await import('@/server/modules/deals/service');
      await applyDealDecision(tx, actor, dispute.dealId, d.decision, amount, dispute.id, d.note);
    }
    await audit(tx, actor, { action: 'dispute.resolved', entityType: 'dispute', entityId: dispute.id, newValues: { decision: d.decision, amount, reasonCode: d.reasonCode }, reason: d.note });
    await notify(tx, {
      event: 'DISPUTE_RESOLVED',
      userIds: [dispute.claimantUserId, dispute.respondentUserId],
      vars: { dispute: dispute.number, decision: DECISION_LABELS[d.decision] },
      link: `/account/disputes/${dispute.id}`,
    });
  });
}

export const DECISION_LABELS: Record<DisputeDecision, string> = {
  FULL_REFUND: 'استرداد كامل للمشتري',
  PARTIAL_REFUND: 'استرداد جزئي',
  RETURN_REQUIRED: 'إرجاع المنتج مطلوب',
  REPLACEMENT: 'استبدال المنتج',
  RELEASE_TO_SELLER: 'صرف المستحقات للبائع',
  REJECT_CLAIM: 'رفض الشكوى',
};

async function applyOrderDecision(tx: DbOrTx, actor: Actor, dispute: Dispute, decision: DisputeDecision, amount: number | null, note: string) {
  const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, dispute.sellerOrderId!)).for('update');
  const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
  const ret = dispute.returnId ? (await tx.select().from(returns).where(eq(returns.id, dispute.returnId)).for('update'))[0] : null;
  const refundAmount = decision === 'FULL_REFUND' ? so.grossTotal - so.refundedTotal : decision === 'PARTIAL_REFUND' ? amount! : 0;

  if (ret && ret.status === 'DISPUTED') {
    if (decision === 'FULL_REFUND' || decision === 'PARTIAL_REFUND') {
      await transition(tx, actor, returnMachine, ret.id, ret.status, 'APPROVED', note);
      const approved = { ...ret, status: 'APPROVED' as const };
      await tx.update(returns).set({ status: 'APPROVED' }).where(eq(returns.id, ret.id));
      await transition(tx, actor, returnMachine, ret.id, 'APPROVED', 'RECEIVED', 'قرار نزاع');
      await tx.update(returns).set({ status: 'RECEIVED' }).where(eq(returns.id, ret.id));
      await acceptReturnRefundTx(tx, actor, { ...approved, status: 'RECEIVED' }, { amount: Math.min(refundAmount, so.grossTotal - so.refundedTotal), includeShipping: decision === 'FULL_REFUND', note });
    } else if (decision === 'RETURN_REQUIRED') {
      await transition(tx, actor, returnMachine, ret.id, ret.status, 'APPROVED', note);
      await tx.update(returns).set({ status: 'APPROVED' }).where(eq(returns.id, ret.id));
    } else if (decision === 'REJECT_CLAIM' || decision === 'RELEASE_TO_SELLER') {
      await transition(tx, actor, returnMachine, ret.id, ret.status, 'REJECTED', note);
      await tx.update(returns).set({ status: 'REJECTED', decisionReason: note }).where(eq(returns.id, ret.id));
    }
  } else if (refundAmount > 0) {
    await createSellerOrderRefund(tx, actor, { sellerOrderId: so.id, customerId: order.customerId, amount: refundAmount, sourceType: 'DISPUTE', sourceId: dispute.id, reason: note });
  } else if (decision === 'RETURN_REQUIRED') {
    // Open an approved return for all remaining items so the normal return workflow takes over.
    const { orderItems } = await import('@/server/db/schema');
    const items = await tx.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    const remaining = items.filter((i) => i.quantity - i.returnedQuantity > 0);
    if (remaining.length) {
      const [r] = await tx
        .insert(returns)
        .values({ orderId: order.id, sellerOrderId: so.id, sellerId: so.sellerId, customerId: order.customerId, status: 'APPROVED', reason: 'OTHER', description: `بقرار النزاع #${dispute.number}: ${note}`.slice(0, 2000), decisionReason: note })
        .returning();
      await tx.insert(returnItems).values(remaining.map((i) => ({ returnId: r.id, orderItemId: i.id, quantity: i.quantity - i.returnedQuantity })));
    }
  }
  // Clear the dispute hold and release whatever is left for the seller (if delivered).
  await releaseIfEligible(tx, actor, so.id);
}

export async function closeDispute(actor: Actor, disputeId: string) {
  requirePermission(actor, 'disputes.manage');
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for('update');
    if (!d) throw notFound('النزاع');
    await transition(tx, actor, disputeMachine, d.id, d.status, 'CLOSED');
    await tx.update(disputes).set({ status: 'CLOSED' }).where(eq(disputes.id, d.id));
  });
}

export async function disputeGraph(actor: Actor, disputeId: string) {
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!d) throw notFound('النزاع');
  const role = partyRole(actor, d);
  if (!role) throw forbidden();
  const msgs = await db
    .select({ m: disputeMessages, author: users.fullName })
    .from(disputeMessages)
    .innerJoin(users, eq(users.id, disputeMessages.authorUserId))
    .where(eq(disputeMessages.disputeId, d.id))
    .orderBy(asc(disputeMessages.createdAt));
  const evidence = await db.select().from(disputeEvidence).where(eq(disputeEvidence.disputeId, d.id));
  return { dispute: d, role, messages: msgs.filter((x) => role === 'ADMIN' || !x.m.isInternal), evidence };
}

export async function disputesForUser(userId: string) {
  return db
    .select()
    .from(disputes)
    .where(inArray(disputes.id, db.select({ id: disputes.id }).from(disputes).where(eq(disputes.claimantUserId, userId))))
    .orderBy(desc(disputes.createdAt));
}

export async function disputesAsRespondent(userId: string) {
  return db.select().from(disputes).where(eq(disputes.respondentUserId, userId)).orderBy(desc(disputes.createdAt));
}

export { requireReason };
