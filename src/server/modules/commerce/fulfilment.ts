import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { assertNotSelfDealing } from '@/server/modules/finance/self-dealing';
import { z } from 'zod';
import { SELLER_ORDER_CANCELLABLE, sellerOrderMachine, shipmentMachine, type SellerOrderStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireSeller, requireUser, SYSTEM_ACTOR, type Actor, requireStepUp } from '@/server/core/actor';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { disputes, orderItems, orders, sellerOrders, sellers, shipmentDocuments, shipments, stores, trackingEvents } from '@/server/db/schema';
import { restock } from '@/server/modules/catalog/inventory';
import { createSellerOrderRefund, releaseSellerOrderFunds } from '@/server/modules/finance/postings';
import { notify } from '@/server/modules/notifications/notify';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason, transition } from '../_shared';
import { syncParentStatus } from './orders';
import { formatEGP } from '@/lib/format';

export type SellerOrder = typeof sellerOrders.$inferSelect;

async function lockSellerOrderForSeller(tx: DbOrTx, actor: Actor, soId: string, perm: 'orders.manage' = 'orders.manage') {
  const sellerId = requireSeller(actor, perm);
  const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
  if (!so) throw notFound('الطلب');
  // Ownership boundary: a seller can never touch another seller's sub-order.
  if (so.sellerId !== sellerId) throw forbidden();
  return so;
}

async function move(tx: DbOrTx, actor: Actor, so: SellerOrder, to: SellerOrderStatus, extra: Partial<SellerOrder> = {}, reason?: string | null) {
  await transition(tx, actor, sellerOrderMachine, so.id, so.status, to, reason);
  await tx.update(sellerOrders).set({ status: to, ...extra }).where(eq(sellerOrders.id, so.id));
}

async function orderNumber(tx: DbOrTx, so: SellerOrder) {
  const [o] = await tx.select({ number: orders.number, customerId: orders.customerId }).from(orders).where(eq(orders.id, so.orderId));
  return { label: `${o.number}-${so.suffix}`, customerId: o.customerId };
}

export async function confirmSellerOrder(actor: Actor, soId: string) {
  await db.transaction(async (tx) => {
    const so = await lockSellerOrderForSeller(tx, actor, soId);
    if (so.status !== 'PAID') throw invalidState('يمكن تأكيد الطلبات المدفوعة الجديدة فقط');
    await move(tx, actor, so, 'SELLER_CONFIRMED', { confirmedAt: new Date() });
    const { label, customerId } = await orderNumber(tx, so);
    const [store] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.sellerId, so.sellerId));
    await audit(tx, actor, { action: 'seller_order.confirmed', entityType: 'seller_order', entityId: so.id });
    await notify(tx, { event: 'SELLER_ORDER_CONFIRMED', userIds: [customerId], vars: { order: label, store: store?.name }, link: `/account/orders/${so.orderId}` });
  });
}

export async function advanceSellerOrder(actor: Actor, soId: string, to: 'PROCESSING' | 'READY_TO_SHIP') {
  await db.transaction(async (tx) => {
    const so = await lockSellerOrderForSeller(tx, actor, soId);
    await move(tx, actor, so, to);
    await audit(tx, actor, { action: `seller_order.${to.toLowerCase()}`, entityType: 'seller_order', entityId: so.id });
  });
}

export const shipmentSchema = z.object({
  carrierName: z.string().trim().min(2, 'اسم شركة الشحن مطلوب').max(80),
  trackingNumber: z.string().trim().max(80).optional().default(''),
  shippedAt: z.coerce.date({ message: 'تاريخ الشحن مطلوب' }),
  expectedDeliveryAt: z.coerce.date().nullable().optional(),
  note: z.string().trim().max(500).optional().default(''),
});

