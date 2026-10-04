import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { dealMachine, orderMachine, paymentMachine, sellerOrderMachine } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { parseEgp } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import {
  externalDeals,
  inventoryReservations,
  orderItems,
  orders,
  paymentDestinations,
  paymentMethods,
  paymentSubmissions,
  payments,
  sellerOrders,
  sellers,
  users,
} from '@/server/db/schema';
import { commitReservation } from '@/server/modules/catalog/inventory';
import { postSellerOrderPayment } from '@/server/modules/finance/postings';
import { postEntry } from '@/server/modules/finance/ledger';
import { notify } from '@/server/modules/notifications/notify';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason, transition } from '../_shared';
import { formatEGP } from '@/lib/format';

export type Payment = typeof payments.$inferSelect;

export const proofSchema = z.object({
  reference: z.string().trim().max(100).optional().default(''),
  claimedAmount: z.string().trim().min(1, 'اكتب المبلغ المحوّل'),
  payerName: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
  clientKey: z.string().min(8).max(100),
});

/**
 * Customer uploads payment proof. This NEVER marks anything paid — it only queues the payment
 * for verification by authorized EDMN staff.
 * Idempotent per clientKey; a second, different submission while one is under review is refused.
 */
export async function submitProof(actor: Actor, paymentId: string, input: z.input<typeof proofSchema>, proof: { data: Buffer; name: string } | null) {
  const userId = requireUser(actor);
  const d = parse(proofSchema, input);
  let claimed: number;
  try {
    claimed = parseEgp(d.claimedAmount);
  } catch {
    throw validation('المبلغ غير صحيح', { claimedAmount: ['المبلغ غير صحيح'] });
  }
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p) throw notFound('عملية الدفع');
    if (p.payerUserId !== userId) throw forbidden();
    const [same] = await tx.select().from(paymentSubmissions).where(and(eq(paymentSubmissions.paymentId, p.id), eq(paymentSubmissions.clientKey, d.clientKey)));
    if (same) return { submission: same, created: false };
    if (p.status === 'PAYMENT_SUBMITTED' || p.status === 'UNDER_REVIEW') throw invalidState('تم استلام إثبات دفع لهذا الطلب وهو قيد المراجعة بالفعل');
    if (p.status !== 'AWAITING_PAYMENT' && p.status !== 'REJECTED') throw invalidState('لا يمكن رفع إثبات دفع لهذه العملية');
    if (p.dueAt < new Date() && p.status === 'AWAITING_PAYMENT') throw invalidState('انتهت مهلة الدفع لهذا الطلب');
    if (!proof) throw validation('ارفع صورة أو ملف إثبات الدفع', { proof: ['مطلوب'] });
    const file = await storeUpload(tx, actor, { purpose: 'PAYMENT_PROOF', data: proof.data, originalName: proof.name });
    const [sub] = await tx
      .insert(paymentSubmissions)
      .values({
        paymentId: p.id,
        submittedBy: userId,
        proofFileId: file.id,
        reference: d.reference || null,
        claimedAmount: claimed,
        payerName: d.payerName || null,
        notes: d.notes || null,
        clientKey: d.clientKey,
      })
      .returning();
    await transition(tx, actor, paymentMachine, p.id, p.status, 'PAYMENT_SUBMITTED');
    await tx.update(payments).set({ status: 'PAYMENT_SUBMITTED' }).where(eq(payments.id, p.id));
    if (p.orderId) {
      await moveOrderTo(tx, actor, p.orderId, 'PAYMENT_UNDER_REVIEW');
      const [o] = await tx.select({ number: orders.number }).from(orders).where(eq(orders.id, p.orderId));
      await notify(tx, { event: 'PAYMENT_SUBMITTED', userIds: [userId], vars: { order: o.number }, link: `/account/orders/${p.orderId}` });
    } else if (p.dealId) {
      const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, p.dealId)).for('update');
      await transition(tx, actor, dealMachine, deal.id, deal.status, 'PAYMENT_UNDER_REVIEW');
      await tx.update(externalDeals).set({ status: 'PAYMENT_UNDER_REVIEW' }).where(eq(externalDeals.id, deal.id));
    }
    await audit(tx, actor, { action: 'payment.proof_submitted', entityType: 'payment', entityId: p.id, newValues: { submissionId: sub.id, claimedAmount: claimed, reference: d.reference } });
    return { submission: sub, created: true };
  });
}

