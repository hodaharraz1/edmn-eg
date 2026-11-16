import { z } from 'zod';
import { TICKET_TYPES } from '@/domain/machines';
import { REPORT_REASON_LABELS } from '@/lib/messaging';
import { inbox, markSeen, newTicket, openForDeal, openForSellerOrder, rate, reopen, reply, report, send, thread, ticket, tickets, unreadCount } from '@/server/modules/mobile/messages';
import { defineRoute } from '../http';
import { isoDateTime, uuid } from '../schemas';

/**
 * Messaging (buyer ↔ store, deal buyer ↔ deal seller) and support tickets. A conversation can only be opened from an
 * order or deal the caller is a party to; its id alone never grants access (uniform 404). Store-side routes run as the
 * session user's store membership and require `orders.communicate`. Messages are evidence only: they never change an
 * order, a deal, a payment or a balance.
 */
const REPORT_REASONS = Object.keys(REPORT_REASON_LABELS) as [keyof typeof REPORT_REASON_LABELS, ...(keyof typeof REPORT_REASON_LABELS)[]];
const errors = ['forbidden' as const, 'not_found' as const, 'invalid_state' as const];
const customer = { api: 'mobile' as const, auth: 'customer' as const, tags: ['Messaging'] };
const store = { api: 'mobile' as const, auth: 'seller' as const, tags: ['Messaging', 'Seller'] };
const support = { api: 'mobile' as const, auth: 'customer' as const, tags: ['Support'] };