/** Create or update shipment details and (optionally) upload a waybill. */
export async function saveShipment(actor: Actor, soId: string, input: z.input<typeof shipmentSchema>, waybill?: { data: Buffer; name: string } | null) {
  const d = parse(shipmentSchema, input);
  if (d.shippedAt.getTime() > Date.now() + 2 * 86400_000) throw validation('تاريخ الشحن لا يمكن أن يكون في المستقبل البعيد');
  if (d.expectedDeliveryAt && d.expectedDeliveryAt < d.shippedAt) throw validation('تاريخ التسليم المتوقع يجب أن يكون بعد تاريخ الشحن');
  return db.transaction(async (tx) => {
    const so = await lockSellerOrderForSeller(tx, actor, soId);
    if (!['SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED'].includes(so.status)) throw invalidState('لا يمكن إضافة بيانات الشحن في الحالة الحالية للطلب');
    const [existing] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    const values = {
      carrierName: d.carrierName,
      trackingNumber: d.trackingNumber || null,
      shippedAt: d.shippedAt,
      expectedDeliveryAt: d.expectedDeliveryAt ?? null,
      note: d.note || null,
    };
    let shipmentId: string;
    if (existing) {
      if (existing.status === 'DELIVERED') throw invalidState('تم تسليم الشحنة بالفعل');
      await tx.update(shipments).set(values).where(eq(shipments.id, existing.id));
      shipmentId = existing.id;
    } else {
      const [s] = await tx.insert(shipments).values({ ...values, sellerOrderId: so.id, createdBy: actor.userId }).returning({ id: shipments.id });
      shipmentId = s.id;
      const { recordTransition } = await import('@/server/audit/audit');
      await recordTransition(tx, actor, 'shipment', s.id, null, 'CREATED');
    }
    if (waybill) {
      const f = await storeUpload(tx, actor, { purpose: 'SHIPPING_WAYBILL', data: waybill.data, originalName: waybill.name });
      await tx.insert(shipmentDocuments).values({ shipmentId, fileId: f.id, kind: 'WAYBILL', uploadedBy: actor.userId });
    }
    await audit(tx, actor, { action: 'shipment.saved', entityType: 'shipment', entityId: shipmentId, newValues: { ...values, waybillUploaded: !!waybill } });
    return shipmentId;
  });
}

/**
 * Mark a seller order SHIPPED. Requires carrier, shipment date and at least one uploaded waybill.
 * Shipping evidence alone NEVER releases funds — only buyer receipt confirmation does.
 */
export async function markShipped(actor: Actor, soId: string) {
  await db.transaction(async (tx) => {
    const so = await lockSellerOrderForSeller(tx, actor, soId);
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (!s || !s.carrierName || !s.shippedAt) throw validation('أدخل بيانات الشحن (شركة الشحن وتاريخ الشحن) أولاً');
    const docs = await tx.select({ id: shipmentDocuments.id }).from(shipmentDocuments).where(eq(shipmentDocuments.shipmentId, s.id));
    if (!docs.length) throw validation('ارفع بوليصة الشحن قبل تحديد الطلب كمشحون');
    // Walk through intermediate states explicitly so history stays complete.
    let current: SellerOrder = so;
    const path: SellerOrderStatus[] = so.status === 'SELLER_CONFIRMED' ? ['READY_TO_SHIP', 'SHIPPED'] : so.status === 'PROCESSING' ? ['READY_TO_SHIP', 'SHIPPED'] : ['SHIPPED'];
    for (const step of path) {
      await move(tx, actor, current, step, step === 'SHIPPED' ? { shippedAt: s.shippedAt } : {});
      current = { ...current, status: step };
    }
    await transition(tx, actor, shipmentMachine, s.id, s.status, 'SHIPPED');
    await tx.update(shipments).set({ status: 'SHIPPED' }).where(eq(shipments.id, s.id));
    await tx.insert(trackingEvents).values({ shipmentId: s.id, status: 'SHIPPED', description: `تم الشحن عبر ${s.carrierName}`, occurredAt: s.shippedAt, actorUserId: actor.userId });
    const { label, customerId } = await orderNumber(tx, so);
    await audit(tx, actor, { action: 'seller_order.shipped', entityType: 'seller_order', entityId: so.id, newValues: { carrier: s.carrierName, tracking: s.trackingNumber } });
    await notify(tx, { event: 'ORDER_SHIPPED', userIds: [customerId], vars: { order: label, carrier: s.carrierName, tracking: s.trackingNumber ?? '—' }, link: `/account/orders/${so.orderId}` });
  });
}

