import { and, eq, inArray } from 'drizzle-orm';
import { requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { addresses, cancellationRequests, disputes, files, governorates, orders, paymentSubmissions, payments, refunds, returns, shipments, trackingEvents } from '@/server/db/schema';
import { returnPolicySummary, type ReturnPolicy } from '@/domain/return-policy';
import { sellerOrderAllowedActions } from '@/server/modules/allowed-actions';
import { publicMediaUrl } from '@/server/modules/catalog/public-read';
import { acknowledgePrices, cartView } from '@/server/modules/commerce/cart';
import { customerOrders, orderForCustomer, orderLabel } from '@/server/modules/commerce/orders';
import type { PricedCart } from '@/server/modules/commerce/pricing';
import { myAddresses } from '@/server/modules/customers/addresses';
import { enabledPaymentMethods } from '@/server/modules/payments/service';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';

/**
 * Buyer read models for the Customer App (cart, checkout, orders, payment). Everything here is derived on the server
 * from the SAME services the web uses: prices, fees, shipping, totals, issues and the actions the buyer may attempt.
 * The app renders these values; it never recomputes them. Identity always comes from the Actor (the session) — no
 * function takes a user id from the client. Shapes are explicit allow-lists (no raw rows).
 */

const policyOut = (p: ReturnPolicy | null | undefined) =>
  p ? { type: p.type, windowDays: p.windowDays ?? null, conditions: [...p.conditions], shippingPayer: p.shippingPayer, notes: p.notes ?? '', summaryAr: returnPolicySummary(p) } : null;

export function cartOut(c: PricedCart) {
  return {
    groups: c.groups.map((g) => ({
      store: { name: g.storeName, slug: g.storeSlug, verified: g.storeVerified },
      lines: g.lines.map((l) => ({
        variantId: l.variantId,
        productSlug: l.productSlug,
        title: l.title,
        variantLabel: l.variantLabel,
        condition: l.condition,
        imageUrl: publicMediaUrl(l.imageKey, 'thumb'),
        unitPricePiastres: l.unitPrice,
        compareAtPricePiastres: l.compareAtPrice,
        priceSeenPiastres: l.priceSeen ?? null,
        quantity: l.quantity,
        lineTotalPiastres: l.lineTotal,
        buyerFeePiastres: l.fee?.buyer ?? 0,
        issues: l.issues,
        returnPolicy: policyOut(l.returnPolicy),
      })),
      merchandiseSubtotalPiastres: g.merchandiseSubtotal,
      shippingFeePiastres: g.shippingFee,
      freeShippingApplied: g.freeShippingApplied,
      etaMinDays: g.etaMinDays,
      etaMaxDays: g.etaMaxDays,
      processingDays: g.processingDays,
      buyerFeePiastres: g.buyerFee,
      totalPiastres: g.total,
    })),
    merchandiseTotalPiastres: c.merchandiseTotal,
    shippingTotalPiastres: c.shippingTotal,
    discountTotalPiastres: c.discountTotal,
    buyerFeeTotalPiastres: c.buyerFeeTotal,
    grandTotalPiastres: c.grandTotal,
    itemCount: c.itemCount,
    hasIssues: c.hasIssues,
    shippingResolved: c.shippingResolved,
    pricingVersionId: c.pricingVersionId,
    pricingUnavailableAr: c.pricingUnavailable,
    /** The server's verdict: every line is purchasable, shipping is priced and fees are available. */
    canCheckout: c.itemCount > 0 && !c.hasIssues && c.shippingResolved && !!c.pricingVersionId,
  };
}

const addressOut = (a: typeof addresses.$inferSelect) => ({
  id: a.id,
  label: a.label,
  recipientName: a.recipientName,
  phone: a.phone,
  governorateId: a.governorateId,
  city: a.city,
  district: a.district,
  street: a.street,
  building: a.building,
  floor: a.floor,
  apartment: a.apartment,
  landmark: a.landmark,
  isDefault: a.isDefault,
});

export async function buyerAddresses(actor: Actor) {
  return (await myAddresses(requireUser(actor))).map(addressOut);
}

/** The buyer's cart priced for a governorate (browsing) — shipping stays unresolved without one. */
export async function buyerCart(actor: Actor, governorateId: number | null) {
  const userId = requireUser(actor);
  let gov: number | null = null;
  if (governorateId) {
    const [g] = await db.select({ id: governorates.id }).from(governorates).where(and(eq(governorates.id, governorateId), eq(governorates.isActive, true)));
    gov = g?.id ?? null;
  }
  return cartOut(await cartView({ userId }, gov));
}

/**
 * Everything the checkout screen shows, priced for ONE of the buyer's own addresses (the default when none is given).
 * The totals returned here are what `placeOrder` re-checks (expectedTotal / expectedPricingVersionId).
 */
export async function buyerCheckout(actor: Actor, addressId: string | null) {
  const userId = requireUser(actor);
  const addrs = await myAddresses(userId);
  const chosen = addressId ? addrs.find((a) => a.id === addressId) : (addrs.find((a) => a.isDefault) ?? addrs[0]);
  if (addressId && !chosen) throw notFound('العنوان');
  const [cart, methods, windowHours, live, notice] = await Promise.all([
    cartView({ userId }, chosen?.governorateId ?? null),
    enabledPaymentMethods(),
    getSetting('payments.paymentWindowHours'),
    realMoneyEnabled(),
    getSetting('returns.mandatoryRightsNotice'),
  ]);
  return {
    selectedAddressId: chosen?.id ?? null,
    addresses: addrs.map(addressOut),
    cart: cartOut(cart),
    paymentMethods: methods.map((m) => ({ code: m.code, nameAr: m.nameAr, nameEn: m.nameEn, instructionsAr: m.instructionsAr ?? null })),
    paymentWindowHours: windowHours,
    realMoneyEnabled: live,
    mandatoryRightsNoticeAr: notice,
  };
}

type PaymentRow = typeof payments.$inferSelect;
type DestinationSnapshot = { label: string; details: Record<string, string>; instructions: string | null; isTest?: boolean };

async function paymentOut(p: PaymentRow | null) {
  if (!p) return null;
  const subs = await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.paymentId, p.id)).orderBy(paymentSubmissions.createdAt);
  const last = subs.at(-1) ?? null;
  const canSubmit = (p.status === 'AWAITING_PAYMENT' || p.status === 'REJECTED') && p.dueAt > new Date();
  return {
    id: p.id,
    method: p.method,
    status: p.status,
    amountDuePiastres: p.amountDue,
    dueAt: p.dueAt.toISOString(),
    isTest: p.isTest,
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    /** Where to transfer: the snapshot taken when the order was placed (never a live lookup that could change). */
    destinations: ((p.destinationSnapshot as DestinationSnapshot[] | null) ?? []).map((d) => ({ label: d.label, details: d.details, instructionsAr: d.instructions ?? null, isTest: d.isTest !== false })),
    submissions: subs.map((s) => ({
      id: s.id,
      status: s.status,
      claimedAmountPiastres: s.claimedAmount,
      reference: s.reference,
      submittedAt: s.createdAt.toISOString(),
      reviewReasonAr: s.status === 'REJECTED' ? s.reviewReason : null,
      proofFileId: s.proofFileId,
    })),
    lastRejectionReasonAr: last?.status === 'REJECTED' ? last.reviewReason : null,
    allowedActions: canSubmit ? ['SUBMIT_PROOF' as const] : [],
  };
}

