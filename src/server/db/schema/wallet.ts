import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, money, ts } from './_helpers';
import { files } from './files';
import { users } from './identity';
import { journalEntries } from './finance';

/**
 * PKG-WALLET-01 (phase 1): customer wallet top-up. A deposit is money the customer transferred (InstaPay / bank) with a
 * receipt; nothing is credited until two different staff approve it (maker requests, checker executes).
 */
export const WALLET_TOPUP_METHODS = ['BANK_TRANSFER', 'INSTAPAY'] as const;
export const WALLET_TOPUP_STATUSES = ['PENDING_REVIEW', 'CREDITED', 'REJECTED', 'CANCELLED'] as const;
export type WalletTopupStatus = (typeof WALLET_TOPUP_STATUSES)[number];

export const walletTopups = pgTable(
  'wallet_topups',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    amount: money().notNull(),
    method: text({ enum: WALLET_TOPUP_METHODS }).notNull(),
    proofFileId: uuid()
      .notNull()
      .references(() => files.id),
    proofSha256: text(),
    payerReference: text(),
    status: text({ enum: WALLET_TOPUP_STATUSES }).notNull().default('PENDING_REVIEW'),
    rejectReason: text(),
    journalEntryId: uuid().references(() => journalEntries.id),
    /** Client idempotency key: a retried submit returns the first deposit. */
    clientKey: text().notNull(),
    createdAt: createdAt(),
    decidedAt: ts(),
    decidedBy: uuid().references(() => users.id),
  },
  (t) => [
    index('wallet_topups_user_idx').on(t.userId, t.createdAt),
    index('wallet_topups_status_idx').on(t.status, t.createdAt),
    uniqueIndex('wallet_topups_client_key_uq').on(t.userId, t.clientKey),
    enumCheck('wallet_topups_status_chk', t.status, WALLET_TOPUP_STATUSES),
    enumCheck('wallet_topups_method_chk', t.method, WALLET_TOPUP_METHODS),
    check('wallet_topups_amount_chk', sql`${t.amount} > 0`),
    check('wallet_topups_credited_chk', sql`${t.status} <> 'CREDITED' or (${t.journalEntryId} is not null and ${t.decidedBy} is not null)`),
    check('wallet_topups_rejected_chk', sql`${t.status} <> 'REJECTED' or (${t.rejectReason} is not null and ${t.decidedBy} is not null)`),
  ],
);

export const CUSTOMER_WALLET_ENTRY_KINDS = ['TOPUP', 'SPEND', 'SPEND_REVERSAL'] as const;

/** Per-user sub-ledger of CUSTOMER_WALLETS. Append-only (DB trigger); a user's sum is their balance and is never negative. */
export const customerWalletEntries = pgTable(
  'customer_wallet_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    journalEntryId: uuid()
      .notNull()
      .references(() => journalEntries.id),
    amount: bigint({ mode: 'number' }).notNull(),
    kind: text({ enum: CUSTOMER_WALLET_ENTRY_KINDS }).notNull(),
    topupId: uuid().references(() => walletTopups.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('customer_wallet_entries_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('customer_wallet_entries_topup_uq').on(t.topupId).where(sql`${t.topupId} is not null`),
    enumCheck('customer_wallet_entries_kind_chk', t.kind, CUSTOMER_WALLET_ENTRY_KINDS),
    check('customer_wallet_entries_amount_chk', sql`${t.amount} <> 0 and (${t.kind} <> 'TOPUP' or ${t.amount} > 0) and (${t.kind} <> 'SPEND' or ${t.amount} < 0) and (${t.kind} <> 'SPEND_REVERSAL' or ${t.amount} > 0)`),
  ],
);
