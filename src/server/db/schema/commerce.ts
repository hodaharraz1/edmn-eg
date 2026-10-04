import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ORDER_STATUSES,
  PAYMENT_METHOD_CODES,
  PAYMENT_STATUSES,
  PAYMENT_SUBMISSION_STATUSES,
  REFUND_STATUSES,
  SELLER_ORDER_STATUSES,
  SHIPMENT_STATUSES,
} from '@/domain/machines';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { categories, productVariants, products } from './catalog';
import { files } from './files';
import { governorates, users } from './identity';
import { sellers } from './sellers';
import { externalDeals } from './deals';

export const orderNumberSeq = pgSequence('order_number_seq', { startWith: 100001 });
export const docNumberSeq = pgSequence('doc_number_seq', { startWith: 500001 });

/* ───────── Cart ───────── */
export const carts = pgTable(
  'carts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the anonymous cart cookie token (guest carts) */
    guestTokenHash: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('carts_user_uq').on(t.userId).where(sql`${t.userId} is not null`),
    uniqueIndex('carts_guest_uq').on(t.guestTokenHash).where(sql`${t.guestTokenHash} is not null`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer().notNull(),
    /** price when added — used only to warn the customer about price changes */
    priceSeen: bigint({ mode: 'number' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('cart_items_uq').on(t.cartId, t.variantId), check('cart_items_qty_chk', sql`${t.quantity} between 1 and 99`)],
);

/* ───────── Commission rules (versioned by effective date; never edited retroactively) ───────── */
export type CommissionTier = { upTo: number | null; bps: number };
export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** null = marketplace default ("Other") rule */
    categoryId: uuid().references(() => categories.id),
    label: text().notNull(),
    percentBps: integer().notNull(),
    /** Minimum commission per order item in minor units (optional) */
    minFee: money(),
    /** Optional price-band tiers on unit price: [{upTo: 30000, bps: 500}, {upTo: null, bps: 300}] */
    tiers: jsonb().$type<CommissionTier[]>(),
    effectiveFrom: ts().notNull(),
    isEnabled: boolean().notNull().default(true),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('commission_rules_category_idx').on(t.categoryId, t.effectiveFrom),
    check('commission_rules_bps_chk', sql`${t.percentBps} between 0 and 10000`),
    check('commission_rules_min_chk', sql`${t.minFee} is null or ${t.minFee} >= 0`),
  ],
);

