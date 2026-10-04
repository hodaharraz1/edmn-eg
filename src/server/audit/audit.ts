import type { Actor } from '@/server/core/actor';
import type { DbOrTx } from '@/server/db/client';
import { auditLogs, statusHistory } from '@/server/db/schema';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
}

/** Append an audit event inside the caller's transaction (so it commits/rolls back with the change). */
export async function audit(tx: DbOrTx, actor: Actor, input: AuditInput): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: actor.userId,
    actorType: actor.type,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    oldValues: input.oldValues ?? null,
    newValues: input.newValues ?? null,
    reason: input.reason ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ? actor.userAgent.slice(0, 300) : null,
    requestId: actor.requestId ?? null,
  });
}

export async function recordTransition(
  tx: DbOrTx,
  actor: Actor,
  entityType: string,
  entityId: string,
  from: string | null,
  to: string,
  reason?: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(statusHistory).values({
    entityType,
    entityId,
    fromStatus: from,
    toStatus: to,
    actorUserId: actor.userId,
    actorType: actor.type,
    reason: reason ?? null,
    meta: meta ?? null,
  });
}
