import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { orderItems, returnEvidence, returnItems, returns, stores, users } from '@/server/db/schema';
import { requirePermission, type Actor } from '@/server/core/actor';
import { notFound } from '@/server/core/errors';
import { maskName } from './monitoring';

/**
 * Admin App — returns MONITORING (PKG-I02-01 v2, read-only by the owner's decision). Staff see the
 * queue, workflow state and the next required action; every mutation (approve / reject / receive /
 * inspect / accept-refund) stays on the approved web console routes and is NOT part of the mobile API.
 * Permission is enforced HERE (same permission as the web console page: returns.manage). No customer
 * PII beyond masked names; return documents/evidence are counted, never embedded.
 */

const RETURN_TABS = {
  pending: ['REQUESTED', 'UNDER_REVIEW'],
  action: ['APPROVED', 'RETURN_IN_TRANSIT', 'RECEIVED', 'INSPECTION'],
  done: ['REFUND_PENDING', 'REFUNDED', 'REJECTED', 'DISPUTED'],
} as const;

/** Monitoring projection of the return workflow: what happens next, and where it is done (web console). */
const NEXT_ACTION: Record<string, string> = {
  REQUESTED: 'Review and approve or reject on the web console',
  UNDER_REVIEW: 'Approve or reject on the web console',
  APPROVED: 'Await customer ship-back',
  RETURN_IN_TRANSIT: 'Mark received at the warehouse on the web console',
  RECEIVED: 'Start inspection on the web console',
  INSPECTION: 'Decide the refund on the web console (maker/checker pays)',
  REFUND_PENDING: 'Finance maker/checker approves the payout',
  REFUNDED: 'None — closed',
  REJECTED: 'None — closed',
  DISPUTED: 'Handled through the dispute workflow',
};

export async function returnsMonitor(actor: Actor, opts: { tab: keyof typeof RETURN_TABS; q?: string; page: number }) {
  requirePermission(actor, 'returns.manage');
  const pageSize = 30;
  const conds: SQL[] = [inArray(returns.status, [...RETURN_TABS[opts.tab]])];
  const q = opts.q?.trim();
  if (q && /^\d+$/.test(q)) conds.push(eq(returns.number, Number(q)));
  const rows = await db
    .select({ r: returns, storeName: stores.name, customerName: users.fullName })
    .from(returns)
    .innerJoin(stores, eq(stores.sellerId, returns.sellerId))
    .innerJoin(users, eq(users.id, returns.customerId))
    .where(and(...conds))
    .orderBy(desc(returns.createdAt))
    .limit(pageSize)
    .offset((opts.page - 1) * pageSize);
  return {
    items: rows.map((x) => ({
      id: x.r.id,
      number: String(x.r.number),
      status: x.r.status as string,
      nextAction: NEXT_ACTION[x.r.status as string] ?? 'Review on the web console',
      reason: x.r.reason as string,
      store: x.storeName,
      customer: maskName(x.customerName),
      refundAmount: x.r.refundAmount ?? null,
      createdAt: x.r.createdAt?.toISOString() ?? null,
    })),
    page: opts.page,
    hasMore: rows.length === pageSize,
  };
}

export async function returnDetailForStaff(actor: Actor, returnId: string) {
  requirePermission(actor, 'returns.manage');
  const [r] = await db.select().from(returns).where(eq(returns.id, returnId));
  if (!r) throw notFound('طلب الإرجاع');
  const items = await db
    .select({ orderItemId: returnItems.orderItemId, quantity: returnItems.quantity, unitPrice: orderItems.unitPrice })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .where(eq(returnItems.returnId, r.id));
  const evidence = await db.select({ id: returnEvidence.id }).from(returnEvidence).where(eq(returnEvidence.returnId, r.id));
  return {
    id: r.id,
    number: String(r.number),
    status: r.status as string,
    nextAction: NEXT_ACTION[r.status as string] ?? 'Review on the web console',
    reason: r.reason as string,
    description: r.description,
    isStatutory: r.isStatutory,
    decisionReason: r.decisionReason ?? null,
    returnCarrier: r.returnCarrier ?? null,
    returnTracking: r.returnTracking ?? null,
    inspectionNote: r.inspectionNote ?? null,
    refundAmount: r.refundAmount ?? null,
    includeShipping: r.includeShipping,
    items: items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity, unitPrice: i.unitPrice })),
    evidenceCount: evidence.length,
    createdAt: r.createdAt?.toISOString() ?? null,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}
