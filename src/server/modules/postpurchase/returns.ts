import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { returnMachine, type ReturnStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { orderItems, orders, returnEvidence, returnItems, returns, sellerOrders, sellers, stores } from '@/server/db/schema';
import { restock } from '@/server/modules/catalog/inventory';
import { requestRefundTx } from '@/server/modules/finance/refunds';
import { notify } from '@/server/modules/notifications/notify';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { PROTECTED_REASONS, type ReturnPolicySnapshot } from '@/domain/return-policy';
import { parse, requireReason, transition } from '../_shared';

export type Return = typeof returns.$inferSelect;

export const STATUS_LABEL_FOR_NOTIFY: Partial<Record<ReturnStatus, string>> = {
  APPROVED: 'اتقبل — ابعت المنتج للبائع',
  REJECTED: 'مرفوض',
  RECEIVED: 'البائع استلم المنتج',
  INSPECTION: 'قيد الفحص',
  REFUND_PENDING: 'الاسترداد اتقبل وجاري التحويل',
  REFUNDED: 'المبلغ اترد',
  DISPUTED: 'اتحوّل لفريق اضمن',
};

export const returnRequestSchema = z.object({
  sellerOrderId: z.string().uuid(),
  reason: z.enum(['CHANGED_MIND', 'WRONG_ITEM', 'DAMAGED', 'DEFECTIVE', 'MISSING_PARTS', 'NOT_AS_DESCRIBED', 'COUNTERFEIT_SUSPECTED', 'OTHER']),
  description: z.string().trim().min(10, 'اشرح سبب الإرجاع بتفصيل أكتر').max(2000),
  items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().positive() })).min(1, 'اختار منتج واحد على الأقل'),
});

/** Eligibility window: the longer of the (legally-reviewed, configurable) statutory window and the store's voluntary window. */
export async function returnWindow(conn: DbOrTx, sellerId: string, items?: { returnPolicySnapshot: ReturnPolicySnapshot | null }[]) {
  const statutory = await getSetting('returns.statutoryWindowDays', conn);
  // The voluntary window is the one agreed at purchase (order item snapshot); legacy items without a
  // snapshot fall back to the store's current setting.
  const snaps = (items ?? []).map((i) => i.returnPolicySnapshot).filter(Boolean) as ReturnPolicySnapshot[];
  let voluntary: number;
  if (snaps.length) voluntary = Math.min(...snaps.map((s) => (s.type === 'VOLUNTARY' ? (s.windowDays ?? 0) : 0)));
  else {
    const [store] = await conn.select().from(stores).where(eq(stores.sellerId, sellerId));
    voluntary = store?.acceptsVoluntaryReturns ? (store.voluntaryReturnDays ?? 0) : 0;
  }
  return { statutory, voluntary, effective: Math.max(statutory, voluntary) };
}

async function openReturnedQty(tx: DbOrTx, orderItemId: string) {
  const [r] = await tx
    .select({ q: sql<string>`coalesce(sum(${returnItems.quantity}),0)` })
    .from(returnItems)
    .innerJoin(returns, eq(returns.id, returnItems.returnId))
    .where(and(eq(returnItems.orderItemId, orderItemId), notInArray(returns.status, ['REJECTED', 'REFUNDED'])));
  return Number(r.q);
}

