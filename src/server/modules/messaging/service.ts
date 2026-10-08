import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { enforce } from '@/server/auth/rate-limit';
import { hasPermission, requirePermission, requireUser, type Actor } from '@/server/core/actor';
import { conflict, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import {
  conversationMessageAttachments,
  conversationMessageReports,
  conversationMessages,
  conversationReads,
  conversations,
  disputes,
  externalDeals,
  files,
  MESSAGE_REPORT_REASONS,
  orderItems,
  orders,
  sellerMembers,
  sellerOrders,
  sellers,
  stores,
  users,
  type MessageReportReason,
  type MessageSenderRole,
} from '@/server/db/schema';
import { SELLER_ROLE_PERMISSIONS } from '@/server/rbac/permissions';
import { fanOutMessage } from '@/server/modules/notifications/message-alerts';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';

/**
 * Buyer ↔ seller communication (see docs/INTERNAL_COMMUNICATION_SYSTEM.md).
 *
 * Hard rules enforced here:
 *  - every conversation is bound to ONE seller sub-order or ONE protected deal; there is no way to start a
 *    conversation with an arbitrary user;
 *  - authorization is derived on every call from the order/deal itself (never from the conversation id alone),
 *    and denials are uniform "not found";
 *  - messages are append-only evidence. This module never touches payments, ledger, balances, shipments, OTPs,
 *    deal terms or disputes — it does not even import those services. A message saying «استلمت» or proposing a
 *    new price changes nothing; only the formal actions do.
 */

export type Conversation = typeof conversations.$inferSelect;
export type Side = MessageSenderRole; // BUYER | SELLER

const MAX_BODY = 2000;
const MAX_ATTACHMENTS = 3;
/** Rate limits (fixed windows, shared across instances through PostgreSQL). */
const LIMITS = { perMinute: 20, perHourPerConversation: 120, attachmentsPerHour: 20, reportsPerHour: 20 };

/** Seller sub-order states in which the store is authorized to fulfil (i.e. payment was confirmed). */
const SO_ELIGIBLE = ['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED'] as const;
const SO_FINAL = ['COMPLETED', 'CANCELLED'];
/** A protected deal is open for communication once the seller has securely claimed the invitation. */
const DEAL_NOT_YET = ['DRAFT', 'INVITED'];
const DEAL_FINAL = ['COMPLETED', 'CANCELLED', 'REFUNDED'];
const OPEN_DISPUTE = ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'];

/** Store-member roles that carry `orders.communicate` (owners always do). */
export const COMMUNICATING_MEMBER_ROLES = Object.entries(SELLER_ROLE_PERMISSIONS)
  .filter(([, p]) => p.includes('orders.communicate'))
  .map(([r]) => r);

const notAvailable = () => notFound('المحادثة');

/* ───────────────────────── Opening (context-bound only) ───────────────────────── */

/** Buyer or authorized store member opens (or creates) the conversation of a seller sub-order. */
export async function openSellerOrderConversation(actor: Actor, sellerOrderId: string): Promise<Conversation> {
  const uid = requireUser(actor);
  if (!isUuid(sellerOrderId)) throw notAvailable();
  const [row] = await db
    .select({ so: sellerOrders, customerId: orders.customerId })
    .from(sellerOrders)
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .where(eq(sellerOrders.id, sellerOrderId));
  if (!row) throw notAvailable();
  const isBuyer = actor.type !== 'SELLER' && row.customerId === uid;
  const isSeller = actor.type === 'SELLER' && actor.sellerId === row.so.sellerId && !!actor.sellerPermissions?.has('orders.communicate');
  if (!isBuyer && !isSeller) throw notAvailable();

  const [existing] = await db.select().from(conversations).where(eq(conversations.sellerOrderId, sellerOrderId));
  if (existing) return existing;
  const eligible = (SO_ELIGIBLE as readonly string[]).includes(row.so.status) || (row.so.status === 'CANCELLED' && !!row.so.paidAt);
  if (!eligible) {
    throw invalidState(isBuyer ? 'التواصل مع البائع بيتفتح بعد ما الدفع يتأكد' : 'التواصل مع المشتري بيتفتح بعد ما الدفع يتأكد');
  }
  await db
    .insert(conversations)
    .values({ context: 'SELLER_ORDER', orderId: row.so.orderId, sellerOrderId, sellerId: row.so.sellerId, buyerUserId: row.customerId })
    .onConflictDoNothing();
  const [c] = await db.select().from(conversations).where(eq(conversations.sellerOrderId, sellerOrderId));
  return c;
}

/** Deal buyer or the bound deal seller opens (or creates) the deal conversation. */
export async function openDealConversation(actor: Actor, dealId: string): Promise<Conversation> {
  const uid = requireUser(actor);
  if (!isUuid(dealId)) throw notAvailable();
  const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, dealId));
  if (!d) throw notAvailable();
  const isBuyer = d.buyerId === uid;
  const isSeller = !!d.sellerUserId && d.sellerUserId === uid;
  if (!isBuyer && !isSeller) throw notAvailable();

  const [existing] = await db.select().from(conversations).where(eq(conversations.dealId, dealId));
  if (existing) return existing;
  if (!d.sellerUserId || !d.sellerJoinedAt || DEAL_NOT_YET.includes(d.status)) {
    throw invalidState('التواصل بيتفتح بعد ما البائع يقبل دعوة الصفقة');
  }
  await db.insert(conversations).values({ context: 'DEAL', dealId, buyerUserId: d.buyerId, sellerUserId: d.sellerUserId }).onConflictDoNothing();
  const [c] = await db.select().from(conversations).where(eq(conversations.dealId, dealId));
  return c;
}

