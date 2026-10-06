import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { users } from './identity';

/* ───────── Operation-specific Admin financial approvals ─────────
 * Every journal entry posted after migration 0008 must reference one of these (DB trigger).
 * An approval names exactly one operation on one entity for one amount/currency/economic version;
 * it is consumed by the execution that posts it and can never be reused, and a REVOKED or stale
 * approval can never be executed. One approval may cover several balanced legs of the same operation. */
export const FINANCIAL_ACTIONS = [
  'PAYMENT_CONFIRMATION',
  'SELLER_RELEASE',
  'REFUND_APPROVAL',
  'REFUND_PAYOUT',
  'WITHDRAWAL_RESERVATION',
  'WITHDRAWAL_RELEASE_RESERVATION',
  'WITHDRAWAL_PAYOUT',
  'MANUAL_ADJUSTMENT',
  'DEAL_PAYMENT_CONFIRMATION',
  'DEAL_RELEASE',
  'DEAL_REFUND',
  'DEAL_PAYOUT',
] as const;
export type FinancialAction = (typeof FINANCIAL_ACTIONS)[number];
export const APPROVAL_STATUSES = ['PENDING_CHECKER', 'APPROVED', 'CONSUMED', 'REVOKED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const financialApprovals = pgTable(
  'financial_approvals',
  {
    id: uuid().primaryKey().defaultRandom(),
    action: text({ enum: FINANCIAL_ACTIONS }).notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    amount: money().notNull(),
    currency: text().notNull().default('EGP'),
    /** Version of the economic state the approval was given against (stale approvals are rejected). */
    economicVersion: text().notNull(),
    /** Journal entry types this approval may post. */
    entryTypes: text().array().notNull(),
    destinationSnapshot: jsonb(),
    reason: text().notNull(),
    status: text({ enum: APPROVAL_STATUSES }).notNull().default('APPROVED'),
    /** Two-person control: the approver must differ from the requester (maker). */
    dualControl: boolean().notNull().default(false),
    requestedBy: uuid().references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    stepUpAt: ts(),
    consumedAt: ts(),
    revokedBy: uuid().references(() => users.id),
    revokedAt: ts(),
    revokeReason: text(),
    idempotencyKey: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('financial_approvals_idem_uq').on(t.idempotencyKey),
    index('financial_approvals_entity_idx').on(t.entityType, t.entityId),
    index('financial_approvals_status_idx').on(t.status, t.createdAt),
    enumCheck('financial_approvals_action_chk', t.action, FINANCIAL_ACTIONS),
    enumCheck('financial_approvals_status_chk', t.status, APPROVAL_STATUSES),
    check('financial_approvals_amount_chk', sql`${t.amount} >= 0`),
    check('financial_approvals_currency_chk', sql`${t.currency} = 'EGP'`),
    // Maker/checker: whoever requested a dual-control approval can never be its approver.
    check('financial_approvals_checker_chk', sql`not ${t.dualControl} or ${t.approvedBy} is null or ${t.approvedBy} <> ${t.requestedBy}`),
  ],
);

/* ───────── Reconciliation: external statements ↔ payments/payouts ↔ journal ───────── */
export const RECON_CHANNELS = ['BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH', 'PSP'] as const;
export const RECON_DIRECTIONS = ['IN', 'OUT'] as const;
export const RECON_STATES = ['UNMATCHED', 'SUGGESTED_MATCH', 'MATCHED', 'MISMATCH', 'IGNORED_WITH_REASON'] as const;
export type ReconState = (typeof RECON_STATES)[number];
export const reconImports = pgTable('recon_imports', {
  id: uuid().primaryKey().defaultRandom(),
  channel: text({ enum: RECON_CHANNELS }).notNull(),
  fileName: text(),
  rowCount: bigint({ mode: 'number' }).notNull().default(0),
  status: text().notNull().default('IMPORTED'), // IMPORTED | FAILED
  error: text(),
  importedBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});
export const externalTransactions = pgTable(
  'external_transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    importId: uuid().references(() => reconImports.id),
    channel: text({ enum: RECON_CHANNELS }).notNull(),
    direction: text({ enum: RECON_DIRECTIONS }).notNull(),
    externalRef: text().notNull(),
    amount: money().notNull(),
    currency: text().notNull().default('EGP'),
    occurredAt: ts().notNull(),
    counterparty: text(),
    state: text({ enum: RECON_STATES }).notNull().default('UNMATCHED'),
    matchedType: text(), // payment | withdrawal | refund | deal_payout
    matchedId: uuid(),
    journalEntryId: uuid(),
    suggestion: jsonb(),
    note: text(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('external_tx_ref_uq').on(t.channel, t.direction, t.externalRef),
    index('external_tx_state_idx').on(t.state, t.occurredAt),
    enumCheck('external_tx_state_chk', t.state, RECON_STATES),
    check('external_tx_amount_chk', sql`${t.amount} > 0`),
    check('external_tx_currency_chk', sql`${t.currency} = 'EGP'`),
  ],
);

/* ───────── Payment / payout provider callbacks (inbox; providers are NOT connected) ───────── */
export const providerEvents = pgTable(
  'provider_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    eventId: text().notNull(),
    eventType: text().notNull(),
    signatureValid: boolean().notNull(),
    occurredAt: ts(),
    receivedAt: ts().notNull().defaultNow(),
    /** sha256 of the raw body (raw bodies are not stored: they may carry personal data). */
    bodySha256: text().notNull(),
    payloadSummary: jsonb(),
    status: text().notNull(), // RECORDED_AS_EVIDENCE | REJECTED_SIGNATURE | REJECTED_REPLAY | REJECTED_STALE | UNKNOWN_TYPE | DUPLICATE
    note: text(),
  },
  (t) => [uniqueIndex('provider_events_uq').on(t.provider, t.eventId), index('provider_events_received_idx').on(t.receivedAt)],
);

/* ───────── Account closure (buyer / seller) ───────── */
export const CLOSURE_STATUSES = ['BLOCKED', 'PENDING', 'COMPLETED', 'WITHDRAWN'] as const;
export const accountClosureRequests = pgTable(
  'account_closure_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: text({ enum: CLOSURE_STATUSES }).notNull(),
    blockers: jsonb().$type<{ code: string; count: number }[]>().notNull().default([]),
    reason: text(),
    decidedBy: uuid().references(() => users.id),
    completedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('closure_user_idx').on(t.userId, t.createdAt), enumCheck('closure_status_chk', t.status, CLOSURE_STATUSES)],
);

/* ───────── Daily financial close (snapshot of a control report; never edits the ledger) ───────── */
export const financialCloses = pgTable(
  'financial_closes',
  {
    id: uuid().primaryKey().defaultRandom(),
    businessDate: date({ mode: 'string' }).notNull(),
    report: jsonb().notNull(),
    balanced: boolean().notNull(),
    issues: bigint({ mode: 'number' }).notNull().default(0),
    closedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('financial_closes_date_uq').on(t.businessDate)],
);
