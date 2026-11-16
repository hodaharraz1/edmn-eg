import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { returnMachine } from '@/domain/machines';
import { PROTECTED_REASONS } from '@/domain/return-policy';
import { requireSeller, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, invalidState, notFound } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { disputes, externalDeals, files, orderItems, orders, productReviews, refunds, returns, sellerOrders, sellerReviews, stores } from '@/server/db/schema';
import { addDisputeMessage, disputeGraph, openDispute } from '@/server/modules/postpurchase/disputes';
import {
  acceptReturnRefund,
  approveReturn,
  customerShipsReturn,
  escalateReturn,
  markReturnReceived,
  openReturnedQty,
  rejectReturn,
  requestReturn,
  returnGraph,
  returnWindow,
  startInspection,
} from '@/server/modules/postpurchase/returns';
import { createProductReview, createSellerReview } from '@/server/modules/reviews/service';
import { getSetting } from '@/server/modules/settings';

type Upload = { data: Buffer; name: string };

/**
 * Returns, disputes and reviews for the Customer App — projections over the existing post-purchase services. Every
 * decision the app shows (eligibility, windows, allowed steps, refund state, dispute decision) comes from those
 * services; refunds are only REQUESTED here and are approved / paid by EDMN finance (two-person) in the admin
 * console. Holds on the seller's funds open and close inside the services (B2), never from the app.
 */