export async function requestReturn(actor: Actor, input: z.input<typeof returnRequestSchema>, evidence: { data: Buffer; name: string }[] = []) {
  const userId = requireUser(actor);
  const d = parse(returnRequestSchema, input);
  if (evidence.length > 6) throw validation('الحد الأقصى 6 ملفات');
  if (['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'COUNTERFEIT_SUSPECTED'].includes(d.reason) && !evidence.length) {
    throw validation('ارفع صور توضّح المشكلة');
  }
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, d.sellerOrderId)).for('update');
    if (!so) throw notFound('الطلب');
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    if (order.customerId !== userId) throw forbidden();
    if (so.status !== 'DELIVERED' && so.status !== 'COMPLETED') throw invalidState('تقدر تطلب الإرجاع بس بعد ما تأكّد استلام الطلب');
    const items = await tx.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    const win = await returnWindow(tx, so.sellerId, items.filter((i) => d.items.some((r) => r.orderItemId === i.id)));
    const ageDays = (Date.now() - (so.deliveredAt ?? new Date()).getTime()) / 86400_000;
    // A seller's "no voluntary returns" only limits change-of-mind returns. Wrong / damaged /
    // defective / not-as-described items stay claimable for the (longer) dispute window.
    const isProtected = (PROTECTED_REASONS as readonly string[]).includes(d.reason);
    const limit = isProtected ? Math.max(win.effective, await getSetting('disputes.windowDays', tx)) : win.effective;
    if (ageDays > limit) throw invalidState(`انتهت مدة الإرجاع (${limit} يوم من الاستلام). لو المنتج معيب، تقدر تفتح نزاع أو تذكرة دعم`);
    for (const ri of d.items) {
      const it = items.find((i) => i.id === ri.orderItemId);
      if (!it) throw forbidden();
      const open = await openReturnedQty(tx, it.id);
      if (ri.quantity > it.quantity - it.returnedQuantity - open) throw validation(`الكمية اللي عايز ترجّعها من "${it.titleSnapshot}" أكبر من المتاح`);
    }
    const [ret] = await tx
      .insert(returns)
      .values({
        orderId: order.id,
        sellerOrderId: so.id,
        sellerId: so.sellerId,
        customerId: userId,
        reason: d.reason,
        description: d.description,
        isStatutory: ageDays <= win.statutory,
      })
      .returning();
    await tx.insert(returnItems).values(d.items.map((i) => ({ returnId: ret.id, orderItemId: i.orderItemId, quantity: i.quantity })));
    for (const e of evidence) {
      const f = await storeUpload(tx, actor, { purpose: 'RETURN_EVIDENCE', data: e.data, originalName: e.name });
      await tx.insert(returnEvidence).values({ returnId: ret.id, fileId: f.id, uploadedBy: userId });
    }
    const { recordTransition } = await import('@/server/audit/audit');
    await recordTransition(tx, actor, 'return', ret.id, null, 'REQUESTED');
    await audit(tx, actor, { action: 'return.requested', entityType: 'return', entityId: ret.id, newValues: { reason: d.reason, items: d.items } });
    const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
    await notify(tx, { event: 'RETURN_REQUESTED', userIds: [s.ownerUserId], vars: { ret: ret.number, order: `${order.number}-${so.suffix}` }, link: `/seller/returns/${ret.id}` });
    return ret;
  });
}

/** Seller (owner of the sub-order) or operations staff with returns.manage. */
async function lockForHandler(tx: DbOrTx, actor: Actor, returnId: string) {
  const [r] = await tx.select().from(returns).where(eq(returns.id, returnId)).for('update');
  if (!r) throw notFound('طلب الإرجاع');
  if (actor.type === 'SELLER') {
    if (actor.sellerId !== r.sellerId || !actor.sellerPermissions?.has('returns.manage')) throw forbidden();
  } else requirePermission(actor, 'returns.manage');
  // An escalated return is decided only through its dispute (one decision, one refund).
  if (r.status === 'DISPUTED') throw invalidState('هذا الإرجاع محال إلى نزاع؛ يتم القرار من صفحة النزاع');
  return r;
}

async function moveReturn(tx: DbOrTx, actor: Actor, r: Return, to: ReturnStatus, extra: Partial<Return> = {}, reason?: string | null) {
  await transition(tx, actor, returnMachine, r.id, r.status, to, reason);
  await tx.update(returns).set({ status: to, ...extra }).where(eq(returns.id, r.id));
  const label = STATUS_LABEL_FOR_NOTIFY[to];
  if (label) await notify(tx, { event: 'RETURN_UPDATED', userIds: [r.customerId], vars: { ret: r.number, status: label }, link: `/account/returns/${r.id}` });
}

