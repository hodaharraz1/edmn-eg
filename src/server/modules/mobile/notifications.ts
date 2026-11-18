import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { requireUser, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { notifications } from '@/server/db/schema';
import { unreadGeneralNotifications } from '@/server/modules/messaging/live';
import { prefsFor, savePrefs, type MessagePrefs } from '@/server/modules/notifications/message-alerts';
import { markRead } from '@/server/modules/notifications/notify';

/**
 * Notification center for the Customer App: the session user's own in-app notifications (orders, payments, deals,
 * returns, disputes, support, earnings). Message alerts keep their own badge on the Messages inbox, exactly as on the
 * web, so the bell never double-counts them. Notifications are informational: opening or reading one changes nothing
 * in an order, a deal or money.
 */

export type NotificationTarget =
  | { kind: 'ORDER' | 'PAYMENT' | 'DEAL' | 'RETURN' | 'STORE_RETURN' | 'DISPUTE' | 'TICKET' | 'CONVERSATION' | 'STORE_CONVERSATION' | 'STORE_ORDER' | 'STORE_PRODUCT'; id: string }
  | { kind: 'WALLET' | 'IDENTITY' | 'STORE' | 'RECEIVING_ACCOUNTS' | 'ORDERS' | 'DEALS'; id: null };

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const RULES: [RegExp, NotificationTarget['kind']][] = [
  [new RegExp(`^/account/orders/${UUID}/pay`), 'ORDER'],
  [new RegExp(`^/account/orders/${UUID}`), 'ORDER'],
  [new RegExp(`^/account/deals/${UUID}`), 'DEAL'],
  [new RegExp(`^/account/returns/${UUID}`), 'RETURN'],
  [new RegExp(`^/seller/returns/${UUID}`), 'STORE_RETURN'],
  [new RegExp(`^/(?:account|seller)/disputes/${UUID}`), 'DISPUTE'],
  [new RegExp(`^/account/support/${UUID}`), 'TICKET'],
  [new RegExp(`^/account/messages/${UUID}`), 'CONVERSATION'],
  [new RegExp(`^/seller/messages/${UUID}`), 'STORE_CONVERSATION'],
  [new RegExp(`^/seller/orders/${UUID}`), 'STORE_ORDER'],
  [new RegExp(`^/seller/products/${UUID}`), 'STORE_PRODUCT'],
];
const STATIC: [RegExp, Extract<NotificationTarget, { id: null }>['kind']][] = [
  [/^\/account\/earnings|^\/seller\/(finance|withdrawals|wallet)/, 'WALLET'],
  [/^\/account\/identity/, 'IDENTITY'],
  [/^\/account\/receiving/, 'RECEIVING_ACCOUNTS'],
  [/^\/account\/orders\/?$/, 'ORDERS'],
  [/^\/account\/deals\/?$/, 'DEALS'],
  [/^\/seller(\/|$)/, 'STORE'],
];

/**
 * A web link stored on the notification → a typed in-app target. Only known internal paths are mapped; anything else
 * (external URLs, unknown pages, admin links) yields null, so the app never navigates to an arbitrary link.
 */
export function targetOf(link: string | null): NotificationTarget | null {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return null;
  const path = link.split(/[?#]/)[0];
  for (const [re, kind] of RULES) {
    const m = re.exec(path);
    if (m) return { kind, id: m[1] } as NotificationTarget;
  }
  for (const [re, kind] of STATIC) if (re.test(path)) return { kind, id: null };
  return null;
}

export async function myNotifications(actor: Actor, opts: { unreadOnly?: boolean; before?: string; limit?: number } = {}) {
  const userId = requireUser(actor);
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.category, 'GENERAL'),
        sql`${notifications.event} not in ('MESSAGE_FROM_SELLER','MESSAGE_FROM_BUYER')`,
        opts.unreadOnly ? isNull(notifications.readAt) : undefined,
        // Keyset cursor on (created_at, id), compared inside PostgreSQL at full timestamp precision; the cursor row must be mine.
        opts.before ? sql`(${notifications.createdAt}, ${notifications.id}) < (select n2.created_at, n2.id from notifications n2 where n2.id = ${opts.before} and n2.user_id = ${userId})` : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((n) => ({ id: n.id, event: n.event, title: n.title, body: n.body, read: !!n.readAt, createdAt: n.createdAt.toISOString(), target: targetOf(n.link) })),
    unread: await unreadGeneralNotifications(userId),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}

export async function unreadNotifications(actor: Actor) {
  return { unread: await unreadGeneralNotifications(requireUser(actor)) };
}

/** Mark some (or all) of MY general notifications read. Ids that are not mine are simply not matched. */
export async function readNotifications(actor: Actor, ids?: string[]) {
  const userId = requireUser(actor);
  if (ids?.length) await markRead(db, userId, ids);
  else
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.category, 'GENERAL'), isNull(notifications.readAt)));
  return { unread: await unreadGeneralNotifications(userId) };
}

export async function notificationPrefs(actor: Actor) {
  return prefsFor(db, requireUser(actor));
}

export async function saveNotificationPrefs(actor: Actor, input: Partial<MessagePrefs>) {
  return savePrefs(requireUser(actor), input);
}
