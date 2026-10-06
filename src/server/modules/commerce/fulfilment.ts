import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { assertNotSelfDealing } from '@/server/modules/finance/self-dealing';
import { z } from 'zod';
import {
  CANCELLATION_REASON_CODES,
  SELLER_ORDER_CANCELLABLE,
  SHIPMENT_EXCEPTION_CODES,
  sellerOrderMachine,
  shipmentMachine,
  type CancellationReasonCode,
  type SellerOrderStatus,
  type ShipmentExceptionCode,
} from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireSeller, requireUser, SYSTEM_ACTOR, type Actor, requireStepUp } from '@/server/core/actor';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import {
  cancellationRequests,
  deliveryEvidence,
  disputes,
  orderItems,
  orders,
  refunds,
  riskFlags,
  sellerOrders,
  sellers,
  shipmentDocuments,
  shipments,
  stores,
  trackingEvents,
} from '@/server/db/schema';
import { restock } from '@/server/modules/catalog/inventory';
import { releaseSellerOrderFunds, sellerOrderPosition } from '@/server/modules/finance/postings';
import { grantApproval } from '@/server/modules/finance/approvals';
import { assertNotPaused } from '@/server/modules/finance/controls';
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

/**
 * Seller tracking updates: only IN_TRANSIT / FAILED. A seller can never record a delivery (DELIVERED is
 * an authoritative carrier/Operations event); a seller statement alone never proves delivery.
 */
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
    // Same row lock as cancellation: a pending buyer cancellation blocks shipment until it is resolved.
    if (so.cancellationRequestedAt) throw invalidState('فيه طلب إلغاء من المشتري لازم يتحسم قبل الشحن');
    if (so.status === 'CANCELLED') throw invalidState('الطلب ده اتلغى');
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
    await notify(tx, { event: 'ORDER_SHIPPED', userIds: [customerId], vars: { order: label, carrier: s.carrierName, tracking: s.trackingNumber ?? '—' }, link: `/account/orders/${so.orderId}`, dedupeKey: `so:${so.id}:shipped` });
  });
}

export async function addTrackingEvent(actor: Actor, soId: string, input: { status: 'IN_TRANSIT' | 'FAILED'; description: string }) {
  const d = parse(z.object({ status: z.enum(['IN_TRANSIT', 'FAILED']), description: z.string().trim().min(2).max(300) }), input);
  await db.transaction(async (tx) => {
    const so = await lockSellerOrderForSeller(tx, actor, soId);
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (!s) throw notFound('الشحنة');
    if (so.status !== 'SHIPPED') throw invalidState('تحديثات التتبع للطلبات المشحونة فقط');
    if (s.status !== d.status) {
      await transition(tx, actor, shipmentMachine, s.id, s.status, d.status);
      await tx.update(shipments).set({ status: d.status }).where(eq(shipments.id, s.id));
    }
    await tx.insert(trackingEvents).values({ shipmentId: s.id, status: d.status, description: d.description, actorUserId: actor.userId });
  });
}

/* ═════════════ Holds, receipt basis, entitlement ═════════════ */

const OPEN_DISPUTE = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'] as const;

/** Every reason that blocks timeout entitlement or an Admin seller release (fail closed). */
export async function releaseBlockers(tx: DbOrTx, so: SellerOrder): Promise<string[]> {
  const out: string[] = [];
  if (so.financialHold) out.push(`تجميد مالي: ${so.holdReason ?? 'بقرار العمليات'}`);
  if (so.deliveryExceptionCode) out.push(`استثناء تسليم مفتوح: ${so.deliveryExceptionCode}`);
  const r = await tx.execute<{ kind: string; n: string }>(sql`
    select 'DISPUTE' kind, count(*)::text n from disputes where seller_order_id = ${so.id} and status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')
    union all select 'RETURN', count(*)::text from returns where seller_order_id = ${so.id} and status not in ('REFUNDED','REJECTED')
    union all select 'REFUND', count(*)::text from refunds where seller_order_id = ${so.id} and status in ('REQUESTED','UNDER_REVIEW')
    union all select 'CANCELLATION', count(*)::text from cancellation_requests where seller_order_id = ${so.id} and status = 'PENDING'
    union all select 'SHIPMENT', count(*)::text from shipments where seller_order_id = ${so.id} and status in ('FAILED','EXCEPTION','RETURNED_TO_SELLER','LOST')`);
  const labels: Record<string, string> = {
    DISPUTE: 'نزاع مفتوح',
    RETURN: 'طلب إرجاع مفتوح',
    REFUND: 'استرداد في انتظار قرار',
    CANCELLATION: 'طلب إلغاء معلق',
    SHIPMENT: 'مشكلة شحن مفتوحة',
  };
  for (const row of r.rows) if (Number(row.n) > 0) out.push(labels[row.kind]);
  return out;
}

/**
 * ConfirmBuyerReceipt — the authenticated BUYER only. Records the receipt basis (BUYER_CONFIRMED) and
 * seller entitlement. It moves NO money: funds stay pending until an Admin approves the seller release.
 * Transactional + idempotent (row lock; a double click returns alreadyConfirmed).
 */
