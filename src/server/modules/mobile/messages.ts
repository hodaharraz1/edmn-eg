import { requireUser, type Actor } from '@/server/core/actor';
import { notFound } from '@/server/core/errors';
import {
  listForSeller,
  listForUser,
  markRead,
  openDealConversation,
  openSellerOrderConversation,
  participantThread,
  reportMessage,
  sendMessage,
  unreadForSeller,
  unreadForUser,
  type ConversationListItem,
  type InboxFilter,
} from '@/server/modules/messaging/service';
import { myTickets, openTicket, rateTicket, reopenTicket, replyToTicket, ticketThread } from '@/server/modules/support/service';

type Upload = { data: Buffer; name: string };

/**
 * Messaging and support for the Customer App — thin projections over the existing services. Every conversation is
 * bound to one seller sub-order or one protected deal (no way to message an arbitrary user); authorization is derived
 * from that order/deal on every call; messages never change an order, a deal or money. The same functions serve the
 * buyer / deal-party routes (customer actor) and the store routes (seller actor with `orders.communicate`).
 */

const item = (c: ConversationListItem) => ({
  id: c.id,
  context: c.context,
  ref: stripIsolates(c.ref),
  title: c.title,
  status: c.status,
  otherParty: c.otherParty,
  side: c.side,
  lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
  preview: c.preview,
  unread: c.unread,
});

/** The web inbox wraps codes in Unicode isolates for HTML; the app lays out LTR codes itself. */
const stripIsolates = (s: string) => s.replace(/[⁦-⁩]/g, '');

export async function inbox(actor: Actor, filter: InboxFilter = 'all', q?: string) {
  const userId = requireUser(actor);
  const asStore = actor.type === 'SELLER';
  const [items, unread] = await Promise.all([asStore ? listForSeller(actor, { filter, q }) : listForUser(actor, { filter, q }), asStore ? unreadForSeller(actor) : unreadForUser(userId)]);
  return { items: items.map(item), unread };
}

export async function unreadCount(actor: Actor) {
  const userId = requireUser(actor);
  return { unread: actor.type === 'SELLER' ? await unreadForSeller(actor) : await unreadForUser(userId) };
}

/** Full thread. Reading it does NOT mark it read: the app reports what was actually on screen (markSeen). */
export async function thread(actor: Actor, conversationId: string) {
  const t = await participantThread(actor, conversationId);
  return {
    id: t.conv.id,
    context: t.conv.context,
    side: t.side,
    ref: stripIsolates(t.context.ref),
    title: t.context.title ?? '',
    status: t.context.status,
    otherParty: t.side === 'BUYER' ? t.context.sellerName : t.context.buyerName,
    /** Where the app opens the order / deal this conversation belongs to. */
    link: t.conv.context === 'DEAL' ? { kind: 'DEAL' as const, id: t.conv.dealId! } : t.side === 'BUYER' ? { kind: 'ORDER' as const, id: t.conv.orderId! } : { kind: 'SELLER_ORDER' as const, id: t.conv.sellerOrderId! },
    canWrite: t.write.canWrite,
    readOnlyReason: t.write.reason,
    messages: t.messages.map((m) => ({
      id: m.id,
      side: m.side,
      mine: m.mine,
      // A message hidden by EDMN staff keeps its place in the thread but never its text.
      body: m.hidden ? '' : m.body,
      hidden: m.hidden,
      createdAt: m.createdAt.toISOString(),
      attachments: m.hidden ? [] : m.attachments.map((a) => ({ fileId: a.fileId, mimeType: a.mimeType })),
      readByOther: m.readByOther,
    })),
  };
}

export async function openForSellerOrder(actor: Actor, sellerOrderId: string) {
  const c = await openSellerOrderConversation(actor, sellerOrderId);
  return { conversationId: c.id };
}

export async function openForDeal(actor: Actor, dealId: string) {
  const c = await openDealConversation(actor, dealId);
  return { conversationId: c.id };
}

/** clientKey is the idempotency key: a retried send returns the original message, never a duplicate. */
export async function send(actor: Actor, conversationId: string, body: string, clientKey: string, attachments: Upload[]) {
  const m = await sendMessage(actor, conversationId, { body, clientKey }, attachments);
  return { id: m.id, createdAt: m.createdAt.toISOString() };
}

export async function markSeen(actor: Actor, conversationId: string, upToMessageId?: string) {
  await markRead(actor, conversationId, upToMessageId);
  return unreadCount(actor);
}

export async function report(actor: Actor, messageId: string, reason: string, note?: string) {
  await reportMessage(actor, messageId, { reason, note });
  return { ok: true as const };
}

/* ───────────────────────── Support tickets ───────────────────────── */

type Ticket = Awaited<ReturnType<typeof myTickets>>[number];

/** What the requester may do next — decided here from the ticket, never by the app. */
function ticketActions(t: Ticket): ('REPLY' | 'REOPEN' | 'RATE')[] {
  const done = t.status === 'RESOLVED' || t.status === 'CLOSED';
  const a: ('REPLY' | 'REOPEN' | 'RATE')[] = ['REPLY'];
  if (done) a.push('REOPEN');
  if (done && (!t.ratedAt || (t.reopenedAt && t.reopenedAt > t.ratedAt))) a.push('RATE');
  return a;
}

const ticketRow = (t: Ticket) => ({
  id: t.id,
  number: String(t.number),
  type: t.type,
  subject: t.subject,
  status: t.status,
  relatedType: t.relatedType,
  relatedId: t.relatedId,
  rating: t.rating,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  allowedActions: ticketActions(t),
});

export async function tickets(actor: Actor) {
  const userId = requireUser(actor);
  return { items: (await myTickets(userId)).map(ticketRow) };
}

/** Requester view: internal notes are excluded by the service; staff appear as «فريق أضمن», never by name. */
export async function ticket(actor: Actor, ticketId: string) {
  const userId = requireUser(actor);
  const t = await ticketThread(actor, ticketId);
  if (t.ticket.requesterUserId !== userId) throw notFound('التذكرة'); // staff use the admin console
  return {
    ...ticketRow(t.ticket),
    messages: t.messages
      .filter((x) => !x.m.isInternal)
      .map((x) => ({ id: x.m.id, fromStaff: x.m.isStaff, mine: x.m.authorUserId === userId, body: x.m.body, createdAt: x.m.createdAt.toISOString(), attachmentFileId: x.m.attachmentFileId })),
  };
}

export async function newTicket(actor: Actor, input: { type: string; subject: string; body: string; relatedType?: string; relatedId?: string }, attachment: Upload | null) {
  const t = await openTicket(actor, input as Parameters<typeof openTicket>[1], attachment);
  return ticket(actor, t.id);
}

export async function reply(actor: Actor, ticketId: string, body: string, attachment: Upload | null) {
  await replyToTicket(actor, ticketId, body, { attachment });
  return ticket(actor, ticketId);
}

export async function reopen(actor: Actor, ticketId: string, reason: string) {
  await reopenTicket(actor, ticketId, reason);
  return ticket(actor, ticketId);
}

export async function rate(actor: Actor, ticketId: string, rating: number, comment?: string) {
  await rateTicket(actor, ticketId, rating, comment);
  return ticket(actor, ticketId);
}
