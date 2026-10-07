import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { orderMachine, paymentMachine, sellerOrderMachine, type OrderStatus, type PaymentMethodCode } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requireUser, SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import {
  addresses,
  governorates,
  orderItems,
  orders,
  paymentDestinations,
  paymentMethods,
  payments,
  sellerOrders,
  stores,
  users,
  products,
  cancellationRequests,
} from '@/server/db/schema';
import { enqueueJob } from '@/server/jobs/queue';
import { notify } from '@/server/modules/notifications/notify';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';
import { effectiveBps, lockPricingShared, marketplaceSnapshot, requireActiveVersion } from '@/server/modules/pricing/service';
import { releaseReservation, reserve } from '@/server/modules/catalog/inventory';
import { transition, parse } from '../_shared';
import { acknowledgePrices, cartLines, clearVariants } from './cart';
import { priceLines } from './pricing';
import { offeredDestinations } from '@/server/modules/payments/service';
import { listingReturnPolicy } from '@/server/modules/catalog/return-policy';
import { currentLegalVersion } from '@/server/modules/sellers/service';
import { formatEGP } from '@/lib/format';

export const checkoutSchema = z.object({
  addressId: z.string().uuid('اختار عنوان التوصيل'),
  paymentMethod: z.enum(['BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH'], { message: 'اختار طريقة الدفع' }),
  checkoutKey: z.string().min(8).max(100),
  expectedTotal: z.number().int().min(0),
  /** Pricing version the buyer was quoted; a different version at commit → re-confirm (stale quote). */
  expectedPricingVersionId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional().default(''),
});

const SUFFIXES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function orderLabel(number: number, suffix?: string) {
  return suffix ? `${number}-${suffix}` : String(number);
}

/**
 * Place an order from the customer's cart.
 * Transaction boundary: everything below commits atomically or not at all.
 *  - idempotent on (customer, checkoutKey): a retried submission returns the original order
 *  - prices, stock, product/seller status, shipping and totals are re-validated server-side
 *  - one parent order + one seller sub-order per seller; immutable item & commission snapshots
 *  - inventory reserved with conditional updates (cannot oversell the last unit)
 */
export async function placeOrder(actor: Actor, input: z.input<typeof checkoutSchema>) {
  const customerId = requireUser(actor);
  const d = parse(checkoutSchema, input);
  try {
    return await placeOrderTx(actor, customerId, d);
  } catch (e) {
    // The customer has now been shown the current prices: accept them so the next review passes.
    if (e instanceof DomainError && e.code === 'CONFLICT') await acknowledgePrices(db, { userId: customerId });
    throw e;
  }
}