export async function buyerOrders(actor: Actor, page: number) {
  const rows = await customerOrders(requireUser(actor), page);
  const pays = rows.length ? await db.select({ orderId: payments.orderId, status: payments.status }).from(payments).where(inArray(payments.orderId, rows.map((o) => o.id))) : [];
  const byOrder = new Map(pays.map((p) => [p.orderId, p.status]));
  return {
    page,
    pageSize: 20,
    items: rows.map((o) => ({
      id: o.id,
      number: orderLabel(o.number),
      status: o.status,
      grandTotalPiastres: o.grandTotal,
      placedAt: o.placedAt.toISOString(),
      paymentStatus: byOrder.get(o.id) ?? null,
      paymentDueAt: o.paymentDueAt.toISOString(),
    })),
  };
}

/** One order of the signed-in buyer (ownership enforced by orderForCustomer), with per-sub-order allowed actions. */
export async function buyerOrder(actor: Actor, orderId: string) {
  const userId = requireUser(actor);
  const g = await orderForCustomer(actor, orderId);
  const soIds = g.sellerOrders.map((s) => s.so.id);
  const none = <T>() => Promise.resolve([] as T[]);
  const [ships, cancels, disp, rets, refs, windowDays] = await Promise.all([
    soIds.length ? db.select().from(shipments).where(inArray(shipments.sellerOrderId, soIds)) : none<typeof shipments.$inferSelect>(),
    soIds.length ? db.select().from(cancellationRequests).where(and(inArray(cancellationRequests.sellerOrderId, soIds), eq(cancellationRequests.status, 'PENDING'))) : none<typeof cancellationRequests.$inferSelect>(),
    soIds.length ? db.select().from(disputes).where(inArray(disputes.sellerOrderId, soIds)) : none<typeof disputes.$inferSelect>(),
    soIds.length ? db.select().from(returns).where(inArray(returns.sellerOrderId, soIds)) : none<typeof returns.$inferSelect>(),
    soIds.length ? db.select().from(refunds).where(inArray(refunds.sellerOrderId, soIds)) : none<typeof refunds.$inferSelect>(),
    getSetting('disputes.windowDays'),
  ]);
  const events = ships.length ? await db.select().from(trackingEvents).where(inArray(trackingEvents.shipmentId, ships.map((s) => s.id))).orderBy(trackingEvents.occurredAt) : [];
  const imageIds = [...new Set(g.sellerOrders.flatMap((s) => s.items.map((i) => i.imageFileId)).filter((x): x is string => !!x))];
  const images = imageIds.length ? await db.select({ id: files.id, key: files.storageKey }).from(files).where(inArray(files.id, imageIds)) : [];
  const imageKey = new Map(images.map((f) => [f.id, f.key]));
  const OPEN_DISPUTE = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'];
  const o = g.order;
  const cancellableUnpaid = (o.status === 'PENDING_PAYMENT' || o.status === 'PAYMENT_UNDER_REVIEW') && (!g.payment || g.payment.status === 'AWAITING_PAYMENT' || g.payment.status === 'REJECTED');
  return {
    id: o.id,
    number: orderLabel(o.number),
    status: o.status,
    placedAt: o.placedAt.toISOString(),
    paymentMethod: o.paymentMethod,
    shippingAddress: o.shippingAddress as Record<string, unknown>,
    customerNote: o.customerNote,
    merchandiseTotalPiastres: o.merchandiseTotal,
    shippingTotalPiastres: o.shippingTotal,
    discountTotalPiastres: o.discountTotal,
    buyerFeeTotalPiastres: o.buyerFeeTotal,
    grandTotalPiastres: o.grandTotal,
    cancelReasonAr: o.cancelReason,
    allowedActions: cancellableUnpaid ? ['CANCEL_UNPAID' as const] : [],
    payment: await paymentOut(g.payment),
    sellerOrders: g.sellerOrders.map(({ so, storeName, storeSlug, items }) => {
      const ship = ships.find((s) => s.sellerOrderId === so.id) ?? null;
      const soDisputes = disp.filter((d) => d.sellerOrderId === so.id);
      const openDispute = soDisputes.some((d) => OPEN_DISPUTE.includes(d.status));
      const cancellationPending = cancels.some((c) => c.sellerOrderId === so.id);
      const disputeWindowClosed = !!so.deliveredAt && Date.now() - so.deliveredAt.getTime() > windowDays * 86_400_000;
      return {
        id: so.id,
        number: orderLabel(o.number, so.suffix),
        status: so.status,
        store: { name: storeName, slug: storeSlug },
        merchandiseSubtotalPiastres: so.merchandiseSubtotal,
        shippingFeePiastres: so.shippingFee,
        buyerFeePiastres: so.buyerFeeTotal,
        grossTotalPiastres: so.grossTotal,
        refundedTotalPiastres: so.refundedTotal,
        shippingEtaMinDays: so.shippingEtaMinDays,
        shippingEtaMaxDays: so.shippingEtaMaxDays,
        shippedAt: so.shippedAt?.toISOString() ?? null,
        deliveredAt: so.deliveredAt?.toISOString() ?? null,
        buyerResponseDueAt: so.buyerResponseDueAt?.toISOString() ?? null,
        receiptBasis: so.receiptBasis,
        cancelledAt: so.cancelledAt?.toISOString() ?? null,
        cancelReasonAr: so.cancelReason,
        cancellationPending,
        openDispute,
        items: items.map((i) => ({
          id: i.id,
          productId: i.productId,
          title: i.titleSnapshot,
          variantLabel: i.variantLabel,
          condition: i.conditionSnapshot,
          imageUrl: publicMediaUrl(i.imageFileId ? imageKey.get(i.imageFileId) : null, 'thumb'),
          unitPricePiastres: i.unitPrice,
          quantity: i.quantity,
          lineTotalPiastres: i.lineTotal,
          refundedQuantity: i.refundedQuantity,
          returnedQuantity: i.returnedQuantity,
          returnPolicy: policyOut(i.returnPolicySnapshot),
        })),
        shipment: ship
          ? {
              status: ship.status,
              carrierName: ship.carrierName,
              trackingNumber: ship.trackingNumber,
              shippedAt: ship.shippedAt?.toISOString() ?? null,
              expectedDeliveryAt: ship.expectedDeliveryAt?.toISOString() ?? null,
              events: events.filter((e) => e.shipmentId === ship.id).map((e) => ({ status: e.status, description: e.description, occurredAt: e.occurredAt.toISOString() })),
            }
          : null,
        disputes: soDisputes.map((d) => ({ id: d.id, number: d.number, status: d.status })),
        returns: rets.filter((r) => r.sellerOrderId === so.id).map((r) => ({ id: r.id, number: r.number, status: r.status })),
        refunds: refs.filter((r) => r.sellerOrderId === so.id).map((r) => ({ id: r.id, status: r.status, amountPiastres: r.amount })),
        allowedActions: sellerOrderAllowedActions({ status: so.status, role: o.customerId === userId ? 'BUYER' : 'NONE', cancellationPending, openDispute, disputeWindowClosed }),
      };
    }),
  };
}

