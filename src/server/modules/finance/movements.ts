import { and, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireStepUp, type Actor, requireAnyPermission } from '@/server/core/actor';
import type { Permission } from '@/server/rbac/permissions';
import { conflict, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { financialMovementRequests, users, type MovementKind } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';

/**
 * UNIVERSAL MAKER / CHECKER (owner rule, Batch 1.5): every actual financial movement needs two DIFFERENT
 * authenticated, authorized people — no amount threshold, no exception.
 *
 *  1. Maker  — `requestMovement` (finance.movement.request + fresh 2FA + reason): proposes ONE movement on ONE
 *              entity for an exact amount. Nothing moves.
 *  2. Checker — the domain command (releaseSellerOrder, releaseDeal, approveRefund, …) calls
 *              `takeMovementRequest` inside its transaction: refuses when no open request exists or when the
 *              Checker IS the Maker; the approval it grants records requested_by = Maker (DB-enforced).
 *
 * Movements whose Maker is already a distinct recorded person (withdrawal payout = reservation approver;
 * refund payout = refund approver; deal payout = release approver; manual adjustment = creator) use that
 * person directly — the same database rule applies.
 */

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  SELLER_RELEASE: 'إتاحة مستحقات بائع (السوق)',
  DEAL_RELEASE: 'تسوية صفقة محمية',
  REFUND_APPROVAL: 'اعتماد استرداد',
  REFUND_REVOCATION: 'إلغاء استرداد معتمد قبل التحويل',
  WITHDRAWAL_REVERSAL: 'فك حجز سحب (رفض / فشل قبل التحويل)',
  WITHDRAWAL_RETURN: 'تسجيل ارتداد تحويل',
};

const ENTITY: Record<MovementKind, string> = {
  SELLER_RELEASE: 'seller_order',
  DEAL_RELEASE: 'external_deal',
  REFUND_APPROVAL: 'refund',
  REFUND_REVOCATION: 'refund',
  WITHDRAWAL_REVERSAL: 'withdrawal',
  WITHDRAWAL_RETURN: 'withdrawal',
};

export type MovementRequest = typeof financialMovementRequests.$inferSelect;

/** Maker step. Idempotent for the same Maker (a retry returns the open request); a second Maker gets a conflict. */
export async function requestMovement(
  actor: Actor,
  kind: MovementKind,
  input: { entityId: string; amount: number; reason: string; params?: Record<string, unknown> },
): Promise<MovementRequest> {
  requirePermission(actor, 'finance.movement.request');
  requireStepUp(actor);
  const reason = input.reason?.trim();
  if (!reason || reason.length < 10) throw validation('اكتب سبب الطلب (10 أحرف على الأقل)');
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) throw validation('المبلغ غير صحيح');
  return db.transaction(async (tx) => {
    const [open] = await tx
      .select()
      .from(financialMovementRequests)
      .where(and(eq(financialMovementRequests.kind, kind), eq(financialMovementRequests.entityId, input.entityId), eq(financialMovementRequests.status, 'PENDING')))
      .for('update');
    if (open) {
      if (open.requestedBy === actor.userId && open.amount === input.amount) return open;
      throw conflict('يوجد طلب مفتوح لهذه الحركة بالفعل وينتظر المعتمد');
    }
    const [row] = await tx
      .insert(financialMovementRequests)
      .values({ kind, entityType: ENTITY[kind], entityId: input.entityId, amount: input.amount, params: input.params ?? {}, reason, requestedBy: actor.userId! })
      .returning();
    await audit(tx, actor, { action: 'finance.movement_requested', entityType: ENTITY[kind], entityId: input.entityId, newValues: { requestId: row.id, kind, amount: input.amount }, reason });
    return row;
  });
}

/**
 * Checker step (inside the executing command's transaction): the open request for this movement, made by
 * SOMEONE ELSE, for exactly this amount. Fail closed.
 */
export async function takeMovementRequest(tx: DbOrTx, actor: Actor, kind: MovementKind, entityId: string, amount?: number): Promise<MovementRequest> {
  const [req] = await tx
    .select()
    .from(financialMovementRequests)
    .where(and(eq(financialMovementRequests.kind, kind), eq(financialMovementRequests.entityId, entityId), eq(financialMovementRequests.status, 'PENDING')))
    .for('update');
  if (!req) throw invalidState(`هذه الحركة تحتاج طلبًا من منشئ (Maker) أولاً: ${MOVEMENT_LABELS[kind]}`);
  if (req.requestedBy === actor.userId) throw forbidden('لا يمكن لنفس الشخص أن يكون منشئ الحركة المالية ومعتمدها');
  if (amount !== undefined && req.amount !== amount) throw invalidState('المبلغ تغيّر منذ طلب المنشئ. يلزم طلب جديد');
  return req;
}