export async function confirmReceipt(actor: Actor, soId: string) {
  const userId = requireUser(actor);
  // Admin review never impersonates the buyer; sellers can never confirm for the buyer.
  if (actor.type !== 'CUSTOMER') throw forbidden('تأكيد الاستلام متاح للمشتري نفسه فقط');
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    if (order.customerId !== userId) throw forbidden();
    if (so.status === 'DELIVERED' || so.status === 'COMPLETED') return { alreadyConfirmed: true, released: false };
    if (so.status !== 'SHIPPED' && so.status !== 'AWAITING_BUYER_RESPONSE') throw invalidState('تأكيد الاستلام بيبقى متاح بعد ما الطلب يتشحن بس');
    const now = new Date();
    await move(tx, actor, so, 'DELIVERED', {
      deliveredAt: now,
      receiptConfirmedBy: userId,
      receiptConfirmationSource: 'BUYER',
      receiptBasis: 'BUYER_CONFIRMED',
      entitledAt: now,
    });
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (s && s.status !== 'DELIVERED' && shipmentMachine.can(s.status, 'DELIVERED')) {
      await transition(tx, actor, shipmentMachine, s.id, s.status, 'DELIVERED');
      await tx.update(shipments).set({ status: 'DELIVERED' }).where(eq(shipments.id, s.id));
      await tx.insert(trackingEvents).values({ shipmentId: s.id, status: 'DELIVERED', description: 'أكد المشتري الاستلام', actorUserId: userId });
    }
    await audit(tx, actor, { action: 'seller_order.receipt_confirmed', entityType: 'seller_order', entityId: so.id, newValues: { receiptBasis: 'BUYER_CONFIRMED', released: false, sessionId: actor.sessionId ?? null } });
    const [seller] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
    await notify(tx, { event: 'BUYER_RECEIPT_CONFIRMED', userIds: [seller.ownerUserId], vars: { order: `${order.number}-${so.suffix}`, amount: formatEGP(so.sellerNet) }, link: `/seller/orders/${so.id}`, dedupeKey: `so:${so.id}:receipt` });
    return { alreadyConfirmed: false, released: false };
  });
}

/**
 * Buyer: «ماستلمتش» / «استلمت بس فيه مشكلة» — opens a dispute in the same transaction, which is the
 * protective hold: timeout entitlement and Admin release are blocked until Operations decides.
 * Needs no financial approval (it moves no money); lifting it does.
 */
export async function reportOrderProblem(actor: Actor, soId: string, kind: 'NOT_RECEIVED' | 'PRODUCT_PROBLEM', description: string) {
  const userId = requireUser(actor);
  const why = requireReason(description);
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    if (order.customerId !== userId) throw forbidden();
    if (!['SHIPPED', 'AWAITING_BUYER_RESPONSE', 'DELIVERED', 'COMPLETED'].includes(so.status)) throw invalidState('البلاغ متاح بعد شحن الطلب');
    const { openDisputeTx } = await import('@/server/modules/postpurchase/disputes');
    const dispute = await openDisputeTx(tx, actor, { sellerOrderId: so.id, reasonCode: kind, description: why, claimantUserId: userId });
    await audit(tx, actor, { action: 'seller_order.problem_reported', entityType: 'seller_order', entityId: so.id, newValues: { kind, disputeId: dispute.id, beforeDeadline: so.buyerResponseDueAt ? new Date() <= so.buyerResponseDueAt : null } });
    return dispute;
  });
}

/* ═════════════ Delivery evidence: authoritative event + seller evidence ═════════════ */