async function placeOrderTx(actor: Actor, customerId: string, d: z.infer<typeof checkoutSchema>) {
  return db.transaction(async (tx) => {
    // Serialize concurrent checkouts of the same customer, then check idempotency.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'checkout:' + customerId}))`);
    const [dupe] = await tx.select().from(orders).where(and(eq(orders.customerId, customerId), eq(orders.checkoutKey, d.checkoutKey)));
    if (dupe) return { order: dupe, created: false };
    // Same lock as account closure: a closing account can never race a new order.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'account:' + customerId}))`);
    const [buyer] = await tx.select({ status: users.status }).from(users).where(eq(users.id, customerId));
    if (buyer?.status !== 'ACTIVE') throw new DomainError('FORBIDDEN', 'الشراء غير متاح لحالة حسابك الحالية');
    const pendingClosure = await tx.execute(sql`select 1 from account_closure_requests where user_id = ${customerId} and status = 'PENDING' limit 1`);
    if (pendingClosure.rows.length) throw invalidState('عندك طلب إغلاق حساب قيد التنفيذ. ألغِه الأول لو عايز تشتري');
    // Fee engine: serialize against a pricing publication, then require a valid version (fail closed).
    await lockPricingShared(tx, 'MARKETPLACE');
    const pricing = await requireActiveVersion(tx, 'MARKETPLACE');

    const [address] = await tx.select().from(addresses).where(eq(addresses.id, d.addressId));
    if (!address || address.userId !== customerId || address.archivedAt) throw validation('عنوان التوصيل ده غير صالح. اختار عنوان تاني');
    const [gov] = await tx.select().from(governorates).where(eq(governorates.id, address.governorateId));

    const [method] = await tx.select().from(paymentMethods).where(eq(paymentMethods.code, d.paymentMethod));
    if (!method?.isEnabled) throw validation('طريقة الدفع دي مش متاحة دلوقتي');
    const destinations = await tx
      .select()
      .from(paymentDestinations)
      .where(and(eq(paymentDestinations.methodCode, d.paymentMethod), offeredDestinations(await realMoneyEnabled(tx))))
      .orderBy(asc(paymentDestinations.sortOrder));
    if (!destinations.length) throw validation('طريقة الدفع دي مش جاهزة دلوقتي. اختار طريقة تانية');

    const lines = await cartLines(tx, { userId: customerId });
    if (!lines.length) throw validation('السلة فاضية');
    const priced = await priceLines(tx, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, priceSeen: l.priceSeen })), address.governorateId);

    const problems: string[] = [];
    for (const g of priced.groups) {
      if (g.lines.some((l) => l.issues.includes('NO_SHIPPING'))) problems.push(`المتجر "${g.storeName}" لا يشحن إلى ${gov?.nameAr ?? 'محافظتك'}`);
      for (const l of g.lines) {
        if (l.issues.includes('UNAVAILABLE') || l.issues.includes('SELLER_UNAVAILABLE')) problems.push(`"${l.title}" مبقاش متاح`);
        else if (l.available === 0) problems.push(`"${l.title}" المنتج خلص`);
        else if (l.issues.includes('INSUFFICIENT_STOCK')) problems.push(`الكمية اللي طلبتها من "${l.title}" مش متوفرة (المتاح ${l.available})`);
      }
    }
    if (problems.length) throw new DomainError('INVALID_STATE', problems.join('، '));
    if (priced.pricingUnavailable || priced.pricingVersionId !== pricing.id) throw new DomainError('INVALID_STATE', priced.pricingUnavailable ?? 'تعذر حساب رسوم الخدمة');
    if (d.expectedPricingVersionId && d.expectedPricingVersionId !== pricing.id) {
      throw new DomainError('CONFLICT', 'رسوم خدمة اضمن اتحدثت من وقت ما فتحت الصفحة. راجع الإجمالي الجديد وأكّد تاني');
    }
    // No self-purchase (wash sales / fake verified reviews), whatever path the cart was filled by.
    for (const g of priced.groups) {
      const own = await tx.execute(sql`select 1 from sellers s left join seller_members m on m.seller_id = s.id and m.user_id = ${customerId} and m.is_active
        where s.id = ${g.sellerId} and (s.owner_user_id = ${customerId} or m.user_id is not null) limit 1`);
      if (own.rows.length) throw new DomainError('INVALID_STATE', `مينفعش تشتري منتجات من متجرك "${g.storeName}"`);
    }
    const changedPrices = priced.groups.flatMap((g) => g.lines.filter((l) => l.issues.includes('PRICE_CHANGED')).map((l) => l.title));
    if (changedPrices.length) throw new DomainError('CONFLICT', `السعر اتغير: ${changedPrices.join('، ')}. راجع الإجمالي الجديد وأكّد تاني`);
    if (priced.grandTotal !== d.expectedTotal) {
      // Never silently charge an old or new amount: the buyer must see and confirm the changed total.
      throw new DomainError('CONFLICT', `الإجمالي اتغير من ${formatEGP(d.expectedTotal)} إلى ${formatEGP(priced.grandTotal)} (الشحن أو رسوم الخدمة اتغيرت). راجع وأكّد تاني`);
    }

    const windowHours = await getSetting('payments.paymentWindowHours', tx);
    const dueAt = new Date(Date.now() + windowHours * 3600_000);
    const shippingAddress = {
      recipientName: address.recipientName,
      phone: address.phone,
      governorateId: address.governorateId,
      governorate: gov?.nameAr,
      city: address.city,
      district: address.district,
      street: address.street,
      building: address.building,
      floor: address.floor,
      apartment: address.apartment,
      landmark: address.landmark,
    };
    const [order] = await tx
      .insert(orders)
      .values({
        customerId,
        status: 'PENDING_PAYMENT',
        shippingAddress,
        governorateId: address.governorateId,
        merchandiseTotal: priced.merchandiseTotal,
        shippingTotal: priced.shippingTotal,
        discountTotal: priced.discountTotal,
        buyerFeeTotal: priced.buyerFeeTotal,
        grandTotal: priced.grandTotal,
        economicSnapshot: {
          version: 2,
          currency: 'EGP',
          feeBasis: 'PRODUCT_VALUE_EXCL_SHIPPING',
          feeEngine: { pricingVersionId: pricing.id, pricingVersionNo: pricing.versionNo, model: 'MARKETPLACE', feeUnit: 'SELLER_SUB_ORDER' },
          feeRounding: 'TOTAL_HALF_UP__BUYER_HALF_UP__SELLER_REMAINDER',
          buyerFeeTotal: priced.buyerFeeTotal,
          sellerFeeTotal: priced.sellerFeeTotal,
          shippingPayer: 'BUYER',
          shippingPayee: 'SELLER_FULFILMENT',
          shippingInputs: { governorateId: address.governorateId, perSeller: priced.groups.map((g) => ({ sellerId: g.sellerId, fee: g.shippingFee, free: g.freeShippingApplied })) },
          discounts: { total: 0, funder: null },
          termsVersions: { buyerTerms: await currentLegalVersion(tx, 'BUYER_TERMS'), feesPolicy: await currentLegalVersion(tx, 'FEES_POLICY'), termsOfUse: await currentLegalVersion(tx, 'TERMS_OF_USE') },
          acceptedAt: new Date().toISOString(),
        },
        paymentMethod: d.paymentMethod,
        paymentDueAt: dueAt,
        checkoutKey: d.checkoutKey,
        customerNote: d.note || null,
      })
      .returning();
    await transitionNew(tx, actor, 'order', order.id, 'PENDING_PAYMENT');

    for (const [i, g] of priced.groups.entries()) {
      let commissionTotal = 0;
      const itemRows: (typeof orderItems.$inferInsert)[] = [];
      // Snapshot the seller's voluntary return policy as shown at purchase time (immune to later edits).
      const [store] = await tx.select().from(stores).where(eq(stores.sellerId, g.sellerId));
      const policyProducts = await tx.select().from(products).where(inArray(products.id, g.lines.map((l) => l.productId)));
      const legalNoticeVersion = await currentLegalVersion(tx, 'RETURNS_POLICY');
      const q = g.quote!;
      const buyerFee = q.result.buyer;
      const sellerFee = q.result.seller;
      commissionTotal = q.result.total;
      const refundPolicyVersion = await currentLegalVersion(tx, 'RETURNS_POLICY');
      const pricingSnapshot = marketplaceSnapshot(q, {
        shipping: g.shippingFee ?? 0,
        categoryByLine: Object.fromEntries(g.lines.map((l) => [l.variantId, l.categoryId])),
        refundPolicyVersion,
      });
      for (const l of g.lines) {
        const lf = q.result.lines.find((x) => x.key === l.variantId)!;
        itemRows.push({
          sellerOrderId: '',
          productId: l.productId,
          variantId: l.variantId,
          titleSnapshot: l.title,
          variantLabel: l.variantLabel,
          skuSnapshot: l.sku,
          conditionSnapshot: l.condition,
          imageFileId: l.imageFileId,
          categoryIdSnapshot: l.categoryId,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
          commissionRuleId: null,
          commissionBps: effectiveBps(lf.total, l.lineTotal),
          commissionAmount: lf.total,
          buyerFeeAmount: lf.buyer,
          sellerFeeAmount: lf.seller,
          economicClass: lf.economicClass,
          pricingVersionId: pricing.id,
          returnPolicySnapshot: { ...listingReturnPolicy(policyProducts.find((x) => x.id === l.productId)!, store), legalNoticeVersion },
        });
      }
      const gross = g.merchandiseSubtotal + (g.shippingFee ?? 0) + buyerFee;
      const [so] = await tx
        .insert(sellerOrders)
        .values({
          orderId: order.id,
          sellerId: g.sellerId,
          suffix: SUFFIXES[i],
          status: 'PENDING_PAYMENT',
          merchandiseSubtotal: g.merchandiseSubtotal,
          shippingFee: g.shippingFee ?? 0,
          buyerFeeTotal: buyerFee,
          sellerFeeTotal: sellerFee,
          grossTotal: gross,
          commissionBasis: g.merchandiseSubtotal,
          commissionTotal,
          shippingPayee: 'SELLER_FULFILMENT',
          sellerNet: gross - commissionTotal,
          shippingEtaMinDays: g.etaMinDays,
          shippingEtaMaxDays: g.etaMaxDays,
          processingDays: g.processingDays,
          pricingSource: 'ENGINE',
          pricingVersionId: pricing.id,
          pricingSnapshot,
        })
        .returning();
      await transitionNew(tx, actor, 'seller_order', so.id, 'PENDING_PAYMENT');
      for (const row of itemRows) {
        const [item] = await tx.insert(orderItems).values({ ...row, sellerOrderId: so.id }).returning({ id: orderItems.id });
        await reserve(tx, row.variantId, row.quantity, item.id, dueAt);
      }
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        orderId: order.id,
        payerUserId: customerId,
        isTest: !(await realMoneyEnabled(tx)),
        method: d.paymentMethod,
        destinationId: destinations[0].id,
        destinationSnapshot: destinations.map((x) => ({ label: x.label, details: x.details, instructions: x.instructionsAr, isTest: x.isTest })),
        amountDue: order.grandTotal,
        dueAt,
      })
      .returning();
    await transitionNew(tx, actor, 'payment', payment.id, 'AWAITING_PAYMENT');
    await clearVariants(tx, customerId, lines.map((l) => l.variantId));
    await enqueueJob(tx, 'orders.expire', { orderId: order.id }, { runAt: new Date(dueAt.getTime() + 60_000) });
    await audit(tx, actor, { action: 'order.placed', entityType: 'order', entityId: order.id, newValues: { number: order.number, grandTotal: order.grandTotal, sellers: priced.groups.length } });
    await notify(tx, {
      event: 'ORDER_CREATED',
      userIds: [customerId],
      vars: { order: order.number, amount: formatEGP(order.grandTotal), due: dueAt.toLocaleString('ar-EG-u-nu-latn') },
      link: `/account/orders/${order.id}`,
    });
    return { order, created: true };
  });
}