async function moveOrderTo(tx: DbOrTx, actor: Actor, orderId: string, to: 'PAYMENT_UNDER_REVIEW' | 'PENDING_PAYMENT' | 'PAID', reason?: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (o.status !== to) {
    await transition(tx, actor, orderMachine, o.id, o.status, to, reason);
    await tx.update(orders).set({ status: to, ...(to === 'PAID' ? { paidAt: new Date() } : {}) }).where(eq(orders.id, o.id));
  }
  const sos = await tx.select().from(sellerOrders).where(and(eq(sellerOrders.orderId, orderId), ne(sellerOrders.status, 'CANCELLED'))).for('update');
  for (const so of sos) {
    if (so.status === to) continue;
    await transition(tx, actor, sellerOrderMachine, so.id, so.status, to, reason);
    await tx.update(sellerOrders).set({ status: to, ...(to === 'PAID' ? { paidAt: new Date() } : {}) }).where(eq(sellerOrders.id, so.id));
  }
  return { order: o, sellerOrders: sos };
}

export async function startReview(actor: Actor, paymentId: string) {
  requirePermission(actor, 'payments.verify');
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p) throw notFound('عملية الدفع');
    if (p.status !== 'PAYMENT_SUBMITTED') return;
    await transition(tx, actor, paymentMachine, p.id, p.status, 'UNDER_REVIEW');
    await tx.update(payments).set({ status: 'UNDER_REVIEW' }).where(eq(payments.id, p.id));
    await audit(tx, actor, { action: 'payment.review_started', entityType: 'payment', entityId: p.id });
  });
}

/**
 * ConfirmPayment — authorization-protected, transactional, idempotent, audited.
 * The payment row is locked FOR UPDATE; a double-click / retry finds it CONFIRMED and returns
 * without re-posting. Ledger entries additionally carry unique idempotency keys.
 */
export async function confirmPayment(actor: Actor, paymentId: string, submissionId: string, note?: string | null) {
  requirePermission(actor, 'payments.verify');
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p) throw notFound('عملية الدفع');
    if (p.status === 'CONFIRMED') return { alreadyConfirmed: true };
    if (p.status !== 'PAYMENT_SUBMITTED' && p.status !== 'UNDER_REVIEW') throw invalidState('لا يوجد إثبات دفع قيد المراجعة لهذه العملية');
    const [sub] = await tx.select().from(paymentSubmissions).where(eq(paymentSubmissions.id, submissionId)).for('update');
    if (!sub || sub.paymentId !== p.id || sub.status !== 'SUBMITTED') throw invalidState('إثبات الدفع المحدد غير صالح للتأكيد');

    await transition(tx, actor, paymentMachine, p.id, p.status, 'CONFIRMED', note);
    await tx.update(payments).set({ status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: actor.userId, confirmedAmount: p.amountDue }).where(eq(payments.id, p.id));
    await tx.update(paymentSubmissions).set({ status: 'ACCEPTED', reviewedBy: actor.userId, reviewedAt: new Date(), reviewReason: note ?? null }).where(eq(paymentSubmissions.id, sub.id));
    await confirmPaymentInternal(tx, actor, p);
    await audit(tx, actor, {
      action: 'payment.confirmed',
      entityType: 'payment',
      entityId: p.id,
      oldValues: { status: p.status },
      newValues: { status: 'CONFIRMED', amount: p.amountDue, claimedAmount: sub.claimedAmount, submissionId: sub.id },
      reason: note ?? null,
    });
    return { alreadyConfirmed: false };
  });
}