async function establishDeliveryTx(tx: DbOrTx, actor: Actor, so: SellerOrder, basis: 'AUTO_EVENT_AND_TIMELY_EVIDENCE' | 'OPERATIONS_REVIEW') {
  if (so.status !== 'SHIPPED') return false;
  if (!so.deliveryEventAt) throw invalidState('لا يوجد حدث تسليم موثّق من شركة الشحن أو العمليات');
  const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now() as now`)).rows;
  const nowDate = new Date(now);
  const hours = BUYER_RESPONSE_HOURS;
  await move(tx, actor, so, 'AWAITING_BUYER_RESPONSE', {
    deliveryEstablishedAt: nowDate,
    deliveryEstablishedBasis: basis,
    deliveryEstablishedBy: actor.userId,
    buyerResponseDueAt: new Date(nowDate.getTime() + hours * 3600_000),
    deliveryExceptionCode: null,
    deliveryExceptionAt: null,
  });
  const { label, customerId } = await orderNumber(tx, so);
  const due = new Date(nowDate.getTime() + hours * 3600_000);
  await notify(tx, {
    event: 'BUYER_RESPONSE_WINDOW_OPENED',
    userIds: [customerId],
    vars: { order: label, due: due.toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' }) },
    link: `/account/orders/${so.orderId}`,
    dedupeKey: `so:${so.id}:buyer-window`,
  });
  await audit(tx, actor, { action: 'seller_order.delivery_established', entityType: 'seller_order', entityId: so.id, newValues: { basis, buyerResponseDueAt: due.toISOString() } });
  return true;
}

export const SELLER_DELIVERY_REPORT_HOURS = 24;
export const BUYER_RESPONSE_HOURS = 24;

/**
 * Operations records an AUTHORITATIVE delivery event (checked with the carrier), with provenance and
 * reference. Starts the seller's 24-hour evidence deadline. A seller statement is never such an event.
 */
export async function recordDeliveryEvent(actor: Actor, soId: string, input: { reference: string; source?: 'OPERATIONS_CARRIER_CHECK' | 'CARRIER_INTEGRATION' }) {
  if (actor.type !== 'SYSTEM') requirePermission(actor, 'delivery.verify');
  const ref = input.reference?.trim();
  if (!ref || ref.length < 3) throw validation('اكتب مرجع التحقق من شركة الشحن (رقم التتبع/حالة الشحنة)');
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    if (actor.type === 'ADMIN') await assertNotSelfDealing(tx, actor, so.sellerId);
    if (so.deliveryEventAt) return { alreadyRecorded: true };
    if (so.status !== 'SHIPPED') throw invalidState('حدث التسليم يتسجل للطلبات المشحونة فقط');
    const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now() as now`)).rows;
    const nowDate = new Date(now);
    const due = new Date(nowDate.getTime() + SELLER_DELIVERY_REPORT_HOURS * 3600_000);
    await tx
      .update(sellerOrders)
      .set({ deliveryEventAt: nowDate, deliveryEventSource: input.source ?? 'OPERATIONS_CARRIER_CHECK', deliveryEventRef: ref, deliveryEventRecordedBy: actor.userId, deliveryReportDueAt: due })
      .where(eq(sellerOrders.id, so.id));
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (s && s.status !== 'DELIVERED' && shipmentMachine.can(s.status, 'DELIVERED')) {
      await transition(tx, actor, shipmentMachine, s.id, s.status, 'DELIVERED', ref);
      await tx.update(shipments).set({ status: 'DELIVERED' }).where(eq(shipments.id, s.id));
      await tx.insert(trackingEvents).values({ shipmentId: s.id, status: 'DELIVERED', description: `حدث تسليم موثّق (${ref})`, actorUserId: actor.userId });
    }
    await audit(tx, actor, { action: 'seller_order.delivery_event_recorded', entityType: 'seller_order', entityId: so.id, newValues: { source: input.source ?? 'OPERATIONS_CARRIER_CHECK', reference: ref, reportDueAt: due.toISOString() } });
    const fresh = { ...so, deliveryEventAt: nowDate, deliveryReportDueAt: due };
    // Seller evidence already in, on time → valid delivery evidence is established now.
    if (so.sellerDeliveryConfirmedAt && !so.sellerDeliveryLate) await establishDeliveryTx(tx, actor, fresh, 'AUTO_EVENT_AND_TIMELY_EVIDENCE');
    else {
      const [seller] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
      const { label } = await orderNumber(tx, so);
      await notify(tx, { event: 'SELLER_DELIVERY_REPORT_DUE', userIds: [seller.ownerUserId], vars: { order: label, due: due.toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' }) }, link: `/seller/orders/${so.id}`, dedupeKey: `so:${so.id}:report-due` });
    }
    return { alreadyRecorded: false };
  });
}

/**
 * Seller submits formal delivery evidence (files + carrier reference). Supporting evidence only:
 * alone it proves nothing. With an authoritative delivery event and on time (≤ 24h after the event)
 * the buyer's window opens; late or without an event → Operations exception, no buyer timeout.
 * The first submission time is kept (re-submitting never restarts or shortens any clock).
 */
