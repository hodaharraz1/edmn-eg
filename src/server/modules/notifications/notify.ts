import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { notificationTemplates, notifications, outboundMessages, users } from '@/server/db/schema';
import { enqueueJob } from '@/server/jobs/queue';
import { EVENT_TEMPLATES, render, type EventName } from './events';

export interface NotifyInput {
  event: EventName;
  userIds: (string | null | undefined)[];
  vars?: Record<string, string | number | null | undefined>;
  link?: string;
  /** Business-event identity: retries of the same event never notify the same user twice. */
  dedupeKey?: string;
}

/**
 * Domain-event → notifications. Runs inside the business transaction so notifications are only
 * created when the change commits. External delivery (email/SMS) is queued to the worker.
 */
export async function notify(tx: DbOrTx, input: NotifyInput): Promise<void> {
  const ids = [...new Set(input.userIds.filter((u): u is string => !!u))];
  if (!ids.length) return;
  const vars = input.vars ?? {};
  const def = EVENT_TEMPLATES[input.event];
  const overrides = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.event, input.event));
  const byChannel = new Map(overrides.map((o) => [o.channel, o]));
  const inApp = byChannel.get('IN_APP');
  if (inApp && !inApp.isEnabled) return;
  const title = render(inApp?.subject ?? def.title, vars);
  const body = render(inApp?.body ?? def.body, vars);

  const inserted = input.dedupeKey
    ? await tx
        .insert(notifications)
        .values(ids.map((userId) => ({ userId, event: input.event, title, body, link: input.link ?? null, dedupeKey: input.dedupeKey })))
        .onConflictDoNothing()
        .returning({ userId: notifications.userId })
    : await tx
        .insert(notifications)
        .values(ids.map((userId) => ({ userId, event: input.event, title, body, link: input.link ?? null })))
        .returning({ userId: notifications.userId });
  const fresh = [...new Set(inserted.map((r) => r.userId))];
  if (!fresh.length) return;

  const recipients = await tx
    .select({ id: users.id, email: users.email, phone: users.phone })
    .from(users)
    .where(inArray(users.id, fresh));
  const email = byChannel.get('EMAIL');
  const sms = byChannel.get('SMS');
  const rows: (typeof outboundMessages.$inferInsert)[] = [];
  for (const r of recipients) {
    if (r.email && (!email || email.isEnabled)) {
      rows.push({
        channel: 'EMAIL',
        recipient: r.email,
        subject: render(email?.subject ?? def.title, vars),
        body: render(email?.body ?? def.body, vars) + (input.link ? `\n\n${input.link}` : ''),
        event: input.event,
      });
    }
    if (r.phone && (sms ? sms.isEnabled : def.sms)) {
      rows.push({ channel: 'SMS', recipient: r.phone, body: render(sms?.body ?? def.body, vars).slice(0, 300), event: input.event });
    }
  }
  if (rows.length) {
    await tx.insert(outboundMessages).values(rows);
    await enqueueJob(tx, 'outbound.flush', {}, { dedupeKey: 'outbound.flush' });
  }
}

/** Direct message to a phone/email that may not belong to a user (e.g. external deal invitations). */
export async function sendDirect(
  tx: DbOrTx,
  event: EventName,
  to: { email?: string | null; phone?: string | null },
  vars: Record<string, string | number | null | undefined>,
): Promise<void> {
  const def = EVENT_TEMPLATES[event];
  const rows: (typeof outboundMessages.$inferInsert)[] = [];
  if (to.email) rows.push({ channel: 'EMAIL', recipient: to.email, subject: render(def.title, vars), body: render(def.body, vars), event });
  if (to.phone) rows.push({ channel: 'SMS', recipient: to.phone, body: render(def.body, vars).slice(0, 300), event });
  if (rows.length) {
    await tx.insert(outboundMessages).values(rows);
    await enqueueJob(tx, 'outbound.flush', {}, { dedupeKey: 'outbound.flush' });
  }
}

export async function markRead(tx: DbOrTx, userId: string, ids?: string[]) {
  const cond = ids?.length
    ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
    : eq(notifications.userId, userId);
  await tx.update(notifications).set({ readAt: new Date() }).where(cond);
}
