import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { hasPermission, requirePermission, type Actor } from '@/server/core/actor';
import { notFound } from '@/server/core/errors';
import { db } from '@/server/db/client';
import {
  disputes,
  externalDeals,
  governorates,
  orders,
  rolePermissions,
  sellerDocuments,
  sellerOrders,
  sellers,
  shipments,
  statusHistory,
  stores,
  trackingEvents,
  userRoles,
  users,
} from '@/server/db/schema';
import { loadOrderGraph } from '@/server/modules/commerce/orders';
import { dealGraph } from '@/server/modules/deals/service';
import { identityCase } from '@/server/modules/identity/service';
import { disputeGraph } from '@/server/modules/postpurchase/disputes';
import { applicationChecklist } from '@/server/modules/sellers/service';
import { maskName } from './monitoring';

/**
 * Admin App detail views. Each one reuses the web console's loader and permission for the same page
 * (sellers.view, identity.view, orders.view, deals.view, disputes.manage) and then strips what a phone must not carry:
 * national IDs and their digits, document/file ids, contact data, addresses and decrypted locations, payout
 * credentials, OTP material, and full personal names (masked to first name + initial). Staff names are masked too.
 */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function staffNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string | null>();
  const rows = await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, maskName(r.name)]));
}

async function history(entityIds: string[]) {
  if (!entityIds.length) return [];
  const rows = await db.select().from(statusHistory).where(inArray(statusHistory.entityId, entityIds)).orderBy(asc(statusHistory.createdAt));
  const names = await staffNames(rows.map((r) => r.actorUserId));
  return rows.map((h) => ({ entityType: h.entityType, from: h.fromStatus, to: h.toStatus, actorType: h.actorType, actor: h.actorUserId ? (names.get(h.actorUserId) ?? null) : null, note: h.reason, at: iso(h.createdAt)! }));
}

export async function sellerDetail(actor: Actor, sellerId: string) {
  requirePermission(actor, 'sellers.view');
  const [row] = await db.select({ s: sellers, owner: users.fullName }).from(sellers).innerJoin(users, eq(users.id, sellers.ownerUserId)).where(eq(sellers.id, sellerId));
  if (!row) throw notFound('البائع');
  const s = row.s;
  const [store] = await db.select().from(stores).where(eq(stores.sellerId, s.id));
  const [gov] = s.governorateId ? await db.select({ name: governorates.nameAr }).from(governorates).where(eq(governorates.id, s.governorateId)) : [];
  const checklist = await applicationChecklist(db, s);
  // Document metadata only (kind, status, when) and only with the same permission the console needs to list them.
  const docs = hasPermission(actor, 'sellers.documents.view')
    ? await db.select({ kind: sellerDocuments.kind, status: sellerDocuments.status, createdAt: sellerDocuments.createdAt }).from(sellerDocuments).where(eq(sellerDocuments.sellerId, s.id)).orderBy(desc(sellerDocuments.createdAt))
    : null;
  return {
    id: s.id,
    applicant: s.type === 'INDIVIDUAL' ? maskName(s.legalName ?? row.owner) : (s.businessLegalName ?? s.legalName ?? maskName(row.owner)),
    type: s.type as string,
    status: s.status as string,
    riskLevel: (s.riskLevel as string | null) ?? null,
    governorate: gov?.name ?? null,
    storeName: store?.name ?? null,
    submittedAt: iso(s.submittedAt),
    checklist: checklist.map((i) => ({ key: i.key, label: i.label, ok: i.ok })),
    documents: docs?.map((d) => ({ kind: d.kind as string, status: d.status as string, uploadedAt: iso(d.createdAt) })) ?? null,
    history: await history([s.id]),
  };
}

export async function identityDetail(actor: Actor, verificationId: string) {
  const c = await identityCase(actor, verificationId); // identity.view enforced inside
  const names = await staffNames([...c.history.map((h) => h.actorUserId), c.v.reviewedBy]);
  return {
    id: c.v.id,
    name: maskName(c.name),
    status: c.v.status as string,
    documentsComplete: !!(c.v.frontFileId && c.v.backFileId),
    // The reason shown to the customer; the reviewers' internal note stays in the console.
    rejectionReason: c.v.reviewReason ?? null,
    submittedAt: iso(c.v.submittedAt),
    reviewedAt: iso(c.v.reviewedAt),
    reviewedBy: c.v.reviewedBy ? (names.get(c.v.reviewedBy) ?? null) : null,
    events: c.history.map((e) => ({ action: e.action, from: e.fromStatus, to: e.toStatus, by: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null, reason: e.reason, at: iso(e.createdAt)! })),
  };
}

