import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import { PROTECTION_LEVELS } from '@/domain/used';
import { createdAt, enumCheck, ts, updatedAt } from './_helpers';
import { categories, products } from './catalog';
import { sellerOrders } from './commerce';
import { externalDeals } from './deals';
import { files } from './files';
import { users } from './identity';

/**
 * EDMN Trusted Used Commerce. Category-driven configuration, structured condition reports, the Product Passport
 * (built for a future cross-transaction product history), real inspections, and the frozen condition snapshots
 * that disputes are judged against. None of these tables holds money: financial state stays in the ledger,
 * deals and orders.
 */

/** One policy per category: condition schema, evidence, verification, inspection, dispute reasons, levels. */
export const usedCategoryPolicies = pgTable('used_category_policies', {
  id: uuid().primaryKey().defaultRandom(),
  categoryId: uuid()
    .notNull()
    .unique()
    .references(() => categories.id),
  enabled: boolean().notNull().default(true),
  config: jsonb().notNull(),
  version: integer().notNull().default(1),
  updatedBy: uuid().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const USED_REPORT_STATUSES = ['DRAFT', 'DECLARED', 'LOCKED'] as const;
/**
 * The seller's structured documentation of ONE item (a marketplace listing or a protected deal).
 * The device identifier is never stored in clear: AES-GCM ciphertext + masked form + keyed hash (comparison and
 * future history linking without decryption).
 */
export const usedConditionReports = pgTable(
  'used_condition_reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    policyId: uuid()
      .notNull()
      .references(() => usedCategoryPolicies.id),
    policyVersion: integer().notNull(),
    productId: uuid().references(() => products.id),
    dealId: uuid().references(() => externalDeals.id),
    authorUserId: uuid()
      .notNull()
      .references(() => users.id),
    answers: jsonb().notNull().default({}),
    identifierEnc: text(),
    identifierMasked: text(),
    identifierHash: text(),
    status: text({ enum: USED_REPORT_STATUSES }).notNull().default('DRAFT'),
    declaredAt: ts(),
    conditionCompleteness: integer().notNull().default(0),
    evidenceCompleteness: integer().notNull().default(0),
    defectsCount: integer().notNull().default(0),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('used_reports_product_uq').on(t.productId).where(sql`${t.productId} is not null`),
    uniqueIndex('used_reports_deal_uq').on(t.dealId).where(sql`${t.dealId} is not null`),
    index('used_reports_identifier_idx').on(t.identifierHash),
    check('used_reports_subject_chk', sql`num_nonnulls(${t.productId}, ${t.dealId}) = 1`),
    enumCheck('used_reports_status_chk', t.status, USED_REPORT_STATUSES),
  ],
);

export const usedConditionEvidence = pgTable(
  'used_condition_evidence',
  {
    id: uuid().primaryKey().defaultRandom(),
    reportId: uuid()
      .notNull()
      .references(() => usedConditionReports.id),
    slot: text().notNull(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    uploadedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('used_evidence_file_uq').on(t.reportId, t.fileId), index('used_evidence_report_idx').on(t.reportId, t.slot)],
);

export const PASSPORT_VERIFICATION_STATUSES = ['UNREVIEWED', 'VERIFIED', 'REJECTED'] as const;
/** EDMN Product Passport: the public identity of a documented used item (identifier only as a keyed hash). */
export const productPassports = pgTable(
  'product_passports',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull().unique(),
    reportId: uuid()
      .notNull()
      .unique()
      .references(() => usedConditionReports.id),
    productId: uuid().references(() => products.id),
    dealId: uuid().references(() => externalDeals.id),
    identifierHash: text(),
    level: text({ enum: PROTECTION_LEVELS }).notNull().default('PROTECTED'),
    verificationStatus: text({ enum: PASSPORT_VERIFICATION_STATUSES }).notNull().default('UNREVIEWED'),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    verificationNote: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('product_passports_identifier_idx').on(t.identifierHash),
    enumCheck('product_passports_level_chk', t.level, PROTECTION_LEVELS),
    enumCheck('product_passports_verification_chk', t.verificationStatus, PASSPORT_VERIFICATION_STATUSES),
  ],
);

/** Append-only passport history (the seed of a future cross-owner Product History). No PII in `data`. */
export const productPassportEvents = pgTable(
  'product_passport_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    passportId: uuid()
      .notNull()
      .references(() => productPassports.id),
    kind: text().notNull(),
    actorUserId: uuid().references(() => users.id),
    data: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index('passport_events_idx').on(t.passportId, t.createdAt)],
);