/* ───────── Orders: parent customer order + seller sub-orders ───────── */
export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('order_number_seq')`),
    customerId: uuid()
      .notNull()
      .references(() => users.id),
    status: text({ enum: ORDER_STATUSES }).notNull(),
    currency: text().notNull().default('EGP'),
    shippingAddress: jsonb().notNull(), // immutable snapshot of the address at checkout
    governorateId: integer()
      .notNull()
      .references(() => governorates.id),
    merchandiseTotal: money().notNull(),
    shippingTotal: money().notNull(),
    discountTotal: money().notNull().default(0),
    grandTotal: money().notNull(),
    paymentMethod: text({ enum: PAYMENT_METHOD_CODES }).notNull(),
    paymentDueAt: ts().notNull(),
    checkoutKey: text().notNull(), // idempotency key of the checkout submission
    customerNote: text(),
    placedAt: ts().notNull().defaultNow(),
    paidAt: ts(),
    completedAt: ts(),
    cancelledAt: ts(),
    cancelReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_number_uq').on(t.number),
    uniqueIndex('orders_checkout_key_uq').on(t.customerId, t.checkoutKey),
    index('orders_customer_idx').on(t.customerId, t.placedAt),
    index('orders_status_idx').on(t.status, t.placedAt),
    enumCheck('orders_status_chk', t.status, ORDER_STATUSES),
    check(
      'orders_totals_chk',
      sql`${t.grandTotal} = ${t.merchandiseTotal} + ${t.shippingTotal} - ${t.discountTotal} and ${t.grandTotal} >= 0`,
    ),
  ],
);

export const sellerOrders = pgTable(
  'seller_orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id),
    suffix: text().notNull(), // A, B, C… → displayed as 100001-A
    status: text({ enum: SELLER_ORDER_STATUSES }).notNull(),
    // Financial snapshot (immutable after placement except refund/adjustment totals)
    merchandiseSubtotal: money().notNull(),
    shippingFee: money().notNull(),
    discountTotal: money().notNull().default(0),
    grossTotal: money().notNull(),
    commissionBasis: money().notNull(),
    commissionTotal: money().notNull(),
    adjustmentsTotal: money().notNull().default(0),
    refundedTotal: money().notNull().default(0),
    sellerNet: money().notNull(),
    shippingEtaMinDays: integer(),
    shippingEtaMaxDays: integer(),
    processingDays: integer(),
    // Lifecycle timestamps
    paidAt: ts(),
    confirmedAt: ts(),
    shippedAt: ts(),
    deliveredAt: ts(),
    receiptConfirmedBy: uuid().references(() => users.id),
    receiptConfirmationSource: text(), // BUYER | ADMIN_ON_BEHALF
    completedAt: ts(),
    cancelledAt: ts(),
    cancelledBy: uuid().references(() => users.id),
    cancelReason: text(),
    /** Administrative / dispute hold — blocks release of funds to available balance. */
    financialHold: boolean().notNull().default(false),
    holdReason: text(),
    fundsReleasedAt: ts(),
    deliveryFollowUpFlaggedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('seller_orders_order_suffix_uq').on(t.orderId, t.suffix),
    uniqueIndex('seller_orders_order_seller_uq').on(t.orderId, t.sellerId),
    index('seller_orders_seller_idx').on(t.sellerId, t.status, t.createdAt),
    index('seller_orders_status_idx').on(t.status),
    enumCheck('seller_orders_status_chk', t.status, SELLER_ORDER_STATUSES),
    check(
      'seller_orders_fin_chk',
      sql`${t.grossTotal} = ${t.merchandiseSubtotal} + ${t.shippingFee} - ${t.discountTotal}
          and ${t.sellerNet} = ${t.grossTotal} - ${t.commissionTotal}
          and ${t.commissionTotal} >= 0 and ${t.refundedTotal} >= 0 and ${t.refundedTotal} <= ${t.grossTotal}`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerOrderId: uuid()
      .notNull()
      .references(() => sellerOrders.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    // Snapshot at purchase time — survives product edits/archival
    titleSnapshot: text().notNull(),
    variantLabel: text().notNull().default(''),
    skuSnapshot: text().notNull(),
    conditionSnapshot: text().notNull(),
    imageFileId: uuid().references(() => files.id),
    categoryIdSnapshot: uuid(),
    unitPrice: money().notNull(),
    quantity: integer().notNull(),
    lineTotal: money().notNull(),
    commissionRuleId: uuid().references(() => commissionRules.id),
    commissionBps: integer().notNull(),
    commissionAmount: money().notNull(),
    returnedQuantity: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_items_so_idx').on(t.sellerOrderId),
    index('order_items_product_idx').on(t.productId),
    check('order_items_qty_chk', sql`${t.quantity} > 0 and ${t.returnedQuantity} between 0 and ${t.quantity}`),
    check('order_items_total_chk', sql`${t.lineTotal} = ${t.unitPrice} * ${t.quantity}`),
  ],
);

/* ───────── Manual payments ───────── */
export const paymentMethods = pgTable('payment_methods', {
  code: text({ enum: PAYMENT_METHOD_CODES }).primaryKey(),
  nameAr: text().notNull(),
  nameEn: text().notNull(),
  isEnabled: boolean().notNull().default(false),
  instructionsAr: text(),
  sortOrder: integer().notNull().default(0),
  updatedAt: updatedAt(),
});

/** Where customers send money. Managed at runtime by authorized finance admins — never hard-coded. */
export const paymentDestinations = pgTable(
  'payment_destinations',
  {
    id: uuid().primaryKey().defaultRandom(),
    methodCode: text({ enum: PAYMENT_METHOD_CODES })
      .notNull()
      .references(() => paymentMethods.code),
    label: text().notNull(),
    /** Display fields e.g. {bankName, accountName, accountNumber, iban} / {instapayAddress} / {walletNumber} */
    details: jsonb().$type<Record<string, string>>().notNull(),
    instructionsAr: text(),
    isEnabled: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_destinations_method_idx').on(t.methodCode, t.isEnabled)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid().references(() => orders.id),
    dealId: uuid().references(() => externalDeals.id),
    payerUserId: uuid()
      .notNull()
      .references(() => users.id),
    method: text({ enum: PAYMENT_METHOD_CODES }).notNull(),
    destinationId: uuid().references(() => paymentDestinations.id),
    destinationSnapshot: jsonb(),
    amountDue: money().notNull(),
    currency: text().notNull().default('EGP'),
    status: text({ enum: PAYMENT_STATUSES }).notNull().default('AWAITING_PAYMENT'),
    /** Provider abstraction: MANUAL today; a licensed PSP adapter later. */
    provider: text().notNull().default('MANUAL'),
    providerReference: text(),
    dueAt: ts().notNull(),
    confirmedAt: ts(),
    confirmedBy: uuid().references(() => users.id),
    confirmedAmount: money(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_order_uq').on(t.orderId).where(sql`${t.orderId} is not null`),
    uniqueIndex('payments_deal_uq').on(t.dealId).where(sql`${t.dealId} is not null`),
    index('payments_status_idx').on(t.status, t.updatedAt),
    enumCheck('payments_status_chk', t.status, PAYMENT_STATUSES),
    check('payments_target_chk', sql`(${t.orderId} is null) <> (${t.dealId} is null)`),
    check('payments_amount_chk', sql`${t.amountDue} > 0`),
  ],
);

export const paymentSubmissions = pgTable(
  'payment_submissions',
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    submittedBy: uuid()
      .notNull()
      .references(() => users.id),
    proofFileId: uuid()
      .notNull()
      .references(() => files.id),
    reference: text(),
    claimedAmount: money().notNull(),
    payerName: text(),
    notes: text(),
    status: text({ enum: PAYMENT_SUBMISSION_STATUSES }).notNull().default('SUBMITTED'),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: ts(),
    reviewReason: text(),
    /** Client idempotency key — double submit returns the first submission */
    clientKey: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_submissions_payment_idx').on(t.paymentId, t.createdAt),
    uniqueIndex('payment_submissions_client_key_uq').on(t.paymentId, t.clientKey),
    uniqueIndex('payment_submissions_one_open_uq').on(t.paymentId).where(sql`${t.status} = 'SUBMITTED'`),
    enumCheck('payment_submissions_status_chk', t.status, PAYMENT_SUBMISSION_STATUSES),
  ],
);

/* ───────── Shipping (seller-fulfilled) ───────── */
export const shipments = pgTable(
  'shipments',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerOrderId: uuid()
      .notNull()
      .references(() => sellerOrders.id),
    status: text({ enum: SHIPMENT_STATUSES }).notNull().default('CREATED'),
    carrierName: text().notNull(),
    trackingNumber: text(),
    shippedAt: ts(),
    expectedDeliveryAt: ts(),
    note: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shipments_so_uq').on(t.sellerOrderId),
    index('shipments_tracking_idx').on(t.trackingNumber),
    index('shipments_carrier_idx').on(t.carrierName, t.shippedAt),
    enumCheck('shipments_status_chk', t.status, SHIPMENT_STATUSES),
  ],
);

export const shipmentDocuments = pgTable(
  'shipment_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    shipmentId: uuid()
      .notNull()
      .references(() => shipments.id),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    kind: text().notNull().default('WAYBILL'),
    uploadedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('shipment_documents_shipment_idx').on(t.shipmentId)],
);

export const trackingEvents = pgTable(
  'tracking_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    shipmentId: uuid()
      .notNull()
      .references(() => shipments.id),
    status: text().notNull(),
    description: text(),
    occurredAt: ts().notNull().defaultNow(),
    actorUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('tracking_events_shipment_idx').on(t.shipmentId, t.occurredAt)],
);

/* ───────── Refund records (money owed back to a customer; paid manually) ───────── */
export const REFUND_SOURCES = ['ORDER_CANCELLATION', 'RETURN', 'DISPUTE', 'DEAL'] as const;
export const refunds = pgTable(
  'refunds',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    sourceType: text({ enum: REFUND_SOURCES }).notNull(),
    sourceId: uuid().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => users.id),
    sellerOrderId: uuid().references(() => sellerOrders.id),
    dealId: uuid().references(() => externalDeals.id),
    amount: money().notNull(),
    commissionReversal: money().notNull().default(0),
    status: text({ enum: REFUND_STATUSES }).notNull().default('PENDING'),
    reason: text(),
    customerDestination: text(), // where the customer wants the refund (free text; masked in lists)
    paidReference: text(),
    paidProofFileId: uuid().references(() => files.id),
    paidBy: uuid().references(() => users.id),
    paidAt: ts(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('refunds_number_uq').on(t.number),
    uniqueIndex('refunds_source_uq').on(t.sourceType, t.sourceId),
    index('refunds_status_idx').on(t.status, t.createdAt),
    index('refunds_customer_idx').on(t.customerId),
    enumCheck('refunds_status_chk', t.status, REFUND_STATUSES),
    check('refunds_amount_chk', sql`${t.amount} > 0 and ${t.commissionReversal} >= 0 and ${t.commissionReversal} <= ${t.amount}`),
  ],
);