/** Payment of one of MY orders (to render the transfer instructions and the proof form). */
export async function buyerPayment(actor: Actor, paymentId: string) {
  const userId = requireUser(actor);
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw notFound('الدفعة');
  if (p.payerUserId !== userId) throw forbidden();
  const [o] = p.orderId ? await db.select({ number: orders.number }).from(orders).where(eq(orders.id, p.orderId)) : [];
  return { ...(await paymentOut(p))!, orderId: p.orderId, dealId: p.dealId, orderNumber: o ? orderLabel(o.number) : null };
}

export async function acknowledgeCartPrices(actor: Actor) {
  await acknowledgePrices(db, { userId: requireUser(actor) });
}

/**
 * A private file the signed-in user may read, as buyer or — when they belong to a store — as that store's member.
 * Authorization is the storage layer's (readPrivateFile); anything else is the same 404.
 */
export async function downloadMyFile(actor: Actor, fileId: string) {
  const userId = requireUser(actor);
  const { readPrivateFile } = await import('@/server/storage/access');
  const { sellerActor } = await import('@/server/auth/actors');
  const asSeller = await sellerActor(userId, { ip: actor.ip, userAgent: actor.userAgent, channel: actor.channel, deviceId: actor.deviceId });
  for (const candidate of [actor, asSeller]) {
    if (!candidate) continue;
    const res = await readPrivateFile(candidate, fileId);
    if (res) return { data: res.data, contentType: res.file.mimeType, filename: `${res.file.id}.${res.file.mimeType === 'application/pdf' ? 'pdf' : 'webp'}` };
  }
  throw notFound('الملف');
}
