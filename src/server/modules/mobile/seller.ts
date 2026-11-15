import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { requireSeller, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound, validation } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { cancellationRequests, disputes, files, orderItems, orders, productImages, productVariants, products, sellerOrders, stores } from '@/server/db/schema';
import { sellerOrderAllowedActions, type SellerOrderAction } from '@/server/modules/allowed-actions';
import { sellerOrderMessagingAvailable } from '@/server/modules/messaging/service';
import { publicMediaUrl } from '@/server/modules/catalog/public-read';
import { setStock } from '@/server/modules/catalog/inventory';
import {
  advanceSellerOrder,
  confirmSellerOrder,
  decideCancellationRequest,
  markShipped,
  saveShipment,
  sellerOrderForSeller,
} from '@/server/modules/commerce/fulfilment';
import { orderLabel } from '@/server/modules/commerce/orders';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { sellerFundsPosition, sendBlockReason } from '@/server/modules/finance/holds';
import { rangeFromPreset, sellerDashboard } from '@/server/modules/reports/service';
import { sellerContextForUser } from '@/server/modules/sellers/service';

/**
 * Seller Center read models and actions for the Customer App (the same app; the seller role is the session user's
 * store membership). Every function derives the store from the actor (never from the client) and checks the
 * store-scoped permission of the member's role. State changes go through the existing fulfilment/inventory services,
 * which enforce the seller-order state machine. Nothing here moves money.
 */

/** Seller membership of the signed-in user (null = not a seller). Drives the buyer ⇄ seller switch in the app. */
export async function sellerMembership(actor: Actor) {
  const userId = requireUser(actor);
  const ctx = await sellerContextForUser(userId);
  if (!ctx) return { membership: null };
  const [store] = await db.select({ name: stores.name, slug: stores.slug }).from(stores).where(eq(stores.sellerId, ctx.seller.id));
  return {
    membership: {
      status: ctx.seller.status,
      type: ctx.seller.type,
      role: ctx.role,
      permissions: [...ctx.permissions].sort(),
      store: store ? { name: store.name, slug: store.slug } : null,
      /** Fulfilment works for APPROVED and RESTRICTED sellers; the rest see their application status. */
      canOperate: ctx.seller.status === 'APPROVED' || ctx.seller.status === 'RESTRICTED',
    },
  };
}

/** Dashboard (board "مركز البائع"). Money figures only for members holding finance.view. */
export async function sellerHome(actor: Actor) {
  const sellerId = requireSeller(actor);
  const perms = actor.sellerPermissions ?? new Set();
  const d = await sellerDashboard(sellerId, rangeFromPreset('30d'));
  const [{ live }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.sellerId, sellerId), eq(products.status, 'LIVE')));
  const finance = perms.has('finance.view');
  return {
    orders: { pendingConfirmation: d.pendingConfirmation, processing: d.processing, readyToShip: d.ready, shipped: d.shipped, openReturns: d.openReturns, last30Days: d.orders },
    products: { live, outOfStock: d.outOfStock, lowStock: d.lowStock },
    rating: { average: d.rating, count: d.ratingCount },
    sales: finance ? { todayPiastres: d.todaySales, last30DaysGrossPiastres: d.gross, last30DaysNetPiastres: d.net } : null,
    onTimeRate: d.onTimeRate,
  };
}

