import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  SELLER_DOCUMENT_KINDS,
  SELLER_MEMBER_ROLES,
  SELLER_STATUSES,
  SELLER_TYPES,
  PAYOUT_TYPES,
} from '@/domain/machines';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { files } from './files';
import { governorates, users } from './identity';

export const sellers = pgTable(
  'sellers',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerUserId: uuid()
      .notNull()
      .references(() => users.id),
    type: text({ enum: SELLER_TYPES }).notNull(),
    status: text({ enum: SELLER_STATUSES }).notNull().default('DRAFT'),
    statusReason: text(),
    // Identity (individual / representative)
    legalName: text(),
    nationalIdEnc: text(), // AES-GCM encrypted; never logged or exported
    nationalIdLast4: text(),
    mobile: text(),
    mobileVerifiedAt: ts(),
    email: text(),
    emailVerifiedAt: ts(),
    addressLine: text(),
    city: text(),
    governorateId: integer().references(() => governorates.id),
    // Business details (required documents are configurable via system settings)
    businessLegalName: text(),
    commercialRegistrationNo: text(),
    taxRegistrationNo: text(),
    businessAddress: text(),
    authorizedRepresentative: text(),
    // Lifecycle
    onboardingStep: integer().notNull().default(1),
    submittedAt: ts(),
    approvedAt: ts(),
    approvedBy: uuid().references(() => users.id),
    agreementVersion: text(),
    agreementAcceptedAt: ts(),
    // Payout safety: withdrawals blocked until this time after payout detail changes
    payoutHoldUntil: ts(),
    autoSettlement: boolean().notNull().default(true),
    // Aggregates maintained transactionally by the reviews module
    ratingAvg: numeric({ precision: 3, scale: 2 }).notNull().default('0'),
    ratingCount: integer().notNull().default(0),
    positiveCount: integer().notNull().default(0),
    riskLevel: text().notNull().default('NORMAL'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sellers_owner_uq').on(t.ownerUserId),
    index('sellers_status_idx').on(t.status, t.submittedAt),
    enumCheck('sellers_status_chk', t.status, SELLER_STATUSES),
    enumCheck('sellers_type_chk', t.type, SELLER_TYPES),
  ],
);

export const sellerMembers = pgTable(
  'seller_members',
  {
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text({ enum: SELLER_MEMBER_ROLES }).notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.sellerId, t.userId] }),
    index('seller_members_user_idx').on(t.userId),
    enumCheck('seller_members_role_chk', t.role, SELLER_MEMBER_ROLES),
  ],
);

export const SELLER_DOC_STATUSES = ['SUBMITTED', 'ACCEPTED', 'REJECTED'] as const;
export const sellerDocuments = pgTable(
  'seller_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id, { onDelete: 'cascade' }),
    kind: text({ enum: SELLER_DOCUMENT_KINDS }).notNull(),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    status: text({ enum: SELLER_DOC_STATUSES }).notNull().default('SUBMITTED'),
    note: text(),
    createdAt: createdAt(),
    supersededAt: ts(),
  },
  (t) => [
    index('seller_documents_seller_idx').on(t.sellerId),
    enumCheck('seller_documents_kind_chk', t.kind, SELLER_DOCUMENT_KINDS),
  ],
);

export const PAYOUT_METHOD_STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'REJECTED', 'ARCHIVED'] as const;
export const sellerPayoutMethods = pgTable(
  'seller_payout_methods',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id, { onDelete: 'cascade' }),
    type: text({ enum: PAYOUT_TYPES }).notNull(),
    detailsEnc: text().notNull(), // encrypted JSON (account holder, IBAN/number, bank…)
    maskedLabel: text().notNull(), // e.g. "بنك مصر •••• 4321"
    holderName: text().notNull(),
    status: text({ enum: PAYOUT_METHOD_STATUSES }).notNull(),
    isDefault: boolean().notNull().default(false),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('seller_payout_methods_seller_idx').on(t.sellerId),
    enumCheck('seller_payout_methods_type_chk', t.type, PAYOUT_TYPES),
    enumCheck('seller_payout_methods_status_chk', t.status, PAYOUT_METHOD_STATUSES),
  ],
);

export const stores = pgTable(
  'stores',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    logoFileId: uuid().references(() => files.id),
    bannerFileId: uuid().references(() => files.id),
    returnAddress: text(),
    returnGovernorateId: integer().references(() => governorates.id),
    supportPhone: text(),
    /** Voluntary return policy — never overrides statutory consumer rights (see legal text). */
    acceptsVoluntaryReturns: boolean().notNull().default(false),
    voluntaryReturnDays: integer(),
    returnConditions: text(),
    /** Structured voluntary-return conditions (keys of RETURN_CONDITION_KEYS) and who pays return shipping. */
    returnConditionKeys: jsonb().$type<string[]>().notNull().default([]),
    returnShippingPayer: text().notNull().default('BY_REASON'),
    shippingPolicy: text(),
    defaultProcessingDays: integer().notNull().default(2),
    freeShippingThreshold: money(),
    isVerified: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('stores_seller_uq').on(t.sellerId),
    uniqueIndex('stores_slug_uq').on(t.slug),
    check('stores_return_days_chk', sql`${t.voluntaryReturnDays} is null or ${t.voluntaryReturnDays} between 1 and 365`),
    check('stores_processing_chk', sql`${t.defaultProcessingDays} between 0 and 30`),
  ],
);

/** Governorate-based shipping rates — mandatory pricing model for V1 (seller-fulfilled). */
export const sellerShippingRates = pgTable(
  'seller_shipping_rates',
  {
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id, { onDelete: 'cascade' }),
    governorateId: integer()
      .notNull()
      .references(() => governorates.id),
    enabled: boolean().notNull().default(true),
    fee: money().notNull(),
    etaMinDays: integer().notNull(),
    etaMaxDays: integer().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.sellerId, t.governorateId] }),
    check('ssr_fee_chk', sql`${t.fee} >= 0`),
    check('ssr_eta_chk', sql`${t.etaMinDays} >= 0 and ${t.etaMaxDays} >= ${t.etaMinDays} and ${t.etaMaxDays} <= 60`),
  ],
);

export const RISK_FLAG_STATUSES = ['OPEN', 'RESOLVED'] as const;
export const riskFlags = pgTable(
  'risk_flags',
  {
    id: uuid().primaryKey().defaultRandom(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    code: text().notNull(),
    severity: text().notNull().default('MEDIUM'),
    note: text(),
    status: text({ enum: RISK_FLAG_STATUSES }).notNull().default('OPEN'),
    meta: jsonb(),
    createdBy: uuid().references(() => users.id),
    resolvedBy: uuid().references(() => users.id),
    resolvedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('risk_flags_entity_idx').on(t.entityType, t.entityId, t.status)],
);