export async function submitDeliveryEvidence(actor: Actor, soId: string, input: { carrierReference: string; note?: string }, files: { data: Buffer; name: string }[]) {
  if (!files.length) throw validation('ارفع دليل التسليم (إيصال الاستلام / إثبات شركة الشحن)');
  if (files.length > 5) throw validation('الحد الأقصى 5 ملفات');
  const ref = input.carrierReference?.trim();
  if (!ref) throw validation('اكتب مرجع شركة الشحن');
  return db.transaction(async (tx) => {
    const so = await lockSellerOrderForSeller(tx, actor, soId);
    if (so.status !== 'SHIPPED' && so.status !== 'AWAITING_BUYER_RESPONSE') throw invalidState('دليل التسليم يتبعت بعد شحن الطلب');
    for (const f of files) {
      const stored = await storeUpload(tx, actor, { purpose: 'SHIPPING_WAYBILL', data: f.data, originalName: f.name });
      await tx.insert(deliveryEvidence).values({ sellerOrderId: so.id, fileId: stored.id, carrierReference: ref, note: input.note?.trim() || null, submittedBy: actor.userId! });
    }
    if (so.sellerDeliveryConfirmedAt || so.status !== 'SHIPPED') {
      await audit(tx, actor, { action: 'seller_order.delivery_evidence_added', entityType: 'seller_order', entityId: so.id, newValues: { files: files.length } });
      return { firstSubmission: false };
    }
    const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now() as now`)).rows;
    const nowDate = new Date(now);
    const late = !!so.deliveryReportDueAt && nowDate > so.deliveryReportDueAt;
    await tx.update(sellerOrders).set({ sellerDeliveryConfirmedAt: nowDate, sellerDeliveryLate: late }).where(eq(sellerOrders.id, so.id));
    await audit(tx, actor, { action: 'seller_order.delivery_evidence_submitted', entityType: 'seller_order', entityId: so.id, newValues: { late, hasAuthoritativeEvent: !!so.deliveryEventAt, files: files.length, carrierReference: ref } });
    const fresh = { ...so, sellerDeliveryConfirmedAt: nowDate, sellerDeliveryLate: late };
    if (late) await raiseDeliveryException(tx, actor, fresh, 'SELLER_EVIDENCE_LATE', 'دليل التسليم وصل بعد مهلة الـ24 ساعة');
    else if (so.deliveryEventAt) await establishDeliveryTx(tx, actor, fresh, 'AUTO_EVENT_AND_TIMELY_EVIDENCE');
    return { firstSubmission: true, late, buyerWindowOpened: !late && !!so.deliveryEventAt };
  });
}

/** Mark a sub-order for Operations review (no buyer timeout, no entitlement, no money). Idempotent. */
export async function raiseDeliveryException(tx: DbOrTx, actor: Actor, so: Pick<SellerOrder, 'id' | 'deliveryExceptionCode'>, code: string, note: string) {
  if (so.deliveryExceptionCode === code) return;
  await tx.update(sellerOrders).set({ deliveryExceptionCode: code, deliveryExceptionAt: new Date() }).where(eq(sellerOrders.id, so.id));
  await tx.insert(riskFlags).values({ entityType: 'seller_order', entityId: so.id, code, severity: 'HIGH', note, createdBy: actor.userId ?? null });
  await audit(tx, actor, { action: 'seller_order.delivery_exception', entityType: 'seller_order', entityId: so.id, newValues: { code }, reason: note });
}

/**
 * Operations review of a delivery exception. ESTABLISH opens the buyer window only when an
 * authoritative delivery event AND seller evidence exist (late evidence accepted with a reason).
 * Never impersonates the buyer and never moves money.
 */
export async function reviewDeliveryException(actor: Actor, soId: string, decision: 'ESTABLISH' | 'KEEP_OPEN', reason: string) {
  requirePermission(actor, 'delivery.verify');
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    await assertNotSelfDealing(tx, actor, so.sellerId);
    if (decision === 'KEEP_OPEN') {
      await audit(tx, actor, { action: 'seller_order.delivery_exception_reviewed', entityType: 'seller_order', entityId: so.id, newValues: { decision }, reason: why });
      return { established: false };
    }
    if (!so.deliveryEventAt) throw invalidState('لازم يتسجل حدث تسليم موثّق من شركة الشحن الأول — كلام البائع لوحده مش دليل');
    const [ev] = await tx.select({ id: deliveryEvidence.id }).from(deliveryEvidence).where(eq(deliveryEvidence.sellerOrderId, so.id)).limit(1);
    if (!ev) throw invalidState('مفيش دليل تسليم من البائع');
    const [openDispute] = await tx.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.sellerOrderId, so.id), inArray(disputes.status, [...OPEN_DISPUTE])));
    if (openDispute) throw invalidState('فيه نزاع مفتوح على الطلب. القرار من صفحة النزاع');
    await tx.update(riskFlags).set({ status: 'RESOLVED', resolvedBy: actor.userId, resolvedAt: new Date() }).where(and(eq(riskFlags.entityType, 'seller_order'), eq(riskFlags.entityId, so.id), eq(riskFlags.status, 'OPEN')));
    const ok = await establishDeliveryTx(tx, actor, so, 'OPERATIONS_REVIEW');
    await audit(tx, actor, { action: 'seller_order.delivery_exception_reviewed', entityType: 'seller_order', entityId: so.id, newValues: { decision, established: ok }, reason: why });
    return { established: ok };
  });
}

/* ═════════════ Admin seller release (the ONLY path pending → available) ═════════════ */

/**
 * Admin manual seller release: explicit, permissioned (finance.release), fresh 2FA, kill-switch aware,
 * blocked by every hold, executed under ONE operation-specific approval for the exact amounts shown.
 * Idempotent: a second click returns alreadyReleased and posts nothing. Completes the sub-order when
 * all completion guards pass. Never creates a withdrawal or an external payout.
 */
export async function releaseSellerOrder(actor: Actor, soId: string, input: { expectedSellerAmount: number; reason: string }) {
  requirePermission(actor, 'finance.release');
  requireStepUp(actor);
  const why = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    if (so.fundsReleasedAt) return { alreadyReleased: true, completed: so.status === 'COMPLETED' };
    await assertNotPaused(tx, 'killswitch.sellerRelease');
    await assertNotSelfDealing(tx, actor, so.sellerId);
    if (so.status !== 'DELIVERED' || !so.receiptBasis) throw invalidState('الإتاحة ممكنة بعد تأكيد الاستلام من المشتري أو انتهاء مهلته بدون اعتراض فقط');
    const blockers = await releaseBlockers(tx, so);
    if (blockers.length) throw invalidState(`لا يمكن الإتاحة الآن: ${blockers.join('، ')}`);
    const drift = await sellerLedgerDrift(tx, so.sellerId);
    if (drift) throw invalidState('أرصدة البائع المخزنة لا تطابق دفتر الأستاذ — تم إيقاف الإتاحة وإبلاغ المالية');
    const pos = await sellerOrderPosition(tx, so);
    if (pos.pending !== input.expectedSellerAmount) throw invalidState('المبلغ المعلق تغيّر بعد فتح الصفحة. راجع المبلغ واعتمد تاني');
    if (pos.pending <= 0 && pos.deferredCommission <= 0) throw invalidState('لا يوجد رصيد معلق لإتاحته (الطلب مسترد بالكامل)');
    const approval = await grantApproval(tx, actor, {
      action: 'SELLER_RELEASE',
      entityType: 'seller_order',
      entityId: so.id,
      amount: pos.pending + pos.deferredCommission,
      economicVersion: `pending:${pos.pending}:fee:${pos.deferredCommission}:refunded:${so.refundedTotal}:basis:${so.receiptBasis}`,
      reason: why,
      idempotencyKey: `release:${so.id}`,
    });
    await releaseSellerOrderFunds(tx, actor, so, approval.id);
    // Completion guards: receipt basis + committed release + nothing unresolved.
    const after = await releaseBlockers(tx, so);
    let completed = false;
    if (!after.length) {
      await move(tx, actor, so, 'COMPLETED', { completedAt: new Date() });
      await syncParentStatus(tx, actor, so.orderId);
      completed = true;
    }
    await audit(tx, actor, {
      action: 'seller_order.funds_released',
      entityType: 'seller_order',
      entityId: so.id,
      newValues: { approvalId: approval.id, sellerAmount: pos.pending, feeRecognized: pos.deferredCommission, receiptBasis: so.receiptBasis, completed },
      reason: why,
    });
    const [seller] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
    const { label } = await orderNumber(tx, so);
    await notify(tx, { event: 'SELLER_FUNDS_RELEASED', userIds: [seller.ownerUserId], vars: { order: label, amount: formatEGP(pos.pending) }, link: '/seller/finance', dedupeKey: `so:${so.id}:released` });
    return { alreadyReleased: false, completed, approvalId: approval.id };
  });
}

/** True when the seller's stored balances disagree with the journal (blocks release/payout; never auto-fixed). */
export async function sellerLedgerDrift(tx: DbOrTx, sellerId: string): Promise<boolean> {
  const r = await tx.execute<{ n: string }>(sql`select count(*)::text n from ledger_accounts a
    where a.seller_id = ${sellerId} and a.balance <> (select coalesce(sum(l.credit - l.debit), 0) from journal_lines l where l.account_id = a.id)`);
  return Number(r.rows[0].n) > 0;
}

/** Operations protective hold. Placing it needs no financial approval; lifting it is an authorized action. */
export async function setFinancialHold(actor: Actor, soId: string, hold: boolean, reason: string) {
  requirePermission(actor, 'orders.manage');
  if (!hold) requireStepUp(actor);
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    if (hold && so.fundsReleasedAt) throw invalidState('تمت إتاحة الأموال بالفعل. استخدم تسوية مالية بدلاً من ذلك');
    await assertNotSelfDealing(tx, actor, so.sellerId);
    await tx.update(sellerOrders).set({ financialHold: hold, holdReason: hold ? why : null }).where(eq(sellerOrders.id, so.id));
    await audit(tx, actor, { action: hold ? 'seller_order.hold_placed' : 'seller_order.hold_released', entityType: 'seller_order', entityId: so.id, reason: why });
  });
}

/* ═════════════ Cancellation (strictly before SHIPPED) ═════════════ */

async function cancelSellerOrderTx(tx: DbOrTx, actor: Actor, so: SellerOrder, code: CancellationReasonCode, note: string) {
  if (so.status === 'CANCELLED') return { alreadyCancelled: true };
  if (!SELLER_ORDER_CANCELLABLE.includes(so.status)) throw invalidState('مينفعش إلغاء الطلب بعد الشحن. استخدم الإرجاع أو بلّغ عن مشكلة');
  await move(tx, actor, so, 'CANCELLED', { cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: note, cancelReasonCode: code, cancellationRequestedAt: null }, `${code}: ${note}`);
  await tx
    .update(cancellationRequests)
    .set({ status: 'ACCEPTED', decidedBy: actor.userId, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(cancellationRequests.sellerOrderId, so.id), eq(cancellationRequests.status, 'PENDING')));
  const items = await tx.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
  for (const it of items) await restock(tx, it.variantId, it.quantity, `cancel:${so.id}`);
  const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
  // Paid → a refund OBLIGATION (request) for everything the buyer paid for this sub-order. No money
  // moves until an Admin approves it; the order being CANCELLED never means "refund paid".
  const { requestRefundTx, refundableOf } = await import('@/server/modules/finance/refunds');
  const left = await refundableOf(tx, so);
  if (left.total > 0) {
    await requestRefundTx(tx, actor, {
      sellerOrderId: so.id,
      sourceType: 'ORDER_CANCELLATION',
      sourceId: so.id,
      items: left.items.filter((i) => i.refundableQty > 0).map((i) => ({ orderItemId: i.item.id, quantity: i.refundableQty })),
      shippingAmount: left.shipping,
      buyerFeeRefund: left.buyerFee,
      sellerFeeReversal: left.sellerFee,
      reason: `إلغاء قبل الشحن (${code}): ${note}`,
    });
  }
  await syncParentStatus(tx, actor, so.orderId);
  await audit(tx, actor, { action: 'seller_order.cancelled', entityType: 'seller_order', entityId: so.id, newValues: { code }, reason: note });
  const [store] = await tx.select({ name: stores.name, ownerUserId: sellers.ownerUserId }).from(stores).innerJoin(sellers, eq(sellers.id, stores.sellerId)).where(eq(stores.sellerId, so.sellerId));
  await notify(tx, { event: 'SELLER_ORDER_CANCELLED', userIds: [order.customerId, store?.ownerUserId], vars: { order: `${order.number}-${so.suffix}`, store: store?.name, reason: note }, link: `/account/orders/${order.id}`, dedupeKey: `so:${so.id}:cancelled` });
  return { alreadyCancelled: false };
}

/**
 * Cancel a paid sub-order before shipment — seller (cannot fulfil / out of stock) or Operations (risk,
 * duplicate…). Serialized with shipment on the sub-order row lock: only one legal outcome commits.
 */
export async function cancelSellerOrder(actor: Actor, soId: string, reason: string, code?: CancellationReasonCode) {
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    let so: SellerOrder;
    if (actor.type === 'SELLER') so = await lockSellerOrderForSeller(tx, actor, soId);
    else {
      requirePermission(actor, 'orders.manage');
      const [row] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
      if (!row) throw notFound('الطلب');
      so = row;
      await assertNotSelfDealing(tx, actor, so.sellerId);
    }
    const c = code ?? (actor.type === 'SELLER' ? 'SELLER_UNABLE_TO_FULFIL' : 'ADMIN_OPERATIONAL');
    if (!CANCELLATION_REASON_CODES.includes(c)) throw validation('سبب الإلغاء غير صالح');
    return cancelSellerOrderTx(tx, actor, so, c, why);
  });
}

/**
 * Buyer cancellation of a PAID sub-order before shipment. Not yet confirmed by the seller → cancelled
 * at once. Already being prepared → a pending request that blocks shipment until the seller (or
 * Operations) resolves it. Shipped → refused (use problem report / return).
 */
export async function requestCancellation(actor: Actor, soId: string, note: string) {
  const userId = requireUser(actor);
  const why = requireReason(note);
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
    if (order.customerId !== userId) throw forbidden();
    if (so.status === 'CANCELLED') return { status: 'CANCELLED' as const };
    if (so.status === 'PAID') {
      await cancelSellerOrderTx(tx, actor, so, 'BUYER_REQUEST', why);
      return { status: 'CANCELLED' as const };
    }
    if (!['PAYMENT_UNDER_REVIEW', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(so.status)) {
      throw invalidState('مينفعش تلغي بعد ما الطلب اتشحن. تقدر تبلّغ عن مشكلة أو تطلب إرجاع بعد الاستلام');
    }
    const [open] = await tx.select().from(cancellationRequests).where(and(eq(cancellationRequests.sellerOrderId, so.id), eq(cancellationRequests.status, 'PENDING')));
    if (open) return { status: 'PENDING' as const, requestId: open.id };
    const [req] = await tx.insert(cancellationRequests).values({ sellerOrderId: so.id, requestedBy: userId, reasonCode: 'BUYER_REQUEST', note: why }).returning();
    await tx.update(sellerOrders).set({ cancellationRequestedAt: new Date() }).where(eq(sellerOrders.id, so.id));
    await audit(tx, actor, { action: 'seller_order.cancellation_requested', entityType: 'seller_order', entityId: so.id, newValues: { requestId: req.id }, reason: why });
    const [seller] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
    await notify(tx, { event: 'CANCELLATION_REQUESTED', userIds: [seller.ownerUserId], vars: { order: `${order.number}-${so.suffix}` }, link: `/seller/orders/${so.id}`, dedupeKey: `cancel-req:${req.id}` });
    return { status: 'PENDING' as const, requestId: req.id };
  });
}

/** After payment confirmation: honour a buyer cancellation requested while the proof was under review. */
export async function applyPendingBuyerCancellation(tx: DbOrTx, actor: Actor, soId: string) {
  const [req] = await tx.select().from(cancellationRequests).where(and(eq(cancellationRequests.sellerOrderId, soId), eq(cancellationRequests.status, 'PENDING')));
  if (!req) return false;
  const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
  if (so.status !== 'PAID') return false;
  await cancelSellerOrderTx(tx, actor, so, 'BUYER_REQUEST', req.note ?? 'طلب المشتري الإلغاء أثناء مراجعة الدفع');
  return true;
}

/** Seller accepts a pending buyer cancellation; Operations may accept or reject (with a reason). */
export async function decideCancellationRequest(actor: Actor, requestId: string, accept: boolean, note: string) {
  const why = requireReason(note);
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(cancellationRequests).where(eq(cancellationRequests.id, requestId)).for('update');
    if (!req) throw notFound('طلب الإلغاء');
    let so: SellerOrder;
    if (actor.type === 'SELLER') {
      so = await lockSellerOrderForSeller(tx, actor, req.sellerOrderId);
      if (!accept) throw forbidden('رفض طلب الإلغاء قبل الشحن يتم بمراجعة فريق اضمن فقط');
    } else {
      requirePermission(actor, 'orders.manage');
      [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, req.sellerOrderId)).for('update');
    }
    if (req.status !== 'PENDING') return { status: req.status };
    if (accept) {
      await cancelSellerOrderTx(tx, actor, so, 'BUYER_REQUEST', req.note ?? why);
      return { status: 'ACCEPTED' as const };
    }
    await tx.update(cancellationRequests).set({ status: 'REJECTED', decidedBy: actor.userId, decidedAt: new Date(), decisionNote: why }).where(eq(cancellationRequests.id, req.id));
    await tx.update(sellerOrders).set({ cancellationRequestedAt: null }).where(eq(sellerOrders.id, so.id));
    await audit(tx, actor, { action: 'seller_order.cancellation_rejected', entityType: 'seller_order', entityId: so.id, reason: why });
    return { status: 'REJECTED' as const };
  });
}

/* ═════════════ Shipment exceptions ═════════════ */

export async function recordShipmentException(actor: Actor, soId: string, code: ShipmentExceptionCode, note: string) {
  const why = requireReason(note);
  if (!SHIPMENT_EXCEPTION_CODES.includes(code)) throw validation('نوع المشكلة غير صالح');
  return db.transaction(async (tx) => {
    let so: SellerOrder;
    if (actor.type === 'SELLER') so = await lockSellerOrderForSeller(tx, actor, soId);
    else {
      requirePermission(actor, 'delivery.verify');
      [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
      if (!so) throw notFound('الطلب');
    }
    if (so.status !== 'SHIPPED' && so.status !== 'AWAITING_BUYER_RESPONSE') throw invalidState('مشاكل الشحن تتسجل للطلبات المشحونة فقط');
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (!s) throw notFound('الشحنة');
    if (s.status !== 'EXCEPTION') {
      await transition(tx, actor, shipmentMachine, s.id, s.status, 'EXCEPTION', `${code}: ${why}`);
    }
    await tx.update(shipments).set({ status: 'EXCEPTION', exceptionCode: code, exceptionNote: why, exceptionAt: new Date() }).where(eq(shipments.id, s.id));
    await tx.insert(trackingEvents).values({ shipmentId: s.id, status: 'EXCEPTION', description: `${code}: ${why}`.slice(0, 300), actorUserId: actor.userId });
    // Failed / refused / returned / lost / damaged is never a successful delivery: hold the path.
    await raiseDeliveryException(tx, actor, so, `SHIPMENT_${code}`, why);
    const { label, customerId } = await orderNumber(tx, so);
    await notify(tx, { event: 'SHIPMENT_EXCEPTION', userIds: [customerId], vars: { order: label }, link: `/account/orders/${so.orderId}`, dedupeKey: `so:${so.id}:exc:${code}` });
    await audit(tx, actor, { action: 'shipment.exception', entityType: 'seller_order', entityId: so.id, newValues: { code }, reason: why });
  });
}

/**
 * Operations resolves a shipment exception: RESHIP (back in transit) or FAILED (returned to seller /
 * lost → DELIVERY_FAILED + full refund request). Never treated as a delivery; never releases money.
 */
export async function resolveShipmentException(actor: Actor, soId: string, outcome: 'RESHIP' | 'RETURNED_TO_SELLER' | 'LOST', reason: string) {
  requirePermission(actor, 'delivery.verify');
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, soId)).for('update');
    if (!so) throw notFound('الطلب');
    await assertNotSelfDealing(tx, actor, so.sellerId);
    const [s] = await tx.select().from(shipments).where(eq(shipments.sellerOrderId, so.id)).for('update');
    if (!s || (s.status !== 'EXCEPTION' && s.status !== 'FAILED' && s.status !== 'RETURNED_TO_SELLER')) throw invalidState('لا توجد مشكلة شحن مفتوحة');
    if (outcome === 'RESHIP') {
      await transition(tx, actor, shipmentMachine, s.id, s.status, 'SHIPPED', why);
      await tx.update(shipments).set({ status: 'SHIPPED', exceptionCode: null }).where(eq(shipments.id, s.id));
      await tx.update(sellerOrders).set({ deliveryExceptionCode: null, deliveryExceptionAt: null }).where(eq(sellerOrders.id, so.id));
    } else {
      const to = outcome === 'LOST' ? 'LOST' : 'RETURNED_TO_SELLER';
      if (s.status !== to) {
        await transition(tx, actor, shipmentMachine, s.id, s.status, to, why);
        await tx.update(shipments).set({ status: to }).where(eq(shipments.id, s.id));
      }
      if (so.status === 'SHIPPED' || so.status === 'AWAITING_BUYER_RESPONSE') {
        await move(tx, actor, so, 'DELIVERY_FAILED', {}, why);
        const { requestRefundTx, refundableOf } = await import('@/server/modules/finance/refunds');
        const left = await refundableOf(tx, so);
        if (left.total > 0) {
          await requestRefundTx(tx, actor, {
            sellerOrderId: so.id,
            sourceType: 'DELIVERY_FAILURE',
            sourceId: so.id,
            items: left.items.filter((i) => i.refundableQty > 0).map((i) => ({ orderItemId: i.item.id, quantity: i.refundableQty })),
            shippingAmount: left.shipping,
            buyerFeeRefund: left.buyerFee,
            sellerFeeReversal: left.sellerFee,
            reason: `فشل التوصيل (${to}): ${why}`,
          });
        }
        await syncParentStatus(tx, actor, so.orderId);
      }
    }
    await tx.update(riskFlags).set({ status: 'RESOLVED', resolvedBy: actor.userId, resolvedAt: new Date() }).where(and(eq(riskFlags.entityType, 'seller_order'), eq(riskFlags.entityId, so.id), eq(riskFlags.status, 'OPEN')));
    await audit(tx, actor, { action: 'shipment.exception_resolved', entityType: 'seller_order', entityId: so.id, newValues: { outcome }, reason: why });
  });
}

/* ═════════════ Scheduled operations (idempotent; never move money) ═════════════ */

/**
 * Buyer response window expired with no eligible objection → TIMEOUT_ENTITLEMENT (recorded once, at the
 * real processing time — never backdated). Funds stay pending. Anything doubtful fails closed into
 * an Operations exception instead.
 */
export async function processBuyerResponseTimeouts() {
  const due = await db
    .select({ id: sellerOrders.id })
    .from(sellerOrders)
    .where(and(eq(sellerOrders.status, 'AWAITING_BUYER_RESPONSE'), sql`${sellerOrders.buyerResponseDueAt} <= now()`));
  let n = 0;
  for (const r of due) {
    await db.transaction(async (tx) => {
      const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.id)).for('update');
      if (!so || so.status !== 'AWAITING_BUYER_RESPONSE' || !so.buyerResponseDueAt) return;
      const [{ expired }] = (await tx.execute<{ expired: boolean }>(sql`select now() >= ${so.buyerResponseDueAt.toISOString()}::timestamptz as expired`)).rows;
      if (!expired) return;
      const blockers = await releaseBlockers(tx, so);
      if (!so.deliveryEstablishedAt || !so.deliveryEventAt) blockers.push('أساس التسليم غير مكتمل');
      if (blockers.length) {
        await raiseDeliveryException(tx, SYSTEM_ACTOR, so, 'TIMEOUT_BLOCKED', blockers.join('، '));
        return;
      }
      const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now() as now`)).rows;
      await move(tx, SYSTEM_ACTOR, so, 'DELIVERED', {
        receiptBasis: 'TIMEOUT_ENTITLEMENT',
        entitledAt: new Date(now),
        deliveredAt: so.deliveryEventAt,
      }, 'انتهت مهلة المشتري (24 ساعة) بدون اعتراض');
      await audit(tx, SYSTEM_ACTOR, { action: 'seller_order.timeout_entitlement', entityType: 'seller_order', entityId: so.id, newValues: { buyerResponseDueAt: so.buyerResponseDueAt.toISOString(), released: false } });
      const { label, customerId } = await orderNumber(tx, so);
      const [seller] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
      await notify(tx, { event: 'TIMEOUT_ENTITLEMENT', userIds: [customerId, seller.ownerUserId], vars: { order: label }, link: `/account/orders/${so.orderId}`, dedupeKey: `so:${so.id}:timeout` });
      n++;
    });
  }
  return n;
}

