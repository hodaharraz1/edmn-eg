import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { TICKET_TYPES, ticketMachine, type TicketStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { supportMessages, supportSlaCycles, supportTickets, users } from '@/server/db/schema';
import { getSetting } from '@/server/modules/settings';
import { notify } from '@/server/modules/notifications/notify';
import { storeUpload } from '@/server/storage/uploads';
import { parse, transition } from '../_shared';

export const ticketSchema = z.object({
  type: z.enum(TICKET_TYPES),
  subject: z.string().trim().min(5, 'اكتب موضوع واضح').max(150),
  body: z.string().trim().min(10, 'اشرح طلبك (10 حروف على الأقل)').max(5000),
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
    await startSlaCycle(tx, t, 1, 'OPENED', userId, null);
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
  const { t: loaded, staff } = await loadTicket(actor, ticketId);
  if (opts.internal && !staff) throw forbidden();
  // Owner rule: a RESOLVED or CLOSED ticket is REOPENED by the customer's reply (new SLA cycle, history kept).
  if (!staff && (loaded.status === 'RESOLVED' || loaded.status === 'CLOSED')) await reopenTicket(actor, loaded.id, `رد من العميل بعد ${loaded.status === 'CLOSED' ? 'الإغلاق' : 'الحل'}: ${text.slice(0, 200)}`);
  const t = (await db.select().from(supportTickets).where(eq(supportTickets.id, loaded.id)))[0];
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
    if (staff && !opts.internal && !t.firstRespondedAt) {
      // First staff response of the current SLA cycle (internal notes never count).
      const now = new Date();
      await tx.update(supportTickets).set({ firstRespondedAt: now }).where(eq(supportTickets.id, t.id));
      await tx
        .update(supportSlaCycles)
        .set({ firstRespondedAt: now, firstResponseBreached: t.firstResponseDueAt ? now > t.firstResponseDueAt : null })
        .where(and(eq(supportSlaCycles.ticketId, t.id), eq(supportSlaCycles.cycle, t.slaCycle)));
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
      if (input.status === 'OPEN') throw invalidState('إعادة الفتح تتم من «إعادة فتح التذكرة» مع ذكر السبب');
      await transition(tx, actor, ticketMachine, t.id, t.status, input.status);
      sets.status = input.status;
      const now = new Date();
      if (input.status === 'RESOLVED' || input.status === 'CLOSED') {
        if (!t.resolvedAt || t.status !== 'RESOLVED') sets.resolvedAt = now;
        if (input.status === 'CLOSED') sets.closedAt = now;
        await tx
          .update(supportSlaCycles)
          .set({
            ...(input.status === 'RESOLVED' || t.status !== 'RESOLVED' ? { resolvedAt: now, resolutionBreached: t.resolutionDueAt ? now > t.resolutionDueAt : null } : {}),
            ...(input.status === 'CLOSED' ? { closedAt: now } : {}),
          })
          .where(and(eq(supportSlaCycles.ticketId, t.id), eq(supportSlaCycles.cycle, t.slaCycle)));
      }
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

/* ───────────────────────── Batch 1.5: SLA cycles, reopen, escalation, rating, QA ───────────────────────── */

/** Configured SLA targets for a priority (hours). Nothing is invented: unset → no due dates. */
async function slaTargets(conn: DbOrTx, priority: string) {
  const sla = await getSetting('support.sla', conn);
  return sla[priority] ?? {};
}

async function startSlaCycle(tx: DbOrTx, t: typeof supportTickets.$inferSelect, cycle: number, trigger: string, by: string | null, reason: string | null) {
  const target = await slaTargets(tx, t.priority);
  const now = Date.now();
  const firstResponseDueAt = target.firstResponseHours ? new Date(now + target.firstResponseHours * 3600_000) : null;
  const resolutionDueAt = target.resolutionHours ? new Date(now + target.resolutionHours * 3600_000) : null;
  await tx.insert(supportSlaCycles).values({ ticketId: t.id, cycle, startedBy: by, trigger, reopenReason: reason, firstResponseDueAt, resolutionDueAt });
  await tx.update(supportTickets).set({ slaCycle: cycle, firstResponseDueAt, resolutionDueAt, firstRespondedAt: null }).where(eq(supportTickets.id, t.id));
}

/**
 * Reopen a RESOLVED or CLOSED ticket (owner rule: both can reopen — no new ticket needed). The requester or
 * support staff; mandatory reason. Keeps every message, the previous SLA cycles and the old resolution /
 * closure timestamps; increments reopen_count and starts a NEW SLA cycle.
 */
export async function reopenTicket(actor: Actor, ticketId: string, reason: string) {
  const uid = requireUser(actor);
  const why = reason?.trim();
  if (!why || why.length < 5) throw validation('اكتب سبب إعادة فتح التذكرة');
  const { t, staff } = await loadTicket(actor, ticketId);
  if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') throw invalidState('التذكرة مفتوحة بالفعل');
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(supportTickets).where(eq(supportTickets.id, t.id)).for('update');
    if (cur.status !== 'RESOLVED' && cur.status !== 'CLOSED') return;
    await transition(tx, actor, ticketMachine, cur.id, cur.status, 'OPEN', why);
    await tx
      .update(supportTickets)
      .set({ status: 'OPEN', reopenCount: cur.reopenCount + 1, reopenedAt: new Date(), reopenedBy: uid, lastReopenReason: why.slice(0, 1000), rating: null, ratingComment: null, ratedAt: null })
      .where(eq(supportTickets.id, cur.id));
    await startSlaCycle(tx, cur, cur.slaCycle + 1, cur.status === 'CLOSED' ? 'REOPENED_FROM_CLOSED' : 'REOPENED_FROM_RESOLVED', uid, why.slice(0, 1000));
    await audit(tx, actor, { action: 'support.ticket_reopened', entityType: 'support_ticket', entityId: cur.id, oldValues: { status: cur.status, cycle: cur.slaCycle, resolvedAt: cur.resolvedAt, closedAt: cur.closedAt }, newValues: { status: 'OPEN', cycle: cur.slaCycle + 1, reopenCount: cur.reopenCount + 1 }, reason: why });
    const others = [cur.requesterUserId, cur.assigneeId].filter((u): u is string => !!u && u !== uid);
    await notify(tx, { event: 'SUPPORT_TICKET_REOPENED', userIds: others, vars: { ticket: cur.number }, link: staff ? `/account/support/${cur.id}` : `/admin/support/${cur.id}`, dedupeKey: `ticket:${cur.id}:reopen:${cur.reopenCount + 1}` });
  });
}

export const ESCALATION_TARGETS = ['DISPUTE', 'REFUND', 'IDENTITY', 'RECEIVING_DESTINATION', 'WITHDRAWAL', 'FINANCIAL_REVIEW', 'ORDER', 'DEAL', 'PAYMENT'] as const;
const LINK_TABLE: Record<(typeof ESCALATION_TARGETS)[number], string | null> = {
  DISPUTE: 'disputes',
  REFUND: 'refunds',
  IDENTITY: 'user_identity_verifications',
  RECEIVING_DESTINATION: 'receiving_destinations',
  WITHDRAWAL: 'withdrawal_requests',
  FINANCIAL_REVIEW: null,
  ORDER: 'orders',
  DEAL: 'external_deals',
  PAYMENT: 'payments',
};

/**
 * Escalate to a specialist team, optionally linking the specialist domain object (which keeps owning its
 * decision — the ticket only coordinates communication). The assignee stays the customer-facing owner.
 */
export async function escalateTicket(actor: Actor, ticketId: string, input: { team: string; specialistUserId?: string | null; linkedType?: (typeof ESCALATION_TARGETS)[number] | null; linkedId?: string | null; note: string }) {
  requirePermission(actor, 'support.escalate');
  const note = input.note?.trim();
  if (!note || note.length < 5) throw validation('اكتب سبب التصعيد');
  if (!input.team?.trim()) throw validation('حدد الفريق المختص');
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for('update');
    if (!t) throw notFound('التذكرة');
    if (t.status === 'RESOLVED' || t.status === 'CLOSED') throw invalidState('أعد فتح التذكرة أولاً');
    if (input.linkedType) {
      const table = LINK_TABLE[input.linkedType];
      if (table) {
        if (!input.linkedId || !/^[0-9a-f-]{36}$/.test(input.linkedId)) throw validation('معرّف العنصر المرتبط غير صحيح');
        const found = await tx.execute(sql`select 1 from ${sql.identifier(table)} where id = ${input.linkedId} limit 1`);
        if (!found.rows.length) throw notFound('العنصر المرتبط');
      }
    }
    if (t.status !== 'ESCALATED') await transition(tx, actor, ticketMachine, t.id, t.status, 'ESCALATED', note);
    await tx
      .update(supportTickets)
      .set({ status: 'ESCALATED', escalatedAt: new Date(), specialistTeam: input.team.trim().slice(0, 60), specialistUserId: input.specialistUserId ?? null, assigneeId: t.assigneeId ?? actor.userId, linkedType: input.linkedType ?? t.linkedType, linkedId: input.linkedId ?? t.linkedId })
      .where(eq(supportTickets.id, t.id));
    await tx.insert(supportMessages).values({ ticketId: t.id, authorUserId: actor.userId!, body: `تصعيد إلى ${input.team}: ${note}`.slice(0, 5000), isStaff: true, isInternal: true });
    await audit(tx, actor, { action: 'support.ticket_escalated', entityType: 'support_ticket', entityId: t.id, newValues: { team: input.team, specialistUserId: input.specialistUserId ?? null, linkedType: input.linkedType ?? null, linkedId: input.linkedId ?? null, owner: t.assigneeId ?? actor.userId }, reason: note });
  });
}