export async function approveReturn(actor: Actor, returnId: string, note?: string) {
  await db.transaction(async (tx) => {
    const r = await lockForHandler(tx, actor, returnId);
    await moveReturn(tx, actor, r, 'APPROVED', { decisionReason: note ?? null }, note);
    await audit(tx, actor, { action: 'return.approved', entityType: 'return', entityId: r.id, reason: note ?? null });
  });
}

export async function rejectReturn(actor: Actor, returnId: string, reason: string) {
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const r = await lockForHandler(tx, actor, returnId);
    await moveReturn(tx, actor, r, 'REJECTED', { decisionReason: why }, why);
    await audit(tx, actor, { action: 'return.rejected', entityType: 'return', entityId: r.id, reason: why });
  });
}

export async function customerShipsReturn(actor: Actor, returnId: string, carrier: string, tracking: string) {
  const userId = requireUser(actor);
  if (!carrier?.trim()) throw validation('اكتب اسم شركة الشحن');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(returns).where(eq(returns.id, returnId)).for('update');
    if (!r) throw notFound('طلب الإرجاع');
    if (r.customerId !== userId) throw forbidden();
    await transition(tx, actor, returnMachine, r.id, r.status, 'RETURN_IN_TRANSIT');
    await tx.update(returns).set({ status: 'RETURN_IN_TRANSIT', returnCarrier: carrier.trim(), returnTracking: tracking?.trim() || null }).where(eq(returns.id, r.id));
    await audit(tx, actor, { action: 'return.shipped_back', entityType: 'return', entityId: r.id });
  });
}

export async function markReturnReceived(actor: Actor, returnId: string) {
  await db.transaction(async (tx) => {
    const r = await lockForHandler(tx, actor, returnId);
    await moveReturn(tx, actor, r, 'RECEIVED');
    await audit(tx, actor, { action: 'return.received', entityType: 'return', entityId: r.id });
  });
}

export async function startInspection(actor: Actor, returnId: string) {
  await db.transaction(async (tx) => {
    const r = await lockForHandler(tx, actor, returnId);
    await moveReturn(tx, actor, r, 'INSPECTION');
  });
}

export async function returnRefundCeiling(conn: DbOrTx, r: Return, includeShipping: boolean) {
  const lines = await conn
    .select({ qty: returnItems.quantity, unitPrice: orderItems.unitPrice })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .where(eq(returnItems.returnId, r.id));
  const items = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const [so] = await conn.select().from(sellerOrders).where(eq(sellerOrders.id, r.sellerOrderId));
  const max = Math.min(so.grossTotal - so.refundedTotal, items + (includeShipping ? so.shippingFee : 0));
  return { items, max };
}

/**
 * Accept the refund for an inspected return: marks the units as returned (optionally restocks them) and
 * creates a refund REQUEST for exactly those units (their snapshotted price and fee shares). Shipping is
 * refunded only when explicitly chosen (no invented shipping policy). Money moves only when an Admin
 * approves the refund; the customer is then paid by finance.
 */
export async function acceptReturnRefund(actor: Actor, returnId: string, input: { amount?: number; includeShipping?: boolean; restock?: boolean; note?: string; shippingAmount?: number }) {
  return db.transaction(async (tx) => {
    const r = await lockForHandler(tx, actor, returnId);
    return acceptReturnRefundTx(tx, actor, r, input);
  });
}