export const RETURN_REASONS = ['CHANGED_MIND', 'WRONG_ITEM', 'DAMAGED', 'DEFECTIVE', 'MISSING_PARTS', 'NOT_AS_DESCRIBED', 'COUNTERFEIT_SUSPECTED', 'OTHER'] as const;
/** Reasons that require photos (same rule as requestReturn). */
const EVIDENCE_REQUIRED = ['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'COUNTERFEIT_SUSPECTED'];
/** The web's marketplace dispute vocabulary (account/disputes/new). */
export const DISPUTE_REASONS = ['NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'COUNTERFEIT', 'SELLER_UNRESPONSIVE', 'OTHER'] as const;

const DAY = 86_400_000;

async function buyerSellerOrder(userId: string, soId: string) {
  const [row] = await db.select({ so: sellerOrders, customerId: orders.customerId, number: orders.number }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).where(eq(sellerOrders.id, soId));
  if (!row || row.customerId !== userId) throw notFound('الطلب');
  return row;
}

/* ───────────────────────── Returns ───────────────────────── */

/** What the buyer may return now, until when, and why not (all from the return policy and the services). */
export async function returnOptions(actor: Actor, sellerOrderId: string) {
  const userId = requireUser(actor);
  const { so } = await buyerSellerOrder(userId, sellerOrderId);
  const items = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
  const win = await returnWindow(db, so.sellerId, items);
  const disputeDays = await getSetting('disputes.windowDays', db);
  const delivered = so.deliveredAt;
  const deadline = delivered ? new Date(delivered.getTime() + win.effective * DAY) : null;
  const protectedDeadline = delivered ? new Date(delivered.getTime() + Math.max(win.effective, disputeDays) * DAY) : null;
  const out = [];
  for (const it of items) {
    const open = await openReturnedQty(db, it.id);
    out.push({ orderItemId: it.id, title: it.titleSnapshot, variantLabel: it.variantLabel, unitPricePiastres: it.unitPrice, quantity: it.quantity, returnableQuantity: Math.max(0, it.quantity - it.returnedQuantity - open) });
  }
  const [store] = await db.select().from(stores).where(eq(stores.sellerId, so.sellerId));
  let blocked: 'NOT_DELIVERED' | 'WINDOW_CLOSED' | 'NOTHING_RETURNABLE' | null = null;
  if (so.status !== 'DELIVERED' && so.status !== 'COMPLETED') blocked = 'NOT_DELIVERED';
  else if (protectedDeadline && Date.now() > protectedDeadline.getTime()) blocked = 'WINDOW_CLOSED';
  else if (!out.some((i) => i.returnableQuantity > 0)) blocked = 'NOTHING_RETURNABLE';
  const changeOfMindOpen = !!deadline && Date.now() <= deadline.getTime();
  return {
    eligible: blocked === null,
    blockReason: blocked,
    window: { statutoryDays: win.statutory, voluntaryDays: win.voluntary, effectiveDays: win.effective, disputeDays, deliveredAt: delivered?.toISOString() ?? null, deadline: deadline?.toISOString() ?? null, protectedDeadline: protectedDeadline?.toISOString() ?? null },
    reasons: RETURN_REASONS.map((code) => {
      const isProtected = (PROTECTED_REASONS as readonly string[]).includes(code);
      return { code, requiresEvidence: EVIDENCE_REQUIRED.includes(code), protected: isProtected, available: blocked === null && (isProtected || changeOfMindOpen) };
    }),
    items: out,
    returnShippingPayer: store?.returnShippingPayer ?? 'BY_REASON',
  };
}

export async function createReturn(actor: Actor, input: { sellerOrderId: string; reason: string; description: string; items: { orderItemId: string; quantity: number }[] }, evidence: Upload[]) {
  const r = await requestReturn(actor, input as Parameters<typeof requestReturn>[1], evidence);
  return returnView(actor, r.id);
}

type Ret = typeof returns.$inferSelect;

/** Steps the viewer may take now — the state machine plus the service's own role rules. */
function returnActions(r: Ret, side: 'BUYER' | 'STORE', canManage: boolean): string[] {
  const next = returnMachine.next(r.status);
  const a: string[] = [];
  if (side === 'BUYER') {
    if (r.status === 'APPROVED') a.push('SHIP_BACK');
    if (next.includes('DISPUTED')) a.push('ESCALATE');
    return a;
  }
  if (!canManage) return a;
  if (r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') a.push('APPROVE', 'REJECT');
  if (next.includes('RECEIVED')) a.push('MARK_RECEIVED');
  if (next.includes('INSPECTION')) a.push('START_INSPECTION');
  if (next.includes('REFUND_PENDING') && r.status !== 'DISPUTED') a.push('ACCEPT');
  if (next.includes('DISPUTED')) a.push('ESCALATE');
  return a;
}

export async function returnView(actor: Actor, returnId: string) {
  const userId = requireUser(actor);
  let g;
  try {
    g = await returnGraph(actor, returnId);
  } catch {
    throw notFound('طلب الإرجاع'); // uniform: not yours = not found
  }
  const r = g.ret;
  const side: 'BUYER' | 'STORE' = r.customerId === userId && actor.type !== 'SELLER' ? 'BUYER' : 'STORE';
  if (side === 'STORE' && (actor.type !== 'SELLER' || actor.sellerId !== r.sellerId)) throw notFound('طلب الإرجاع');
  const canManage = actor.type === 'SELLER' && !!actor.sellerPermissions?.has('returns.manage');
  const refundRows = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'RETURN'), eq(refunds.sourceId, r.id)));
  const [dispute] = r.status === 'DISPUTED' ? await db.select({ id: disputes.id }).from(disputes).where(eq(disputes.returnId, r.id)).orderBy(desc(disputes.createdAt)).limit(1) : [];
  const [store] = await db.select().from(stores).where(eq(stores.sellerId, r.sellerId));
  const evFiles = g.evidence.length ? await db.select({ id: files.id, mime: files.mimeType }).from(files).where(inArray(files.id, g.evidence.map((e) => e.fileId))) : [];
  return {
    id: r.id,
    number: String(r.number),
    status: r.status,
    side,
    reason: r.reason,
    description: r.description,
    orderLabel: g.orderLabel,
    orderId: r.orderId,
    sellerOrderId: r.sellerOrderId,
    storeName: store?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    items: g.items.map((x) => ({ orderItemId: x.item.id, title: x.item.titleSnapshot, variantLabel: x.item.variantLabel, quantity: x.ri.quantity, unitPricePiastres: x.item.unitPrice })),
    evidence: evFiles.map((f) => ({ fileId: f.id, mimeType: f.mime })),
    decisionReason: r.decisionReason,
    returnCarrier: r.returnCarrier,
    returnTracking: r.returnTracking,
    /** Where to send the item back — only once the store approved the return. */
    shipBackTo: ['APPROVED', 'RETURN_IN_TRANSIT'].includes(r.status) && store?.returnAddress ? { address: store.returnAddress, governorateId: store.returnGovernorateId ?? null, shippingPayer: store.returnShippingPayer } : null,
    refundAmountPiastres: r.refundAmount,
    refunds: refundRows.map((x) => ({ id: x.id, status: x.status, amountPiastres: x.amount, reference: x.status === 'PAID' ? x.paidReference : null })),
    disputeId: dispute?.id ?? null,
    allowedActions: returnActions(r, side, canManage),
  };
}

export async function myReturns(actor: Actor) {
  const userId = requireUser(actor);
  const rows = await db.select().from(returns).where(eq(returns.customerId, userId)).orderBy(desc(returns.createdAt)).limit(100);
  return { items: rows.map(returnRow) };
}

export async function storeReturns(actor: Actor) {
  const sellerId = requireSeller(actor, 'returns.manage');
  const rows = await db.select().from(returns).where(eq(returns.sellerId, sellerId)).orderBy(desc(returns.createdAt)).limit(100);
  return { items: rows.map(returnRow) };
}

