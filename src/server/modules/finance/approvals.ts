import { and, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requireStepUp, type Actor } from '@/server/core/actor';
import { forbidden, invalidState } from '@/server/core/errors';
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
};

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
  if (!Number.isSafeInteger(req.amount) || req.amount < 0) throw invalidState('مبلغ الموافقة غير صالح');
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
  requireStepUp(actor);
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(financialApprovals).where(eq(financialApprovals.id, approvalId)).for('update');
    if (!a) throw invalidState('الموافقة غير موجودة');
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
