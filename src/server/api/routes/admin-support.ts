import { z } from 'zod';
import { replyToTicketAsStaff, supportQueueMobile, supportThreadForStaff } from '@/server/modules/admin-mobile/support';
import { defineRoute } from '../http';
import { isoDateTime, ok } from '../schemas';

/**
 * Admin App — support inbox (PKG-I02-05 read-only + PKG-I02-06 one approved write). Permission
 * support.manage, same as the console page. Assignment, status changes and escalation stay on the web
 * console; the only mutation here is the staff reply, which reuses the domain service and can never
 * close a ticket, post an internal note or carry an attachment. Names masked; attachment file ids
 * never exposed.
 */
const id = z.uuid();
const nullableIso = isoDateTime.nullable();

export const adminListSupportTickets = defineRoute({
  id: 'adminListSupportTickets',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/support/tickets',
  summary: 'Support ticket queue by tab (support.manage). Masked requester names; read-only',
  tags: ['Admin Support'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({
    tab: z.enum(['open', 'mine', 'closed']).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
  }),
  response: z.object({
    items: z.array(
      z.object({
        id,
        number: z.string(),
        subject: z.string(),
        type: z.string(),
        fromSeller: z.boolean(),
        requester: z.string().nullable(),
        priority: z.string(),
        status: z.string(),
        assignedToMe: z.boolean(),
        updatedAt: nullableIso,
      }),
    ),
    page: z.number().int(),
    hasMore: z.boolean(),
  }),
  handler: async ({ actor, query }) => supportQueueMobile(actor!, { tab: query.tab ?? 'open', page: query.page ?? 1 }),
});

export const adminSupportTicketDetail = defineRoute({
  id: 'adminSupportTicketDetail',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/support/tickets/{ticketId}',
  summary: 'Support ticket thread for staff (support.manage): ticket + full message history, masked author names, attachments flagged not exposed. Read-only',
  tags: ['Admin Support'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ ticketId: id }),
  response: z.object({
    id,
    number: z.string(),
    type: z.string(),
    subject: z.string(),
    status: z.string(),
    priority: z.string(),
    fromSeller: z.boolean(),
    assignedToMe: z.boolean(),
    messages: z.array(
      z.object({
        id,
        isStaff: z.boolean(),
        isInternal: z.boolean(),
        author: z.string().nullable(),
        body: z.string(),
        hasAttachment: z.boolean(),
        createdAt: nullableIso,
      }),
    ),
    createdAt: nullableIso,
    updatedAt: nullableIso,
  }),
  handler: ({ actor, params }) => supportThreadForStaff(actor!, params.ticketId),
});

export const adminReplySupportTicket = defineRoute({
  id: 'adminReplySupportTicket',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/support/tickets/{ticketId}/reply',
  summary:
    'Reply to a support ticket as the support team (support.manage). The customer sees a staff reply and is notified via SUPPORT_REPLY; never internal, never closes the ticket; audited without the reply body',
  tags: ['Admin Actions'],
  auth: 'admin',
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'validation_failed'],
  params: z.object({ ticketId: id }),
  body: z.object({ body: z.string().trim().min(2).max(4000) }),
  response: ok,
  handler: async ({ actor, params, body }) => {
    await replyToTicketAsStaff(actor!, params.ticketId, body.body);
    return { ok: true as const };
  },
});

export const adminSupportRoutes = [adminListSupportTickets, adminSupportTicketDetail, adminReplySupportTicket];
