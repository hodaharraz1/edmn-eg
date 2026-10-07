import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, index, jsonb, pgTable, text, uniqueIndex, uuid, date } from 'drizzle-orm/pg-core';
import { ADJUSTMENT_STATUSES, PAYOUT_TYPES, WITHDRAWAL_STATUSES } from '@/domain/machines';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { files } from './files';
import { users } from './identity';
import { sellerPayoutMethods, sellers } from './sellers';
import { sellerOrders } from './commerce';

/**
 * Double-entry ledger. Balances are a transactional projection of journal lines
 * (ledger_accounts.balance is updated in the same transaction that posts lines, under row lock)
 * and can be fully re-derived from journal_lines at any time (see reconcile()).
 */
export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY'] as const;
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    name: text().notNull(),
    type: text({ enum: ACCOUNT_TYPES }).notNull(),
    sellerId: uuid().references(() => sellers.id),
    currency: text().notNull().default('EGP'),
    /** Balance in the account's normal direction (credit-normal for LIABILITY/REVENUE/EQUITY). */
    balance: money().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ledger_accounts_platform_uq').on(t.code).where(sql`${t.sellerId} is null`),
    uniqueIndex('ledger_accounts_seller_uq').on(t.code, t.sellerId).where(sql`${t.sellerId} is not null`),
    enumCheck('ledger_accounts_type_chk', t.type, ACCOUNT_TYPES),
  ],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    seq: bigserial({ mode: 'number' }).notNull(),
    entryType: text().notNull(),
    sourceType: text().notNull(),
    sourceId: text().notNull(),
    /** Unique business key — the core idempotency guarantee for every money movement. */
    idempotencyKey: text().notNull(),
    description: text().notNull(),
    currency: text().notNull().default('EGP'),
    reversesEntryId: uuid(),
    /** The operation-specific Admin financial approval this entry executes (DB trigger: mandatory for new entries). */
    approvalId: uuid(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('journal_entries_idem_uq').on(t.idempotencyKey),
    index('journal_entries_approval_idx').on(t.approvalId),
    index('journal_entries_type_idx').on(t.entryType, t.createdAt),
    index('journal_entries_source_idx').on(t.sourceType, t.sourceId),
    index('journal_entries_created_idx').on(t.createdAt),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    entryId: uuid()
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid()
      .notNull()
      .references(() => ledgerAccounts.id),
    debit: money().notNull().default(0),
    credit: money().notNull().default(0),
    memo: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('journal_lines_entry_idx').on(t.entryId),
    index('journal_lines_account_idx').on(t.accountId, t.createdAt),
    check(
      'journal_lines_amount_chk',
      sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} = 0) <> (${t.credit} = 0)`,
    ),
  ],
);

export const SETTLEMENT_STATUSES = ['CREATED', 'COMPLETED'] as const;
export const settlements = pgTable(
  'settlements',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    scheduledFor: date({ mode: 'string' }).notNull(),
    status: text({ enum: SETTLEMENT_STATUSES }).notNull().default('CREATED'),
    totalAmount: money().notNull().default(0),
    itemCount: bigint({ mode: 'number' }).notNull().default(0),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('settlements_date_uq').on(t.scheduledFor), uniqueIndex('settlements_number_uq').on(t.number)],
);

export const withdrawalRequests = pgTable(
  'withdrawal_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id),
    amount: money().notNull(),
    status: text({ enum: WITHDRAWAL_STATUSES }).notNull().default('REQUESTED'),
    source: text().notNull().default('ON_DEMAND'), // ON_DEMAND | SCHEDULED
    settlementId: uuid().references(() => settlements.id),
    payoutMethodId: uuid().references(() => sellerPayoutMethods.id),
    payoutType: text({ enum: PAYOUT_TYPES }).notNull(),
    payoutMasked: text().notNull(),
    clientKey: text().notNull(),
    requestedBy: uuid().references(() => users.id),
    slaDueAt: ts().notNull(),
    requiresDualControl: boolean().notNull().default(false),
    reviewedBy: uuid().references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    processingBy: uuid().references(() => users.id),
    paidBy: uuid().references(() => users.id),
    paidAt: ts(),
    paidReference: text(),
    proofFileId: uuid().references(() => files.id),
    rejectReason: text(),
    /** Set when Admin approval reserved the funds (AVAILABLE → RESERVED). A bare request moves no money. */
    reservedAt: ts(),
    reserveApprovalId: uuid(),
    payoutApprovalId: uuid(),
    /** Destination frozen at approval: a later payout-method change never redirects this payout. */
    destinationSnapshot: jsonb(),
    /** Snapshot: requested while real money was disabled — closing it moves no money. */
    isTest: boolean().notNull().default(true),
    /** Transfer cost: quoted at request, frozen at approval, actual recorded at payout. Never the EDMN sale fee. */
    payoutChannel: text(),
    payoutChannelConfigId: uuid(),
    transferCostPayer: text(),
    transferCost: money().notNull().default(0),
    netTransferAmount: money(),
    actualTransferCost: money(),
    transferCostSnapshot: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('withdrawals_number_uq').on(t.number),
    uniqueIndex('withdrawals_client_key_uq').on(t.sellerId, t.clientKey),
    index('withdrawals_seller_idx').on(t.sellerId, t.createdAt),
    index('withdrawals_status_idx').on(t.status, t.slaDueAt),
    enumCheck('withdrawals_status_chk', t.status, WITHDRAWAL_STATUSES),
    check('withdrawals_amount_chk', sql`${t.amount} > 0`),
  ],
);

export const ledgerAdjustments = pgTable(
  'ledger_adjustments',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id),
    sellerOrderId: uuid().references(() => sellerOrders.id),
    /** Signed: positive credits the seller's available balance, negative debits it. */
    amount: money().notNull(),
    reasonCode: text().notNull(),
    reason: text().notNull(),
    status: text({ enum: ADJUSTMENT_STATUSES }).notNull().default('PENDING_APPROVAL'),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    rejectReason: text(),
    journalEntryId: uuid().references(() => journalEntries.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_adjustments_number_uq').on(t.number),
    index('ledger_adjustments_status_idx').on(t.status),
    enumCheck('ledger_adjustments_status_chk', t.status, ADJUSTMENT_STATUSES),
    check('ledger_adjustments_amount_chk', sql`${t.amount} <> 0`),
    check('ledger_adjustments_checker_chk', sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.createdBy}`),
  ],
);