/** Seller missed the 24h evidence deadline → Operations exception. Never starts a buyer timeout. */
export async function flagMissingDeliveryEvidence() {
  const rows = await db
    .select({ id: sellerOrders.id })
    .from(sellerOrders)
    .where(and(eq(sellerOrders.status, 'SHIPPED'), isNull(sellerOrders.sellerDeliveryConfirmedAt), sql`${sellerOrders.deliveryReportDueAt} < now()`, isNull(sellerOrders.deliveryExceptionCode)));
  for (const r of rows) {
    await db.transaction(async (tx) => {
      const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.id)).for('update');
      if (so.status !== 'SHIPPED' || so.sellerDeliveryConfirmedAt || so.deliveryExceptionCode) return;
      await raiseDeliveryException(tx, SYSTEM_ACTOR, so, 'SELLER_EVIDENCE_MISSING', 'البائع لم يرسل دليل التسليم خلال 24 ساعة من حدث التسليم');
    });
  }
  return rows.length;
}

/** Shipped long past the ETA without any authoritative delivery event → Operations exception. */
export async function flagMissingDeliveryEvents() {
  const grace = await getSetting('delivery.eventMissingGraceDays');
  const rows = await db.execute<{ id: string }>(sql`select id from seller_orders where status = 'SHIPPED' and delivery_event_at is null and delivery_exception_code is null
    and shipped_at + make_interval(days => coalesce(shipping_eta_max_days, 7) + ${grace}) < now()`);
  for (const r of rows.rows) {
    await db.transaction(async (tx) => {
      const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.id)).for('update');
      if (so.status !== 'SHIPPED' || so.deliveryEventAt || so.deliveryExceptionCode) return;
      await raiseDeliveryException(tx, SYSTEM_ACTOR, so, 'DELIVERY_EVENT_MISSING', 'لا يوجد حدث تسليم موثق بعد موعد التوصيل المتوقع');
    });
  }
  return rows.rows.length;
}

