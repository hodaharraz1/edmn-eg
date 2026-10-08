import { sql } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { loadMessages, participantAccess, unreadForSeller, unreadForUser, type Side } from './service';

/**
 * Near-real-time sync for the web app ("live" channel). Transport: short polling of one small, indexed,
 * cursor-based JSON endpoint (≈6 s while a tab is visible, 30 s in the background, immediately on focus /
 * reconnect). Chosen over WebSocket/SSE because the deployment is serverless (no long-lived connections) —
 * reliability over the technology label. Web Push covers closed/background tabs.
 *
 * Cursors are PostgreSQL timestamps (microsecond text) + id. Every query re-reads a 15 s overlap window and
 * clients de-duplicate by id, so a message committed slightly out of timestamp order is never lost.
 */

export type Surface = 'account' | 'seller';
const TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;

export function parseCursor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  return v.length <= 40 && TS.test(v) ? v : null;
}

export interface IncomingItem {
  id: string;
  conversationId: string;
  href: string;
  ref: string;
  from: string;
  /** short, plain-text, safe preview (no attachment names/links) */
  preview: string;
  attachment: boolean;
  createdAt: string;
}

export interface LiveThread {
  conversationId: string;
  messages: ReturnType<typeof serializeMessage>[];
  cursor: string | null;
  readIds: string[];
}

export interface LiveSnapshot {
  now: string;
  unreadMessages: number;
  unreadNotifications: number;
  cursor: string;
  incoming: IncomingItem[];
  /** ids inside the overlap window when the client had no cursor yet (seed its de-duplication set) */
  seen: string[];
  inboxVersion: string;
  thread: LiveThread | null;
}

/** Where incoming messages for this actor/surface come from (never another store's or user's). */
function incomingScope(actor: Actor, surface: Surface) {
  const uid = actor.userId!;
  if (surface === 'seller') {
    if (actor.type !== 'SELLER' || !actor.sellerId || !actor.sellerPermissions?.has('orders.communicate')) return null;
    return { where: sql`c.seller_id = ${actor.sellerId} and m.sender_role = 'BUYER'`, href: (id: string) => `/seller/messages/${id}`, uid };
  }
  return {
    where: sql`((c.buyer_user_id = ${uid} and m.sender_role = 'SELLER') or (c.seller_user_id = ${uid} and m.sender_role = 'BUYER'))`,
    href: (id: string) => `/account/messages/${id}`,
    uid,
  };
}

