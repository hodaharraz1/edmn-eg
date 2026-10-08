import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, ts, updatedAt } from './_helpers';
import { conversationMessages, conversations } from './messaging';
import { users } from './identity';
import { notifications } from './ops';

/**
 * Notification delivery architecture (see docs/NOTIFICATIONS_REALTIME.md).
 *
 * A message is persisted FIRST; notification fan-out happens afterwards and can never undo or block it.
 * Every (event, recipient, channel) decision is recorded once — idempotently — in notification_deliveries,
 * which is operational telemetry only: none of these rows is delivery evidence or a financial signal.
 */

/** Channels live today (IN_APP, PUSH, EMAIL) and provider-agnostic future channels (no provider connected). */
export const NOTIFY_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'MOBILE_PUSH'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];
export const DELIVERY_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SUPPRESSED', 'OPENED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const MESSAGE_EVENTS = ['MESSAGE_RECEIVED', 'MESSAGE_ATTACHMENT_RECEIVED'] as const;
export type MessageEvent = (typeof MESSAGE_EVENTS)[number];

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid().primaryKey().defaultRandom(),
    event: text().notNull(),
    channel: text({ enum: NOTIFY_CHANNELS }).notNull(),
    recipientUserId: uuid()
      .notNull()
      .references(() => users.id),
    conversationId: uuid().references(() => conversations.id),
    messageId: uuid().references(() => conversationMessages.id),
    notificationId: uuid().references(() => notifications.id),
    /** `${event}:${messageId}:${recipientUserId}:${channel}` — retries never create a second delivery. */
    dedupeKey: text().notNull(),
    status: text({ enum: DELIVERY_STATUSES }).notNull(),
    /** Why it was suppressed / failed (BURST, COOLDOWN, READ, PREFERENCE_OFF, ACTIVE_IN_APP, NO_SUBSCRIPTION, …). */
    reason: text(),
    provider: text(),
    attempts: integer().notNull().default(0),
    /** QUEUED rows are dispatched at or after this time (email fallback waits for the configured delay). */
    runAfter: ts(),
    sentAt: ts(),
    openedAt: ts(),
    failedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('notification_deliveries_dedupe_uq').on(t.dedupeKey),
    index('notification_deliveries_queue_idx').on(t.runAfter).where(sql`${t.status} = 'QUEUED'`),
    index('notification_deliveries_recipient_idx').on(t.recipientUserId, t.conversationId, t.channel, t.createdAt),
    index('notification_deliveries_status_idx').on(t.status, t.channel, t.createdAt),
    enumCheck('notification_deliveries_channel_chk', t.channel, NOTIFY_CHANNELS),
    enumCheck('notification_deliveries_status_chk', t.status, DELIVERY_STATUSES),
  ],
);

/**
 * Per-user messaging notification preferences. Security/account alerts are NOT governed by these
 * (they follow their own mandatory policy). Absent row = defaults.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  messagesInApp: boolean().notNull().default(true),
  messagesSound: boolean().notNull().default(true),
  messagesPush: boolean().notNull().default(true),
  messagesEmail: boolean().notNull().default(true),
  /** Lock-screen privacy: false = generic push text only (default). Attachments are never previewed. */
  pushPreview: boolean().notNull().default(false),
  updatedAt: updatedAt(),
});

/**
 * Web Push subscriptions (one per browser/device). The endpoint and keys are a capability to message the
 * device, so they are stored encrypted; only a hash of the endpoint is kept in clear for de-duplication.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpointHash: text().notNull(),
    /** encrypted JSON { endpoint, p256dh, auth } */
    secretEnc: text().notNull(),
    deviceLabel: text(),
    expiresAt: ts(),
    lastSeenAt: ts(),
    lastSuccessAt: ts(),
    lastFailureAt: ts(),
    failureCount: integer().notNull().default(0),
    revokedAt: ts(),
    revokedReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpointHash),
    index('push_subscriptions_user_idx').on(t.userId).where(sql`${t.revokedAt} is null`),
  ],
);

/** UX-only presence used to route notifications (never consulted by money, delivery or dispute logic). */
export const userPresence = pgTable(
  'user_presence',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastSeenAt: ts().notNull(),
    lastVisibleAt: ts(),
    surface: text(),
  },
  (t) => [check('user_presence_surface_chk', sql`${t.surface} is null or ${t.surface} in ('account','seller')`)],
);
