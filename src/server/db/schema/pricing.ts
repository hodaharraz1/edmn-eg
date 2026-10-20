import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { categories } from './catalog';
import { users } from './identity';

/* ═══════════════ Versioned pricing (fee engine) ═══════════════
 * A pricing version is a complete, immutable-once-published fee configuration for one model.
 * Fees are progressive/marginal tiers on the fee base (product value; shipping excluded) in basis
 * points (1 bp = 0.01%), with buyer + seller = total per tier (DB CHECK + domain validation).
 * Published versions are never edited: a change is a new version (DB triggers on children).
 * Every committed order/deal snapshots the exact version, tiers and components it used. */

export const PRICING_MODELS = ['MARKETPLACE', 'PROTECTED_DEAL'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];
export const ECONOMIC_CLASSES = ['LOW_MARGIN', 'STANDARD', 'HIGH_MARGIN'] as const;
export type EconomicClass = (typeof ECONOMIC_CLASSES)[number];
/** Tier rows of a protected-deal version use this pseudo class. */
export const DEAL_TIER_CLASS = 'DEAL' as const;
/**
 * Stored lifecycle. ACTIVE / SCHEDULED / SUPERSEDED are derived for PUBLISHED versions from their
 * effective time (the effective version is the latest PUBLISHED one with effective_from <= now()).
 */
export const PRICING_STATUSES = ['DRAFT', 'VALIDATED', 'APPROVED', 'PUBLISHED', 'CANCELLED'] as const;
export type PricingStatus = (typeof PRICING_STATUSES)[number];
export const TAX_TREATMENTS = ['UNRESOLVED', 'FEES_INCLUDE_VAT', 'VAT_ADDED', 'EXEMPT'] as const;

export interface PricingAssumptions {
  /** Estimated collection (incoming payment) cost: bps of the buyer payable + fixed piastres per transaction. */
  collectionCostBps: number;
  collectionCostFixed: number;
  /** Managerial reserves/provisions, bps of GMV (ESTIMATES — never cash movements). */
  refundReserveBps: number;
  disputeReserveBps: number;
  operationalReserveBps: number;
  fraudReserveBps: number;
  /** Internal tax provision, bps of gross EDMN revenue. ESTIMATE — not invoice tax. */
  taxProvisionBps: number;
  /** Estimated payout transfer cost borne by EDMN (0 when the seller pays). */
  edmnPayoutCostFixed: number;
}