/** Whether the order/deal currently allows opening a conversation (for showing the CTA). */
export function sellerOrderMessagingAvailable(so: { status: string; paidAt: Date | null }): boolean {
  return (SO_ELIGIBLE as readonly string[]).includes(so.status) || (so.status === 'CANCELLED' && !!so.paidAt);
}
export function dealMessagingAvailable(d: { status: string; sellerUserId: string | null; sellerJoinedAt: Date | null }): boolean {
  return !!d.sellerUserId && !!d.sellerJoinedAt && !DEAL_NOT_YET.includes(d.status);
}

/* ───────────────────────── Participant access ───────────────────────── */

export interface ParticipantAccess {
  conv: Conversation;
  side: Side;
  userId: string;
}

/**
 * Resolve the caller's side in a conversation. Store members need the seller context AND `orders.communicate`;
 * deal parties are matched by user. Anything else → uniform not-found (no existence oracle).
 */
export async function participantAccess(actor: Actor, conversationId: string, conn: DbOrTx = db): Promise<ParticipantAccess> {
  const uid = requireUser(actor);
  if (!isUuid(conversationId)) throw notAvailable();
  const [conv] = await conn.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) throw notAvailable();
  if (conv.context === 'SELLER_ORDER') {
    if (actor.type === 'SELLER') {
      if (actor.sellerId === conv.sellerId && actor.sellerPermissions?.has('orders.communicate')) return { conv, side: 'SELLER', userId: uid };
      throw notAvailable();
    }
    if (conv.buyerUserId === uid) return { conv, side: 'BUYER', userId: uid };
    throw notAvailable();
  }
  if (conv.buyerUserId === uid) return { conv, side: 'BUYER', userId: uid };
  if (conv.sellerUserId === uid) return { conv, side: 'SELLER', userId: uid };
  throw notAvailable();
}

/* ───────────────────────── Write window / lifecycle ───────────────────────── */

export interface WriteState {
  canWrite: boolean;
  reason: string | null;
}

/**
 * ACTIVE while the transaction needs communication. After the order/deal is final (completed/cancelled/refunded)
 * participants can still write for `messaging.postCloseWriteDays`, or while a dispute is open; afterwards the
 * conversation is read-only. Staff can LOCK a conversation. Nothing is ever deleted.
 */
export async function writeState(conv: Conversation, side: Side | null, conn: DbOrTx = db): Promise<WriteState> {
  if (conv.status === 'LOCKED') return { canWrite: false, reason: 'المحادثة دي اتقفلت من فريق اضمن.' };
  const windowDays = await getSetting('messaging.postCloseWriteDays', conn);
  if (conv.context === 'SELLER_ORDER') {
    const [so] = await conn.select().from(sellerOrders).where(eq(sellerOrders.id, conv.sellerOrderId!));
    if (side === 'SELLER') {
      const [s] = await conn.select({ status: sellers.status }).from(sellers).where(eq(sellers.id, conv.sellerId!));
      if (s && s.status !== 'APPROVED' && s.status !== 'RESTRICTED') return { canWrite: false, reason: 'حساب المتجر مش مفعّل دلوقتي، فمينفعش يبعت رسايل.' };
    }
    if (SO_FINAL.includes(so.status)) {
      const end = so.completedAt ?? so.cancelledAt ?? so.updatedAt;
      if (Date.now() - end.getTime() > windowDays * 86_400_000 && !(await hasOpenDispute(conn, { sellerOrderId: so.id }))) {
        return { canWrite: false, reason: 'الطلب ده خلص من فترة، والمحادثة بقت للقراءة بس.' };
      }
    }
    return { canWrite: true, reason: null };
  }
  const [d] = await conn.select().from(externalDeals).where(eq(externalDeals.id, conv.dealId!));
  if (DEAL_FINAL.includes(d.status)) {
    const end = d.completedAt ?? d.cancelledAt ?? d.updatedAt;
    if (Date.now() - end.getTime() > windowDays * 86_400_000 && !(await hasOpenDispute(conn, { dealId: d.id }))) {
      return { canWrite: false, reason: 'الصفقة دي خلصت من فترة، والمحادثة بقت للقراءة بس.' };
    }
  }
  return { canWrite: true, reason: null };
}