export async function addTrackingEvent(actor: Actor, soId: string, input: { status: 'IN_TRANSIT' | 'FAILED'; description: string }) {
  const d = parse(z.object({ status: z.enum(['IN_TRANSIT', 'FAILED']), description: z.string().trim().min(2).max(300) }), input);
  await db.transaction(async (tx) => {
    const so = await lockSellerOrderForSeller(tx, actor, soId);
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (!s) throw notFound('الشحنة');
    if (s.status !== d.status) {
      await transition(tx, actor, shipmentMachine, s.id, s.status, d.status);
      await tx.update(shipments).set({ status: d.status }).where(eq(shipments.id, s.id));
    }
    await tx.insert(trackingEvents).values({ shipmentId: s.id, status: d.status, description: d.description, actorUserId: actor.userId });
  });
}

/** True when an open dispute or administrative hold blocks releasing funds. */
async function isBlocked(tx: DbOrTx, so: SellerOrder) {
  if (so.financialHold) return true;
  const [d] = await tx
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(eq(disputes.sellerOrderId, so.id), inArray(disputes.status, ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'])));
  return !!d;
}

/**
 * ConfirmBuyerReceipt — the ONLY event that makes seller proceeds available.
 * Transactional + idempotent: the sub-order row is locked; a retry/double click on an already
 * DELIVERED order is a no-op, and the ledger release carries a unique key.
 */
export async function confirmReceipt(actor: Actor, soId: string, opts: { onBehalfReason?: string } = {}) {
  const userId = requireUser(actor);
  const onBehalf = actor.type === 'ADMIN';
  if (onBehalf) {
    requirePermission(actor, 'orders.confirm_receipt_on_behalf');
    requireStepUp(actor); // releases seller funds without the buyer
    requireReason(opts.onBehalfReason);
  }
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    if (!onBehalf && order.customerId !== userId) throw forbidden();
    if (onBehalf) await assertNotSelfDealing(tx, actor, so.sellerId);
    if (so.status === 'DELIVERED' || so.status === 'COMPLETED') return { alreadyConfirmed: true, released: !!so.fundsReleasedAt };
    if (so.status !== 'SHIPPED') throw invalidState('تأكيد الاستلام بيبقى متاح بعد ما الطلب يتشحن بس');

    const now = new Date();
    await move(tx, actor, so, 'DELIVERED', {
      deliveredAt: now,
      receiptConfirmedBy: userId,
      receiptConfirmationSource: onBehalf ? 'ADMIN_ON_BEHALF' : 'BUYER',
    }, opts.onBehalfReason ?? null);
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (s && s.status !== 'DELIVERED') {
      await transition(tx, actor, shipmentMachine, s.id, s.status, 'DELIVERED');
      await tx.update(shipments).set({ status: 'DELIVERED' }).where(eq(shipments.id, s.id));
      await tx.insert(trackingEvents).values({ shipmentId: s.id, status: 'DELIVERED', description: onBehalf ? 'تم تأكيد الاستلام بواسطة فريق اضمن' : 'أكد العميل الاستلام', actorUserId: userId });
    }
    const fresh = { ...so, status: 'DELIVERED' as const };
    const blocked = await isBlocked(tx, fresh);
    if (!blocked) await releaseSellerOrderFunds(tx, actor, fresh);
    await audit(tx, actor, {
      action: onBehalf ? 'seller_order.receipt_confirmed_on_behalf' : 'seller_order.receipt_confirmed',
      entityType: 'seller_order',
      entityId: so.id,
      newValues: { released: !blocked, sessionId: actor.sessionId ?? null },
      reason: opts.onBehalfReason ?? null,
    });
    const [seller] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
    await notify(tx, { event: 'BUYER_RECEIPT_CONFIRMED', userIds: [seller.ownerUserId], vars: { order: `${order.number}-${so.suffix}`, amount: blocked ? '0 (محجوز بسبب نزاع)' : formatEGP(so.sellerNet - 0) }, link: `/seller/orders/${so.id}` });
    return { alreadyConfirmed: false, released: !blocked };
  });
}