/** SLA flags: seller response overdue, shipment overdue. Notifications only; never cancels or moves money. */
export async function flagSellerSlaBreaches() {
  let n = 0;
  const late = await db.execute<{ id: string; kind: string }>(sql`
    select id, 'RESPONSE' kind from seller_orders where status = 'PAID' and seller_response_due_at < now() and seller_response_overdue_at is null
    union all select id, 'SHIPMENT' from seller_orders where status in ('PAID','SELLER_CONFIRMED','PROCESSING','READY_TO_SHIP') and ship_by_due_at < now() and shipment_overdue_at is null`);
  for (const r of late.rows) {
    await db.transaction(async (tx) => {
      const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, r.id)).for('update');
      const col = r.kind === 'RESPONSE' ? { sellerResponseOverdueAt: new Date() } : { shipmentOverdueAt: new Date() };
      await tx.update(sellerOrders).set(col).where(eq(sellerOrders.id, so.id));
      const code = r.kind === 'RESPONSE' ? 'SELLER_RESPONSE_OVERDUE' : 'SHIPMENT_OVERDUE';
      await tx.insert(riskFlags).values({ entityType: 'seller_order', entityId: so.id, code, severity: 'MEDIUM', note: code });
      const [seller] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
      const { label, customerId } = await orderNumber(tx, so);
      await notify(tx, { event: r.kind === 'RESPONSE' ? 'SELLER_RESPONSE_OVERDUE' : 'SHIPMENT_OVERDUE', userIds: [seller.ownerUserId, customerId], vars: { order: label }, link: `/seller/orders/${so.id}`, dedupeKey: `so:${so.id}:${code}` });
      await audit(tx, SYSTEM_ACTOR, { action: `seller_order.${code.toLowerCase()}`, entityType: 'seller_order', entityId: so.id });
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
  const evidence = await db.select().from(deliveryEvidence).where(eq(deliveryEvidence.sellerOrderId, so.id)).orderBy(asc(deliveryEvidence.createdAt));
  const cancellations = await db.select().from(cancellationRequests).where(eq(cancellationRequests.sellerOrderId, so.id)).orderBy(desc(cancellationRequests.createdAt));
  const soRefunds = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id)).orderBy(desc(refunds.createdAt));
  return { so, order, items, shipment: shipment ?? null, documents: docs, tracking: events, deliveryEvidence: evidence, cancellations, refunds: soRefunds };
}

export function canAdminSeeShipping(actor: Actor) {
  return hasPermission(actor, 'shipping.view') || hasPermission(actor, 'orders.view');
}