async function hasOpenDispute(conn: DbOrTx, by: { sellerOrderId?: string; dealId?: string }) {
  const where = by.sellerOrderId ? eq(disputes.sellerOrderId, by.sellerOrderId) : eq(disputes.dealId, by.dealId!);
  const [r] = await conn.select({ id: disputes.id }).from(disputes).where(and(where, inArray(disputes.status, OPEN_DISPUTE as unknown as ('OPEN' | 'UNDER_REVIEW' | 'AWAITING_INFORMATION')[]))).limit(1);
  return !!r;
}

/* ───────────────────────── Sending ───────────────────────── */

/** Strip control characters (except newline/tab); collapse >3 blank lines. Content is always rendered as text. */
export function cleanBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export async function sendMessage(
  actor: Actor,
  conversationId: string,
  input: { body: string; clientKey: string },
  attachments: { data: Buffer; name: string }[] = [],
  opts: { onCommitted?: (pushDeliveryIds: string[]) => void } = {},
) {
  const access = await participantAccess(actor, conversationId);
  const body = cleanBody(String(input.body ?? ''));
  const clientKey = String(input.clientKey ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientKey)) throw validation('حاول تاني');
  if (body.length > MAX_BODY) throw validation(`الرسالة طويلة. الحد الأقصى ${MAX_BODY} حرف`);
  if (!body && !attachments.length) throw validation('اكتب رسالتك أو ضيف مرفق');
  if (attachments.length > MAX_ATTACHMENTS) throw validation(`تقدر ترفق ${MAX_ATTACHMENTS} ملفات بالكتير في الرسالة`);

  // A retried send (same client key) returns the original message — never a duplicate.
  const [dupe] = await db
    .select()
    .from(conversationMessages)
    .where(and(eq(conversationMessages.senderUserId, access.userId), eq(conversationMessages.clientKey, clientKey)));
  if (dupe) {
    if (dupe.conversationId !== access.conv.id) throw validation('حاول تاني');
    return dupe;
  }

  const ws = await writeState(access.conv, access.side);
  if (!ws.canWrite) throw invalidState(ws.reason ?? 'مينفعش تبعت رسايل في المحادثة دي دلوقتي');

  await enforce(`msg:min:${access.userId}`, LIMITS.perMinute, 60);
  await enforce(`msg:conv:${access.conv.id}:${access.userId}`, LIMITS.perHourPerConversation, 3600);
  for (let i = 0; i < attachments.length; i++) await enforce(`msg:att:${access.userId}`, LIMITS.attachmentsPerHour, 3600);

  let pushIds: string[] = [];
  const msg = await db.transaction(async (tx) => {
    const fileIds: string[] = [];
    for (const a of attachments) {
      const stored = await storeUpload(tx, actor, { purpose: 'MESSAGE_ATTACHMENT', data: a.data, originalName: a.name });
      fileIds.push(stored.id);
    }
    const [msg] = await tx
      .insert(conversationMessages)
      .values({ conversationId: access.conv.id, senderUserId: access.userId, senderRole: access.side, body, clientKey })
      .returning();
    if (fileIds.length) await tx.insert(conversationMessageAttachments).values(fileIds.map((fileId) => ({ messageId: msg.id, fileId })));
    await tx.update(conversations).set({ lastMessageAt: msg.createdAt }).where(eq(conversations.id, access.conv.id));
    await markReadTx(tx, access.conv.id, access.userId);
    // Notification fan-out is recorded in the same transaction (so it exists iff the message exists), but no
    // provider is contacted here: a push/email outage can never lose, delay or roll back a message.
    pushIds = await notifyRecipients(tx, access.conv, access.side, msg.id, fileIds.length > 0);
    return msg;
  });
  opts.onCommitted?.(pushIds);
  return msg;
}

/** Users on the other side who should be told about a new message. */
async function recipientsFor(conn: DbOrTx, conv: Conversation, senderSide: Side): Promise<string[]> {
  if (senderSide === 'SELLER') return [conv.buyerUserId];
  if (conv.context === 'DEAL') return [conv.sellerUserId!];
  return storeCommunicators(conn, conv.sellerId!);
}

/** Store owner + active members whose role carries `orders.communicate`. */
export async function storeCommunicators(conn: DbOrTx, sellerId: string): Promise<string[]> {
  const [s] = await conn.select({ owner: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, sellerId));
  const members = COMMUNICATING_MEMBER_ROLES.length
    ? await conn
        .select({ userId: sellerMembers.userId })
        .from(sellerMembers)
        .where(and(eq(sellerMembers.sellerId, sellerId), eq(sellerMembers.isActive, true), inArray(sellerMembers.role, COMMUNICATING_MEMBER_ROLES as never[])))
    : [];
  return [...new Set([s?.owner, ...members.map((m) => m.userId)].filter((x): x is string => !!x))];
}

