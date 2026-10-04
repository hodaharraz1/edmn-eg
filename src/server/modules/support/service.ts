import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ticketMachine, type TicketStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound, validation } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { supportMessages, supportTickets, users } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { storeUpload } from '@/server/storage/uploads';
import { parse, transition } from '../_shared';

export const ticketSchema = z.object({
  type: z.enum(['ORDER', 'PAYMENT', 'SHIPPING', 'RETURN', 'PRODUCT', 'SELLER', 'EXTERNAL_DEAL', 'ACCOUNT']),
  subject: z.string().trim().min(5, 'اكتب عنواناً واضحاً').max(150),
  body: z.string().trim().min(10, 'اشرح طلبك (10 أحرف على الأقل)').max(5000),
  relatedType: z.string().trim().max(40).optional().default(''),
  relatedId: z.string().trim().max(60).optional().default(''),
});

export async function openTicket(actor: Actor, input: z.input<typeof ticketSchema>, attachment?: { data: Buffer; name: string } | null) {
  const userId = requireUser(actor);
  const d = parse(ticketSchema, input);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(supportTickets)
      .values({
        requesterUserId: userId,
        sellerId: actor.type === 'SELLER' ? actor.sellerId : null,
        type: d.type,
        subject: d.subject,
        relatedType: d.relatedType || null,
        relatedId: d.relatedId || null,
        priority: d.type === 'PAYMENT' ? 'HIGH' : 'NORMAL',
      })
      .returning();
    const file = attachment ? await storeUpload(tx, actor, { purpose: 'SUPPORT_ATTACHMENT', data: attachment.data, originalName: attachment.name }) : null;
    await tx.insert(supportMessages).values({ ticketId: t.id, authorUserId: userId, body: d.body, attachmentFileId: file?.id ?? null });
    return t;
  });
}

async function loadTicket(actor: Actor, ticketId: string) {
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId));
  if (!t) throw notFound('التذكرة');
  const staff = hasPermission(actor, 'support.manage');
  if (!staff && t.requesterUserId !== actor.userId) throw forbidden();
  return { t, staff };
}

export async function replyToTicket(actor: Actor, ticketId: string, body: string, opts: { internal?: boolean; attachment?: { data: Buffer; name: string } | null } = {}) {
  requireUser(actor);
  const text = body?.trim();
  if (!text || text.length < 2) throw validation('اكتب ردك');
  const { t, staff } = await loadTicket(actor, ticketId);
  if (opts.internal && !staff) throw forbidden();
  await db.transaction(async (tx) => {
    const file = opts.attachment ? await storeUpload(tx, actor, { purpose: 'SUPPORT_ATTACHMENT', data: opts.attachment.data, originalName: opts.attachment.name }) : null;
    await tx.insert(supportMessages).values({ ticketId: t.id, authorUserId: actor.userId!, body: text.slice(0, 5000), isStaff: staff, isInternal: !!opts.internal, attachmentFileId: file?.id ?? null });
    let to: TicketStatus | null = null;
    if (staff && !opts.internal && t.status === 'OPEN') to = 'IN_PROGRESS';
    if (!staff && (t.status === 'WAITING_CUSTOMER' || t.status === 'WAITING_SELLER' || t.status === 'RESOLVED')) to = 'IN_PROGRESS';
    if (to) {
      await transition(tx, actor, ticketMachine, t.id, t.status, to);
      await tx.update(supportTickets).set({ status: to }).where(eq(supportTickets.id, t.id));
    } else {
      await tx.update(supportTickets).set({ updatedAt: new Date() }).where(eq(supportTickets.id, t.id));
    }
    if (staff && !opts.internal) await notify(tx, { event: 'SUPPORT_REPLY', userIds: [t.requesterUserId], vars: { ticket: t.number }, link: `/account/support/${t.id}` });
  });
}

export async function updateTicket(actor: Actor, ticketId: string, input: { status?: TicketStatus; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; assigneeId?: string | null }) {
  requirePermission(actor, 'support.manage');
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for('update');
    if (!t) throw notFound('التذكرة');
    const sets: Partial<typeof supportTickets.$inferInsert> = {};
    if (input.status && input.status !== t.status) {
      await transition(tx, actor, ticketMachine, t.id, t.status, input.status);
      sets.status = input.status;
      if (input.status === 'RESOLVED' || input.status === 'CLOSED') sets.resolvedAt = new Date();
    }
    if (input.priority) sets.priority = input.priority;
    if (input.assigneeId !== undefined) sets.assigneeId = input.assigneeId;
    if (Object.keys(sets).length) await tx.update(supportTickets).set(sets).where(eq(supportTickets.id, t.id));
    await audit(tx, actor, { action: 'support.ticket_updated', entityType: 'support_ticket', entityId: t.id, newValues: input });
  });
}

export async function ticketThread(actor: Actor, ticketId: string) {
  const { t, staff } = await loadTicket(actor, ticketId);
  const msgs = await db
    .select({ m: supportMessages, author: users.fullName })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.authorUserId))
    .where(staff ? eq(supportMessages.ticketId, t.id) : and(eq(supportMessages.ticketId, t.id), eq(supportMessages.isInternal, false)))
    .orderBy(asc(supportMessages.createdAt));
  return { ticket: t, messages: msgs, staff };
}

export async function myTickets(userId: string) {
  return db.select().from(supportTickets).where(eq(supportTickets.requesterUserId, userId)).orderBy(desc(supportTickets.updatedAt));
}

export async function ticketQueue(statuses: TicketStatus[]) {
  return db
    .select({ t: supportTickets, requester: users.fullName })
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.requesterUserId))
    .where(inArray(supportTickets.status, statuses))
    .orderBy(sql`case ${supportTickets.priority} when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end`, asc(supportTickets.createdAt))
    .limit(200);
}