/** Marks the request executed by the Checker (same transaction as the posting). */
export async function completeMovementRequest(tx: DbOrTx, actor: Actor, req: MovementRequest, approvalId: string | null) {
  await tx.update(financialMovementRequests).set({ status: 'EXECUTED', decidedBy: actor.userId, decidedAt: new Date(), approvalId }).where(eq(financialMovementRequests.id, req.id));
  await audit(tx, actor, { action: 'finance.movement_executed', entityType: req.entityType, entityId: req.entityId, newValues: { requestId: req.id, kind: req.kind, amount: req.amount, maker: req.requestedBy, approvalId } });
}

/** Who may decide (approve or decline) each kind of request: the same permission the Checker step needs. */
export const CHECKER_PERMISSIONS: Record<MovementKind, Permission[]> = {
  SELLER_RELEASE: ['finance.release'],
  DEAL_RELEASE: ['finance.release'],
  REFUND_APPROVAL: ['refunds.approve'],
  REFUND_REVOCATION: ['refunds.approve'],
  WITHDRAWAL_REVERSAL: ['withdrawals.approve'],
  WITHDRAWAL_RETURN: ['withdrawals.approve', 'withdrawals.pay'],
};

/** Checker declines a request (nothing moves). Only someone who could be its Checker may decline it. */
export async function rejectMovementRequest(actor: Actor, requestId: string, reason: string) {
  requirePermission(actor, 'finance.view');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 5) throw validation('اكتب سبب الرفض');
  await db.transaction(async (tx) => {
    const [req] = await tx.select().from(financialMovementRequests).where(eq(financialMovementRequests.id, requestId)).for('update');
    if (!req) throw notFound('الطلب');
    if (!CHECKER_PERMISSIONS[req.kind].some((p) => hasPermission(actor, p))) throw forbidden('رفض الطلب متاح لصاحب صلاحية الاعتماد لنفس نوع الحركة فقط');
    if (req.status !== 'PENDING') throw invalidState('تم البت في الطلب بالفعل');
    if (req.requestedBy === actor.userId) throw forbidden('المنشئ يلغي طلبه ولا يرفضه');
    await tx.update(financialMovementRequests).set({ status: 'REJECTED', decidedBy: actor.userId, decidedAt: new Date(), decisionReason: reason.trim() }).where(eq(financialMovementRequests.id, req.id));
    await audit(tx, actor, { action: 'finance.movement_rejected', entityType: req.entityType, entityId: req.entityId, newValues: { requestId: req.id, kind: req.kind }, reason });
    await notify(tx, { event: 'FINANCE_MOVEMENT_DECIDED', userIds: [req.requestedBy], vars: { kind: MOVEMENT_LABELS[req.kind], decision: 'مرفوض' }, link: '/admin/approvals', dedupeKey: `mreq:${req.id}:rejected` });
  });
}

/** Maker withdraws their own open request. */
export async function cancelMovementRequest(actor: Actor, requestId: string) {
  await db.transaction(async (tx) => {
    const [req] = await tx.select().from(financialMovementRequests).where(eq(financialMovementRequests.id, requestId)).for('update');
    if (!req) throw notFound('الطلب');
    if (req.requestedBy !== actor.userId) throw forbidden();
    if (req.status !== 'PENDING') throw invalidState('تم البت في الطلب بالفعل');
    await tx.update(financialMovementRequests).set({ status: 'CANCELLED', decidedAt: new Date() }).where(eq(financialMovementRequests.id, req.id));
    await audit(tx, actor, { action: 'finance.movement_cancelled', entityType: req.entityType, entityId: req.entityId, newValues: { requestId: req.id, kind: req.kind } });
  });
}

export async function openMovementRequests(actor: Actor, entityIds?: string[]) {
  requireAnyPermission(actor, ['finance.view', 'finance.movement.request', 'refunds.pay', 'refunds.approve', 'deals.payout']);
  return db
    .select({ r: financialMovementRequests, maker: users.fullName })
    .from(financialMovementRequests)
    .innerJoin(users, eq(users.id, financialMovementRequests.requestedBy))
    .where(entityIds?.length ? and(eq(financialMovementRequests.status, 'PENDING'), inArray(financialMovementRequests.entityId, entityIds)) : eq(financialMovementRequests.status, 'PENDING'))
    .orderBy(desc(financialMovementRequests.requestedAt));
}
