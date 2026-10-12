import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { files } from './files';
import { users } from './identity';
import { sellers } from './sellers';

/* ═════════════════ Global user identity (KYC) — ONE domain for buyers, Marketplace and Protected Deal sellers ═════════════════
 * Identity APPROVED ≠ seller/store approved ≠ payout destination verified ≠ refund approved ≠ any release.
 * National ID number is AES-GCM encrypted (only the last 4 digits are stored in clear for display);
 * front/back images are PRIVATE files with purpose IDENTITY_DOCUMENT (business-derived access, audited). */
export const IDENTITY_STATUSES = ['INCOMPLETE', 'PENDING_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'REJECTED', 'REVERIFICATION_REQUIRED'] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];
/** SELF = submitted by the user; LEGACY_SELLER_APPLICATION = linked from a pre-existing seller application (never auto-approved). */
export const IDENTITY_SOURCES = ['SELF', 'LEGACY_SELLER_APPLICATION'] as const;

export const userIdentityVerifications = pgTable(
  'user_identity_verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: text({ enum: IDENTITY_STATUSES }).notNull().default('INCOMPLETE'),
    legalName: text(),
    nationalIdEnc: text(),
    nationalIdLast4: text(),
    frontFileId: uuid().references(() => files.id),
    backFileId: uuid().references(() => files.id),
    source: text({ enum: IDENTITY_SOURCES }).notNull().default('SELF'),
    legacySellerId: uuid().references(() => sellers.id),
    /** Increments on every (re)submission: reviews always refer to an exact submission. */
    submissionVersion: integer().notNull().default(0),
    submittedAt: ts(),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: ts(),
    /** Customer-safe reason (shown to the user). */
    reviewReason: text(),
    /** Staff-only note (never shown to the user, never in notifications). */
    internalNote: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_identity_verifications_user_uq').on(t.userId),
    index('user_identity_verifications_status_idx').on(t.status, t.submittedAt),
    enumCheck('user_identity_verifications_status_chk', t.status, IDENTITY_STATUSES),
    enumCheck('user_identity_verifications_source_chk', t.source, IDENTITY_SOURCES),
    check('user_identity_verifications_approved_chk', sql`${t.status} <> 'APPROVED' or (${t.reviewedBy} is not null and ${t.frontFileId} is not null and ${t.backFileId} is not null and ${t.nationalIdEnc} is not null and ${t.legalName} is not null)`),
  ],
);

/* ═════════════════ Buyer money-receiving details (NOT a wallet: no balance, no withdrawal) ═════════════════
 * Versioned and immutable: a material change creates a NEW version (the previous one is ARCHIVED), so a refund
 * snapshot always names the exact verified version. Usable only once APPROVED by a destination reviewer. */
export const RECEIVING_DESTINATION_TYPES = ['BANK_ACCOUNT', 'MOBILE_WALLET', 'INSTAPAY'] as const;
export const RECEIVING_DESTINATION_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'MORE_INFO_REQUIRED', 'REJECTED', 'REVERIFICATION_REQUIRED', 'ARCHIVED'] as const;
export type ReceivingDestinationStatus = (typeof RECEIVING_DESTINATION_STATUSES)[number];

export const receivingDestinations = pgTable(
  'receiving_destinations',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: text({ enum: RECEIVING_DESTINATION_TYPES }).notNull(),
    /** Encrypted JSON of the exact transfer fields; never logged, never in notifications. */
    detailsEnc: text().notNull(),
    maskedLabel: text().notNull(),
    holderName: text().notNull(),
    /** sha256 of the canonical details: what a review / refund snapshot actually verified. */
    fingerprint: text().notNull(),
    version: integer().notNull().default(1),
    supersedesId: uuid(),
    status: text({ enum: RECEIVING_DESTINATION_STATUSES }).notNull().default('PENDING_REVIEW'),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: ts(),
    reviewReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('receiving_destinations_user_idx').on(t.userId, t.status),
    index('receiving_destinations_status_idx').on(t.status, t.createdAt),
    enumCheck('receiving_destinations_type_chk', t.type, RECEIVING_DESTINATION_TYPES),
    enumCheck('receiving_destinations_status_chk', t.status, RECEIVING_DESTINATION_STATUSES),
    check('receiving_destinations_approved_chk', sql`${t.status} <> 'APPROVED' or (${t.reviewedBy} is not null and ${t.reviewedAt} is not null)`),
  ],
);

