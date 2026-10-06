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
  CANCELLATION_REASON_CODES,
  ORDER_STATUSES,
  RECEIPT_BASES,
  SHIPMENT_EXCEPTION_CODES,
  DELIVERY_EVENT_SOURCES,
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
    /** Buyer share of the transparent EDMN fee (Fb). Legacy orders: 0 (the fee was fully seller-borne). */
    buyerFeeTotal: money().notNull().default(0),
    grandTotal: money().notNull(),
    /** Immutable economic snapshot (fee config/version, rounding, shipping payer/payee, terms version). */
    economicSnapshot: jsonb(),
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
      sql`${t.grandTotal} = ${t.merchandiseTotal} + ${t.shippingTotal} + ${t.buyerFeeTotal} - ${t.discountTotal} and ${t.grandTotal} >= 0 and ${t.buyerFeeTotal} >= 0`,
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
    /** Fb: buyer share of the EDMN fee, included in grossTotal (what the buyer pays for this sub-order). */
    buyerFeeTotal: money().notNull().default(0),
    /** Fs: seller share of the EDMN fee. commissionTotal = Fb + Fs (the total fee F). */
    sellerFeeTotal: money().notNull().default(0),
    grossTotal: money().notNull(),
    commissionBasis: money().notNull(),
    commissionTotal: money().notNull(),
    /** Who receives the buyer's shipping charge (snapshot). Seller-fulfilled shipping → SELLER_FULFILMENT. */
    shippingPayee: text().notNull().default('SELLER_FULFILMENT'),
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
    // ── Fulfilment SLAs (configurable; operational flags only — never money) ──
    sellerResponseDueAt: ts(),
    shipByDueAt: ts(),
    sellerResponseOverdueAt: ts(),
    shipmentOverdueAt: ts(),
    /** Set while a buyer cancellation request is pending: shipment is blocked until it is resolved. */
    cancellationRequestedAt: ts(),
    cancelReasonCode: text({ enum: CANCELLATION_REASON_CODES }),
    // ── Delivery evidence → buyer window → entitlement (distinct facts, never one boolean) ──
    /** Authoritative delivery event (carrier / Operations), with provenance. A seller claim is not one. */
    deliveryEventAt: ts(),
    deliveryEventSource: text({ enum: DELIVERY_EVENT_SOURCES }),
    deliveryEventRef: text(),
    deliveryEventRecordedBy: uuid().references(() => users.id),
    /** Seller must submit delivery evidence within 24h of the authoritative delivery event. */
    deliveryReportDueAt: ts(),
    sellerDeliveryConfirmedAt: ts(),
    sellerDeliveryLate: boolean().notNull().default(false),
    /** When valid delivery evidence was established, and how (AUTO = event + timely seller evidence; OPS_REVIEW). */
    deliveryEstablishedAt: ts(),
    deliveryEstablishedBasis: text(),
    deliveryEstablishedBy: uuid().references(() => users.id),
    /** Buyer's response window: deliveryEstablishedAt + 24h (server time). Never restarted by retries. */
    buyerResponseDueAt: ts(),
    receiptBasis: text({ enum: RECEIPT_BASES }),
    entitledAt: ts(),
    /** Operations exception that blocks the automatic path (late/missing evidence, conflict, outage…). */
    deliveryExceptionCode: text(),
    deliveryExceptionAt: ts(),
    releaseApprovalId: uuid(),
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
      sql`${t.grossTotal} = ${t.merchandiseSubtotal} + ${t.shippingFee} + ${t.buyerFeeTotal} - ${t.discountTotal}
          and ${t.sellerNet} = ${t.grossTotal} - ${t.commissionTotal}
          and ${t.commissionTotal} >= 0 and ${t.refundedTotal} >= 0 and ${t.refundedTotal} <= ${t.grossTotal}`,
    ),
    check('seller_orders_fee_split_chk', sql`${t.buyerFeeTotal} >= 0 and ${t.sellerFeeTotal} >= 0 and (${t.buyerFeeTotal} + ${t.sellerFeeTotal} = ${t.commissionTotal} or (${t.buyerFeeTotal} = 0 and ${t.sellerFeeTotal} = 0))`),
    enumCheck('seller_orders_receipt_basis_chk', t.receiptBasis, RECEIPT_BASES),
    // COMPLETED requires an established receipt basis AND a committed Admin seller release.
    check('seller_orders_completion_chk', sql`${t.status} <> 'COMPLETED' or (${t.receiptBasis} is not null and ${t.fundsReleasedAt} is not null)`),
    check('seller_orders_entitlement_chk', sql`${t.status} not in ('DELIVERED','COMPLETED') or ${t.receiptBasis} is not null`),
    index('seller_orders_buyer_due_idx').on(t.buyerResponseDueAt).where(sql`${t.status} = 'AWAITING_BUYER_RESPONSE'`),
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
    /** Split of commissionAmount (F_item = buyer + seller share), kept per item for exact partial refunds. */
    buyerFeeAmount: money().notNull().default(0),
    sellerFeeAmount: money().notNull().default(0),
    /** Units already refunded (approved refunds). Never exceeds quantity. */
    refundedQuantity: integer().notNull().default(0),
    /** Seller's voluntary return policy as shown at purchase (later policy edits never change it). */
    returnPolicySnapshot: jsonb().$type<import('@/domain/return-policy').ReturnPolicySnapshot>(),
    returnedQuantity: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_items_so_idx').on(t.sellerOrderId),
    index('order_items_product_idx').on(t.productId),
    check('order_items_qty_chk', sql`${t.quantity} > 0 and ${t.returnedQuantity} between 0 and ${t.quantity}`),
    check('order_items_refunded_qty_chk', sql`${t.refundedQuantity} between 0 and ${t.quantity}`),
    check('order_items_fee_split_chk', sql`${t.buyerFeeAmount} >= 0 and ${t.sellerFeeAmount} >= 0 and ${t.buyerFeeAmount} + ${t.sellerFeeAmount} <= ${t.commissionAmount}`),
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
    /** TEST destinations are shown as "TEST PAYMENT DESTINATION — NOT FOR REAL MONEY". Only an admin marks a real one. */
    isTest: boolean().notNull().default(true),
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
    /** Snapshot: created while real money was disabled (pilot/staging) — never a real receipt. */
    isTest: boolean().notNull().default(true),
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
    /** sha256 of the proof file (copied for duplicate-proof detection; review signal only). */
    proofSha256: text(),
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
    index('payment_submissions_reference_idx').on(t.reference),
    index('payment_submissions_sha_idx').on(t.proofSha256),
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
    exceptionCode: text({ enum: SHIPMENT_EXCEPTION_CODES }),
    exceptionNote: text(),
    exceptionAt: ts(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shipments_so_uq').on(t.sellerOrderId),
    index('shipments_status_idx').on(t.status, t.updatedAt),
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
export const REFUND_SOURCES = ['ORDER_CANCELLATION', 'RETURN', 'DISPUTE', 'DEAL', 'DELIVERY_FAILURE', 'ADMIN'] as const;
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
    // Components (new refunds): amount = principal + shipping + buyer fee refund.
    principalAmount: money().notNull().default(0),
    shippingAmount: money().notNull().default(0),
    buyerFeeRefund: money().notNull().default(0),
    sellerFeeReversal: money().notNull().default(0),
    /** Charged to the seller: principal + shipping − seller fee reversal. */
    sellerLiability: money().notNull().default(0),
    status: text({ enum: REFUND_STATUSES }).notNull().default('REQUESTED'),
    reason: text(),
    originalPaymentId: uuid(),
    /** Authoritative destination: the original payment method/reference unless an audited exception. */
    destinationSnapshot: jsonb(),
    destinationOverride: boolean().notNull().default(false),
    idempotencyKey: text(),
    requestedBy: uuid().references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    approvalId: uuid(),
    payoutApprovalId: uuid(),
    rejectReason: text(),
    failureReason: text(),
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
    check('refunds_components_chk', sql`${t.principalAmount} >= 0 and ${t.shippingAmount} >= 0 and ${t.buyerFeeRefund} >= 0 and ${t.sellerFeeReversal} >= 0
      and (${t.principalAmount} + ${t.shippingAmount} + ${t.buyerFeeRefund} = 0 or ${t.principalAmount} + ${t.shippingAmount} + ${t.buyerFeeRefund} = ${t.amount})`),
    uniqueIndex('refunds_idem_uq').on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index('refunds_so_idx').on(t.sellerOrderId),
  ],
);