export async function orderDetail(actor: Actor, orderId: string) {
  requirePermission(actor, 'orders.view');
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw notFound('الطلب');
  const g = await loadOrderGraph(o);
  const soIds = g.sellerOrders.map((s) => s.so.id);
  const ships = soIds.length ? await db.select().from(shipments).where(inArray(shipments.sellerOrderId, soIds)) : [];
  const events = ships.length ? await db.select().from(trackingEvents).where(inArray(trackingEvents.shipmentId, ships.map((s) => s.id))).orderBy(asc(trackingEvents.occurredAt)) : [];
  return {
    id: o.id,
    number: String(o.number),
    status: o.status as string,
    customer: maskName(g.customer?.fullName),
    placedAt: iso(o.placedAt),
    paidAt: iso(o.paidAt),
    totals: { merchandise: o.merchandiseTotal, shipping: o.shippingTotal, grand: o.grandTotal },
    payment: g.payment ? { method: g.payment.method as string, status: g.payment.status as string, amount: g.payment.amountDue } : null,
    sellerOrders: g.sellerOrders.map((s) => {
      const ship = ships.find((x) => x.sellerOrderId === s.so.id);
      return {
        id: s.so.id,
        number: `${o.number}-${s.so.suffix}`,
        store: s.storeName,
        status: s.so.status as string,
        total: s.so.grossTotal,
        items: s.items.map((i) => ({ title: i.titleSnapshot, quantity: i.quantity, lineTotal: i.lineTotal })),
        shipment: ship
          ? {
              status: ship.status as string,
              carrier: ship.carrierName,
              trackingNumber: ship.trackingNumber,
              shippedAt: iso(ship.shippedAt),
              expectedAt: iso(ship.expectedDeliveryAt),
              exception: ship.exceptionCode,
              events: events.filter((e) => e.shipmentId === ship.id).map((e) => ({ status: e.status as string, description: e.description, at: iso(e.occurredAt)! })),
            }
          : null,
        followUpFlaggedAt: iso(s.so.deliveryFollowUpFlaggedAt),
      };
    }),
    history: await history([o.id, ...soIds]),
  };
}

export async function dealDetail(actor: Actor, dealId: string) {
  requirePermission(actor, 'deals.view');
  const g = await dealGraph(actor, dealId); // decrypts locations for staff: deliberately NOT forwarded to the phone
  const d = g.deal;
  const disp = await db.select({ id: disputes.id, number: disputes.number, status: disputes.status }).from(disputes).where(eq(disputes.dealId, d.id));
  return {
    id: d.id,
    number: String(d.number),
    ref: g.ref,
    title: d.title,
    condition: d.condition as string,
    status: d.status as string,
    buyer: maskName(g.buyerName),
    seller: maskName(d.sellerFullName ?? d.sellerName),
    sellerConfirmed: !!d.sellerFullName,
    financialHold: !!d.financialHold,
    money: { total: d.totalAmount ?? null, buyerPays: d.buyerPays ?? null, sellerReceives: d.sellerReceives ?? null },
    payment: g.payment ? { status: g.payment.status as string, method: g.payment.method as string } : null,
    payout: g.payout ? { status: g.payout.status as string } : null,
    evidenceCount: g.evidence.length,
    disputes: disp.map((x) => ({ id: x.id, number: String(x.number), status: x.status as string })),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
    history: await history([d.id]),
  };
}

export async function disputeDetail(actor: Actor, disputeId: string) {
  requirePermission(actor, 'disputes.manage');
  const g = await disputeGraph(actor, disputeId); // ADMIN role sees internal notes too
  const d = g.dispute;
  const names = await staffNames([d.assignedTo, d.claimantUserId, d.respondentUserId, ...g.evidence.map((e) => e.uploadedBy)]);
  let subject: { kind: 'ORDER' | 'DEAL' | 'RETURN'; number: string | null; id: string | null } = { kind: 'ORDER', number: null, id: null };
  if (d.dealId) {
    const [x] = await db.select({ number: externalDeals.number }).from(externalDeals).where(eq(externalDeals.id, d.dealId));
    subject = { kind: 'DEAL', number: x ? String(x.number) : null, id: d.dealId };
  } else if (d.sellerOrderId) {
    const [x] = await db.select({ orderId: sellerOrders.orderId, suffix: sellerOrders.suffix, number: orders.number }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).where(eq(sellerOrders.id, d.sellerOrderId));
    subject = { kind: d.returnId ? 'RETURN' : 'ORDER', number: x ? `${x.number}-${x.suffix}` : null, id: x?.orderId ?? null };
  }
  return {
    id: d.id,
    number: String(d.number),
    status: d.status as string,
    reasonCode: d.reasonCode,
    description: d.description,
    claimedAmount: d.claimedAmount ?? null,
    claimant: names.get(d.claimantUserId) ?? null,
    respondent: d.respondentUserId ? (names.get(d.respondentUserId) ?? null) : null,
    assignee: d.assignedTo ? { id: d.assignedTo, name: names.get(d.assignedTo) ?? null, isMe: d.assignedTo === actor.userId } : null,
    subject,
    createdAt: iso(d.createdAt),
    messages: g.messages.map((m) => ({ id: m.m.id, authorRole: m.m.authorRole as string, author: maskName(m.author), internal: m.m.isInternal, body: m.m.body, at: iso(m.m.createdAt)! })),
    // Evidence metadata only: who/when/note. Files open in the web console, behind its file access checks.
    evidence: g.evidence.map((e) => ({ uploadedBy: names.get(e.uploadedBy) ?? null, note: e.note, at: iso(e.createdAt)! })),
    history: await history([d.id]),
  };
}

/** Staff who may be assigned a dispute: active staff holding disputes.manage through any of their roles. */
export async function disputeAssignees(actor: Actor) {
  requirePermission(actor, 'disputes.manage');
  const rows = await db
    .selectDistinct({ id: users.id, name: users.fullName })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleCode, userRoles.roleCode))
    .where(and(eq(users.isStaff, true), eq(rolePermissions.permission, 'disputes.manage'), sql`${users.status} = 'ACTIVE'`))
    .orderBy(asc(users.fullName))
    .limit(200);
  return rows.map((r) => ({ id: r.id, name: maskName(r.name), isMe: r.id === actor.userId }));
}