/** Review history for identity cases and receiving destinations (append-only). */
export const REVIEW_SUBJECTS = ['IDENTITY', 'RECEIVING_DESTINATION'] as const;
export const reviewEvents = pgTable(
  'review_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    subjectType: text({ enum: REVIEW_SUBJECTS }).notNull(),
    subjectId: uuid().notNull(),
    actorUserId: uuid().references(() => users.id),
    action: text().notNull(),
    fromStatus: text(),
    toStatus: text().notNull(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [index('review_events_subject_idx').on(t.subjectType, t.subjectId, t.createdAt), enumCheck('review_events_subject_chk', t.subjectType, REVIEW_SUBJECTS)],
);

/* ═════════════════ Universal Maker/Checker for actual financial movements ═════════════════
 * A Maker (authorized staff, fresh 2FA) proposes ONE movement on ONE entity for an exact amount; a DIFFERENT
 * authorized Checker executes it (the execution grants the operation-specific approval with requested_by =
 * Maker; the DB refuses any movement approval without a distinct requester). One open request per movement. */
export const MOVEMENT_KINDS = ['SELLER_RELEASE', 'DEAL_RELEASE', 'REFUND_APPROVAL', 'REFUND_REVOCATION', 'WITHDRAWAL_REVERSAL', 'WITHDRAWAL_RETURN'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export const MOVEMENT_STATUSES = ['PENDING', 'EXECUTED', 'REJECTED', 'CANCELLED'] as const;

export const financialMovementRequests = pgTable(
  'financial_movement_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text({ enum: MOVEMENT_KINDS }).notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    amount: money().notNull(),
    /** Kind-specific inputs the Checker must execute exactly (e.g. evidence reference, returned amount). */
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    reason: text().notNull(),
    status: text({ enum: MOVEMENT_STATUSES }).notNull().default('PENDING'),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id),
    requestedAt: createdAt(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    decisionReason: text(),
    approvalId: uuid(),
  },
  (t) => [
    uniqueIndex('financial_movement_requests_open_uq').on(t.kind, t.entityId).where(sql`${t.status} = 'PENDING'`),
    index('financial_movement_requests_status_idx').on(t.status, t.requestedAt),
    enumCheck('financial_movement_requests_kind_chk', t.kind, MOVEMENT_KINDS),
    enumCheck('financial_movement_requests_status_chk', t.status, MOVEMENT_STATUSES),
    check('financial_movement_requests_amount_chk', sql`${t.amount} >= 0`),
    check('financial_movement_requests_checker_chk', sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
  ],
);

/* ═════════════════ Privileged staff access to private conversations ═════════════════ */
export const MESSAGE_ACCESS_PURPOSES = ['SUPPORT', 'DISPUTE', 'RISK', 'OPERATIONS', 'FINANCIAL_REVIEW'] as const;
export const privilegedMessageAccess = pgTable(
  'privileged_message_access',
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: uuid()
      .notNull()
      .references(() => users.id),
    conversationId: uuid().notNull(),
    purpose: text({ enum: MESSAGE_ACCESS_PURPOSES }).notNull(),
    note: text().notNull(),
    caseType: text(),
    caseId: text(),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('privileged_message_access_actor_idx').on(t.actorUserId, t.conversationId, t.expiresAt), enumCheck('privileged_message_access_purpose_chk', t.purpose, MESSAGE_ACCESS_PURPOSES)],
);

/* ═════════════════ Support SLA cycles (a reopen starts a NEW cycle; old cycles are never rewritten) ═════════════════ */
export const supportSlaCycles = pgTable(
  'support_sla_cycles',
  {
    id: uuid().primaryKey().defaultRandom(),
    ticketId: uuid().notNull(),
    cycle: integer().notNull(),
    startedAt: createdAt(),
    startedBy: uuid().references(() => users.id),
    /** Why this cycle started: OPENED | REOPENED_FROM_RESOLVED | REOPENED_FROM_CLOSED. */
    trigger: text().notNull(),
    reopenReason: text(),
    firstResponseDueAt: ts(),
    resolutionDueAt: ts(),
    firstRespondedAt: ts(),
    resolvedAt: ts(),
    closedAt: ts(),
    firstResponseBreached: boolean(),
    resolutionBreached: boolean(),
  },
  (t) => [uniqueIndex('support_sla_cycles_ticket_cycle_uq').on(t.ticketId, t.cycle)],
);

/* ═════════════════ Proactive alerts (one state row per rule × entity × recipient; dedupe + cooldown) ═════════════════ */
export const ALERT_STAGES = ['PRE_DEADLINE', 'DUE', 'OVERDUE', 'RESOLVED'] as const;
export type AlertStage = (typeof ALERT_STAGES)[number];
export const alertStates = pgTable(
  'alert_states',
  {
    id: uuid().primaryKey().defaultRandom(),
    rule: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    recipientUserId: uuid()
      .notNull()
      .references(() => users.id),
    deadlineAt: ts(),
    stage: text({ enum: ALERT_STAGES }).notNull(),
    severity: text().notNull().default('NORMAL'),
    sentCount: integer().notNull().default(0),
    lastSentAt: ts(),
    nextEligibleAt: ts(),
    resolvedAt: ts(),
    /** Safe metadata only (references, never PII / destinations / identity data). */
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('alert_states_key_uq').on(t.rule, t.entityId, t.recipientUserId),
    index('alert_states_open_idx').on(t.rule, t.stage).where(sql`${t.resolvedAt} is null`),
    enumCheck('alert_states_stage_chk', t.stage, ALERT_STAGES),
  ],
);