/** Shared post-confirmation effects (manual today; PSP webhook tomorrow). */
export async function confirmPaymentInternal(tx: DbOrTx, actor: Actor, p: Payment) {
  if (p.orderId) {
    const { order, sellerOrders: sos } = await moveOrderTo(tx, actor, p.orderId, 'PAID');
    for (const so of sos) {
      const items = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
      for (const it of items) {
        const [r] = await tx.select().from(inventoryReservations).where(eq(inventoryReservations.orderItemId, it.id));
        if (!r || r.status === 'RELEASED') {
          // Reservation was released (should not happen for submitted proofs) — fail loudly rather than oversell.
          throw invalidState('انتهى حجز المخزون لهذا الطلب. راجع توفر المنتجات قبل التأكيد');
        }
        await commitReservation(tx, it.id);
      }
      await postSellerOrderPayment(tx, actor, p.id, so);
      const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
      await notify(tx, { event: 'SELLER_NEW_ORDER', userIds: [s.ownerUserId], vars: { order: `${order.number}-${so.suffix}`, amount: formatEGP(so.grossTotal) }, link: `/seller/orders/${so.id}` });
    }
    await notify(tx, { event: 'PAYMENT_CONFIRMED', userIds: [p.payerUserId], vars: { order: order.number }, link: `/account/orders/${order.id}` });
  } else if (p.dealId) {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, p.dealId)).for('update');
    await transition(tx, actor, dealMachine, deal.id, deal.status, 'ACTIVE');
    await tx.update(externalDeals).set({ status: 'ACTIVE', activatedAt: new Date() }).where(eq(externalDeals.id, deal.id));
    await postEntry(tx, actor, {
      entryType: 'DEAL_PAYMENT',
      sourceType: 'external_deal',
      sourceId: deal.id,
      idempotencyKey: `payment:${p.id}:deal:${deal.id}`,
      description: `تأكيد دفع الصفقة المحمية #${deal.number}`,
      lines: [
        { account: { code: 'PLATFORM_CASH' }, debit: p.amountDue },
        { account: { code: 'DEAL_FUNDS_HELD' }, credit: p.amountDue },
      ],
    });
    await notify(tx, { event: 'EXTERNAL_DEAL_ACTIVE', userIds: [deal.buyerId, deal.sellerUserId], vars: { deal: deal.number }, link: `/account/deals/${deal.id}` });
  }
}

/** RejectPayment / RequestNewProof — customer may resubmit; the payment window is extended by 24h. */
export async function rejectPayment(actor: Actor, paymentId: string, submissionId: string, reason: string, requestNewProof = false) {
  requirePermission(actor, 'payments.verify');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p) throw notFound('عملية الدفع');
    if (p.status !== 'PAYMENT_SUBMITTED' && p.status !== 'UNDER_REVIEW') throw invalidState('لا يوجد إثبات دفع قيد المراجعة');
    const [sub] = await tx.select().from(paymentSubmissions).where(eq(paymentSubmissions.id, submissionId)).for('update');
    if (!sub || sub.paymentId !== p.id || sub.status !== 'SUBMITTED') throw invalidState('إثبات الدفع المحدد غير صالح');
    await transition(tx, actor, paymentMachine, p.id, p.status, 'REJECTED', why);
    const newDue = new Date(Math.max(p.dueAt.getTime(), Date.now() + 24 * 3600_000));
    await tx.update(payments).set({ status: 'REJECTED', dueAt: newDue }).where(eq(payments.id, p.id));
    await tx
      .update(paymentSubmissions)
      .set({ status: requestNewProof ? 'NEW_PROOF_REQUESTED' : 'REJECTED', reviewedBy: actor.userId, reviewedAt: new Date(), reviewReason: why })
      .where(eq(paymentSubmissions.id, sub.id));
    let label = '';
    if (p.orderId) {
      const { order, sellerOrders: sos } = await moveOrderTo(tx, actor, p.orderId, 'PENDING_PAYMENT', why);
      await tx.update(orders).set({ paymentDueAt: newDue }).where(eq(orders.id, order.id));
      for (const so of sos) {
        const items = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
        for (const it of items) {
          await tx.update(inventoryReservations).set({ expiresAt: newDue }).where(and(eq(inventoryReservations.orderItemId, it.id), eq(inventoryReservations.status, 'ACTIVE')));
        }
      }
      label = String(order.number);
    } else if (p.dealId) {
      const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, p.dealId)).for('update');
      await transition(tx, actor, dealMachine, deal.id, deal.status, 'PAYMENT_PENDING', why);
      await tx.update(externalDeals).set({ status: 'PAYMENT_PENDING' }).where(eq(externalDeals.id, deal.id));
      label = `صفقة ${deal.number}`;
    }
    await audit(tx, actor, { action: requestNewProof ? 'payment.new_proof_requested' : 'payment.rejected', entityType: 'payment', entityId: p.id, newValues: { submissionId }, reason: why });
    await notify(tx, {
      event: 'PAYMENT_REJECTED',
      userIds: [p.payerUserId],
      vars: { order: label, reason: why },
      link: p.orderId ? `/account/orders/${p.orderId}` : `/account/deals/${p.dealId}`,
    });
  });
}