const SELLER_VISIBLE: readonly string[] = ['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'AWAITING_BUYER_RESPONSE', 'DELIVERED', 'COMPLETED', 'DELIVERY_FAILED', 'CANCELLED'];

/** The store's PAID sub-orders (never-paid orders are not the seller's to see), newest first, 20 per page. */
export async function sellerOrdersPage(actor: Actor, status: string | null, page: number) {
  const sellerId = requireSeller(actor, 'orders.manage');
  const statuses = status ? SELLER_VISIBLE.filter((s) => s === status) : SELLER_VISIBLE;
  if (!statuses.length) throw validation('حالة غير معروفة');
  const pageSize = 20;
  const rows = await db
    .select({ so: sellerOrders, orderNumber: orders.number })
    .from(sellerOrders)
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .where(and(eq(sellerOrders.sellerId, sellerId), isNotNull(sellerOrders.paidAt), inArray(sellerOrders.status, statuses as never[])))
    .orderBy(desc(sellerOrders.paidAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const ids = rows.map((r) => r.so.id);
  const lines = ids.length
    ? await db.select({ soId: orderItems.sellerOrderId, qty: orderItems.quantity, imageFileId: orderItems.imageFileId }).from(orderItems).where(inArray(orderItems.sellerOrderId, ids))
    : [];
  const imgIds = [...new Set(lines.map((l) => l.imageFileId).filter((x): x is string => !!x))];
  const imgs = imgIds.length ? await db.select({ id: files.id, key: files.storageKey }).from(files).where(inArray(files.id, imgIds)) : [];
  const keyOf = new Map(imgs.map((f) => [f.id, f.key]));
  return {
    page,
    pageSize,
    items: rows.map(({ so, orderNumber }) => {
      const mine = lines.filter((l) => l.soId === so.id);
      return {
        id: so.id,
        number: `${orderLabel(orderNumber)}-${so.suffix}`,
        status: so.status,
        paidAt: so.paidAt!.toISOString(),
        itemCount: mine.reduce((a, l) => a + l.qty, 0),
        thumbnails: [...new Set(mine.map((l) => publicMediaUrl(l.imageFileId ? keyOf.get(l.imageFileId) : null, 'thumb')).filter((u): u is string => !!u))].slice(0, 3),
        merchandiseSubtotalPiastres: so.merchandiseSubtotal,
      };
    }),
  };
}

async function viewOf(actor: Actor, soId: string) {
  const g = await sellerOrderForSeller(actor, soId);
  const pendingCancel = g.cancellations.find((c) => c.status === 'PENDING') ?? null;
  const [openDispute] = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(eq(disputes.sellerOrderId, soId), inArray(disputes.status, ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'])));
  const actions = sellerOrderAllowedActions({ status: g.so.status, role: 'SELLER', cancellationPending: !!pendingCancel, openDispute: !!openDispute, disputeWindowClosed: true });
  return { g, pendingCancel, openDispute: !!openDispute, actions };
}

/** One sub-order of the store: items, ship-to address (paid orders only), shipment, server-allowed actions. */
export async function sellerOrderView(actor: Actor, soId: string) {
  const { g, pendingCancel, openDispute, actions } = await viewOf(actor, soId);
  const finance = actor.sellerPermissions?.has('finance.view') ?? false;
  const imgIds = [...new Set(g.items.map((i) => i.imageFileId).filter((x): x is string => !!x))];
  const imgs = imgIds.length ? await db.select({ id: files.id, key: files.storageKey }).from(files).where(inArray(files.id, imgIds)) : [];
  const keyOf = new Map(imgs.map((f) => [f.id, f.key]));
  const addr = (g.order.shippingAddress ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof addr[k] === 'string' ? (addr[k] as string) : null);
  return {
    id: g.so.id,
    number: `${orderLabel(g.order.number)}-${g.so.suffix}`,
    status: g.so.status,
    paidAt: g.so.paidAt?.toISOString() ?? null,
    processingDays: g.so.processingDays,
    shipTo: {
      recipientName: s('recipientName'),
      phone: s('phone'),
      governorate: s('governorate'),
      city: s('city'),
      district: s('district'),
      street: s('street'),
      building: s('building'),
      floor: s('floor'),
      apartment: s('apartment'),
      landmark: s('landmark'),
    },
    items: g.items.map((i) => ({
      id: i.id,
      title: i.titleSnapshot,
      variantLabel: i.variantLabel,
      condition: i.conditionSnapshot,
      imageUrl: publicMediaUrl(i.imageFileId ? keyOf.get(i.imageFileId) : null, 'thumb'),
      quantity: i.quantity,
      unitPricePiastres: i.unitPrice,
      lineTotalPiastres: i.lineTotal,
    })),
    merchandiseSubtotalPiastres: g.so.merchandiseSubtotal,
    shippingFeePiastres: g.so.shippingFee,
    /** Seller economics only for members holding finance.view. */
    economics: finance ? { commissionPiastres: g.so.commissionTotal, sellerNetPiastres: g.so.sellerNet } : null,
    shipment: g.shipment
      ? {
          status: g.shipment.status,
          carrierName: g.shipment.carrierName,
          trackingNumber: g.shipment.trackingNumber,
          shippedAt: g.shipment.shippedAt?.toISOString() ?? null,
          expectedDeliveryAt: g.shipment.expectedDeliveryAt?.toISOString() ?? null,
          hasWaybill: g.documents.length > 0,
        }
      : null,
    cancellationRequest: pendingCancel ? { id: pendingCancel.id, note: pendingCancel.note, createdAt: pendingCancel.createdAt.toISOString() } : null,
    openDispute,
    allowedActions: [...actions, ...(actor.sellerPermissions?.has('orders.communicate') && sellerOrderMessagingAvailable(g.so) ? ['MESSAGE_BUYER'] : [])],
  };
}

export type SellerStep = Extract<SellerOrderAction, 'CONFIRM_ORDER' | 'START_PROCESSING' | 'MARK_READY_TO_SHIP' | 'MARK_SHIPPED' | 'ACCEPT_CANCELLATION'>;

/** Runs one state-machine step, only if the server currently allows it for this sub-order. */
export async function sellerOrderStep(actor: Actor, soId: string, step: SellerStep, note: string | null) {
  const { pendingCancel, actions } = await viewOf(actor, soId);
  if (!actions.includes(step)) throw forbidden('الإجراء غير متاح لهذا الطلب الآن');
  switch (step) {
    case 'CONFIRM_ORDER':
      await confirmSellerOrder(actor, soId);
      break;
    case 'START_PROCESSING':
      await advanceSellerOrder(actor, soId, 'PROCESSING');
      break;
    case 'MARK_READY_TO_SHIP':
      await advanceSellerOrder(actor, soId, 'READY_TO_SHIP');
      break;
    case 'MARK_SHIPPED':
      await markShipped(actor, soId);
      break;
    case 'ACCEPT_CANCELLATION':
      if (!pendingCancel) throw notFound('طلب الإلغاء');
      await decideCancellationRequest(actor, pendingCancel.id, true, note ?? '');
      break;
  }
  return sellerOrderView(actor, soId);
}

/** Shipment details (carrier, tracking, dates) + optional waybill image/PDF. */
export async function sellerSaveShipment(
  actor: Actor,
  soId: string,
  input: { carrierName: string; trackingNumber?: string; shippedAt: string; expectedDeliveryAt?: string | null; note?: string },
  waybill: { data: Buffer; name: string } | null,
) {
  const { actions } = await viewOf(actor, soId);
  if (!actions.includes('SAVE_SHIPMENT')) throw forbidden('الإجراء غير متاح لهذا الطلب الآن');
  await saveShipment(actor, soId, input, waybill);
  return sellerOrderView(actor, soId);
}

/** The store's products with stock per variant (catalog / inventory members). */
export async function sellerProductsPage(actor: Actor, status: string | null, page: number) {
  const sellerId = requireSeller(actor);
  const perms = actor.sellerPermissions ?? new Set();
  if (!perms.has('products.manage') && !perms.has('inventory.manage')) throw forbidden();
  const pageSize = 20;
  const where = [eq(products.sellerId, sellerId)];
  if (status) where.push(eq(products.status, status as never));
  const rows = await db
    .select()
    .from(products)
    .where(and(...where))
    .orderBy(desc(products.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const ids = rows.map((p) => p.id);
  const variants = ids.length ? await db.select().from(productVariants).where(inArray(productVariants.productId, ids)) : [];
  // First image of each product (lowest sort order).
  const imgs = ids.length
    ? await db
        .select({ productId: productImages.productId, key: files.storageKey, sort: productImages.sortOrder })
        .from(productImages)
        .innerJoin(files, eq(files.id, productImages.fileId))
        .where(inArray(productImages.productId, ids))
        .orderBy(productImages.sortOrder)
    : [];
  const keyOf = new Map<string, string>();
  for (const i of imgs) if (!keyOf.has(i.productId)) keyOf.set(i.productId, i.key);
  return {
    page,
    pageSize,
    items: rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      titleAr: p.titleAr,
      status: p.status,
      condition: p.condition,
      imageUrl: publicMediaUrl(keyOf.get(p.id) ?? null, 'thumb'),
      variants: variants
        .filter((v) => v.productId === p.id)
        .map((v) => ({
          id: v.id,
          label: v.label,
          pricePiastres: v.price,
          stockOnHand: v.stockOnHand,
          reserved: v.reserved,
          available: Math.max(0, v.stockOnHand - v.reserved),
          lowStockThreshold: v.lowStockThreshold,
          active: v.isActive,
        })),
    })),
  };
}

/** Stock update through the inventory service (owner check, reserved floor, movement + audit). */
export async function sellerSetStock(actor: Actor, variantId: string, stockOnHand: number) {
  await setStock(actor, variantId, stockOnHand);
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
  return { id: v.id, stockOnHand: v.stockOnHand, reserved: v.reserved, available: Math.max(0, v.stockOnHand - v.reserved) };
}

/**
 * Store funds — READ ONLY, finance.view + store scope. Holds, booked debt and uncovered claims are shown as what
 * they are; only `withdrawablePiastres` (available − held, never negative) is withdrawable. Pending = not yet released.
 */
export async function sellerFunds(actor: Actor) {
  const sellerId = requireSeller(actor, 'finance.view');
  const [b, p] = await Promise.all([sellerBalances(db, sellerId), sellerFundsPosition(db, sellerId)]);
  const [{ open }] = await db.execute<{ open: number }>(
    sql`select count(*)::int as open from withdrawal_requests where seller_id = ${sellerId} and status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','TRANSFER_UNCERTAIN')`,
  ).then((r) => r.rows);
  return {
    pendingPiastres: b.pending,
    availablePiastres: p.available,
    heldPiastres: p.held,
    reservedForPayoutPiastres: b.reserved,
    bookedDebtPiastres: p.bookedDebt,
    unsecuredClaimsPiastres: p.unsecuredExposure,
    withdrawablePiastres: p.withdrawable,
    openPayoutRequests: Number(open),
    blockReasonAr: sendBlockReason(p),
  };
}

/** Exposed for tests: the pending cancellation request of a sub-order. */
export async function pendingCancellationOf(soId: string) {
  const [r] = await db.select().from(cancellationRequests).where(and(eq(cancellationRequests.sellerOrderId, soId), eq(cancellationRequests.status, 'PENDING')));
  return r ?? null;
}