/**
 * Route the new message to the other side: one in-app notification per unread "burst", Web Push for
 * opted-in devices of users who are away, delayed email fallback (see notifications/message-alerts.ts).
 * Alerts never contain the message text by default, never attachment links.
 */
async function notifyRecipients(tx: DbOrTx, conv: Conversation, senderSide: Side, messageId: string, hasAttachments: boolean): Promise<string[]> {
  const recipients = await recipientsFor(tx, conv, senderSide);
  if (!recipients.length) return [];
  const ctx = await contextLabel(tx, conv);
  const toBuyer = senderSide === 'SELLER';
  return fanOutMessage(tx, {
    conversationId: conv.id,
    messageId,
    recipients,
    senderSide,
    hasAttachments,
    ref: ctx.ref,
    party: toBuyer ? ctx.sellerName : 'المشتري',
    linkFor: () => (toBuyer || conv.context === 'DEAL' ? `/account/messages/${conv.id}` : `/seller/messages/${conv.id}`),
  });
}

/* ───────────────────────── Reading ───────────────────────── */

/**
 * Move the user's read position to the newest message. Computed inside PostgreSQL: timestamps there have
 * microsecond precision, JS Dates only milliseconds — a JS-side value would leave the last message "unread".
 */
async function markReadTx(conn: DbOrTx, conversationId: string, userId: string, upToMessageId?: string) {
  // upTo = the newest message the participant actually had on screen; never beyond what exists.
  const upTo = upToMessageId && isUuid(upToMessageId) ? sql`and (created_at, id) <= (select created_at, id from conversation_messages where id = ${upToMessageId} and conversation_id = ${conversationId})` : sql``;
  await conn.execute(sql`
    insert into conversation_reads (conversation_id, user_id, last_read_at)
    select ${conversationId}, ${userId}, max(created_at) from conversation_messages where conversation_id = ${conversationId} ${upTo}
    having max(created_at) is not null
    on conflict (conversation_id, user_id) do update set last_read_at = greatest(conversation_reads.last_read_at, excluded.last_read_at)`);
}

/**
 * Read rule (server-authoritative): a message becomes read only when the participant's client reports that
 * the conversation was on screen in a visible tab, up to the newest message rendered. Fetching messages
 * (page render, polling, push, toast, email, a notification being opened) never marks anything read, and
 * staff views never touch participants' read positions. Once nothing in the conversation is unread for
 * this user, its message notifications are cleared from the bell/notification center too.
 */
export async function markRead(actor: Actor, conversationId: string, upToMessageId?: string) {
  const access = await participantAccess(actor, conversationId);
  await markReadTx(db, access.conv.id, access.userId, upToMessageId);
  if ((await unreadIn(access.conv.id, access.userId, access.side)) === 0) {
    await db.execute(sql`update notifications set read_at = now() where user_id = ${access.userId} and conversation_id = ${access.conv.id} and read_at is null`);
  }
  return access;
}

export interface ThreadMessage {
  id: string;
  side: Side;
  mine: boolean;
  body: string;
  createdAt: Date;
  hidden: boolean;
  hiddenReason: string | null;
  /** original text — only for staff */
  originalBody?: string;
  attachments: { fileId: string; mimeType: string; name: string | null }[];
  readByOther: boolean;
  reportCount?: number;
}

export async function loadMessages(conn: DbOrTx, conv: Conversation, viewer: { userId: string | null; side: Side | 'STAFF' }, afterTs?: string): Promise<ThreadMessage[]> {
  // Authoritative order: server timestamp, then id (deterministic for concurrent messages).
  // afterTs (a PostgreSQL timestamp text) selects a small overlapping window; the client de-duplicates by id.
  const msgs = await conn
    .select()
    .from(conversationMessages)
    .where(and(eq(conversationMessages.conversationId, conv.id), afterTs ? sql`${conversationMessages.createdAt} > ${afterTs}::timestamptz - interval '15 seconds'` : undefined))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
  const atts = msgs.length
    ? await conn
        .select({ messageId: conversationMessageAttachments.messageId, fileId: files.id, mimeType: files.mimeType, name: files.originalName })
        .from(conversationMessageAttachments)
        .innerJoin(files, eq(files.id, conversationMessageAttachments.fileId))
        .where(inArray(conversationMessageAttachments.messageId, msgs.map((m) => m.id)))
    : [];
  // Latest read position per side (any store member counts for the store).
  const reads = await conn.select().from(conversationReads).where(eq(conversationReads.conversationId, conv.id));
  const buyerRead = reads.filter((r) => r.userId === conv.buyerUserId).map((r) => r.lastReadAt.getTime());
  const sellerRead = reads.filter((r) => r.userId !== conv.buyerUserId).map((r) => r.lastReadAt.getTime());
  const lastRead = { BUYER: Math.max(0, ...buyerRead), SELLER: Math.max(0, ...sellerRead) };
  const staff = viewer.side === 'STAFF';
  let reportCounts = new Map<string, number>();
  if (staff && msgs.length) {
    const rc = await conn
      .select({ messageId: conversationMessageReports.messageId, n: sql<number>`count(*)::int` })
      .from(conversationMessageReports)
      .where(eq(conversationMessageReports.conversationId, conv.id))
      .groupBy(conversationMessageReports.messageId);
    reportCounts = new Map(rc.map((r) => [r.messageId, r.n]));
  }
  return msgs.map((m) => {
    const hidden = !!m.hiddenAt;
    const other: Side = m.senderRole === 'BUYER' ? 'SELLER' : 'BUYER';
    return {
      id: m.id,
      side: m.senderRole,
      mine: !staff && m.senderUserId === viewer.userId,
      body: hidden && !staff ? '' : m.body,
      createdAt: m.createdAt,
      hidden,
      hiddenReason: staff ? m.hiddenReason : null,
      originalBody: staff ? m.body : undefined,
      attachments: hidden && !staff ? [] : atts.filter((a) => a.messageId === m.id).map((a) => ({ fileId: a.fileId, mimeType: a.mimeType, name: a.name })),
      readByOther: lastRead[other] >= m.createdAt.getTime(),
      reportCount: staff ? (reportCounts.get(m.id) ?? 0) : undefined,
    };
  });
}