/** Customer service rating after resolution/closure (1–5). */
export async function rateTicket(actor: Actor, ticketId: string, rating: number, comment?: string) {
  const uid = requireUser(actor);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw validation('التقييم من 1 إلى 5');
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for('update');
    if (!t || t.requesterUserId !== uid) throw notFound('التذكرة');
    if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') throw invalidState('التقييم متاح بعد حل التذكرة');
    // One rating per resolution: a new rating is accepted only after the ticket was reopened since the last one.
    if (t.ratedAt && !(t.reopenedAt && t.reopenedAt > t.ratedAt)) throw invalidState('قيّمت التذكرة دي بالفعل');
    await tx.update(supportTickets).set({ rating, ratingComment: comment?.trim().slice(0, 1000) || null, ratedAt: new Date() }).where(eq(supportTickets.id, t.id));
    await audit(tx, actor, { action: 'support.ticket_rated', entityType: 'support_ticket', entityId: t.id, newValues: { rating, cycle: t.slaCycle } });
  });
}

/** Internal quality review (support.qa). Never visible to the customer. */
export async function qaReviewTicket(actor: Actor, ticketId: string, score: number, note: string) {
  requirePermission(actor, 'support.qa');
  requireStepUp(actor);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw validation('درجة الجودة من 1 إلى 5');
  if (!note || note.trim().length < 5) throw validation('اكتب ملاحظة الجودة');
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for('update');
    if (!t) throw notFound('التذكرة');
    if (t.assigneeId === actor.userId) throw forbidden('لا يمكنك مراجعة جودة تذكرة أنت مسؤول عنها');
    await tx.update(supportTickets).set({ qaScore: score, qaNote: note.trim().slice(0, 2000), qaBy: actor.userId, qaAt: new Date() }).where(eq(supportTickets.id, t.id));
    await audit(tx, actor, { action: 'support.ticket_qa', entityType: 'support_ticket', entityId: t.id, newValues: { score } });
  });
}

export async function ticketSlaCycles(ticketId: string) {
  return db.select().from(supportSlaCycles).where(eq(supportSlaCycles.ticketId, ticketId)).orderBy(asc(supportSlaCycles.cycle));
}
