import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, ts } from './_helpers';
import { orders, sellerOrders } from './commerce';
import { externalDeals } from './deals';
import { files } from './files';
import { users } from './identity';
import { sellers } from './sellers';

/**
 * Buyer ↔ seller communication. Every conversation is bound to exactly ONE business context:
 * a marketplace seller sub-order (one conversation per seller, never a shared multi-seller thread)
 * or a protected deal. There are no free-form user-to-user conversations.
 *
 * Messages are SUPPORTING EVIDENCE only. They never change money, deal terms, payment, shipment,
 * OTP or dispute state — those live in their own authoritative records.
 */
export const CONVERSATION_CONTEXTS = ['SELLER_ORDER', 'DEAL'] as const;
export type ConversationContext = (typeof CONVERSATION_CONTEXTS)[number];
/** ACTIVE = participants may write (subject to the context's communication window); LOCKED = closed by staff. */
export const CONVERSATION_STATUSES = ['ACTIVE', 'LOCKED'] as const;
export const MESSAGE_SENDER_ROLES = ['BUYER', 'SELLER'] as const;
export type MessageSenderRole = (typeof MESSAGE_SENDER_ROLES)[number];
export const MESSAGE_REPORT_REASONS = ['INAPPROPRIATE', 'FRAUD_ATTEMPT', 'UNNEEDED_DATA_REQUEST', 'OTHER'] as const;
export type MessageReportReason = (typeof MESSAGE_REPORT_REASONS)[number];
export const MESSAGE_REPORT_STATUSES = ['OPEN', 'ACTIONED', 'DISMISSED'] as const;

export const conversations = pgTable(
  'conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    context: text({ enum: CONVERSATION_CONTEXTS }).notNull(),
    orderId: uuid().references(() => orders.id),
    sellerOrderId: uuid().references(() => sellerOrders.id),
    dealId: uuid().references(() => externalDeals.id),
    buyerUserId: uuid()
      .notNull()
      .references(() => users.id),
    /** Marketplace store side (any authorized member of this seller may take part). */
    sellerId: uuid().references(() => sellers.id),
    /** Protected-deal seller (the user who securely claimed the invitation). */
    sellerUserId: uuid().references(() => users.id),
    status: text({ enum: CONVERSATION_STATUSES }).notNull().default('ACTIVE'),
    lockedReason: text(),
    lockedBy: uuid().references(() => users.id),
    lockedAt: ts(),
    lastMessageAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('conversations_so_uq').on(t.sellerOrderId).where(sql`${t.sellerOrderId} is not null`),
    uniqueIndex('conversations_deal_uq').on(t.dealId).where(sql`${t.dealId} is not null`),
    index('conversations_buyer_idx').on(t.buyerUserId, t.lastMessageAt),
    index('conversations_seller_idx').on(t.sellerId, t.lastMessageAt),
    index('conversations_seller_user_idx').on(t.sellerUserId, t.lastMessageAt),
    enumCheck('conversations_context_chk', t.context, CONVERSATION_CONTEXTS),
    enumCheck('conversations_status_chk', t.status, CONVERSATION_STATUSES),
    check(
      'conversations_binding_chk',
      sql`(${t.context} = 'SELLER_ORDER' and ${t.sellerOrderId} is not null and ${t.orderId} is not null and ${t.sellerId} is not null and ${t.dealId} is null and ${t.sellerUserId} is null)
       or (${t.context} = 'DEAL' and ${t.dealId} is not null and ${t.sellerUserId} is not null and ${t.sellerOrderId} is null and ${t.orderId} is null and ${t.sellerId} is null)`,
    ),
  ],
);

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    senderUserId: uuid()
      .notNull()
      .references(() => users.id),
    senderRole: text({ enum: MESSAGE_SENDER_ROLES }).notNull(),
    body: text().notNull(),
    /** Idempotency key from the client: a retried send never duplicates a message. */
    clientKey: text().notNull(),
    createdAt: createdAt(),
    /** Moderation: the original record is preserved; participants see a placeholder instead. */
    hiddenAt: ts(),
    hiddenBy: uuid().references(() => users.id),
    hiddenReason: text(),
  },
  (t) => [
    index('conversation_messages_conv_idx').on(t.conversationId, t.createdAt),
    uniqueIndex('conversation_messages_client_uq').on(t.senderUserId, t.clientKey),
    enumCheck('conversation_messages_role_chk', t.senderRole, MESSAGE_SENDER_ROLES),
    check('conversation_messages_body_chk', sql`char_length(${t.body}) <= 2000`),
  ],
);

export const conversationMessageAttachments = pgTable(
  'conversation_message_attachments',
  {
    id: uuid().primaryKey().defaultRandom(),
    messageId: uuid()
      .notNull()
      .references(() => conversationMessages.id),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('conversation_message_attachments_file_uq').on(t.fileId), index('conversation_message_attachments_msg_idx').on(t.messageId)],
);

/** Per-user read position (each authorized store member has their own). */
export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    lastReadAt: ts().notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conversation_reads_user_idx').on(t.userId)],
);

export const conversationMessageReports = pgTable(
  'conversation_message_reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    messageId: uuid()
      .notNull()
      .references(() => conversationMessages.id),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    reporterUserId: uuid()
      .notNull()
      .references(() => users.id),
    reason: text({ enum: MESSAGE_REPORT_REASONS }).notNull(),
    note: text(),
    status: text({ enum: MESSAGE_REPORT_STATUSES }).notNull().default('OPEN'),
    handledBy: uuid().references(() => users.id),
    handledAt: ts(),
    resolutionNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('conversation_message_reports_uq').on(t.messageId, t.reporterUserId),
    index('conversation_message_reports_status_idx').on(t.status, t.createdAt),
    enumCheck('conversation_message_reports_reason_chk', t.reason, MESSAGE_REPORT_REASONS),
    enumCheck('conversation_message_reports_status_chk', t.status, MESSAGE_REPORT_STATUSES),
  ],
);
