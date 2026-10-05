import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
    // Optional buyer-provided contact HINTS for the external seller — never treated as verified identity.
    sellerName: text(),
    sellerPhone: text(),
    sellerEmail: text(),
    // The seller account bound to this deal through the invitation (set once, on claim).
    sellerUserId: uuid().references(() => users.id),
    sellerJoinedAt: ts(),
    // Authoritative seller details, entered by the SELLER (phone copied from their verified account).
    sellerFullName: text(),
    sellerVerifiedPhone: text(),
    sellerContactEmail: text(),
    // Delivery locations: structured address + optional GPS, encrypted (AES-256-GCM) — sensitive PII.
    buyerLocationEnc: text(),
    sellerLocationEnc: text(),
    // Plain governorate ids for shipping calculation (origin = seller, destination = buyer).
    originGovernorateId: integer(),
    destinationGovernorateId: integer(),
    // Seller offer fields (set from the agreed terms version).
    shippingFee: money().notNull().default(0),
    processingDays: integer(),
    /** Immutable once set: the exact terms both parties accepted (DB trigger blocks any later change). */
    agreedTerms: jsonb().$type<Record<string, unknown>>(),
    agreedVersion: integer(),
    agreedAt: ts(),
    // Delivery handover (OTP). Physical handover evidence only — never acceptance of the goods.
    deliveryAttempt: integer().notNull().default(0),
    handoverVerifiedAt: ts(),
    handoverOtpId: uuid(),
    buyerConfirmedAt: ts(),
    deliveryConflictAt: ts(),
    /** Operations hold: while true the buyer's confirmation cannot make the payout payable. */
    financialHold: boolean().notNull().default(false),
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
    /** First time the link was opened (audit INVITATION_OPENED). */
    openedAt: ts(),
    /** The single account this invitation is bound to once a seller claims it. */
    boundUserId: uuid().references(() => users.id),
    boundAt: ts(),
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

/**
 * Deal terms versions: every seller offer, buyer change request and seller counter-offer is a NEW
 * row (never overwritten). Statuses: PROPOSED → ACCEPTED | REJECTED | SUPERSEDED.
 */
export const DEAL_TERMS_STATUSES = ['PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;
export const dealTermsVersions = pgTable(
  'deal_terms_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    dealId: uuid()
      .notNull()
      .references(() => externalDeals.id),
    version: integer().notNull(),
    proposedBy: text().notNull(), // SELLER | BUYER
    proposedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    terms: jsonb().$type<Record<string, unknown>>().notNull(),
    message: text(),
    status: text({ enum: DEAL_TERMS_STATUSES }).notNull().default('PROPOSED'),
    respondedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('deal_terms_versions_uq').on(t.dealId, t.version),
    enumCheck('deal_terms_versions_status_chk', t.status, DEAL_TERMS_STATUSES),
    check('deal_terms_versions_by_chk', sql`${t.proposedBy} in ('SELLER','BUYER')`),
  ],
);

/**
 * Delivery OTP: a one-time 6-digit code that the BUYER hands to the seller/courier at physical
 * handover. Only an HMAC of the code is stored (bound to deal + OTP id). `testCodeEnc` is filled only
 * on staging / development so the authenticated buyer can see a clearly-labelled test code while no
 * SMS provider is configured; it is never set in production.
 */
export const DELIVERY_OTP_INVALID_REASONS = ['REGENERATED', 'EXPIRED', 'LOCKED', 'CLOSED'] as const;
export const dealDeliveryOtps = pgTable(
  'deal_delivery_otps',
  {
    id: uuid().primaryKey(),
    dealId: uuid()
      .notNull()
      .references(() => externalDeals.id),
    buyerId: uuid()
      .notNull()
      .references(() => users.id),
    deliveryAttempt: integer().notNull(),
    codeHash: text().notNull(),
    testCodeEnc: text(),
    expiresAt: ts().notNull(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull(),
    lastAttemptAt: ts(),
    usedAt: ts(),
    usedBy: uuid().references(() => users.id),
    invalidatedAt: ts(),
    invalidReason: text({ enum: DELIVERY_OTP_INVALID_REASONS }),
    issuedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('deal_delivery_otps_deal_idx').on(t.dealId, t.createdAt),
    // At most one usable code per deal at any time.
    uniqueIndex('deal_delivery_otps_active_uq').on(t.dealId).where(sql`${t.usedAt} is null and ${t.invalidatedAt} is null`),
    check('deal_delivery_otps_attempts_chk', sql`${t.attempts} >= 0 and ${t.attempts} <= ${t.maxAttempts}`),
  ],
);