export const pricingVersions = pgTable(
  'pricing_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    model: text({ enum: PRICING_MODELS }).notNull(),
    versionNo: integer().notNull(),
    name: text().notNull(),
    status: text({ enum: PRICING_STATUSES }).notNull().default('DRAFT'),
    currency: text().notNull().default('EGP'),
    /** Minimum TOTAL EDMN fee per fee unit (seller sub-order / deal), piastres. */
    minFee: money().notNull(),
    /** PROPORTIONAL: the minimum is split by the buyer/seller split that would otherwise apply. */
    minFeeAllocation: text().notNull().default('PROPORTIONAL'),
    rounding: text().notNull().default('TOTAL_HALF_UP__BUYER_HALF_UP__SELLER_REMAINDER'),
    shippingInFeeBase: boolean().notNull().default(false),
    /** Internal contribution-margin target (bps). Governance only, never a customer promise. */
    targetMarginBps: integer().notNull().default(5000),
    assumptions: jsonb().$type<PricingAssumptions>().notNull(),
    taxTreatment: text({ enum: TAX_TREATMENTS }).notNull().default('UNRESOLVED'),
    notes: text(),
    clonedFromId: uuid(),
    effectiveFrom: ts(),
    /** Expected margin from the governance simulation at validation (bps). */
    expectedMarginBps: integer(),
    createdBy: uuid().references(() => users.id),
    validatedBy: uuid().references(() => users.id),
    validatedAt: ts(),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    approvalReason: text(),
    marginOverride: boolean().notNull().default(false),
    marginOverrideBy: uuid().references(() => users.id),
    marginOverrideReason: text(),
    publishedBy: uuid().references(() => users.id),
    publishedAt: ts(),
    publishReason: text(),
    cancelledBy: uuid().references(() => users.id),
    cancelledAt: ts(),
    configHash: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pricing_versions_no_uq').on(t.model, t.versionNo),
    uniqueIndex('pricing_versions_effective_uq').on(t.model, t.effectiveFrom).where(sql`${t.status} = 'PUBLISHED'`),
    index('pricing_versions_lookup_idx').on(t.model, t.status, t.effectiveFrom),
    enumCheck('pricing_versions_model_chk', t.model, PRICING_MODELS),
    enumCheck('pricing_versions_status_chk', t.status, PRICING_STATUSES),
    enumCheck('pricing_versions_tax_chk', t.taxTreatment, TAX_TREATMENTS),
    check('pricing_versions_currency_chk', sql`${t.currency} = 'EGP'`),
    check('pricing_versions_min_chk', sql`${t.minFee} >= 0`),
    check('pricing_versions_target_chk', sql`${t.targetMarginBps} between 0 and 10000`),
    // Maker/checker: the approver is never the maker who submitted the version.
    check('pricing_versions_maker_checker_chk', sql`${t.approvedBy} is null or ${t.validatedBy} is null or ${t.approvedBy} <> ${t.validatedBy}`),
    check('pricing_versions_published_chk', sql`${t.status} <> 'PUBLISHED' or (${t.effectiveFrom} is not null and ${t.approvedBy} is not null and ${t.publishedBy} is not null)`),
  ],
);

export const pricingTiers = pgTable(
  'pricing_tiers',
  {
    id: uuid().primaryKey().defaultRandom(),
    versionId: uuid().notNull().references(() => pricingVersions.id),
    /** LOW_MARGIN | STANDARD | HIGH_MARGIN for marketplace, DEAL for protected deals. */
    economicClass: text().notNull(),
    seq: integer().notNull(),
    /** Tier covers (lowerBound, upperBound] of the fee base, piastres; the first tier starts at 0. */
    lowerBound: money().notNull(),
    upperBound: money(),
    buyerBps: integer().notNull(),
    sellerBps: integer().notNull(),
    totalBps: integer().notNull(),
  },
  (t) => [
    uniqueIndex('pricing_tiers_seq_uq').on(t.versionId, t.economicClass, t.seq),
    check('pricing_tiers_split_chk', sql`${t.buyerBps} + ${t.sellerBps} = ${t.totalBps}`),
    check('pricing_tiers_rates_chk', sql`${t.buyerBps} >= 0 and ${t.sellerBps} >= 0 and ${t.totalBps} between 0 and 10000`),
    check('pricing_tiers_bounds_chk', sql`${t.lowerBound} >= 0 and (${t.upperBound} is null or ${t.upperBound} > ${t.lowerBound})`),
    check('pricing_tiers_class_chk', sql`${t.economicClass} in ('LOW_MARGIN','STANDARD','HIGH_MARGIN','DEAL')`),
  ],
);

/** Category → economic class, per version (descendants inherit the nearest mapped ancestor). */
export const pricingCategoryClasses = pgTable(
  'pricing_category_classes',
  {
    id: uuid().primaryKey().defaultRandom(),
    versionId: uuid().notNull().references(() => pricingVersions.id),
    categoryId: uuid().notNull().references(() => categories.id),
    economicClass: text({ enum: ECONOMIC_CLASSES }).notNull(),
  },
  (t) => [uniqueIndex('pricing_category_classes_uq').on(t.versionId, t.categoryId), enumCheck('pricing_category_classes_class_chk', t.economicClass, ECONOMIC_CLASSES)],
);