const returnRow = (r: Ret) => ({ id: r.id, number: String(r.number), status: r.status, reason: r.reason, refundAmountPiastres: r.refundAmount, createdAt: r.createdAt.toISOString() });

export async function shipBack(actor: Actor, returnId: string, carrier: string, tracking: string) {
  await customerShipsReturn(actor, returnId, carrier, tracking);
  return returnView(actor, returnId);
}

/** Either party escalates to an EDMN dispute (the return is then decided only through that dispute). */
export async function escalate(actor: Actor, returnId: string, description: string) {
  await returnView(actor, returnId); // ownership (uniform 404)
  const d = await escalateReturn(actor, returnId, description);
  return { disputeId: d.id };
}

export type StoreReturnStep = 'APPROVE' | 'REJECT' | 'MARK_RECEIVED' | 'START_INSPECTION' | 'ACCEPT';

/** Store step on a return (returns.manage). ACCEPT creates a refund REQUEST for exactly the returned units. */
export async function storeReturnStep(actor: Actor, returnId: string, step: StoreReturnStep, input: { note?: string; reason?: string; includeShipping?: boolean; restock?: boolean }) {
  requireSeller(actor, 'returns.manage');
  const view = await returnView(actor, returnId);
  if (!view.allowedActions.includes(step)) throw invalidState('الخطوة دي مش متاحة على الإرجاع ده دلوقتي');
  if (step === 'APPROVE') await approveReturn(actor, returnId, input.note);
  else if (step === 'REJECT') await rejectReturn(actor, returnId, input.reason ?? '');
  else if (step === 'MARK_RECEIVED') await markReturnReceived(actor, returnId);
  else if (step === 'START_INSPECTION') await startInspection(actor, returnId);
  else await acceptReturnRefund(actor, returnId, { includeShipping: !!input.includeShipping, restock: !!input.restock, note: input.note });
  return returnView(actor, returnId);
}

/* ───────────────────────── Disputes ───────────────────────── */

export async function createDispute(actor: Actor, input: { sellerOrderId?: string; dealId?: string; reasonCode: string; description: string; claimedAmountPiastres?: number }, evidence: Upload[]) {
  const d = await openDispute(
    actor,
    { sellerOrderId: input.sellerOrderId, dealId: input.dealId, reasonCode: input.reasonCode, description: input.description, claimedAmount: input.claimedAmountPiastres ? (input.claimedAmountPiastres / 100).toFixed(2) : '' },
    evidence,
  );
  return disputeView(actor, d.id);
}

export async function disputeView(actor: Actor, disputeId: string) {
  const userId = requireUser(actor);
  let g;
  try {
    g = await disputeGraph(actor, disputeId);
  } catch {
    throw notFound('النزاع');
  }
  if (g.role === 'ADMIN') throw notFound('النزاع'); // staff use the admin console
  const d = g.dispute;
  let context: { kind: 'ORDER' | 'DEAL'; id: string; orderId: string | null; ref: string };
  if (d.sellerOrderId) {
    const [so] = await db.select({ suffix: sellerOrders.suffix, orderId: sellerOrders.orderId, number: orders.number }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).where(eq(sellerOrders.id, d.sellerOrderId));
    context = { kind: 'ORDER', id: d.sellerOrderId, orderId: so.orderId, ref: `#${so.number}-${so.suffix}` };
  } else {
    const [deal] = await db.select({ number: externalDeals.number }).from(externalDeals).where(eq(externalDeals.id, d.dealId!));
    context = { kind: 'DEAL', id: d.dealId!, orderId: null, ref: `EDMN-${String(deal.number).padStart(8, '0')}` };
  }
  const evFiles = g.evidence.length ? await db.select({ id: files.id, mime: files.mimeType }).from(files).where(inArray(files.id, g.evidence.map((e) => e.fileId))) : [];
  const refundRows = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'DISPUTE'), eq(refunds.sourceId, d.id)));
  const open = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'].includes(d.status);
  return {
    id: d.id,
    number: String(d.number),
    status: d.status,
    role: g.role as 'CLAIMANT' | 'RESPONDENT',
    context,
    reasonCode: d.reasonCode,
    description: d.description,
    claimedAmountPiastres: d.claimedAmount,
    createdAt: d.createdAt.toISOString(),
    returnId: d.returnId,
    // Staff appear as «فريق أضمن» (no names); internal notes are excluded by the service.
    messages: g.messages.map((x) => ({ id: x.m.id, from: x.m.authorRole === 'ADMIN' ? ('EDMN' as const) : (x.m.authorRole as 'CLAIMANT' | 'RESPONDENT'), mine: x.m.authorUserId === userId, body: x.m.body, createdAt: x.m.createdAt.toISOString() })),
    evidence: g.evidence.map((e) => ({ fileId: e.fileId, mimeType: evFiles.find((f) => f.id === e.fileId)?.mime ?? 'application/octet-stream', mine: e.uploadedBy === userId, note: e.note, createdAt: e.createdAt.toISOString() })),
    decision: d.decision ? { code: d.decision, amountPiastres: d.decisionAmount, note: d.decisionNote, decidedAt: d.decidedAt?.toISOString() ?? null } : null,
    refunds: refundRows.map((x) => ({ id: x.id, status: x.status, amountPiastres: x.amount, reference: x.status === 'PAID' ? x.paidReference : null })),
    /** While open, the seller's funds for this order / deal stay frozen (hold) until EDMN decides. */
    fundsFrozen: open,
    allowedActions: open ? (['REPLY', 'ADD_EVIDENCE'] as ('REPLY' | 'ADD_EVIDENCE')[]) : [],
  };
}