/** Item/quantity lines of a refund (prevents refunding the same units twice). */
export const refundItems = pgTable(
  'refund_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    refundId: uuid()
      .notNull()
      .references(() => refunds.id),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id),
    quantity: integer().notNull(),
    principal: money().notNull(),
    buyerFee: money().notNull().default(0),
    sellerFee: money().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('refund_items_uq').on(t.refundId, t.orderItemId), check('refund_items_qty_chk', sql`${t.quantity} > 0 and ${t.principal} >= 0`)],
);

/* ───────── Cancellation requests (buyer, after payment, before shipment) ───────── */
export const CANCELLATION_REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const;
export const cancellationRequests = pgTable(
  'cancellation_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerOrderId: uuid()
      .notNull()
      .references(() => sellerOrders.id),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id),
    reasonCode: text({ enum: CANCELLATION_REASON_CODES }).notNull(),
    note: text(),
    status: text({ enum: CANCELLATION_REQUEST_STATUSES }).notNull().default('PENDING'),
    decidedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    decisionNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cancellation_requests_open_uq').on(t.sellerOrderId).where(sql`${t.status} = 'PENDING'`),
    enumCheck('cancellation_requests_status_chk', t.status, CANCELLATION_REQUEST_STATUSES),
  ],
);

/* ───────── Seller delivery evidence (supporting evidence; never alone proof of delivery) ───────── */
export const deliveryEvidence = pgTable(
  'delivery_evidence',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerOrderId: uuid()
      .notNull()
      .references(() => sellerOrders.id),
    fileId: uuid().references(() => files.id),
    carrierReference: text(),
    note: text(),
    submittedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('delivery_evidence_so_idx').on(t.sellerOrderId)],
);
