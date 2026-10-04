import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DEAL_STATUSES, INVITATION_STATUSES, PAYOUT_TYPES } from '@/domain/machines';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { files } from './files';
import { users } from './identity';

/**
 * External protected deals: a buyer protects a purchase that originated outside the marketplace.
 * Wording is deliberately "protected deal" — EDMN does not claim to be a licensed escrow holder.
 */
export const externalDeals = pgTable(
  'external_deals',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    buyerId: uuid()
      .notNull()
      .references(() => users.id),
    status: text({ enum: DEAL_STATUSES }).notNull().default('DRAFT'),
    wizardStep: integer().notNull().default(1),
    // Step 1 — product
    title: text().notNull(),
    description: text(),
    productCategory: text(),
    condition: text(), // NEW | USED (free for external goods)
    sourceUrl: text(), // where the buyer found it (marketplace/social link) — display only
    quantity: integer().notNull().default(1),
    // Step 2 — external seller (counterparty)
    sellerName: text(),
    sellerPhone: text(),
    sellerEmail: text(),
    sellerUserId: uuid().references(() => users.id),
    // Step 3 — price & terms
    unitPrice: money(),
    totalAmount: money(),
    feeBps: integer().notNull().default(0),
    feeAmount: money().notNull().default(0),
    feePayer: text().notNull().default('SELLER'), // SELLER | BUYER
    buyerPays: money(), // total the buyer transfers
    sellerReceives: money(), // net the seller is paid on completion
    // Step 4 — delivery expectations
    deliveryMethod: text(),
    deliveryDeadline: ts(),
    inspectionDays: integer().notNull().default(2),
    // Step 5 — custom terms
    customTerms: text(),
    termsVersion: text(),
    // Seller payout destination (captured on acceptance; encrypted)
    sellerPayoutType: text({ enum: PAYOUT_TYPES }),
    sellerPayoutEnc: text(),
    sellerPayoutMasked: text(),
    // Lifecycle
    invitedAt: ts(),
    acceptedAt: ts(),
    activatedAt: ts(),
    deliveredAt: ts(),
    deliveryNote: text(),
    completedAt: ts(),
    cancelledAt: ts(),
    cancelReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('external_deals_number_uq').on(t.number),
    index('external_deals_buyer_idx').on(t.buyerId, t.createdAt),
    index('external_deals_seller_idx').on(t.sellerUserId),
    index('external_deals_status_idx').on(t.status),
    enumCheck('external_deals_status_chk', t.status, DEAL_STATUSES),
    check('external_deals_qty_chk', sql`${t.quantity} between 1 and 10000`),
    check('external_deals_amount_chk', sql`${t.totalAmount} is null or ${t.totalAmount} > 0`),
  ],
);

export const dealInvitations = pgTable(
  'deal_invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    dealId: uuid()
      .notNull()
      .references(() => externalDeals.id),
    /** sha256 of the random token; the raw token is only in the invitation link */
    tokenHash: text().notNull(),
    status: text({ enum: INVITATION_STATUSES }).notNull().default('PENDING'),
    expiresAt: ts().notNull(),
    respondedAt: ts(),
    respondedBy: uuid().references(() => users.id),
    rejectReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('deal_invitations_token_uq').on(t.tokenHash),
    index('deal_invitations_deal_idx').on(t.dealId),
    enumCheck('deal_invitations_status_chk', t.status, INVITATION_STATUSES),
  ],
);

export const dealEvidence = pgTable(
  'deal_evidence',
  {
    id: uuid().primaryKey().defaultRandom(),
    dealId: uuid()
      .notNull()
      .references(() => externalDeals.id),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    kind: text().notNull(), // PRODUCT_PHOTO | DELIVERY_PROOF | OTHER
    uploadedBy: uuid()
      .notNull()
      .references(() => users.id),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index('deal_evidence_deal_idx').on(t.dealId)],
);

export const DEAL_PAYOUT_STATUSES = ['PENDING', 'PAID'] as const;
export const dealPayouts = pgTable(
  'deal_payouts',
  {
    id: uuid().primaryKey().defaultRandom(),
    dealId: uuid()
      .notNull()
      .references(() => externalDeals.id),
    payeeUserId: uuid().references(() => users.id),
    amount: money().notNull(),
    status: text({ enum: DEAL_PAYOUT_STATUSES }).notNull().default('PENDING'),
    paidReference: text(),
    paidProofFileId: uuid().references(() => files.id),
    paidBy: uuid().references(() => users.id),
    paidAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('deal_payouts_deal_uq').on(t.dealId),
    enumCheck('deal_payouts_status_chk', t.status, DEAL_PAYOUT_STATUSES),
    check('deal_payouts_amount_chk', sql`${t.amount} > 0`),
  ],
);