/* ═══════════════ Payout / transfer channels (cost + operational limits) ═══════════════
 * Rows are versions: a change inserts a new row and closes the previous one (effective_to).
 * Only is_active / effective_to may change on an existing row (DB trigger). */
export const PAYOUT_CHANNELS = ['INSTAPAY', 'BANK_TRANSFER', 'MOBILE_WALLET', 'FUTURE_PSP', 'OTHER'] as const;
export type PayoutChannel = (typeof PAYOUT_CHANNELS)[number];
export const TRANSFER_COST_PAYERS = ['SELLER_PAYS', 'EDMN_PAYS'] as const;
export type TransferCostPayer = (typeof TRANSFER_COST_PAYERS)[number];

export const payoutChannelConfigs = pgTable(
  'payout_channel_configs',
  {
    id: uuid().primaryKey().defaultRandom(),
    channel: text({ enum: PAYOUT_CHANNELS }).notNull(),
    name: text().notNull(),
    version: integer().notNull(),
    isActive: boolean().notNull().default(true),
    costBps: integer().notNull().default(0),
    costFixed: money().notNull().default(0),
    costMin: money().notNull().default(0),
    costMax: money(),
    payerPolicy: text({ enum: TRANSFER_COST_PAYERS }).notNull().default('SELLER_PAYS'),
    taxTreatment: text({ enum: TAX_TREATMENTS }).notNull().default('UNRESOLVED'),
    maxPerTransaction: money(),
    maxPerDay: money(),
    maxPerMonth: money(),
    recipientMaxPerDay: money(),
    recipientMaxPerMonth: money(),
    /** Warn when a payout uses more than this share of a limit (bps). */
    warningThresholdBps: integer().notNull().default(8000),
    effectiveFrom: ts().notNull(),
    effectiveTo: ts(),
    notes: text(),
    sourceReference: text(),
    lastReviewedAt: ts(),
    lastReviewedBy: uuid().references(() => users.id),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payout_channel_configs_version_uq').on(t.channel, t.version),
    index('payout_channel_configs_lookup_idx').on(t.channel, t.isActive, t.effectiveFrom),
    enumCheck('payout_channel_configs_channel_chk', t.channel, PAYOUT_CHANNELS),
    enumCheck('payout_channel_configs_payer_chk', t.payerPolicy, TRANSFER_COST_PAYERS),
    check('payout_channel_configs_cost_chk', sql`${t.costBps} between 0 and 10000 and ${t.costFixed} >= 0 and ${t.costMin} >= 0 and (${t.costMax} is null or ${t.costMax} >= ${t.costMin})`),
    check('payout_channel_configs_dates_chk', sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

/* ═══════════════ Fee refund & cost attribution policy ═══════════════ */
export const REFUND_LIFECYCLE_STAGES = ['BEFORE_SHIPMENT', 'IN_TRANSIT', 'AFTER_DELIVERY', 'AFTER_RELEASE'] as const;
export type RefundLifecycleStage = (typeof REFUND_LIFECYCLE_STAGES)[number];
export const REFUND_REASON_CODES = [
  'SELLER_FAULT',
  'WRONG_ITEM',
  'DAMAGED_ITEM',
  'NOT_AS_DESCRIBED',
  'NON_DELIVERY',
  'BUYER_VOLUNTARY_RETURN',
  'BUYER_CANCELLATION',
  'EDMN_ERROR',
  'CARRIER_FAILURE',
  'PAYMENT_ERROR',
  'FRAUD',
  'DISPUTE_RESOLUTION',
  'OTHER',
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];
export const RESPONSIBLE_PARTIES = ['SELLER', 'BUYER', 'EDMN', 'CARRIER', 'PROVIDER', 'UNDETERMINED'] as const;
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];
export const SHIPPING_REFUND_RULES = ['FULL', 'NONE', 'MANUAL'] as const;
export const REFUND_POLICY_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;

export const refundFeePolicyVersions = pgTable(
  'refund_fee_policy_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    versionNo: integer().notNull(),
    status: text({ enum: REFUND_POLICY_STATUSES }).notNull().default('DRAFT'),
    legalReviewRequired: boolean().notNull().default(true),
    legalPolicyVersion: text(),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    publishedBy: uuid().references(() => users.id),
    publishedAt: ts(),
    publishReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refund_fee_policy_versions_no_uq').on(t.versionNo),
    enumCheck('refund_fee_policy_versions_status_chk', t.status, REFUND_POLICY_STATUSES),
    // A policy can only be published after legal review is recorded.
    check('refund_fee_policy_versions_legal_chk', sql`${t.status} <> 'PUBLISHED' or ${t.legalReviewRequired} = false`),
  ],
);

export const refundFeePolicyRules = pgTable(
  'refund_fee_policy_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    versionId: uuid().notNull().references(() => refundFeePolicyVersions.id),
    lifecycleStage: text({ enum: REFUND_LIFECYCLE_STAGES }).notNull(),
    reasonCode: text({ enum: REFUND_REASON_CODES }).notNull(),
    responsibleParty: text({ enum: RESPONSIBLE_PARTIES }).notNull(),
    /** Share of the buyer fee on the refunded units that is returned to the buyer (bps). */
    buyerFeeRefundBps: integer().notNull(),
    /** Share of the seller fee on the refunded units that is reversed to the seller (bps). */
    sellerFeeReversalBps: integer().notNull(),
    shippingRefund: text({ enum: SHIPPING_REFUND_RULES }).notNull(),
    returnShippingPayer: text({ enum: RESPONSIBLE_PARTIES }).notNull(),
    transferCostPayer: text({ enum: RESPONSIBLE_PARTIES }).notNull(),
    manualReview: boolean().notNull().default(true),
    notes: text(),
  },
  (t) => [
    uniqueIndex('refund_fee_policy_rules_uq').on(t.versionId, t.lifecycleStage, t.reasonCode, t.responsibleParty),
    check('refund_fee_policy_rules_bps_chk', sql`${t.buyerFeeRefundBps} between 0 and 10000 and ${t.sellerFeeReversalBps} between 0 and 10000`),
  ],
);