export async function myDisputes(actor: Actor) {
  const userId = requireUser(actor);
  const rows = await db.select().from(disputes).where(or(eq(disputes.claimantUserId, userId), eq(disputes.respondentUserId, userId))).orderBy(desc(disputes.createdAt)).limit(100);
  return { items: rows.map((d) => disputeRow(d, d.claimantUserId === userId ? 'CLAIMANT' : 'RESPONDENT')) };
}

export async function storeDisputes(actor: Actor) {
  if (actor.type !== 'SELLER' || !actor.sellerId || !(actor.sellerPermissions?.has('orders.manage') || actor.sellerPermissions?.has('returns.manage'))) throw forbidden();
  const rows = await db.select().from(disputes).where(eq(disputes.respondentSellerId, actor.sellerId)).orderBy(desc(disputes.createdAt)).limit(100);
  return { items: rows.map((d) => disputeRow(d, 'RESPONDENT')) };
}

const disputeRow = (d: typeof disputes.$inferSelect, role: 'CLAIMANT' | 'RESPONDENT') => ({
  id: d.id,
  number: String(d.number),
  status: d.status,
  role,
  kind: d.sellerOrderId ? ('ORDER' as const) : ('DEAL' as const),
  reasonCode: d.reasonCode,
  decision: d.decision,
  createdAt: d.createdAt.toISOString(),
});

export async function disputeReply(actor: Actor, disputeId: string, body: string, attachment: Upload | null) {
  await disputeView(actor, disputeId); // party check (uniform 404)
  await addDisputeMessage(actor, disputeId, body, false, attachment);
  return disputeView(actor, disputeId);
}

/* ───────────────────────── Reviews ───────────────────────── */

export async function reviewOptions(actor: Actor, sellerOrderId: string) {
  const userId = requireUser(actor);
  const { so } = await buyerSellerOrder(userId, sellerOrderId);
  const eligible = so.status === 'DELIVERED' || so.status === 'COMPLETED';
  const items = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
  const reviewed = items.length ? await db.select({ id: productReviews.orderItemId }).from(productReviews).where(inArray(productReviews.orderItemId, items.map((i) => i.id))) : [];
  const [sr] = await db.select({ id: sellerReviews.id }).from(sellerReviews).where(eq(sellerReviews.sellerOrderId, so.id));
  const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.sellerId, so.sellerId));
  return {
    eligible,
    storeName: store?.name ?? null,
    sellerReviewed: !!sr,
    items: items.map((i) => ({ orderItemId: i.id, title: i.titleSnapshot, variantLabel: i.variantLabel, reviewed: reviewed.some((r) => r.id === i.id) })),
  };
}

export async function reviewProduct(actor: Actor, input: { orderItemId: string; rating: number; title?: string; body?: string }, photos: Upload[]) {
  const r = await createProductReview(actor, { orderItemId: input.orderItemId, rating: input.rating, title: input.title ?? '', body: input.body ?? '' }, photos);
  const [it] = await db.select({ so: orderItems.sellerOrderId }).from(orderItems).where(eq(orderItems.id, r.orderItemId));
  return reviewOptions(actor, it.so);
}

export async function reviewSeller(actor: Actor, input: { sellerOrderId: string; rating: number; deliveryRating?: number; packagingRating?: number; accuracyRating?: number; communicationRating?: number; body?: string }) {
  await createSellerReview(actor, { ...input, body: input.body ?? '' });
  return reviewOptions(actor, input.sellerOrderId);
}