export interface ConversationContextInfo {
  ref: string;
  title: string;
  status: string;
  sellerName: string;
  buyerName: string;
  /** link to the business record for the given surface */
  buyerHref: string;
  sellerHref: string;
  adminHref: string;
}

async function contextLabel(conn: DbOrTx, conv: Conversation): Promise<ConversationContextInfo> {
  if (conv.context === 'SELLER_ORDER') {
    const [r] = await conn
      .select({ so: sellerOrders, number: orders.number, store: stores.name, buyer: users.fullName })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .innerJoin(stores, eq(stores.sellerId, sellerOrders.sellerId))
      .innerJoin(users, eq(users.id, orders.customerId))
      .where(eq(sellerOrders.id, conv.sellerOrderId!));
    const items = await conn.select({ t: orderItems.titleSnapshot }).from(orderItems).where(eq(orderItems.sellerOrderId, conv.sellerOrderId!)).limit(2);
    const title = items.length ? items[0].t + (items.length > 1 ? ' + منتجات أخرى' : '') : '';
    return {
      ref: `طلب #${r.number}-${r.so.suffix}`,
      title,
      status: r.so.status,
      sellerName: r.store,
      buyerName: firstName(r.buyer),
      buyerHref: `/account/orders/${r.so.orderId}`,
      sellerHref: `/seller/orders/${r.so.id}`,
      adminHref: `/admin/orders/${r.so.orderId}`,
    };
  }
  const [d] = await conn.select().from(externalDeals).where(eq(externalDeals.id, conv.dealId!));
  const [b] = await conn.select({ n: users.fullName }).from(users).where(eq(users.id, d.buyerId));
  return {
    ref: `صفقة EDMN-${String(d.number).padStart(8, '0')}`,
    title: d.title,
    status: d.status,
    sellerName: d.sellerFullName ? firstName(d.sellerFullName) : 'البائع',
    buyerName: firstName(b?.n ?? 'المشتري'),
    buyerHref: `/account/deals/${d.id}`,
    sellerHref: `/account/deals/${d.id}`,
    adminHref: `/admin/deals/${d.id}`,
  };
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Full thread for a participant. Rendering it does NOT mark it read (see markRead). */
export async function participantThread(actor: Actor, conversationId: string) {
  const access = await participantAccess(actor, conversationId);
  const [ctx, messages, ws] = await Promise.all([
    contextLabel(db, access.conv),
    loadMessages(db, access.conv, { userId: access.userId, side: access.side }),
    writeState(access.conv, access.side),
  ]);
  const [cur] = (await db.execute<{ c: string | null }>(sql`select max(created_at)::text c from conversation_messages where conversation_id = ${access.conv.id}`)).rows;
  return { conv: access.conv, side: access.side, context: ctx, messages, write: ws, cursor: cur?.c ?? null };
}

/* ───────────────────────── Lists & unread counters ───────────────────────── */

export interface ConversationListItem {
  id: string;
  context: Conversation['context'];
  ref: string;
  title: string;
  status: string;
  otherParty: string;
  side: Side;
  lastMessageAt: Date | null;
  preview: string;
  unread: number;
}

export type InboxFilter = 'all' | 'unread' | 'orders' | 'deals';
export interface InboxQuery {
  filter?: InboxFilter;
  q?: string;
}

type InboxRow = {
  id: string;
  context: Conversation['context'];
  side: Side;
  ref: string;
  title: string | null;
  items: number;
  status: string;
  seller_name: string;
  buyer_name: string;
  last_message_at: Date | string | null;
  body: string | null;
  hidden: boolean | null;
  atts: number | null;
  unread: number;
};

/**
 * One query for the whole inbox (no N+1): context labels, latest message preview and the per-conversation
 * unread count for this user. Sorted by latest activity.
 */
async function inbox(uid: string, scope: ReturnType<typeof sql>, sideExpr: ReturnType<typeof sql>, opts: InboxQuery): Promise<ConversationListItem[]> {
  const conds = [scope];
  if (opts.filter === 'orders') conds.push(sql`c.context = 'SELLER_ORDER'`);
  if (opts.filter === 'deals') conds.push(sql`c.context = 'DEAL'`);
  if (opts.filter === 'unread') conds.push(sql`un.n > 0`);
  const q = (opts.q ?? '').trim().slice(0, 60);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, '');
    conds.push(sql`(st.name ilike ${like} or bu.full_name ilike ${like} or d.title ilike ${like} or d.seller_full_name ilike ${like}
      or exists (select 1 from order_items oi where oi.seller_order_id = so.id and oi.title_snapshot ilike ${like})
      ${digits ? sql`or o.number::text like ${`%${digits}%`} or d.number::text like ${`%${digits}%`}` : sql``})`);
  }
  const res = await db.execute<InboxRow>(sql`
    select c.id, c.context, ${sideExpr} as side,
      case when c.context = 'SELLER_ORDER' then 'طلب #' || o.number || '-' || so.suffix else 'صفقة EDMN-' || lpad(d.number::text, 8, '0') end as ref,
      case when c.context = 'SELLER_ORDER' then (select oi.title_snapshot from order_items oi where oi.seller_order_id = so.id order by oi.id limit 1) else d.title end as title,
      case when c.context = 'SELLER_ORDER' then (select count(*)::int from order_items oi where oi.seller_order_id = so.id) else 1 end as items,
      coalesce(so.status, d.status) as status,
      coalesce(st.name, nullif(split_part(d.seller_full_name, ' ', 1), ''), 'البائع') as seller_name,
      coalesce(nullif(split_part(bu.full_name, ' ', 1), ''), 'المشتري') as buyer_name,
      c.last_message_at, lm.body, lm.hidden, lm.atts, un.n as unread
    from conversations c
    join users bu on bu.id = c.buyer_user_id
    left join seller_orders so on so.id = c.seller_order_id
    left join orders o on o.id = c.order_id
    left join stores st on st.seller_id = c.seller_id
    left join external_deals d on d.id = c.deal_id
    left join conversation_reads r on r.conversation_id = c.id and r.user_id = ${uid}
    left join lateral (
      select m.body, (m.hidden_at is not null) as hidden, (select count(*)::int from conversation_message_attachments a where a.message_id = m.id) as atts
        from conversation_messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) lm on true
    cross join lateral (
      select count(*)::int as n from conversation_messages m
       where m.conversation_id = c.id and m.hidden_at is null and m.sender_role <> ${sideExpr}
         and (r.last_read_at is null or m.created_at > r.last_read_at)) un
    where ${sql.join(conds, sql` and `)}
    order by coalesce(c.last_message_at, c.created_at) desc, c.id
    limit 200`);
  return res.rows.map((x) => {
    let preview = '';
    if (x.hidden) preview = 'رسالة اتخفت بواسطة فريق اضمن';
    else if (x.body) preview = x.body.replace(/\s+/g, ' ').slice(0, 90);
    else if ((x.atts ?? 0) > 0) preview = 'مرفق';
    const title = x.title ? x.title + (x.items > 1 ? ' + منتجات أخرى' : '') : '';
    return {
      id: x.id,
      context: x.context,
      ref: x.ref,
      title,
      status: x.status,
      otherParty: x.side === 'BUYER' ? x.seller_name : x.buyer_name,
      side: x.side,
      lastMessageAt: x.last_message_at ? new Date(x.last_message_at) : null,
      preview,
      unread: Number(x.unread),
    };
  });
}