/** Bell = unread GENERAL notifications. Message alerts have their own badge (never double-counted). */
export async function unreadGeneralNotifications(userId: string): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    select count(*)::int n from notifications where user_id = ${userId} and read_at is null
       and category = 'GENERAL' and event not in ('MESSAGE_FROM_SELLER','MESSAGE_FROM_BUYER')`);
  return Number(r.rows[0]?.n ?? 0);
}

export function serializeMessage(m: Awaited<ReturnType<typeof loadMessages>>[number]) {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

export async function liveSnapshot(
  actor: Actor,
  surface: Surface,
  opts: { since?: string | null; conv?: string | null; after?: string | null; visible?: boolean },
): Promise<LiveSnapshot> {
  const uid = actor.userId!;
  const scope = incomingScope(actor, surface);
  const since = parseCursor(opts.since);

  // UX-only presence (routes push vs. in-app). Throttled; never read by any financial or delivery logic.
  await db.execute(sql`
    insert into user_presence (user_id, last_seen_at, last_visible_at, surface) values (${uid}, now(), ${opts.visible ? sql`now()` : sql`null`}, ${surface})
    on conflict (user_id) do update set last_seen_at = now(), surface = excluded.surface,
      last_visible_at = case when ${!!opts.visible} then now() else user_presence.last_visible_at end
    where user_presence.last_seen_at < now() - interval '4 seconds' or (${!!opts.visible} and (user_presence.last_visible_at is null or user_presence.last_visible_at < now() - interval '4 seconds'))`);

  const [unreadMessages, unreadNotifications] = await Promise.all([surface === 'seller' ? unreadForSeller(actor) : unreadForUser(uid), unreadGeneralNotifications(uid)]);

  let incoming: IncomingItem[] = [];
  let seen: string[] = [];
  let cursor = since;
  const [nowRow] = (await db.execute<{ now: string }>(sql`select now()::text as now`)).rows;
  if (scope) {
    if (since) {
      const rows = await db.execute<{
        id: string; conversation_id: string; created_at: string; body: string; atts: number; context: string; ref: string; store: string | null; viewer_is_buyer: boolean;
      }>(sql`
        select m.id, m.conversation_id, m.created_at::text as created_at, m.body,
               (select count(*)::int from conversation_message_attachments a where a.message_id = m.id) as atts, c.context, (c.buyer_user_id = ${uid}) as viewer_is_buyer,
               case when c.context = 'SELLER_ORDER' then 'الطلب #' || o.number || '-' || so.suffix else 'الصفقة EDMN-' || lpad(d.number::text, 8, '0') end as ref,
               coalesce(st.name, nullif(split_part(d.seller_full_name, ' ', 1), '')) as store
          from conversation_messages m
          join conversations c on c.id = m.conversation_id
          left join seller_orders so on so.id = c.seller_order_id
          left join orders o on o.id = c.order_id
          left join stores st on st.seller_id = c.seller_id
          left join external_deals d on d.id = c.deal_id
         where ${scope.where} and m.hidden_at is null and m.sender_user_id <> ${uid}
           and m.created_at > ${since}::timestamptz - interval '15 seconds'
         order by m.created_at, m.id
         limit 30`);
      incoming = rows.rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        href: scope.href(r.conversation_id),
        ref: r.ref,
        from: surface === 'seller' || !r.viewer_is_buyer ? 'المشتري' : (r.store ?? 'البائع'),
        preview: r.body ? r.body.replace(/\s+/g, ' ').slice(0, 60) : '',
        attachment: r.atts > 0,
        createdAt: r.created_at,
      }));
      const last = rows.rows.at(-1);
      if (last && last.created_at > since) cursor = last.created_at;
    } else {
      const rows = await db.execute<{ id: string }>(sql`
        select m.id from conversation_messages m join conversations c on c.id = m.conversation_id
         where ${scope.where} and m.created_at > now() - interval '15 seconds'`);
      seen = rows.rows.map((r) => r.id);
      cursor = nowRow.now;
    }
  }
  if (!cursor) cursor = nowRow.now;

  const [iv] = (
    await db.execute<{ v: string | null }>(
      surface === 'seller'
        ? sql`select max(last_message_at)::text v from conversations where seller_id = ${actor.sellerId ?? null}`
        : sql`select max(last_message_at)::text v from conversations where buyer_user_id = ${uid} or seller_user_id = ${uid}`,
    )
  ).rows;

  let thread: LiveThread | null = null;
  if (opts.conv) {
    try {
      const access = await participantAccess(actor, opts.conv);
      if (surface === 'seller' ? access.conv.context === 'SELLER_ORDER' : true) thread = await threadDelta(access.conv, access.userId, access.side, parseCursor(opts.after));
    } catch {
      thread = null; // not a participant → nothing (uniform, no existence oracle)
    }
  }

  return {
    now: nowRow.now,
    unreadMessages,
    unreadNotifications,
    cursor,
    incoming,
    seen,
    inboxVersion: `${iv?.v ?? '-'}|${unreadMessages}`,
    thread,
  };
}

async function threadDelta(conv: Awaited<ReturnType<typeof participantAccess>>['conv'], userId: string, side: Side, after: string | null): Promise<LiveThread> {
  const msgs = await loadMessages(db, conv, { userId, side }, after ?? undefined);
  const [cur] = (
    await db.execute<{ c: string | null }>(sql`select max(created_at)::text c from conversation_messages where conversation_id = ${conv.id}`)
  ).rows;
  // Read receipts for the viewer's recent messages (any member of the other side counts).
  const readRows = await db.execute<{ id: string }>(sql`
    select m.id from conversation_messages m
     where m.conversation_id = ${conv.id} and m.sender_user_id = ${userId}
       and exists (select 1 from conversation_reads r where r.conversation_id = m.conversation_id and r.user_id <> ${userId}
                    and ${side === 'BUYER' ? sql`r.user_id <> ${conv.buyerUserId}` : sql`r.user_id = ${conv.buyerUserId}`} and r.last_read_at >= m.created_at)
     order by m.created_at desc limit 100`);
  return { conversationId: conv.id, messages: msgs.map(serializeMessage), cursor: cur?.c ?? null, readIds: readRows.rows.map((r) => r.id) };
}