/* ───────── Admin: payment methods & destinations ───────── */

export const destinationSchema = z.object({
  methodCode: z.enum(['BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH']),
  label: z.string().trim().min(2).max(100),
  details: z.record(z.string(), z.string().trim().max(200)),
  instructionsAr: z.string().trim().max(1000).optional().default(''),
  isEnabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export async function saveDestination(actor: Actor, id: string | null, input: z.input<typeof destinationSchema>, reason: string) {
  requirePermission(actor, 'payments.destinations.manage');
  const why = requireReason(reason);
  const d = parse(destinationSchema, input);
  const required: Record<string, string[]> = {
    BANK_TRANSFER: ['bankName', 'accountName', 'accountNumber'],
    INSTAPAY: ['instapayAddress'],
    VODAFONE_CASH: ['walletNumber'],
  };
  for (const k of required[d.methodCode]) if (!d.details[k]) throw validation(`الحقل ${k} مطلوب`);
  return db.transaction(async (tx) => {
    if (id) {
      const [old] = await tx.select().from(paymentDestinations).where(eq(paymentDestinations.id, id)).for('update');
      if (!old) throw notFound('حساب الاستلام');
      await tx.update(paymentDestinations).set({ ...d, instructionsAr: d.instructionsAr || null }).where(eq(paymentDestinations.id, id));
      await audit(tx, actor, { action: 'payment.destination_updated', entityType: 'payment_destination', entityId: id, oldValues: { label: old.label, details: old.details, isEnabled: old.isEnabled }, newValues: d, reason: why });
      return id;
    }
    const [row] = await tx.insert(paymentDestinations).values({ ...d, instructionsAr: d.instructionsAr || null, createdBy: actor.userId }).returning({ id: paymentDestinations.id });
    await audit(tx, actor, { action: 'payment.destination_created', entityType: 'payment_destination', entityId: row.id, newValues: d, reason: why });
    return row.id;
  });
}

export async function updatePaymentMethod(actor: Actor, code: 'BANK_TRANSFER' | 'INSTAPAY' | 'VODAFONE_CASH', input: { isEnabled: boolean; instructionsAr: string; sortOrder: number }, reason: string) {
  requirePermission(actor, 'payments.destinations.manage');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(paymentMethods).where(eq(paymentMethods.code, code)).for('update');
    await tx.update(paymentMethods).set({ isEnabled: input.isEnabled, instructionsAr: input.instructionsAr || null, sortOrder: input.sortOrder }).where(eq(paymentMethods.code, code));
    await audit(tx, actor, { action: 'payment.method_updated', entityType: 'payment_method', entityId: code, oldValues: old as unknown as Record<string, unknown>, newValues: input, reason: why });
  });
}

export async function enabledPaymentMethods(conn: DbOrTx = db) {
  const methods = await conn.select().from(paymentMethods).where(eq(paymentMethods.isEnabled, true)).orderBy(asc(paymentMethods.sortOrder));
  const dests = methods.length
    ? await conn
        .select()
        .from(paymentDestinations)
        .where(and(inArray(paymentDestinations.methodCode, methods.map((m) => m.code)), eq(paymentDestinations.isEnabled, true)))
        .orderBy(asc(paymentDestinations.sortOrder))
    : [];
  return methods.map((m) => ({ ...m, destinations: dests.filter((d) => d.methodCode === m.code) })).filter((m) => m.destinations.length);
}

export async function paymentQueue(status: ('PAYMENT_SUBMITTED' | 'UNDER_REVIEW' | 'CONFIRMED' | 'REJECTED')[], limit = 50, offset = 0) {
  return db
    .select({ payment: payments, payer: { id: users.id, fullName: users.fullName, phone: users.phone }, orderNumber: orders.number, dealNumber: externalDeals.number })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.payerUserId))
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(externalDeals, eq(externalDeals.id, payments.dealId))
    .where(inArray(payments.status, status))
    .orderBy(desc(payments.updatedAt))
    .limit(limit)
    .offset(offset);
}

export async function submissionsFor(paymentId: string) {
  return db.select().from(paymentSubmissions).where(eq(paymentSubmissions.paymentId, paymentId)).orderBy(desc(paymentSubmissions.createdAt));
}