/** Conversations where the user is the buyer, or the bound seller of a protected deal. */
export async function listForUser(actor: Actor, opts: InboxQuery = {}): Promise<ConversationListItem[]> {
  const uid = requireUser(actor);
  return inbox(uid, sql`(c.buyer_user_id = ${uid} or c.seller_user_id = ${uid})`, sql`(case when c.buyer_user_id = ${uid} then 'BUYER' else 'SELLER' end)`, opts);
}

/** Marketplace conversations of the actor's store (requires `orders.communicate`). */
export async function listForSeller(actor: Actor, opts: InboxQuery = {}): Promise<ConversationListItem[]> {
  const uid = requireUser(actor);
  if (actor.type !== 'SELLER' || !actor.sellerId || !actor.sellerPermissions?.has('orders.communicate')) throw forbidden();
  return inbox(uid, sql`c.seller_id = ${actor.sellerId}`, sql`'SELLER'`, { ...opts, filter: opts.filter === 'deals' ? 'all' : opts.filter });
}

async function unreadIn(conversationId: string, userId: string, side: Side): Promise<number> {
  const [r] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from conversation_messages m
    left join conversation_reads r on r.conversation_id = m.conversation_id and r.user_id = ${userId}
    where m.conversation_id = ${conversationId} and m.sender_role <> ${side} and m.hidden_at is null
      and (r.last_read_at is null or m.created_at > r.last_read_at)`).then((x) => x.rows);
  return Number(r?.n ?? 0);
}

/** Unread messages for a customer account: as a buyer, and as the bound seller of protected deals. */
export async function unreadForUser(userId: string): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from conversation_messages m
    join conversations c on c.id = m.conversation_id
    left join conversation_reads r on r.conversation_id = c.id and r.user_id = ${userId}
    where m.hidden_at is null
      and ((c.buyer_user_id = ${userId} and m.sender_role = 'SELLER') or (c.seller_user_id = ${userId} and m.sender_role = 'BUYER'))
      and (r.last_read_at is null or m.created_at > r.last_read_at)`);
  return Number(res.rows[0]?.n ?? 0);
}

