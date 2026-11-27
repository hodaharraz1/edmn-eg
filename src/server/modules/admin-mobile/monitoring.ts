import { and, asc, desc, eq, ilike, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { requireAnyPermission, requirePermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { accountClosureRequests, auditLogs, disputes, externalDeals, orders, sellerOrders, sellers, stores, users, type IdentityStatus } from '@/server/db/schema';
import { identityQueue } from '@/server/modules/identity/service';
import { ORDER_STATUSES } from '@/domain/machines';

/**
 * Admin App monitoring: the same queues as the web console pages (/admin/seller-verification, /admin/identity,
 * /admin/orders, /admin/deals, /admin/disputes, /admin/audit), behind the SAME permissions, enforced here in the service
 * layer rather than in the screen. Read-only. A phone is a riskier place than the console, so the payloads are
 * minimised: no national ID, e-mail, phone, IP, user agent, document or audit before/after values; personal names are
 * masked to the first name and an initial. Decisions (approve a seller or an identity, resolve a dispute, release money)
 * stay in the web console, where documents, Maker/Checker and the ledger workflows live.
 */

/** «أحمد محمد علي» → «أحمد م.»; one word stays as is; null → null. */
export function maskName(full: string | null | undefined): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? null;
  return `${parts[0]} ${Array.from(parts[1])[0]}.`;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const SELLER_QUEUE_TABS = { pending: ['PENDING_REVIEW'], info: ['MORE_INFO_REQUIRED'] } as const;
export async function sellerReviewQueue(actor: Actor, tab: keyof typeof SELLER_QUEUE_TABS) {
  requirePermission(actor, 'sellers.review');
  const rows = await db
    .select({ s: sellers, store: stores.name, owner: users.fullName })
    .from(sellers)
    .innerJoin(users, eq(users.id, sellers.ownerUserId))
    .leftJoin(stores, eq(stores.sellerId, sellers.id))
    .where(inArray(sellers.status, [...SELLER_QUEUE_TABS[tab]]))
    .orderBy(asc(sellers.submittedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.s.id,
    // A business's legal name is not personal data; an individual's falls back to the masked owner name.
    applicant: r.s.type === 'INDIVIDUAL' ? maskName(r.s.legalName ?? r.owner) : (r.s.legalName ?? maskName(r.owner)),
    storeName: r.store,
    type: r.s.type as string,
    status: r.s.status as string,
    riskLevel: (r.s.riskLevel as string | null) ?? null,
    submittedAt: iso(r.s.submittedAt),
  }));
}

export const IDENTITY_QUEUE_TABS: Record<'pending' | 'action' | 'approved' | 'rejected', IdentityStatus[]> = {
  pending: ['PENDING_REVIEW'],
  action: ['MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED'],
  approved: ['APPROVED'],
  rejected: ['REJECTED'],
};
export async function identityReviewQueue(actor: Actor, tab: keyof typeof IDENTITY_QUEUE_TABS) {
  const rows = await identityQueue(actor, IDENTITY_QUEUE_TABS[tab]); // identity.view enforced inside
  return rows.map((r) => ({
    id: r.v.id,
    name: maskName(r.name),
    status: r.v.status as string,
    // Only whether both sides were uploaded: never the images, the number or its last digits.
    documentsComplete: !!(r.v.frontFileId && r.v.backFileId),
    submittedAt: iso(r.v.submittedAt),
    reviewedAt: iso(r.v.reviewedAt),
  }));
}

export async function orderMonitor(actor: Actor, opts: { tab: 'all' | 'followup'; status?: string; q?: string; page: number }) {
  requirePermission(actor, 'orders.view');
  const pageSize = 30;
  if (opts.tab === 'followup') {
    // Shipped, flagged for follow-up: no buyer confirmation of receipt yet (same as /admin/orders?tab=followup).
    const rows = await db
      .select({ so: sellerOrders, number: orders.number, customer: users.fullName, store: stores.name })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .innerJoin(users, eq(users.id, orders.customerId))
      .leftJoin(stores, eq(stores.sellerId, sellerOrders.sellerId))
      .where(and(eq(sellerOrders.status, 'SHIPPED'), isNotNull(sellerOrders.deliveryFollowUpFlaggedAt)))
      .orderBy(asc(sellerOrders.deliveryFollowUpFlaggedAt))
      .limit(pageSize)
      .offset((opts.page - 1) * pageSize);
    return {
      items: rows.map((r) => ({
        id: r.so.id,
        orderId: r.so.orderId,
        number: `${r.number}-${r.so.suffix}`,
        customer: maskName(r.customer),
        store: r.store,
        status: r.so.status as string,
        total: r.so.grossTotal,
        at: iso(r.so.deliveryFollowUpFlaggedAt),
      })),
      page: opts.page,
      hasMore: rows.length === pageSize,
    };
  }
  const conds: SQL[] = [];
  const q = opts.q?.trim();
  if (q) conds.push(/^\d+$/.test(q) ? eq(orders.number, Number(q)) : ilike(users.fullName, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  if (opts.status) conds.push(eq(orders.status, opts.status as (typeof ORDER_STATUSES)[number]));
  const rows = await db
    .select({ o: orders, customer: users.fullName, subs: sql<number>`(select count(*)::int from seller_orders so where so.order_id = ${orders.id})` })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(orders.placedAt))
    .limit(pageSize)
    .offset((opts.page - 1) * pageSize);
  return {
    items: rows.map((r) => ({
      id: r.o.id,
      orderId: r.o.id,
      number: String(r.o.number),
      customer: maskName(r.customer),
      store: null,
      status: r.o.status as string,
      total: r.o.grandTotal,
      at: iso(r.o.placedAt),
      sellerOrders: r.subs,
    })),
    page: opts.page,
    hasMore: rows.length === pageSize,
  };
}

export const DEAL_TABS = {
  active: ['INVITED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED'],
  disputed: ['DISPUTED'],
  done: ['COMPLETED', 'REFUNDED', 'CANCELLED'],
} as const;
export async function dealMonitor(actor: Actor, tab: keyof typeof DEAL_TABS) {
  requirePermission(actor, 'deals.view');
  const rows = await db
    .select({ d: externalDeals, buyer: users.fullName })
    .from(externalDeals)
    .innerJoin(users, eq(users.id, externalDeals.buyerId))
    .where(inArray(externalDeals.status, [...DEAL_TABS[tab]] as (typeof externalDeals.$inferSelect.status)[]))
    .orderBy(desc(externalDeals.updatedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.d.id,
    number: String(r.d.number),
    title: r.d.title,
    buyer: maskName(r.buyer),
    seller: maskName(r.d.sellerFullName ?? r.d.sellerName),
    sellerConfirmed: !!r.d.sellerFullName,
    status: r.d.status as string,
    buyerPays: r.d.buyerPays ?? null,
    updatedAt: iso(r.d.updatedAt),
  }));
}

export const DISPUTE_TABS = { open: ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'], mine: ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'], closed: ['RESOLVED', 'CLOSED'] } as const;
export async function disputeMonitor(actor: Actor, tab: keyof typeof DISPUTE_TABS) {
  requirePermission(actor, 'disputes.manage');
  const conds: SQL[] = [inArray(disputes.status, [...DISPUTE_TABS[tab]])];
  if (tab === 'mine') conds.push(eq(disputes.assignedTo, actor.userId!));
  const rows = await db
    .select({ d: disputes, claimant: users.fullName })
    .from(disputes)
    .innerJoin(users, eq(users.id, disputes.claimantUserId))
    .where(and(...conds))
    .orderBy(desc(disputes.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.d.id,
    number: String(r.d.number),
    kind: (r.d.dealId ? 'DEAL' : r.d.returnId ? 'RETURN' : 'ORDER') as 'DEAL' | 'RETURN' | 'ORDER',
    claimant: maskName(r.claimant),
    reasonCode: r.d.reasonCode as string,
    claimedAmount: r.d.claimedAmount ?? null,
    status: r.d.status as string,
    assignedToMe: r.d.assignedTo === actor.userId,
    createdAt: iso(r.d.createdAt),
  }));
}

