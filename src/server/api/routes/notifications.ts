import { z } from 'zod';
import { myNotifications, notificationPrefs, readNotifications, saveNotificationPrefs, unreadNotifications } from '@/server/modules/mobile/notifications';
import { defineRoute } from '../http';
import { isoDateTime, uuid } from '../schemas';

/**
 * Notification center: the session user's own in-app notifications and their notification preferences. Read-only
 * information plus "mark read"; nothing here changes an order, a deal or money.
 */
const base = { api: 'mobile' as const, auth: 'customer' as const, tags: ['Notifications'] };
const errors = ['forbidden' as const, 'not_found' as const];

const target = z
  .object({
    kind: z.enum(['ORDER', 'PAYMENT', 'DEAL', 'RETURN', 'STORE_RETURN', 'DISPUTE', 'TICKET', 'CONVERSATION', 'STORE_CONVERSATION', 'STORE_ORDER', 'STORE_PRODUCT', 'WALLET', 'IDENTITY', 'STORE', 'RECEIVING_ACCOUNTS', 'ORDERS', 'DEALS']),
    id: uuid.nullable(),
  })
  .meta({ description: 'Where the app opens this notification. Mapped by the server from known internal pages only; null = nothing to open.' });

const unreadOut = z.object({ unread: z.number().int() });
const prefs = z
  .object({ messagesInApp: z.boolean(), messagesSound: z.boolean(), messagesPush: z.boolean(), messagesEmail: z.boolean(), pushPreview: z.boolean() })
  .meta({ id: 'NotificationPreferences' });

export const listNotifications = defineRoute({
  ...base,
  id: 'listNotifications',
  method: 'GET',
  path: '/api/v1/notifications',
  summary: 'My notifications, newest first (message alerts are counted by the Messages inbox, not here)',
  rate: 'read',
  errors,
  query: z.object({ unread: z.enum(['1']).optional(), before: uuid.optional().meta({ description: 'The nextBefore value of the previous page.' }), limit: z.coerce.number().int().min(1).max(50).optional() }),
  response: z.object({
    items: z.array(z.object({ id: uuid, event: z.string(), title: z.string(), body: z.string(), read: z.boolean(), createdAt: isoDateTime, target: target.nullable() })),
    unread: z.number().int(),
    nextBefore: uuid.nullable(),
  }),
  handler: ({ actor, query }) => myNotifications(actor!, { unreadOnly: query.unread === '1', before: query.before, limit: query.limit }),
});

export const getUnreadNotifications = defineRoute({ ...base, id: 'getUnreadNotifications', method: 'GET', path: '/api/v1/notifications/unread', summary: 'Unread notification count (bell badge)', rate: 'read', errors, response: unreadOut, handler: ({ actor }) => unreadNotifications(actor!) });

export const markNotificationsRead = defineRoute({
  ...base,
  id: 'markNotificationsRead',
  method: 'POST',
  path: '/api/v1/notifications/read',
  summary: 'Mark some of my notifications read, or all of them when no ids are sent',
  rate: 'write',
  errors,
  body: z.object({ ids: z.array(uuid).max(100).optional() }),
  response: unreadOut,
  handler: ({ actor, body }) => readNotifications(actor!, body.ids),
});

export const getNotificationPreferences = defineRoute({ ...base, id: 'getNotificationPreferences', method: 'GET', path: '/api/v1/notifications/preferences', summary: 'My notification preferences', rate: 'read', errors, response: prefs, handler: ({ actor }) => notificationPrefs(actor!) });

export const saveNotificationPreferences = defineRoute({
  ...base,
  id: 'saveNotificationPreferences',
  method: 'PUT',
  path: '/api/v1/notifications/preferences',
  summary: 'Change my notification preferences (only the fields sent)',
  rate: 'write',
  errors,
  body: z.object({ messagesInApp: z.boolean().optional(), messagesSound: z.boolean().optional(), messagesPush: z.boolean().optional(), messagesEmail: z.boolean().optional(), pushPreview: z.boolean().optional() }),
  response: prefs,
  handler: ({ actor, body }) => saveNotificationPrefs(actor!, body),
});

export const notificationRoutes = [listNotifications, getUnreadNotifications, markNotificationsRead, getNotificationPreferences, saveNotificationPreferences];