export async function acceptReturnRefundTx(tx: DbOrTx, actor: Actor, r: Return, input: { amount?: number; includeShipping?: boolean; restock?: boolean; note?: string; shippingAmount?: number }) {
  const rItems = await tx.select().from(returnItems).where(eq(returnItems.returnId, r.id));
  const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.sellerOrderId)).for('update');
  const { refundableOf } = await import('@/server/modules/finance/refunds');
  const left = await refundableOf(tx, so);
  const shipping = input.shippingAmount ?? (input.includeShipping ? left.shipping : 0);
  const refund = await requestRefundTx(tx, actor, {
    sellerOrderId: r.sellerOrderId,
    sourceType: 'RETURN',
    sourceId: r.id,
    items: rItems.map((ri) => ({ orderItemId: ri.orderItemId, quantity: ri.quantity })),
    shippingAmount: shipping,
    reason: `إرجاع #${r.number}${input.note ? ` — ${input.note}` : ''}`,
  });
  if (input.amount !== undefined && input.amount !== refund.amount) {
    throw validation(`مبلغ الاسترداد للوحدات المرتجعة ${refund.amount / 100} ج.م (محسوب من سعر الشراء المسجل)`);
  }
  await moveReturn(tx, actor, r, 'REFUND_PENDING', { refundAmount: refund.amount, includeShipping: shipping > 0, inspectionNote: input.note ?? r.inspectionNote }, input.note);
  for (const ri of rItems) {
    const [it] = await tx.select().from(orderItems).where(eq(orderItems.id, ri.orderItemId)).for('update');
    await tx.update(orderItems).set({ returnedQuantity: it.returnedQuantity + ri.quantity }).where(eq(orderItems.id, it.id));
    if (input.restock) await restock(tx, it.variantId, ri.quantity, `return:${r.id}`);
  }
  await audit(tx, actor, { action: 'return.refund_accepted', entityType: 'return', entityId: r.id, newValues: { refundId: refund.id, amount: refund.amount, restock: !!input.restock } });
  return refund;
}

/** Inspection failed / seller disputes the claim → escalate to EDMN dispute officers. */
export async function escalateReturn(actor: Actor, returnId: string, description: string) {
  const why = requireReason(description);
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(returns).where(eq(returns.id, returnId)).for('update');
    if (!r) throw notFound('طلب الإرجاع');
    const isCustomer = actor.userId === r.customerId;
    const isSeller = actor.type === 'SELLER' && actor.sellerId === r.sellerId;
    if (!isCustomer && !isSeller && !hasPermission(actor, 'returns.manage')) throw forbidden();
    await moveReturn(tx, actor, r, 'DISPUTED', {}, why);
    const { openDisputeTx } = await import('./disputes');
    const d = await openDisputeTx(tx, actor, {
      sellerOrderId: r.sellerOrderId,
      reasonCode: `RETURN_${r.reason}`,
      description: why,
      returnId: r.id,
      claimantUserId: r.customerId,
    });
    return d;
  });
}

export async function onReturnRefundPaid(tx: DbOrTx, actor: Actor, returnId: string) {
  const [r] = await tx.select().from(returns).where(eq(returns.id, returnId)).for('update');
  if (!r || r.status !== 'REFUND_PENDING') return;
  await moveReturn(tx, actor, r, 'REFUNDED');
}

export async function returnGraph(actor: Actor, returnId: string) {
  const [r] = await db.select().from(returns).where(eq(returns.id, returnId));
  if (!r) throw notFound('طلب الإرجاع');
  const allowed =
    r.customerId === actor.userId || (actor.type === 'SELLER' && actor.sellerId === r.sellerId) || hasPermission(actor, 'returns.manage') || hasPermission(actor, 'disputes.manage');
  if (!allowed) throw forbidden();
  const items = await db
    .select({ ri: returnItems, item: orderItems })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .where(eq(returnItems.returnId, r.id));
  const evidence = await db.select().from(returnEvidence).where(eq(returnEvidence.returnId, r.id));
  const [order] = await db.select({ number: orders.number }).from(orders).where(eq(orders.id, r.orderId));
  const [so] = await db.select({ suffix: sellerOrders.suffix }).from(sellerOrders).where(eq(sellerOrders.id, r.sellerOrderId));
  return { ret: r, items, evidence, orderLabel: `${order.number}-${so.suffix}` };
}

export async function returnsForSeller(sellerId: string, statuses?: ReturnStatus[]) {
  return db
    .select()
    .from(returns)
    .where(statuses?.length ? and(eq(returns.sellerId, sellerId), inArray(returns.status, statuses)) : eq(returns.sellerId, sellerId))
    .orderBy(desc(returns.createdAt))
    .limit(100);
}

export async function returnsForCustomer(userId: string) {
  return db.select().from(returns).where(eq(returns.customerId, userId)).orderBy(desc(returns.createdAt)).limit(100);
}