/** Release funds for delivered orders whose hold/dispute has just been cleared. */
export async function releaseIfEligible(tx: DbOrTx, actor: Actor, soId: string) {
  const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
  if (!so || so.fundsReleasedAt) return false;
  if (so.status !== 'DELIVERED' && so.status !== 'COMPLETED') return false;
  if (await isBlocked(tx, so)) return false;
  await releaseSellerOrderFunds(tx, actor, so);
  return true;
}

export async function setFinancialHold(actor: Actor, soId: string, hold: boolean, reason: string) {
  requirePermission(actor, 'orders.manage');
  if (!hold) requireStepUp(actor); // releasing a hold can make seller funds available
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    if (hold && so.fundsReleasedAt) throw invalidState('تمت إتاحة الأموال بالفعل. استخدم تسوية مالية بدلاً من ذلك');
    await assertNotSelfDealing(tx, actor, so.sellerId);
    await tx.update(sellerOrders).set({ financialHold: hold, holdReason: hold ? why : null }).where(eq(sellerOrders.id, so.id));
    await audit(tx, actor, { action: hold ? 'seller_order.hold_placed' : 'seller_order.hold_released', entityType: 'seller_order', entityId: so.id, reason: why });
    if (!hold) await releaseIfEligible(tx, actor, so.id);
  });
}

/**
 * Cancel a paid seller sub-order before shipment (seller or operations). Stock is restocked and a
 * refund record is created for the customer; other sellers' sub-orders are unaffected.
 */
export async function cancelSellerOrder(actor: Actor, soId: string, reason: string) {
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    let so: SellerOrder;
    if (actor.type === 'SELLER') so = await lockSellerOrderForSeller(tx, actor, soId);
    else {
      requirePermission(actor, 'orders.manage');
      const [row] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
      if (!row) throw notFound('الطلب');
      so = row;
    }
    if (so.status === 'CANCELLED') return { alreadyCancelled: true };
    if (!SELLER_ORDER_CANCELLABLE.includes(so.status)) throw invalidState('لا يمكن إلغاء الطلب بعد شحنه. يمكن للعميل طلب إرجاع');
    await move(tx, actor, so, 'CANCELLED', { cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: why }, why);
    const items = await tx.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    for (const it of items) await restock(tx, it.variantId, it.quantity, `cancel:${so.id}`);
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    await createSellerOrderRefund(tx, actor, {
      sellerOrderId: so.id,
      customerId: order.customerId,
      amount: so.grossTotal - so.refundedTotal,
      sourceType: 'ORDER_CANCELLATION',
      sourceId: so.id,
      reason: why,
    });
    await syncParentStatus(tx, actor, so.orderId);
    await audit(tx, actor, { action: 'seller_order.cancelled', entityType: 'seller_order', entityId: so.id, reason: why });
    const [store] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.sellerId, so.sellerId));
    await notify(tx, { event: 'SELLER_ORDER_CANCELLED', userIds: [order.customerId], vars: { order: `${order.number}-${so.suffix}`, store: store?.name, reason: why }, link: `/account/orders/${order.id}` });
    return { alreadyCancelled: false };
  });
}