/* ═══════════════ Transaction costs (profitability) ═══════════════
 * ACTUAL costs that are known (payout transfer cost recorded at payout, refund transfer cost, return
 * / dispute direct costs entered by Finance) and explicit ESTIMATES. Append-only (DB trigger).
 * Reserves/provisions from pricing assumptions are computed, never stored as cash. */
export const COST_TYPES = ['COLLECTION', 'PAYOUT_TRANSFER', 'REFUND_TRANSFER', 'RETURN_DIRECT', 'DISPUTE_DIRECT', 'PROVIDER', 'OTHER'] as const;
export type CostType = (typeof COST_TYPES)[number];
export const COST_NATURES = ['ACTUAL', 'ESTIMATE'] as const;
export const COST_BEARERS = ['EDMN', 'SELLER', 'BUYER'] as const;

export const transactionCosts = pgTable(
  'transaction_costs',
  {
    id: uuid().primaryKey().defaultRandom(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    costType: text({ enum: COST_TYPES }).notNull(),
    nature: text({ enum: COST_NATURES }).notNull(),
    borneBy: text({ enum: COST_BEARERS }).notNull(),
    amount: money().notNull(),
    reference: text(),
    journalEntryId: uuid(),
    notes: text(),
    idempotencyKey: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('transaction_costs_entity_idx').on(t.entityType, t.entityId),
    uniqueIndex('transaction_costs_idem_uq').on(t.idempotencyKey),
    enumCheck('transaction_costs_type_chk', t.costType, COST_TYPES),
    enumCheck('transaction_costs_nature_chk', t.nature, COST_NATURES),
    enumCheck('transaction_costs_bearer_chk', t.borneBy, COST_BEARERS),
    check('transaction_costs_amount_chk', sql`${t.amount} >= 0`),
  ],
);