/** Account-closure requests, read-only — the SAME gate as the web /admin/closures page (customers.manage or customers.view). */
export const CLOSURE_TABS = { open: ['PENDING'], closed: ['BLOCKED', 'COMPLETED', 'WITHDRAWN'] } as const;
export async function closureMonitor(actor: Actor, tab: keyof typeof CLOSURE_TABS) {
  requireAnyPermission(actor, ['customers.manage', 'customers.view']);
  const rows = await db
    .select({ r: accountClosureRequests, name: users.fullName })
    .from(accountClosureRequests)
    .innerJoin(users, eq(users.id, accountClosureRequests.userId))
    .where(inArray(accountClosureRequests.status, [...CLOSURE_TABS[tab]]))
    .orderBy(desc(accountClosureRequests.createdAt), desc(accountClosureRequests.id))
    .limit(100);
  // Minimised payload: masked name only, no e-mail, phone or internal fields.
  return rows.map((x) => ({ id: x.r.id, customer: maskName(x.name), status: x.r.status as string, createdAt: iso(x.r.createdAt) }));
}

export const AUDIT_ACTOR_TYPES = ['ADMIN', 'SELLER', 'CUSTOMER', 'SYSTEM', 'ANONYMOUS'] as const;
export async function auditTrail(actor: Actor, opts: { action?: string; entityType?: string; actorType?: (typeof AUDIT_ACTOR_TYPES)[number]; before?: number }) {
  requirePermission(actor, 'audit.view');
  const conds: SQL[] = [];
  if (opts.action) conds.push(ilike(auditLogs.action, `%${opts.action.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  if (opts.entityType) conds.push(eq(auditLogs.entityType, opts.entityType));
  if (opts.actorType) conds.push(eq(auditLogs.actorType, opts.actorType));
  if (opts.before) conds.push(lt(auditLogs.id, opts.before));
  const pageSize = 50;
  const rows = await db
    .select({ a: auditLogs, who: users.fullName })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.id))
    .limit(pageSize);
  return {
    // Old/new values, IP and user agent are deliberately left out: they can hold personal data. The console shows them.
    items: rows.map((r) => ({
      id: r.a.id,
      at: iso(r.a.createdAt)!,
      actorType: r.a.actorType,
      actor: maskName(r.who),
      action: r.a.action,
      entityType: r.a.entityType,
      entityId: r.a.entityId,
      channel: r.a.channel,
      hasReason: !!r.a.reason,
    })),
    nextBefore: rows.length === pageSize ? rows[rows.length - 1].a.id : null,
  };
}
