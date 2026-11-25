import { audit } from '@/server/audit/audit';
import { requirePermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { replyToTicket, ticketQueue, ticketThread } from '@/server/modules/support/service';
import { maskName } from './monitoring';

/**
 * Admin App — support inbox (PKG-I02-05, READ-ONLY). Mobile mirror of the console /admin/support queue
 * and thread, permission support.manage enforced HERE (and again inside the reused domain services).
 * Replies, status changes, assignment and escalation stay on the web console. Personal names are
 * masked per the Admin App convention; attachments are flagged (hasAttachment) but file ids are never
 * exposed on mobile.
 */

const OPEN = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SELLER', 'ESCALATED'] as const;
const CLOSED = ['RESOLVED', 'CLOSED'] as const;

export async function supportQueueMobile(actor: Actor, opts: { tab: 'open' | 'mine' | 'closed'; page: number }) {
  requirePermission(actor, 'support.manage');
  const pageSize = 30;
  const statuses = opts.tab === 'closed' ? [...CLOSED] : [...OPEN];
  const rows = await ticketQueue(actor, statuses as never);
  const list = opts.tab === 'mine' ? rows.filter((r) => r.t.assigneeId === actor.userId) : rows;
  const pageRows = list.slice((opts.page - 1) * pageSize, opts.page * pageSize);
  return {
    items: pageRows.map((r) => ({
      id: r.t.id,
      number: String(r.t.number),
      subject: r.t.subject,
      type: r.t.type as string,
      fromSeller: r.t.sellerId != null,
      requester: maskName(r.requester),
      priority: r.t.priority as string,
      status: r.t.status as string,
      assignedToMe: r.t.assigneeId === (actor.userId ?? null),
      updatedAt: r.t.updatedAt?.toISOString() ?? null,
    })),
    page: opts.page,
    hasMore: list.length > opts.page * pageSize,
  };
}

export async function supportThreadForStaff(actor: Actor, ticketId: string) {
  requirePermission(actor, 'support.manage');
  const { ticket: t, messages } = await ticketThread(actor, ticketId);
  return {
    id: t.id,
    number: String(t.number),
    type: t.type as string,
    subject: t.subject,
    status: t.status as string,
    priority: t.priority as string,
    fromSeller: t.sellerId != null,
    assignedToMe: t.assigneeId === (actor.userId ?? null),
    messages: messages.map((m) => ({
      id: m.m.id,
      isStaff: m.m.isStaff,
      isInternal: m.m.isInternal,
      author: maskName(m.author),
      body: m.m.body,
      hasAttachment: m.m.attachmentFileId != null,
      createdAt: m.m.createdAt?.toISOString() ?? null,
    })),
    createdAt: t.createdAt?.toISOString() ?? null,
    updatedAt: t.updatedAt?.toISOString() ?? null,
  };
}

/**
 * PKG-I02-06 — the single approved support WRITE on the Admin App: a staff reply, reusing the domain
 * service so the semantics are identical to the console (message marked isStaff, OPEN → IN_PROGRESS,
 * first-response SLA tracking, SUPPORT_REPLY notification to the requester). No internal notes, no
 * attachments, no status change beyond what the domain service already does — never an auto-close.
 * Audited with staff identity + ticket only; the reply BODY is never written to the audit trail.
 */
export async function replyToTicketAsStaff(actor: Actor, ticketId: string, body: string) {
  requirePermission(actor, 'support.manage');
  await replyToTicket(actor, ticketId, body);
  await audit(db, actor, { action: 'support.staff_replied', entityType: 'support_ticket', entityId: ticketId });
}