/* ───────── Scheduled operations ───────── */

/** Flag shipped orders without buyer confirmation for follow-up — never auto-releases money. */
export async function flagUnconfirmedDeliveries(now = new Date()) {
  const days = await getSetting('orders.deliveryFollowUpDays');
  const cutoff = new Date(now.getTime() - days * 86400_000);
  const due = await db
    .select({ so: sellerOrders, customerId: orders.customerId, number: orders.number })
    .from(sellerOrders)
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .where(and(eq(sellerOrders.status, 'SHIPPED'), lte(sellerOrders.shippedAt, cutoff), isNull(sellerOrders.deliveryFollowUpFlaggedAt)));
  for (const r of due) {
    await db.transaction(async (tx) => {
      await tx.update(sellerOrders).set({ deliveryFollowUpFlaggedAt: now }).where(eq(sellerOrders.id, r.so.id));
      await notify(tx, { event: 'DELIVERY_FOLLOW_UP', userIds: [r.customerId], vars: { order: `${r.number}-${r.so.suffix}` }, link: `/account/orders/${r.so.orderId}` });
      await audit(tx, SYSTEM_ACTOR, { action: 'seller_order.delivery_follow_up_flagged', entityType: 'seller_order', entityId: r.so.id });
    });
  }
  return due.length;
}

/** DELIVERED → COMPLETED after the configured window when no return/dispute is open. */
export async function completeDeliveredOrders(now = new Date()) {
  const days = await getSetting('orders.completionDays');
  const cutoff = new Date(now.getTime() - days * 86400_000);
  const due = await db
    .select({ id: sellerOrders.id })
    .from(sellerOrders)
    .where(and(eq(sellerOrders.status, 'DELIVERED'), lte(sellerOrders.deliveredAt, cutoff)));
  let n = 0;
  for (const r of due) {
    await db.transaction(async (tx) => {
      const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.id)).for('update');
      if (so.status !== 'DELIVERED') return;
      const open = await tx.execute(sql`
        select 1 from returns where seller_order_id = ${so.id} and status not in ('REFUNDED','REJECTED')
        union all select 1 from disputes where seller_order_id = ${so.id} and status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION') limit 1`);
      if (open.rows.length) return;
      await move(tx, SYSTEM_ACTOR, so, 'COMPLETED', { completedAt: now });
      await syncParentStatus(tx, SYSTEM_ACTOR, so.orderId);
      n++;
    });
  }
  return n;
}

/* ───────── Reads ───────── */

export async function sellerOrderForSeller(actor: Actor, soId: string) {
  const sellerId = requireSeller(actor, 'orders.manage');
  const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, soId));
  if (!so) throw notFound('الطلب');
  if (so.sellerId !== sellerId) throw forbidden();
  if (so.status === 'PENDING_PAYMENT' || so.status === 'PAYMENT_UNDER_REVIEW') throw forbidden('هذا الطلب لم يُدفع بعد');
  return loadSellerOrderGraph(so);
}

export async function loadSellerOrderGraph(so: SellerOrder) {
  const [order] = await db.select().from(orders).where(eq(orders.id, so.orderId));
  const items = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)).orderBy(asc(orderItems.createdAt));
  const [shipment] = await db.select().from(shipments).where(eq(shipments.sellerOrderId, so.id));
  const docs = shipment ? await db.select().from(shipmentDocuments).where(eq(shipmentDocuments.shipmentId, shipment.id)) : [];
  const events = shipment ? await db.select().from(trackingEvents).where(eq(trackingEvents.shipmentId, shipment.id)).orderBy(asc(trackingEvents.occurredAt)) : [];
  return { so, order, items, shipment: shipment ?? null, documents: docs, tracking: events };
}

export function canAdminSeeShipping(actor: Actor) {
  return hasPermission(actor, 'shipping.view') || hasPermission(actor, 'orders.view');
}