async function transitionNew(tx: DbOrTx, actor: Actor, entity: string, id: string, to: string) {
  const { recordTransition } = await import('@/server/audit/audit');
  await recordTransition(tx, actor, entity, id, null, to);
}

/** Cancel / expire an unpaid order: payment closed, sub-orders cancelled, reservations released. */
async function closeUnpaid(tx: DbOrTx, actor: Actor, orderId: string, paymentTo: 'EXPIRED' | 'CANCELLED', reason: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order) throw notFound('الطلب');
  if (order.status !== 'PENDING_PAYMENT') return false;
  const [payment] = await tx.select().from(payments).where(eq(payments.orderId, orderId)).for('update');
  if (payment && !['AWAITING_PAYMENT', 'REJECTED'].includes(payment.status)) return false;
  if (payment) {
    await transition(tx, actor, paymentMachine, payment.id, payment.status, paymentTo, reason);
    await tx.update(payments).set({ status: paymentTo }).where(eq(payments.id, payment.id));
  }
  await transition(tx, actor, orderMachine, order.id, order.status, 'CANCELLED', reason);
  await tx.update(orders).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }).where(eq(orders.id, order.id));
  const sos = await tx.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id)).for('update');
  for (const so of sos) {
    await transition(tx, actor, sellerOrderMachine, so.id, so.status, 'CANCELLED', reason);
    await tx
      .update(sellerOrders)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, cancelledBy: actor.userId, cancelReasonCode: paymentTo === 'EXPIRED' ? 'PAYMENT_FAILURE' : 'BUYER_REQUEST', cancellationRequestedAt: null })
      .where(eq(sellerOrders.id, so.id));
    const items = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    for (const it of items) await releaseReservation(tx, it.id, paymentTo === 'EXPIRED' ? 'EXPIRED' : 'RELEASED');
    await tx
      .update(cancellationRequests)
      .set({ status: 'ACCEPTED', decidedAt: new Date(), decisionNote: reason })
      .where(and(eq(cancellationRequests.sellerOrderId, so.id), eq(cancellationRequests.status, 'PENDING')));
  }
  await audit(tx, actor, { action: paymentTo === 'EXPIRED' ? 'order.expired' : 'order.cancelled_unpaid', entityType: 'order', entityId: order.id, reason });
  return true;
}

