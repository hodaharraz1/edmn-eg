import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DISPUTE_DECISIONS, DISPUTE_STATUSES, RETURN_REASONS, RETURN_STATUSES } from '@/domain/machines';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { orderItems, orders, sellerOrders } from './commerce';
import { externalDeals } from './deals';
import { files } from './files';
import { users } from './identity';
import { products } from './catalog';
import { sellers } from './sellers';

/* ───────── Returns ───────── */
export const returns = pgTable(
  'returns',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    sellerOrderId: uuid()
      .notNull()
      .references(() => sellerOrders.id),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id),
    customerId: uuid()
      .notNull()
      .references(() => users.id),
    status: text({ enum: RETURN_STATUSES }).notNull().default('REQUESTED'),
    reason: text({ enum: RETURN_REASONS }).notNull(),
    description: text().notNull(),
    isStatutory: boolean().notNull().default(false),
    decisionReason: text(),
    returnCarrier: text(),
    returnTracking: text(),
    inspectionNote: text(),
    refundAmount: money(),
    includeShipping: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('returns_number_uq').on(t.number),
    index('returns_seller_idx').on(t.sellerId, t.status),
    index('returns_customer_idx').on(t.customerId),
    index('returns_so_idx').on(t.sellerOrderId),
    enumCheck('returns_status_chk', t.status, RETURN_STATUSES),
    enumCheck('returns_reason_chk', t.reason, RETURN_REASONS),
  ],
);

export const returnItems = pgTable(
  'return_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    returnId: uuid()
      .notNull()
      .references(() => returns.id),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id),
    quantity: integer().notNull(),
  },
  (t) => [
    uniqueIndex('return_items_uq').on(t.returnId, t.orderItemId),
    check('return_items_qty_chk', sql`${t.quantity} > 0`),
  ],
);

export const returnEvidence = pgTable(
  'return_evidence',
  {
    id: uuid().primaryKey().defaultRandom(),
    returnId: uuid()
      .notNull()
      .references(() => returns.id),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    uploadedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('return_evidence_return_idx').on(t.returnId)],
);

/* ───────── Disputes (marketplace orders & external deals) ───────── */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    sellerOrderId: uuid().references(() => sellerOrders.id),
    dealId: uuid().references(() => externalDeals.id),
    returnId: uuid().references(() => returns.id),
    claimantUserId: uuid()
      .notNull()
      .references(() => users.id),
    respondentSellerId: uuid().references(() => sellers.id),
    respondentUserId: uuid().references(() => users.id),
    status: text({ enum: DISPUTE_STATUSES }).notNull().default('OPEN'),
    reasonCode: text().notNull(),
    description: text().notNull(),
    claimedAmount: money(),
    assignedTo: uuid().references(() => users.id),
    decision: text({ enum: DISPUTE_DECISIONS }),
    decisionAmount: money(),
    decisionReasonCode: text(),
    decisionNote: text(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('disputes_number_uq').on(t.number),
    uniqueIndex('disputes_open_so_uq')
      .on(t.sellerOrderId)
      .where(sql`${t.sellerOrderId} is not null and ${t.status} in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')`),
    uniqueIndex('disputes_open_deal_uq')
      .on(t.dealId)
      .where(sql`${t.dealId} is not null and ${t.status} in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')`),
    index('disputes_status_idx').on(t.status, t.createdAt),
    enumCheck('disputes_status_chk', t.status, DISPUTE_STATUSES),
    check('disputes_subject_chk', sql`(${t.sellerOrderId} is null) <> (${t.dealId} is null)`),
  ],
);

export const disputeMessages = pgTable(
  'dispute_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    disputeId: uuid()
      .notNull()
      .references(() => disputes.id),
    authorUserId: uuid()
      .notNull()
      .references(() => users.id),
    authorRole: text().notNull(), // CLAIMANT | RESPONDENT | ADMIN
    body: text().notNull(),
    isInternal: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('dispute_messages_dispute_idx').on(t.disputeId, t.createdAt)],
);

export const disputeEvidence = pgTable(
  'dispute_evidence',
  {
    id: uuid().primaryKey().defaultRandom(),
    disputeId: uuid()
      .notNull()
      .references(() => disputes.id),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    uploadedBy: uuid()
      .notNull()
      .references(() => users.id),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index('dispute_evidence_dispute_idx').on(t.disputeId)],
);

/* ───────── Reviews (verified purchases only) ───────── */
export const REVIEW_STATUSES = ['PUBLISHED', 'HIDDEN', 'REMOVED'] as const;
export const productReviews = pgTable(
  'product_reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    customerId: uuid()
      .notNull()
      .references(() => users.id),
    rating: integer().notNull(),
    title: text(),
    body: text(),
    photoFileIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    status: text({ enum: REVIEW_STATUSES }).notNull().default('PUBLISHED'),
    moderationReason: text(),
    sellerResponse: text(),
    sellerRespondedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('product_reviews_item_uq').on(t.orderItemId),
    index('product_reviews_product_idx').on(t.productId, t.status, t.createdAt),
    check('product_reviews_rating_chk', sql`${t.rating} between 1 and 5`),
    enumCheck('product_reviews_status_chk', t.status, REVIEW_STATUSES),
  ],
);

export const sellerReviews = pgTable(
  'seller_reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerOrderId: uuid()
      .notNull()
      .references(() => sellerOrders.id),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id),
    customerId: uuid()
      .notNull()
      .references(() => users.id),
    rating: integer().notNull(),
    deliveryRating: integer(),
    packagingRating: integer(),
    accuracyRating: integer(),
    communicationRating: integer(),
    body: text(),
    status: text({ enum: REVIEW_STATUSES }).notNull().default('PUBLISHED'),
    moderationReason: text(),
    sellerResponse: text(),
    sellerRespondedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('seller_reviews_so_uq').on(t.sellerOrderId),
    index('seller_reviews_seller_idx').on(t.sellerId, t.status, t.createdAt),
    check(
      'seller_reviews_rating_chk',
      sql`${t.rating} between 1 and 5
        and (${t.deliveryRating} is null or ${t.deliveryRating} between 1 and 5)
        and (${t.packagingRating} is null or ${t.packagingRating} between 1 and 5)
        and (${t.accuracyRating} is null or ${t.accuracyRating} between 1 and 5)
        and (${t.communicationRating} is null or ${t.communicationRating} between 1 and 5)`,
    ),
    enumCheck('seller_reviews_status_chk', t.status, REVIEW_STATUSES),
  ],
);

export const REVIEW_REPORT_STATUSES = ['OPEN', 'ACTIONED', 'DISMISSED'] as const;
export const reviewReports = pgTable(
  'review_reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    reviewType: text().notNull(), // PRODUCT | SELLER
    reviewId: uuid().notNull(),
    reporterUserId: uuid()
      .notNull()
      .references(() => users.id),
    reason: text().notNull(),
    status: text({ enum: REVIEW_REPORT_STATUSES }).notNull().default('OPEN'),
    handledBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_reports_uq').on(t.reviewType, t.reviewId, t.reporterUserId),
    index('review_reports_status_idx').on(t.status),
  ],
);