export const INSPECTION_RESULTS = ['PASS', 'PASS_WITH_NOTES', 'FAIL'] as const;
/** A REAL inspection, recorded by authorized staff with its report. «مفحوص» exists only with a PASS row here. */
export const usedInspections = pgTable(
  'used_inspections',
  {
    id: uuid().primaryKey().defaultRandom(),
    passportId: uuid()
      .notNull()
      .references(() => productPassports.id),
    provider: text().notNull(),
    inspectorName: text().notNull(),
    result: text({ enum: INSPECTION_RESULTS }).notNull(),
    summary: text().notNull(),
    reportFileId: uuid()
      .notNull()
      .references(() => files.id),
    performedAt: ts().notNull(),
    recordedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('used_inspections_passport_idx').on(t.passportId), enumCheck('used_inspections_result_chk', t.result, INSPECTION_RESULTS)],
);

export const CONDITION_SNAPSHOT_STATUSES = ['PROPOSED', 'ACCEPTED', 'SUPERSEDED', 'REJECTED'] as const;
/**
 * Product Condition Freeze. Content (snapshot, hash, chain, subject, version) is immutable at the database level;
 * only the agreement status moves forward. A material change after agreement is a NEW version that the
 * counterparty must accept.
 */
export const conditionSnapshots = pgTable(
  'condition_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    reportId: uuid()
      .notNull()
      .references(() => usedConditionReports.id),
    passportId: uuid()
      .notNull()
      .references(() => productPassports.id),
    dealId: uuid().references(() => externalDeals.id),
    sellerOrderId: uuid().references(() => sellerOrders.id),
    termsVersion: integer(),
    version: integer().notNull(),
    status: text({ enum: CONDITION_SNAPSHOT_STATUSES }).notNull(),
    snapshot: jsonb().notNull(),
    hash: text().notNull(),
    prevHash: text(),
    proposedBy: uuid().references(() => users.id),
    respondedBy: uuid().references(() => users.id),
    respondedAt: ts(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('condition_snapshots_deal_version_uq').on(t.dealId, t.version).where(sql`${t.dealId} is not null`),
    uniqueIndex('condition_snapshots_order_uq').on(t.sellerOrderId, t.reportId, t.version).where(sql`${t.sellerOrderId} is not null`),
    index('condition_snapshots_report_idx').on(t.reportId),
    check('condition_snapshots_subject_chk', sql`num_nonnulls(${t.dealId}, ${t.sellerOrderId}) = 1`),
    enumCheck('condition_snapshots_status_chk', t.status, CONDITION_SNAPSHOT_STATUSES),
  ],
);

export const USED_ANALYTICS_EVENTS = [
  'USED_LISTING_STARTED',
  'USED_LISTING_COMPLETED',
  'EXTERNAL_DEAL_CREATED',
  'DEAL_INVITE_CLAIMED',
  'SELLER_OFFER_SUBMITTED',
  'CONDITION_FROZEN',
  'INSPECTION_STARTED',
  'BUYER_ACCEPTED',
  'INSPECTION_DISPUTE_OPENED',
  'PASSPORT_VERIFIED',
  'INSPECTION_RECORDED',
] as const;
/**
 * Privacy-safe product analytics: event name, opaque subject id and whitelisted coarse properties (category
 * profile, protection level, value bucket). Never names, phones, addresses, identifiers or payment data.
 */
export const usedAnalyticsEvents = pgTable(
  'used_analytics_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text({ enum: USED_ANALYTICS_EVENTS }).notNull(),
    subjectRef: uuid(),
    props: jsonb().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('used_analytics_name_idx').on(t.name, t.createdAt), enumCheck('used_analytics_name_chk', t.name, USED_ANALYTICS_EVENTS)],
);