export async function cancelUnpaidOrder(actor: Actor, orderId: string) {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    const [o] = await tx.select({ customerId: orders.customerId }).from(orders).where(eq(orders.id, orderId));
    if (!o) throw notFound('الطلب');
    if (o.customerId !== userId) throw forbidden();
    const ok = await closeUnpaid(tx, actor, orderId, 'CANCELLED', 'ألغى العميل الطلب قبل الدفع');
    if (!ok) throw invalidState('مينفعش تلغي الطلب بعد ما بعت إثبات الدفع. تواصل مع الدعم');
  });
}

/** Job: expire orders whose payment window passed without a proof under review. */
export async function expireOrder(orderId: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!o || o.status !== 'PENDING_PAYMENT') return false;
    const [p] = await tx.select().from(payments).where(eq(payments.orderId, orderId));
    if (p && p.dueAt > new Date()) {
      await enqueueJob(tx, 'orders.expire', { orderId }, { runAt: new Date(p.dueAt.getTime() + 60_000) });
      return false;
    }
    return closeUnpaid(tx, SYSTEM_ACTOR, orderId, 'EXPIRED', 'انتهت مهلة الدفع');
  });
}

export async function expireOverdueOrders(now = new Date()) {
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.status, 'PENDING_PAYMENT'), inArray(payments.status, ['AWAITING_PAYMENT', 'REJECTED']), lte(payments.dueAt, now)));
  let n = 0;
  for (const o of due) if (await expireOrder(o.id)) n++;
  return n;
}