const listQuery = z.object({ filter: z.enum(['all', 'unread', 'orders', 'deals']).optional(), q: z.string().trim().max(60).optional() });
const conversationItem = z.object({
  id: uuid,
  context: z.enum(['SELLER_ORDER', 'DEAL']),
  ref: z.string(),
  title: z.string(),
  status: z.string(),
  otherParty: z.string(),
  side: z.enum(['BUYER', 'SELLER']),
  lastMessageAt: isoDateTime.nullable(),
  preview: z.string(),
  unread: z.number().int(),
});
const inboxOut = z.object({ items: z.array(conversationItem), unread: z.number().int() });
const unreadOut = z.object({ unread: z.number().int() });
const threadOut = z.object({
  id: uuid,
  context: z.enum(['SELLER_ORDER', 'DEAL']),
  side: z.enum(['BUYER', 'SELLER']),
  ref: z.string(),
  title: z.string(),
  status: z.string(),
  otherParty: z.string(),
  link: z.object({ kind: z.enum(['ORDER', 'SELLER_ORDER', 'DEAL']), id: uuid }),
  canWrite: z.boolean(),
  readOnlyReason: z.string().nullable(),
  messages: z.array(
    z.object({
      id: uuid,
      side: z.enum(['BUYER', 'SELLER']),
      mine: z.boolean(),
      body: z.string(),
      hidden: z.boolean(),
      createdAt: isoDateTime,
      attachments: z.array(z.object({ fileId: uuid, mimeType: z.string() })).meta({ description: 'Download with GET /api/v1/files/{fileId}.' }),
      readByOther: z.boolean(),
    }),
  ),
});
const opened = z.object({ conversationId: uuid });
const conv = z.object({ conversationId: uuid });
const sendBody = z.object({ body: z.string().max(2000).optional().default(''), clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict();
const sent = z.object({ id: uuid, createdAt: isoDateTime });
const seenBody = z.object({ upToMessageId: uuid.optional() });

/** One definition per audience; the service resolves the side from the actor. */
function conversationRoutes(prefix: '' | '/seller', base: typeof customer | typeof store, idp: string) {
  const p = `/api/v1${prefix}/conversations`;
  return [
    defineRoute({ ...base, id: `list${idp}Conversations`, method: 'GET', path: p, summary: 'My conversations, newest activity first, with unread counts', rate: 'read', errors, query: listQuery, response: inboxOut, handler: ({ actor, query }) => inbox(actor!, query.filter, query.q) }),
    defineRoute({ ...base, id: `get${idp}UnreadMessages`, method: 'GET', path: `${p}/unread`, summary: 'Unread message count (badge)', rate: 'read', errors, response: unreadOut, handler: ({ actor }) => unreadCount(actor!) }),
    defineRoute({ ...base, id: `get${idp}Conversation`, method: 'GET', path: `${p}/{conversationId}`, summary: 'One conversation (fetching never marks it read)', rate: 'read', errors, params: conv, response: threadOut, handler: ({ actor, params }) => thread(actor!, params.conversationId) }),
    defineRoute({
      ...base,
      id: `send${idp}Message`,
      method: 'POST',
      path: `${p}/{conversationId}/messages`,
      summary: 'Send a message (text and/or up to 3 attachments). clientKey makes a retry return the original message.',
      rate: 'write',
      errors: [...errors, 'rate_limited' as const, 'conflict' as const],
      params: conv,
      multipart: { files: { attachments: { max: 3 } } },
      body: sendBody,
      response: sent,
      handler: ({ actor, params, body, files }) => send(actor!, params.conversationId, body.body, body.clientKey, files.attachments ?? []),
    }),
    defineRoute({
      ...base,
      id: `mark${idp}ConversationSeen`,
      method: 'POST',
      path: `${p}/{conversationId}/seen`,
      summary: 'Report the newest message that was on screen; only this marks messages read',
      rate: 'write',
      errors,
      params: conv,
      body: seenBody,
      response: unreadOut,
      handler: ({ actor, params, body }) => markSeen(actor!, params.conversationId, body.upToMessageId),
    }),
    defineRoute({
      ...base,
      id: `report${idp}Message`,
      method: 'POST',
      path: `${p}/messages/{messageId}/report`,
      summary: "Report one of the other party's messages to EDMN (creates a review record, penalises nobody)",
      rate: 'sensitive',
      errors: [...errors, 'conflict' as const],
      params: z.object({ messageId: uuid }),
      body: z.object({ reason: z.enum(REPORT_REASONS), note: z.string().trim().max(500).optional() }),
      response: z.object({ ok: z.literal(true) }),
      handler: ({ actor, params, body }) => report(actor!, params.messageId, body.reason, body.note),
    }),
  ];
}

export const openOrderConversation = defineRoute({
  ...customer,
  id: 'openOrderConversation',
  method: 'POST',
  path: '/api/v1/seller-orders/{sellerOrderId}/conversation',
  summary: 'Buyer: open (or get) the conversation with the store of one paid seller order',
  rate: 'write',
  errors,
  params: z.object({ sellerOrderId: uuid }),
  response: opened,
  handler: ({ actor, params }) => openForSellerOrder(actor!, params.sellerOrderId),
});

export const openStoreOrderConversation = defineRoute({
  ...store,
  id: 'openStoreOrderConversation',
  method: 'POST',
  path: '/api/v1/seller/orders/{sellerOrderId}/conversation',
  summary: 'Store: open (or get) the conversation with the buyer of one paid seller order',
  rate: 'write',
  errors,
  params: z.object({ sellerOrderId: uuid }),
  response: opened,
  handler: ({ actor, params }) => openForSellerOrder(actor!, params.sellerOrderId),
});

export const openDealConversationRoute = defineRoute({
  ...customer,
  id: 'openDealConversation',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/conversation',
  summary: 'Deal buyer or joined deal seller: open (or get) the deal conversation',
  rate: 'write',
  errors,
  params: z.object({ dealId: uuid }),
  response: opened,
  handler: ({ actor, params }) => openForDeal(actor!, params.dealId),
});

/* ───────── Support ───────── */

const ticketRow = z.object({
  id: uuid,
  number: z.string(),
  type: z.string(),
  subject: z.string(),
  status: z.string(),
  relatedType: z.string().nullable(),
  relatedId: z.string().nullable(),
  rating: z.number().int().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  allowedActions: z.array(z.enum(['REPLY', 'REOPEN', 'RATE'])),
});
const ticketOut = ticketRow.extend({
  messages: z.array(z.object({ id: uuid, fromStaff: z.boolean(), mine: z.boolean(), body: z.string(), createdAt: isoDateTime, attachmentFileId: uuid.nullable() })),
});
const tid = z.object({ ticketId: uuid });

export const listSupportTickets = defineRoute({ ...support, id: 'listSupportTickets', method: 'GET', path: '/api/v1/support/tickets', summary: 'My support tickets', rate: 'read', errors, response: z.object({ items: z.array(ticketRow) }), handler: ({ actor }) => tickets(actor!) });

export const getSupportTicket = defineRoute({ ...support, id: 'getSupportTicket', method: 'GET', path: '/api/v1/support/tickets/{ticketId}', summary: 'One ticket with its public replies (internal notes never included)', rate: 'read', errors, params: tid, response: ticketOut, handler: ({ actor, params }) => ticket(actor!, params.ticketId) });

export const openSupportTicket = defineRoute({
  ...support,
  id: 'openSupportTicket',
  method: 'POST',
  path: '/api/v1/support/tickets',
  summary: 'Open a ticket (optionally about an order / deal / payment of mine, with one attachment)',
  rate: 'sensitive',
  idempotency: 'required',
  errors: [...errors, 'rate_limited' as const],
  multipart: { files: { attachment: { max: 1 } } },
  body: z.object({
    type: z.enum(TICKET_TYPES),
    subject: z.string().trim().min(5).max(150),
    body: z.string().trim().min(10).max(5000),
    relatedType: z.string().trim().max(40).optional(),
    relatedId: uuid.optional(),
  }),
  response: ticketOut,
  handler: ({ actor, body, files }) => newTicket(actor!, body, files.attachment?.[0] ?? null),
});

export const replySupportTicket = defineRoute({
  ...support,
  id: 'replySupportTicket',
  method: 'POST',
  path: '/api/v1/support/tickets/{ticketId}/replies',
  summary: 'Reply to my ticket (a reply to a resolved or closed ticket reopens it)',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: tid,
  multipart: { files: { attachment: { max: 1 } } },
  body: z.object({ body: z.string().trim().min(2).max(5000) }),
  response: ticketOut,
  handler: ({ actor, params, body, files }) => reply(actor!, params.ticketId, body.body, files.attachment?.[0] ?? null),
});

export const reopenSupportTicket = defineRoute({
  ...support,
  id: 'reopenSupportTicket',
  method: 'POST',
  path: '/api/v1/support/tickets/{ticketId}/reopen',
  summary: 'Reopen a resolved or closed ticket with a reason',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: tid,
  body: z.object({ reason: z.string().trim().min(5).max(1000) }),
  response: ticketOut,
  handler: ({ actor, params, body }) => reopen(actor!, params.ticketId, body.reason),
});

export const rateSupportTicket = defineRoute({
  ...support,
  id: 'rateSupportTicket',
  method: 'POST',
  path: '/api/v1/support/tickets/{ticketId}/rating',
  summary: 'Rate the service after resolution (1–5, once per resolution)',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: tid,
  body: z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }),
  response: ticketOut,
  handler: ({ actor, params, body }) => rate(actor!, params.ticketId, body.rating, body.comment),
});

export const [listConversations, getUnreadMessages, getConversation, sendMessageRoute, markConversationSeen, reportMessageRoute] = conversationRoutes('', customer, '');
export const [listStoreConversations, getStoreUnreadMessages, getStoreConversation, sendStoreMessage, markStoreConversationSeen, reportStoreMessage] = conversationRoutes('/seller', store, 'Store');

export const messageRoutes = [
  listConversations, getUnreadMessages, getConversation, sendMessageRoute, markConversationSeen, reportMessageRoute,
  listStoreConversations, getStoreUnreadMessages, getStoreConversation, sendStoreMessage, markStoreConversationSeen, reportStoreMessage,
  openOrderConversation,
  openStoreOrderConversation,
  openDealConversationRoute,
  listSupportTickets,
  getSupportTicket,
  openSupportTicket,
  replySupportTicket,
  reopenSupportTicket,
  rateSupportTicket,
];
