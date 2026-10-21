import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { externalDeals, orders, riskFlags, sellerMembers, sellerOrders, sellers } from '@/server/db/schema';

/**
 * Risk flags (Phase 1, fixes S-H1). Resolving a flag can remove a RELEASE BLOCKER (deal delivery conflict/exception,
 * seller-order delivery review), so it is a service with the same guarantees as other money-adjacent decisions:
 *
 *   - permission inside the service (deals.manage for deal flags; sellers.suspend otherwise)
 *   - fresh 2FA and a written reason for flags on money-holding entities (external_deal, seller_order)
 *   - conflict of interest: a staff member who is a PARTY to the flagged entity (deal buyer/seller, order buyer,
 *     member of the selling store) can never resolve it
 *   - the status change and its audit row commit in ONE transaction, and only an OPEN flag can be resolved
 */
const MONEY_HOLDING = new Set(['external_deal', 'seller_order']);

/** User ids that are parties to the entity (empty when the entity type has no parties). */
async function partiesOf(conn: DbOrTx, entityType: string, entityId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const uuidOk = z.uuid().safeParse(entityId).success;
  if (!uuidOk) return out;
  const addSellerMembers = async (sellerId: string) => {
    const [s] = await conn.select({ owner: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, sellerId));
    if (s?.owner) out.add(s.owner);
    for (const m of await conn.select({ userId: sellerMembers.userId }).from(sellerMembers).where(eq(sellerMembers.sellerId, sellerId))) out.add(m.userId);
  };
  if (entityType === 'external_deal') {
    const [d] = await conn.select({ buyerId: externalDeals.buyerId, sellerUserId: externalDeals.sellerUserId }).from(externalDeals).where(eq(externalDeals.id, entityId));
    if (d?.buyerId) out.add(d.buyerId);
    if (d?.sellerUserId) out.add(d.sellerUserId);
  } else if (entityType === 'seller_order') {
    const [so] = await conn.select({ sellerId: sellerOrders.sellerId, customerId: orders.customerId }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).where(eq(sellerOrders.id, entityId));
    if (so) {
      if (so.customerId) out.add(so.customerId);
      await addSellerMembers(so.sellerId);
    }
  } else if (entityType === 'seller') {
    await addSellerMembers(entityId);
  }
  return out;
}

export async function resolveRiskFlag(actor: Actor, flagId: string, reason: string | null | undefined) {
  const userId = requireUser(actor);
  if (!z.uuid().safeParse(flagId).success) throw notFound('المؤشر');
  const [peek] = await db.select({ entityType: riskFlags.entityType }).from(riskFlags).where(eq(riskFlags.id, flagId));
  if (!peek) throw notFound('المؤشر');
  const moneyHolding = MONEY_HOLDING.has(peek.entityType);
  requirePermission(actor, peek.entityType === 'external_deal' ? 'deals.manage' : 'sellers.suspend');
  const why = (reason ?? '').trim();
  if (moneyHolding) {
    requireStepUp(actor);
    if (why.length < 3) throw validation('اكتب سبب إغلاق المؤشر');
  }
  return db.transaction(async (tx) => {
    const [flag] = await tx.select().from(riskFlags).where(eq(riskFlags.id, flagId)).for('update');
    if (!flag) throw notFound('المؤشر');
    if ((await partiesOf(tx, flag.entityType, flag.entityId)).has(userId)) throw forbidden('لا يمكنك إغلاق مؤشر على عملية أنت طرف فيها');
    if (flag.status !== 'OPEN') return { resolved: false };
    await tx.update(riskFlags).set({ status: 'RESOLVED', resolvedBy: userId, resolvedAt: new Date() }).where(and(eq(riskFlags.id, flag.id), eq(riskFlags.status, 'OPEN')));
    await audit(tx, actor, { action: 'risk.flag_resolved', entityType: flag.entityType, entityId: flag.entityId, newValues: { flagId: flag.id, code: flag.code }, reason: why || null });
    return { resolved: true };
  });
}

export const manualFlagSchema = z.object({
  entityType: z.string().trim().regex(/^[a-z_]{2,40}$/),
  entityId: z.string().trim().min(1).max(64),
  code: z.string().trim().regex(/^[A-Z_]{2,40}$/).default('MANUAL'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  note: z.string().trim().min(3, 'اكتب الملاحظة').max(1000),
});

/** Raise a manual flag (adding a flag only ever ADDS scrutiny, so no party check is needed). */
export async function addRiskFlag(actor: Actor, input: z.input<typeof manualFlagSchema>) {
  const userId = requireUser(actor);
  requirePermission(actor, 'sellers.suspend');
  const parsed = manualFlagSchema.safeParse(input);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? 'بيانات غير صحيحة');
  const v = parsed.data;
  return db.transaction(async (tx) => {
    const [f] = await tx.insert(riskFlags).values({ ...v, createdBy: userId }).returning({ id: riskFlags.id });
    await audit(tx, actor, { action: 'risk.flag_added', entityType: v.entityType, entityId: v.entityId, newValues: { flagId: f.id, code: v.code, severity: v.severity } });
    return { id: f.id };
  });
}