/** Recompute the parent order status from its sub-orders after fulfilment events. */
export async function syncParentStatus(tx: DbOrTx, actor: Actor, orderId: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  const sos = await tx.select({ status: sellerOrders.status }).from(sellerOrders).where(eq(sellerOrders.orderId, orderId));
  const to = deriveParentStatus(sos.map((s) => s.status));
  if (to && to !== order.status && orderMachine.can(order.status, to)) {
    await transition(tx, actor, orderMachine, order.id, order.status, to);
    await tx.update(orders).set({ status: to, ...(to === 'CANCELLED' ? { cancelledAt: new Date() } : { completedAt: new Date() }) }).where(eq(orders.id, order.id));
  }
}

/**
 * Parent status from its sub-orders. Mixed outcomes stay explicit: a cancelled or failed sub-order is
 * never presented as successfully completed. Returns null while any sub-order is still in progress.
 */
export function deriveParentStatus(statuses: string[]): OrderStatus | null {
  if (!statuses.length) return null;
  const finalStates = ['COMPLETED', 'CANCELLED', 'DELIVERY_FAILED'];
  if (statuses.every((s) => s === 'CANCELLED')) return 'CANCELLED';
  if (!statuses.every((s) => finalStates.includes(s))) return null;
  if (statuses.every((s) => s === 'COMPLETED')) return 'COMPLETED';
  if (statuses.some((s) => s === 'COMPLETED')) return 'PARTIALLY_COMPLETED';
  return 'CLOSED_UNFULFILLED';
}

/* ───────── Reads (ownership enforced) ───────── */

export async function customerOrders(userId: string, page = 1) {
  return db.select().from(orders).where(eq(orders.customerId, userId)).orderBy(desc(orders.placedAt)).limit(20).offset((page - 1) * 20);
}

export async function orderForCustomer(actor: Actor, orderId: string) {
  const userId = requireUser(actor);
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw notFound('الطلب');
  if (order.customerId !== userId) throw forbidden();
  return loadOrderGraph(order);
}

export async function loadOrderGraph(order: typeof orders.$inferSelect) {
  const sos = await db
    .select({ so: sellerOrders, storeName: stores.name, storeSlug: stores.slug })
    .from(sellerOrders)
    .innerJoin(stores, eq(stores.sellerId, sellerOrders.sellerId))
    .where(eq(sellerOrders.orderId, order.id))
    .orderBy(asc(sellerOrders.suffix));
  const items = sos.length ? await db.select().from(orderItems).where(inArray(orderItems.sellerOrderId, sos.map((s) => s.so.id))) : [];
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, order.id));
  const [customer] = await db.select({ id: users.id, fullName: users.fullName, email: users.email, phone: users.phone }).from(users).where(eq(users.id, order.customerId));
  return { order, payment: payment ?? null, customer, sellerOrders: sos.map((s) => ({ ...s, items: items.filter((i) => i.sellerOrderId === s.so.id) })) };
}

export type PaymentMethodLabel = Record<PaymentMethodCode, string>;
