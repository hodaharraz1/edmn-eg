import { and, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { enforce } from '@/server/auth/rate-limit';
import { forbidden, invalidState, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { financialApprovals, type FinancialAction } from '@/server/db/schema';

export type FinancialApproval = typeof financialApprovals.$inferSelect;

/** Journal entry types each operation may post (mirrored by the DB trigger through `entry_types`). */
export const ACTION_ENTRY_TYPES: Record<FinancialAction, string[]> = {
  PAYMENT_CONFIRMATION: ['ORDER_PAYMENT'],
  DEAL_PAYMENT_CONFIRMATION: ['DEAL_PAYMENT'],
  SELLER_RELEASE: ['SELLER_RELEASE'],
  REFUND_APPROVAL: ['REFUND'],
  REFUND_PAYOUT: ['REFUND_PAID'],
  WITHDRAWAL_RESERVATION: ['WITHDRAWAL_RESERVE'],
  WITHDRAWAL_RELEASE_RESERVATION: ['WITHDRAWAL_REVERSAL'],
  WITHDRAWAL_PAYOUT: ['WITHDRAWAL_PAID'],
  MANUAL_ADJUSTMENT: ['ADJUSTMENT'],
  DEAL_RELEASE: ['DEAL_SETTLEMENT'],
  DEAL_REFUND: ['DEAL_REFUND'],
  DEAL_PAYOUT: ['DEAL_PAYOUT_PAID'],
  WITHDRAWAL_PAYOUT_RETURN: ['WITHDRAWAL_RETURNED'],
  REFUND_REVOCATION: ['REFUND_REVERSAL'],
};

/**
 * OWNER RULE (Batch 1.5): EVERY actual financial movement is two-person — a Maker and a DIFFERENT Checker,
 * no amount threshold, no exception. Mirrored by the DB trigger `financial_approvals_movement_two_person`.
 * Not listed (documented): PAYMENT_CONFIRMATION / DEAL_PAYMENT_CONFIRMATION verify money RECEIVED (the payer
 * submits, a reviewer who is never the payer confirms; the payer is recorded as requester) and
 * WITHDRAWAL_RESERVATION locks the seller's own funds at the seller's request (its payout is two-person).
 */
export const MOVEMENT_ACTIONS: readonly FinancialAction[] = [
  'SELLER_RELEASE',
  'REFUND_APPROVAL',
  'REFUND_PAYOUT',
  'REFUND_REVOCATION',
  'WITHDRAWAL_RELEASE_RESERVATION',
  'WITHDRAWAL_PAYOUT',
  'WITHDRAWAL_PAYOUT_RETURN',
  'MANUAL_ADJUSTMENT',
  'DEAL_RELEASE',
  'DEAL_REFUND',
  'DEAL_PAYOUT',
];

export interface ApprovalRequest {
  action: FinancialAction;
  entityType: string;
  entityId: string;
  /** Exact total of the debits the operation will post (verified by the DB at commit). */
  amount: number;
  economicVersion: string;
  reason: string;
  /** Business identity of this one operation: a retry returns the same approval, never a second one. */
  idempotencyKey: string;
  destinationSnapshot?: Record<string, unknown> | null;
  /** Maker/checker: `requestedBy` (the maker) can never be the approver (DB CHECK). */
  dualControl?: { requestedBy: string } | null;
}

/**
 * Grant an operation-specific Admin approval inside the caller's transaction. The caller has already
 * checked the operation's permission, kill switch and state under row locks; this records WHO approved
 * WHAT (action, entity, exact amount, currency, economic version, destination) with a fresh 2FA step-up.
 * Approvals are never implied by another action, never blanket, never reused (DB trigger consumes them).
 */
export async function grantApproval(tx: DbOrTx, actor: Actor, req: ApprovalRequest): Promise<FinancialApproval> {
  if (actor.type !== 'ADMIN' || !actor.userId) throw forbidden('الحركات المالية تحتاج موافقة صريحة من الإدارة');
  requireStepUp(actor);
  // Rate limit per approver (a runaway script / stolen session cannot fire unlimited approvals).
  // Counted outside the business transaction so a refused operation still counts.
  await enforce(`fin-approve:${actor.userId}`, 300, 3600);
  if (!Number.isSafeInteger(req.amount) || req.amount < 0) throw invalidState('مبلغ الموافقة غير صالح');
  if (MOVEMENT_ACTIONS.includes(req.action) && !req.dualControl?.requestedBy) {
    throw forbidden('كل حركة مالية تتطلب شخصين: منشئ (Maker) ومعتمد/منفّذ مختلف (Checker)');
  }
  if (req.dualControl && req.dualControl.requestedBy === actor.userId) {
    throw forbidden('هذه العملية تتطلب شخصين: لا يمكن لنفس الشخص أن يكون المنشئ والمعتمد');
  }
  const [existing] = await tx.select().from(financialApprovals).where(eq(financialApprovals.idempotencyKey, req.idempotencyKey)).for('update');
  if (existing) {
    const same =
      existing.action === req.action && existing.entityId === req.entityId && existing.amount === req.amount && existing.economicVersion === req.economicVersion;
    if (!same) throw invalidState('تغيّرت بيانات العملية بعد الموافقة. يلزم موافقة جديدة');
    if (existing.status !== 'APPROVED') throw invalidState('تم تنفيذ هذه الموافقة بالفعل');
    return existing;
  }
  const now = new Date();
  const [row] = await tx
    .insert(financialApprovals)
    .values({
      action: req.action,
      entityType: req.entityType,
      entityId: req.entityId,
      amount: req.amount,
      economicVersion: req.economicVersion,
      entryTypes: ACTION_ENTRY_TYPES[req.action],
      destinationSnapshot: req.destinationSnapshot ?? null,
      reason: req.reason,
      status: 'APPROVED',
      dualControl: !!req.dualControl,
      requestedBy: req.dualControl?.requestedBy ?? actor.userId,
      approvedBy: actor.userId,
      approvedAt: now,
      stepUpAt: actor.stepUpAt ?? null,
      idempotencyKey: req.idempotencyKey,
    })
    .returning();
  await audit(tx, actor, {
    action: 'financial_approval.granted',
    entityType: req.entityType,
    entityId: req.entityId,
    newValues: { approvalId: row.id, action: req.action, amount: req.amount, currency: 'EGP', economicVersion: req.economicVersion, dualControl: !!req.dualControl },
    reason: req.reason,
  });
  return row;
}

/** Revoke an approval that has not been executed yet (e.g. superseded, wrong amount). Audited. */
export async function revokeApproval(actor: Actor, approvalId: string, reason: string) {
  if (actor.type !== 'ADMIN' || !actor.userId) throw forbidden();
  requirePermission(actor, 'finance.controls');
  requireStepUp(actor);
  if (!reason || reason.trim().length < 10) throw validation('اكتب سبب إلغاء الموافقة (10 أحرف على الأقل)');
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(financialApprovals).where(eq(financialApprovals.id, approvalId)).for('update');
    if (!a) throw invalidState('الموافقة غير موجودة');
    if (a.approvedBy === actor.userId) throw forbidden('لا يمكنك إلغاء موافقة أنت اللي أصدرتها — يلغيها شخص تاني');
    if (a.status !== 'APPROVED' && a.status !== 'PENDING_CHECKER') throw invalidState('لا يمكن إلغاء موافقة تم تنفيذها');
    await tx.update(financialApprovals).set({ status: 'REVOKED', revokedBy: actor.userId, revokedAt: new Date(), revokeReason: reason }).where(eq(financialApprovals.id, a.id));
    await audit(tx, actor, { action: 'financial_approval.revoked', entityType: a.entityType, entityId: a.entityId, newValues: { approvalId: a.id }, reason });
  });
}

export async function approvalsFor(entityType: string, entityIds: string[]) {
  if (!entityIds.length) return [];
  return db
    .select()
    .from(financialApprovals)
    .where(and(eq(financialApprovals.entityType, entityType), inArray(financialApprovals.entityId, entityIds)))
    .orderBy(desc(financialApprovals.createdAt));
}

export async function recentApprovals(limit = 50, offset = 0) {
  return db.select().from(financialApprovals).orderBy(desc(financialApprovals.createdAt), desc(financialApprovals.id)).limit(limit).offset(offset);
}
