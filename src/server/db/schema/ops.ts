import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { TICKET_PRIORITIES, TICKET_STATUSES, TICKET_TYPES } from '@/domain/machines';
import { createdAt, enumCheck, ts, updatedAt } from './_helpers';
import { files } from './files';
import { users } from './identity';
import { conversationMessages, conversations } from './messaging';
import { sellers } from './sellers';

/* ───────── Notifications ───────── */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    link: text(),
    readAt: ts(),
    /** Business-event identity: a retried event never creates a second identical notification. */
    dedupeKey: text(),
    /**
     * MESSAGE = a buyer↔seller message alert (counted by the Messages badge through conversation reads, never by
     * the bell); GENERAL = everything else (orders, payments, deals …), counted by the notification bell.
     */
    category: text().notNull().default('GENERAL'),
    conversationId: uuid().references(() => conversations.id),
    messageId: uuid().references(() => conversationMessages.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt),
    index('notifications_conversation_idx').on(t.userId, t.conversationId).where(sql`${t.conversationId} is not null and ${t.readAt} is null`),
    check('notifications_category_chk', sql`${t.category} in ('GENERAL','MESSAGE')`),
    uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

export const OUTBOUND_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    channel: text().notNull(), // EMAIL | SMS
    recipient: text().notNull(),
    subject: text(),
    body: text().notNull(),
    event: text(),
    status: text({ enum: OUTBOUND_STATUSES }).notNull().default('PENDING'),
    provider: text(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    sentAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('outbound_status_idx').on(t.status, t.createdAt)],
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    event: text().notNull(),
    channel: text().notNull(), // IN_APP | EMAIL | SMS
    subject: text(),
    body: text().notNull(),
    isEnabled: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.event, t.channel] })],
);

/* ───────── Background jobs (DB-backed queue; worker uses FOR UPDATE SKIP LOCKED) ───────── */
export const JOB_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const;
export const jobs = pgTable(
  'jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    type: text().notNull(),
    payload: jsonb().notNull().default({}),
    status: text({ enum: JOB_STATUSES }).notNull().default('PENDING'),
    runAt: ts().notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    lockedAt: ts(),
    lastError: text(),
    dedupeKey: text(),
    createdAt: createdAt(),
    finishedAt: ts(),
  },
  (t) => [
    index('jobs_pending_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_uq').on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    enumCheck('jobs_status_chk', t.status, JOB_STATUSES),
  ],
);

/* ───────── Support ───────── */
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: bigint({ mode: 'number' })
      .notNull()
      .default(sql`nextval('doc_number_seq')`),
    requesterUserId: uuid()
      .notNull()
      .references(() => users.id),
    sellerId: uuid().references(() => sellers.id), // set when opened from Seller Center
    type: text({ enum: TICKET_TYPES }).notNull(),
    subject: text().notNull(),
    status: text({ enum: TICKET_STATUSES }).notNull().default('OPEN'),
    priority: text({ enum: TICKET_PRIORITIES }).notNull().default('NORMAL'),
    assigneeId: uuid().references(() => users.id),
    relatedType: text(),
    relatedId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: ts(),
  },
  (t) => [
    uniqueIndex('support_tickets_number_uq').on(t.number),
    index('support_tickets_requester_idx').on(t.requesterUserId),
    index('support_tickets_status_idx').on(t.status, t.priority),
    enumCheck('support_tickets_status_chk', t.status, TICKET_STATUSES),
    enumCheck('support_tickets_type_chk', t.type, TICKET_TYPES),
    enumCheck('support_tickets_priority_chk', t.priority, TICKET_PRIORITIES),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    ticketId: uuid()
      .notNull()
      .references(() => supportTickets.id),
    authorUserId: uuid()
      .notNull()
      .references(() => users.id),
    isStaff: boolean().notNull().default(false),
    isInternal: boolean().notNull().default(false),
    body: text().notNull(),
    attachmentFileId: uuid().references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [index('support_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);

/* ───────── CMS ───────── */
export const CMS_BLOCK_TYPES = [
  'HERO',
  'BANNER',
  'FEATURED_CATEGORIES',
  'PRODUCT_RAIL',
  'FEATURED_SELLERS',
  'DEAL_CTA',
  'TRUST',
  'FOOTER',
] as const;
export const cmsBlocks = pgTable(
  'cms_blocks',
  {
    id: uuid().primaryKey().defaultRandom(),
    placement: text().notNull().default('HOME'),
    type: text({ enum: CMS_BLOCK_TYPES }).notNull(),
    title: text(),
    data: jsonb().notNull().default({}),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    startsAt: ts(),
    endsAt: ts(),
    updatedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_blocks_placement_idx').on(t.placement, t.isActive, t.sortOrder), enumCheck('cms_blocks_type_chk', t.type, CMS_BLOCK_TYPES)],
);

export const cmsPages = pgTable(
  'cms_pages',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    isPublished: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('cms_pages_slug_uq').on(t.slug)],
);

/**
 * Versioned legal documents. Text is DRAFT until approved by EDMN legal counsel;
 * acceptance of significant documents (seller agreement, deal terms) records the exact version.
 */
export const LEGAL_STATUSES = ['DRAFT', 'APPROVED', 'RETIRED'] as const;
export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    version: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    status: text({ enum: LEGAL_STATUSES }).notNull().default('DRAFT'),
    isCurrent: boolean().notNull().default(false),
    approvedBy: uuid().references(() => users.id),
    approvedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('legal_documents_version_uq').on(t.code, t.version),
    uniqueIndex('legal_documents_current_uq').on(t.code).where(sql`${t.isCurrent}`),
    enumCheck('legal_documents_status_chk', t.status, LEGAL_STATUSES),
  ],
);

export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    documentCode: text().notNull(),
    version: text().notNull(),
    context: text(), // e.g. seller id / deal id
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [index('legal_acceptances_user_idx').on(t.userId, t.documentCode)],
);