/** Unread buyer messages in the store's marketplace conversations, for this member. */
export async function unreadForSeller(actor: Actor): Promise<number> {
  if (actor.type !== 'SELLER' || !actor.sellerId || !actor.userId || !actor.sellerPermissions?.has('orders.communicate')) return 0;
  const res = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from conversation_messages m
    join conversations c on c.id = m.conversation_id
    left join conversation_reads r on r.conversation_id = c.id and r.user_id = ${actor.userId}
    where c.seller_id = ${actor.sellerId} and m.sender_role = 'BUYER' and m.hidden_at is null
      and (r.last_read_at is null or m.created_at > r.last_read_at)`);
  return Number(res.rows[0]?.n ?? 0);
}

/** Existing conversation id for a sub-order / deal (for links on order, deal and dispute pages). */
export async function conversationIdFor(by: { sellerOrderId?: string; dealId?: string }): Promise<string | null> {
  const where = by.sellerOrderId ? eq(conversations.sellerOrderId, by.sellerOrderId) : by.dealId ? eq(conversations.dealId, by.dealId) : null;
  if (!where) return null;
  const [c] = await db.select({ id: conversations.id }).from(conversations).where(where);
  return c?.id ?? null;
}

/** Unread count for a specific sub-order/deal conversation (for the CTA badge on order/deal pages). */
export async function unreadForContext(actor: Actor, by: { sellerOrderId?: string; dealId?: string }): Promise<number> {
  const id = await conversationIdFor(by);
  if (!id) return 0;
  try {
    const a = await participantAccess(actor, id);
    return unreadIn(id, a.userId, a.side);
  } catch {
    return 0;
  }
}

/* ───────────────────────── Reports ───────────────────────── */

export { REPORT_REASON_LABELS } from '@/lib/messaging';

/**
 * A participant reports one message of the OTHER party. This only creates a reviewable record for staff;
 * nobody is penalised automatically.
 */
export async function reportMessage(actor: Actor, messageId: string, input: { reason: string; note?: string }) {
  const uid = requireUser(actor);
  if (!isUuid(messageId)) throw notFound('الرسالة');
  const [m] = await db.select().from(conversationMessages).where(eq(conversationMessages.id, messageId));
  if (!m) throw notFound('الرسالة');
  const access = await participantAccess(actor, m.conversationId);
  if (m.senderUserId === uid || m.senderRole === access.side) throw validation('مينفعش تبلّغ عن رسالتك');
  if (!(MESSAGE_REPORT_REASONS as readonly string[]).includes(input.reason)) throw validation('اختار سبب البلاغ');
  const note = cleanBody(input.note ?? '').slice(0, 500) || null;
  await enforce(`msg:report:${uid}`, LIMITS.reportsPerHour, 3600);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(conversationMessageReports)
      .values({ messageId, conversationId: m.conversationId, reporterUserId: uid, reason: input.reason as MessageReportReason, note })
      .onConflictDoNothing()
      .returning();
    if (!r) throw conflict('بلّغت عن الرسالة دي قبل كده، وفريق اضمن هيراجعها');
    await audit(tx, actor, { action: 'conversation.message_reported', entityType: 'conversation', entityId: m.conversationId, newValues: { messageId, reason: input.reason } });
    return r;
  });
}

/* ───────────────────────── Staff (read-only by default, audited) ───────────────────────── */

/**
 * Staff view of a conversation. Requires `messages.view`; EVERY view is written to the audit log with the
 * related order/deal, because conversations are private customer communication. Staff never post as a party.
 */
export async function staffThread(actor: Actor, conversationId: string, opts: { via?: string } = {}) {
  requirePermission(actor, 'messages.view');
  if (!isUuid(conversationId)) throw notAvailable();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) throw notAvailable();
  await audit(db, actor, {
    action: 'conversation.staff_viewed',
    entityType: 'conversation',
    entityId: conv.id,
    newValues: { context: conv.context, sellerOrderId: conv.sellerOrderId, orderId: conv.orderId, dealId: conv.dealId, via: opts.via ?? null },
  });
  const [ctx, messages, ws] = await Promise.all([contextLabel(db, conv), loadMessages(db, conv, { userId: null, side: 'STAFF' }), writeState(conv, null)]);
  const reports = await db
    .select({ r: conversationMessageReports, reporter: users.fullName })
    .from(conversationMessageReports)
    .innerJoin(users, eq(users.id, conversationMessageReports.reporterUserId))
    .where(eq(conversationMessageReports.conversationId, conv.id))
    .orderBy(desc(conversationMessageReports.createdAt));
  return { conv, context: ctx, messages, write: ws, reports };
}

export async function reportQueue(actor: Actor, status: 'OPEN' | 'ACTIONED' | 'DISMISSED' = 'OPEN') {
  requirePermission(actor, 'messages.view');
  return db
    .select({ r: conversationMessageReports, reporter: users.fullName, body: conversationMessages.body, hiddenAt: conversationMessages.hiddenAt })
    .from(conversationMessageReports)
    .innerJoin(users, eq(users.id, conversationMessageReports.reporterUserId))
    .innerJoin(conversationMessages, eq(conversationMessages.id, conversationMessageReports.messageId))
    .where(eq(conversationMessageReports.status, status))
    .orderBy(desc(conversationMessageReports.createdAt))
    .limit(200);
}

/** Hide a message from participants. The original stays stored and visible to staff; audited. */
export async function hideMessage(actor: Actor, messageId: string, reason: string) {
  requirePermission(actor, 'messages.moderate');
  const why = cleanBody(reason ?? '');
  if (why.length < 3) throw validation('اكتب سبب الإخفاء');
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(conversationMessages).where(eq(conversationMessages.id, messageId)).for('update');
    if (!m) throw notFound('الرسالة');
    if (m.hiddenAt) throw conflict('الرسالة متخفية بالفعل');
    await tx.update(conversationMessages).set({ hiddenAt: new Date(), hiddenBy: actor.userId, hiddenReason: why }).where(eq(conversationMessages.id, messageId));
    await tx
      .update(conversationMessageReports)
      .set({ status: 'ACTIONED', handledBy: actor.userId, handledAt: new Date(), resolutionNote: why })
      .where(and(eq(conversationMessageReports.messageId, messageId), eq(conversationMessageReports.status, 'OPEN')));
    await audit(tx, actor, { action: 'conversation.message_hidden', entityType: 'conversation', entityId: m.conversationId, newValues: { messageId }, reason: why });
  });
}

export async function resolveReport(actor: Actor, reportId: string, decision: 'ACTIONED' | 'DISMISSED', note: string) {
  requirePermission(actor, 'messages.moderate');
  const why = cleanBody(note ?? '');
  if (why.length < 3) throw validation('اكتب ملاحظة القرار');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(conversationMessageReports).where(eq(conversationMessageReports.id, reportId)).for('update');
    if (!r) throw notFound('البلاغ');
    if (r.status !== 'OPEN') throw conflict('البلاغ ده اتراجع قبل كده');
    await tx.update(conversationMessageReports).set({ status: decision, handledBy: actor.userId, handledAt: new Date(), resolutionNote: why }).where(eq(conversationMessageReports.id, reportId));
    await audit(tx, actor, { action: 'conversation.report_resolved', entityType: 'conversation', entityId: r.conversationId, newValues: { reportId, decision }, reason: why });
  });
}

/** Staff can lock (read-only for both parties) or reopen a conversation; audited. */
export async function setConversationLock(actor: Actor, conversationId: string, locked: boolean, reason: string) {
  requirePermission(actor, 'messages.moderate');
  const why = cleanBody(reason ?? '');
  if (why.length < 3) throw validation('اكتب السبب');
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, conversationId)).for('update');
    if (!c) throw notAvailable();
    await tx
      .update(conversations)
      .set(locked ? { status: 'LOCKED', lockedAt: new Date(), lockedBy: actor.userId, lockedReason: why } : { status: 'ACTIVE', lockedAt: null, lockedBy: null, lockedReason: null })
      .where(eq(conversations.id, conversationId));
    await audit(tx, actor, { action: locked ? 'conversation.locked' : 'conversation.unlocked', entityType: 'conversation', entityId: conversationId, reason: why });
  });
}

/** Recent conversations for the staff index (metadata only — opening one is audited). */
export async function recentConversations(actor: Actor, limit = 50) {
  requirePermission(actor, 'messages.view');
  const rows = await db
    .select()
    .from(conversations)
    .where(sql`${conversations.lastMessageAt} is not null`)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
  return Promise.all(rows.map(async (c) => ({ conv: c, context: await contextLabel(db, c) })));
}

/** True if a staff actor may open conversations (used to show links on admin pages). */
export const canViewConversations = (actor: Actor) => hasPermission(actor, 'messages.view');

function isUuid(v: string) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Exported for tests: the one place that decides whether a store member may take part.
export function memberCanCommunicate(role: string): boolean {
  return COMMUNICATING_MEMBER_ROLES.includes(role);
}

