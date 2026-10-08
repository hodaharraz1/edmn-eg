import { and, eq, inArray, sql } from 'drizzle-orm';
import { env } from '@/server/core/env';
import { logger } from '@/server/core/logger';
import { db, type DbOrTx } from '@/server/db/client';
import { notificationDeliveries, notificationPreferences, notifications, users, type MessageEvent, type NotifyChannel } from '@/server/db/schema';
import { getSetting } from '@/server/modules/settings';
import { EVENT_TEMPLATES, render } from './events';
import { providerFor } from './providers';
import { activeSubscriptionCount, pushConfigured, pushReady, sendPushToUser } from './push';

/**
 * Message notification routing. Called inside the message transaction AFTER the message row exists, so a
 * provider problem can never lose or block a message; providers are only contacted after commit.
 *
 *  - Active recipient (visible EDMN tab seen recently): live badge + in-app toast (+ optional sound) — no push.
 *  - Background/away: Web Push where the user opted in on a device.
 *  - Still unread after the configured delay: ONE email per conversation per cooldown window.
 *
 * Each (event, message, recipient, channel) decision is written once to notification_deliveries
 * (idempotent dedupe key). Nothing here reads or writes payments, ledger, shipments, receipts, OTPs,
 * deal terms or disputes; a delivered/opened notification is never evidence of anything.
 */

export interface MessagePrefs {
  messagesInApp: boolean;
  messagesSound: boolean;
  messagesPush: boolean;
  messagesEmail: boolean;
  pushPreview: boolean;
}
export const DEFAULT_PREFS: MessagePrefs = { messagesInApp: true, messagesSound: true, messagesPush: true, messagesEmail: true, pushPreview: false };

export async function prefsFor(conn: DbOrTx, userId: string): Promise<MessagePrefs> {
  const [p] = await conn.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  return p ? { messagesInApp: p.messagesInApp, messagesSound: p.messagesSound, messagesPush: p.messagesPush, messagesEmail: p.messagesEmail, pushPreview: p.pushPreview } : { ...DEFAULT_PREFS };
}

export async function savePrefs(userId: string, input: Partial<MessagePrefs>) {
  const cur = await prefsFor(db, userId);
  const next = { ...cur, ...Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'boolean')) } as MessagePrefs;
  await db
    .insert(notificationPreferences)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...next, updatedAt: new Date() } });
  return next;
}

export const deliveryKey = (event: string, messageId: string, userId: string, channel: NotifyChannel) => `${event}:${messageId}:${userId}:${channel}`;

export interface FanOutInput {
  conversationId: string;
  messageId: string;
  /** recipients on the other side (store communicators / buyer / deal party) */
  recipients: string[];
  senderSide: 'BUYER' | 'SELLER';
  hasAttachments: boolean;
  ref: string;
  party: string;
  /** link per recipient surface */
  linkFor: (userId: string) => string;
}

/** Returns the ids of push deliveries to dispatch right after commit (emails wait for their delay). */
export async function fanOutMessage(tx: DbOrTx, input: FanOutInput): Promise<string[]> {
  const event: MessageEvent = input.hasAttachments ? 'MESSAGE_ATTACHMENT_RECEIVED' : 'MESSAGE_RECEIVED';
  const tpl = EVENT_TEMPLATES[event];
  const vars = { ref: input.ref, party: input.party };
  const [pushCooldown, emailCooldown, emailDelay, activeSecs] = await Promise.all([
    getSetting('messaging.pushCooldownSeconds', tx),
    getSetting('messaging.emailCooldownMinutes', tx),
    getSetting('messaging.emailFallbackDelayMinutes', tx),
    getSetting('messaging.presenceActiveSeconds', tx),
  ]);
  const pushNow: string[] = [];
  for (const userId of [...new Set(input.recipients)]) {
    const prefs = await prefsFor(tx, userId);
    const burstStart = await isBurstStart(tx, input.conversationId, input.messageId, input.senderSide, userId);
    const rows: (typeof notificationDeliveries.$inferInsert)[] = [];
    const base = { event, recipientUserId: userId, conversationId: input.conversationId, messageId: input.messageId };

    // IN_APP: one notification-center entry per unread burst (the Messages badge counts every message).
    if (burstStart) {
      const [n] = await tx
        .insert(notifications)
        .values({
          userId,
          event,
          title: render(tpl.title, vars),
          body: render(tpl.body, vars),
          link: input.linkFor(userId),
          dedupeKey: `${event}:${input.messageId}`,
          category: 'MESSAGE',
          conversationId: input.conversationId,
          messageId: input.messageId,
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      rows.push({ ...base, channel: 'IN_APP', status: 'SENT', provider: 'in-app', notificationId: n?.id ?? null, sentAt: new Date(), dedupeKey: deliveryKey(event, input.messageId, userId, 'IN_APP') });
    } else {
      rows.push({ ...base, channel: 'IN_APP', status: 'SUPPRESSED', reason: 'BURST', dedupeKey: deliveryKey(event, input.messageId, userId, 'IN_APP') });
    }

    // PUSH
    let push: { status: 'QUEUED' | 'SUPPRESSED'; reason?: string };
    if (!prefs.messagesPush) push = { status: 'SUPPRESSED', reason: 'PREFERENCE_OFF' };
    else if (!(await activeSubscriptionCount(tx, userId))) push = { status: 'SUPPRESSED', reason: 'NO_SUBSCRIPTION' };
    else if (!pushReady()) push = { status: 'SUPPRESSED', reason: 'NOT_CONFIGURED' };
    else if (await isActive(tx, userId, activeSecs)) push = { status: 'SUPPRESSED', reason: 'ACTIVE_IN_APP' };
    else if (await recentDelivery(tx, userId, input.conversationId, 'PUSH', `${pushCooldown} seconds`)) push = { status: 'SUPPRESSED', reason: 'COOLDOWN' };
    else push = { status: 'QUEUED' };
    rows.push({ ...base, channel: 'PUSH', status: push.status, reason: push.reason ?? null, runAfter: push.status === 'QUEUED' ? new Date() : null, dedupeKey: deliveryKey(event, input.messageId, userId, 'PUSH') });

    // EMAIL fallback (delayed; re-checked against the read state before sending)
    let email: { status: 'QUEUED' | 'SUPPRESSED'; reason?: string };
    if (!burstStart) email = { status: 'SUPPRESSED', reason: 'BURST' };
    else if (!prefs.messagesEmail) email = { status: 'SUPPRESSED', reason: 'PREFERENCE_OFF' };
    else if (!(await emailOf(tx, userId))) email = { status: 'SUPPRESSED', reason: 'NO_ADDRESS' };
    else if (await recentDelivery(tx, userId, input.conversationId, 'EMAIL', `${emailCooldown} minutes`)) email = { status: 'SUPPRESSED', reason: 'COOLDOWN' };
    else email = { status: 'QUEUED' };
    rows.push({
      ...base,
      channel: 'EMAIL',
      status: email.status,
      reason: email.reason ?? null,
      runAfter: email.status === 'QUEUED' ? sql`now() + make_interval(mins => ${emailDelay})` as unknown as Date : null,
      dedupeKey: deliveryKey(event, input.messageId, userId, 'EMAIL'),
    });

    const inserted = await tx.insert(notificationDeliveries).values(rows).onConflictDoNothing().returning({ id: notificationDeliveries.id, channel: notificationDeliveries.channel, status: notificationDeliveries.status });
    for (const r of inserted) if (r.channel === 'PUSH' && r.status === 'QUEUED') pushNow.push(r.id);
  }
  return pushNow;
}

/** First message of the sender's side that this recipient has not read yet (one alert per burst). */
async function isBurstStart(conn: DbOrTx, conversationId: string, messageId: string, senderSide: string, userId: string) {
  const res = await conn.execute(sql`
    select 1 from conversation_messages m
    left join conversation_reads r on r.conversation_id = m.conversation_id and r.user_id = ${userId}
    where m.conversation_id = ${conversationId} and m.sender_role = ${senderSide} and m.id <> ${messageId} and m.hidden_at is null
      and (m.created_at, m.id) <= (select created_at, id from conversation_messages where id = ${messageId})
      and (r.last_read_at is null or m.created_at > r.last_read_at)
    limit 1`);
  return res.rows.length === 0;
}

async function isActive(conn: DbOrTx, userId: string, seconds: number) {
  const r = await conn.execute(sql`select 1 from user_presence where user_id = ${userId} and last_visible_at > now() - make_interval(secs => ${seconds})`);
  return r.rows.length > 0;
}

async function recentDelivery(conn: DbOrTx, userId: string, conversationId: string, channel: NotifyChannel, window: string) {
  const r = await conn.execute(sql`
    select 1 from notification_deliveries
    where recipient_user_id = ${userId} and conversation_id = ${conversationId} and channel = ${channel}
      and status in ('QUEUED','SENT','OPENED') and created_at > now() - ${window}::interval
    limit 1`);
  return r.rows.length > 0;
}

async function emailOf(conn: DbOrTx, userId: string) {
  const [u] = await conn.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return u?.email ?? null;
}

/** Has the recipient read this message (server-authoritative read position)? */
async function messageRead(conn: DbOrTx, messageId: string, userId: string) {
  const r = await conn.execute(sql`
    select 1 from conversation_messages m join conversation_reads r on r.conversation_id = m.conversation_id and r.user_id = ${userId}
    where m.id = ${messageId} and r.last_read_at >= m.created_at`);
  return r.rows.length > 0;
}

type ClaimedDelivery = {
  id: string;
  event: string;
  channel: NotifyChannel;
  recipient_user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  attempts: number;
};

/**
 * Claim and send due deliveries (FOR UPDATE SKIP LOCKED + a short lease, safe with several workers and the
 * after-response trigger). `ids` restricts the run to specific rows (immediate push after a send).
 */
export async function dispatchDeliveries(opts: { ids?: string[]; limit?: number } = {}): Promise<{ sent: number; suppressed: number; failed: number }> {
  const claimed = await db.transaction(async (tx) => {
    const filter = opts.ids?.length ? sql`and id in (${sql.join(opts.ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
    const r = await tx.execute<ClaimedDelivery>(sql`
      update notification_deliveries set attempts = attempts + 1, run_after = now() + interval '2 minutes', updated_at = now()
      where id in (select id from notification_deliveries where status = 'QUEUED' and run_after <= now() ${filter}
                   order by run_after limit ${opts.limit ?? 50} for update skip locked)
      returning id, event, channel, recipient_user_id, conversation_id, message_id, attempts`);
    return r.rows;
  });
  const out = { sent: 0, suppressed: 0, failed: 0 };
  for (const d of claimed) {
    try {
      const res = await dispatchOne(d);
      out[res]++;
    } catch (e) {
      logger.error('notify.dispatch_failed', { delivery: d.id, channel: d.channel, error: (e as Error).message });
      await fail(d, 'ERROR');
      out.failed++;
    }
  }
  return out;
}

async function settle(id: string, set: Partial<typeof notificationDeliveries.$inferInsert>) {
  await db.update(notificationDeliveries).set({ ...set, updatedAt: new Date() }).where(and(eq(notificationDeliveries.id, id), eq(notificationDeliveries.status, 'QUEUED')));
}

async function fail(d: ClaimedDelivery, reason: string, maxAttempts = d.channel === 'EMAIL' ? 5 : 3) {
  if (d.attempts >= maxAttempts) await settle(d.id, { status: 'FAILED', reason, failedAt: new Date() });
  else await db.execute(sql`update notification_deliveries set reason = ${reason}, run_after = now() + make_interval(secs => ${Math.min(3600, 30 * 2 ** d.attempts)}), updated_at = now() where id = ${d.id} and status = 'QUEUED'`);
}

async function messageContext(d: ClaimedDelivery) {
  const r = await db.execute<{ link: string | null; title: string; body: string; msg_body: string; hidden: boolean; atts: number }>(sql`
    select n.link, n.title, n.body, m.body as msg_body, (m.hidden_at is not null) as hidden,
           (select count(*)::int from conversation_message_attachments a where a.message_id = m.id) as atts
      from conversation_messages m
      left join lateral (select link, title, body from notifications where user_id = ${d.recipient_user_id} and conversation_id = m.conversation_id
                         and category = 'MESSAGE' order by created_at desc limit 1) n on true
     where m.id = ${d.message_id}`);
  return r.rows[0];
}

async function dispatchOne(d: ClaimedDelivery): Promise<'sent' | 'suppressed' | 'failed'> {
  if (!d.message_id || !d.conversation_id) {
    await settle(d.id, { status: 'SUPPRESSED', reason: 'NO_CONTEXT' });
    return 'suppressed';
  }
  if (await messageRead(db, d.message_id, d.recipient_user_id)) {
    await settle(d.id, { status: 'SUPPRESSED', reason: 'READ' });
    return 'suppressed';
  }
  const prefs = await prefsFor(db, d.recipient_user_id);
  const ctx = await messageContext(d);
  if (!ctx || ctx.hidden) {
    await settle(d.id, { status: 'SUPPRESSED', reason: 'HIDDEN' });
    return 'suppressed';
  }
  const link = ctx.link ?? '/account/messages';

  if (d.channel === 'PUSH') {
    if (!prefs.messagesPush) {
      await settle(d.id, { status: 'SUPPRESSED', reason: 'PREFERENCE_OFF' });
      return 'suppressed';
    }
    // Lock-screen privacy: generic text unless the user chose previews; attachments are never previewed.
    const preview = prefs.pushPreview && ctx.msg_body ? ctx.msg_body.replace(/\s+/g, ' ').slice(0, 80) : null;
    const res = await sendPushToUser(d.recipient_user_id, {
      title: 'اضمن',
      body: preview ? `${ctx.title}: ${preview}` : `لديك رسالة جديدة ${ctx.body}`,
      url: link,
      tag: `conv-${d.conversation_id}`,
      deliveryId: d.id,
    });
    if (res.accepted > 0) {
      await settle(d.id, { status: 'SENT', provider: 'webpush', sentAt: new Date(), reason: res.failed ? `PARTIAL:${res.lastError}` : null });
      return 'sent';
    }
    if (res.lastError === 'NOT_CONFIGURED') {
      await settle(d.id, { status: 'SUPPRESSED', reason: 'NOT_CONFIGURED' });
      return 'suppressed';
    }
    if (res.failed === 0) {
      await settle(d.id, { status: 'SUPPRESSED', reason: 'NO_SUBSCRIPTION' });
      return 'suppressed';
    }
    await fail(d, res.lastError ?? 'PUSH_FAILED');
    return 'failed';
  }

  if (d.channel === 'EMAIL') {
    if (!prefs.messagesEmail) {
      await settle(d.id, { status: 'SUPPRESSED', reason: 'PREFERENCE_OFF' });
      return 'suppressed';
    }
    const cooldown = await getSetting('messaging.emailCooldownMinutes');
    const other = await db.execute(sql`
      select 1 from notification_deliveries where recipient_user_id = ${d.recipient_user_id} and conversation_id = ${d.conversation_id}
        and channel = 'EMAIL' and id <> ${d.id} and status in ('SENT','OPENED') and sent_at > now() - make_interval(mins => ${cooldown}) limit 1`);
    if (other.rows.length) {
      await settle(d.id, { status: 'SUPPRESSED', reason: 'COOLDOWN' });
      return 'suppressed';
    }
    const to = await emailOf(db, d.recipient_user_id);
    if (!to) {
      await settle(d.id, { status: 'SUPPRESSED', reason: 'NO_ADDRESS' });
      return 'suppressed';
    }
    const e = env();
    const url = link.startsWith('/seller') ? `${e.SELLER_APP_URL.replace(/\/seller\/?$/, '')}${link}` : `${e.APP_URL.replace(/\/$/, '')}${link}`;
    try {
      const p = await providerFor('EMAIL');
      // Never the thread, the message text or attachment links — only the context and a link to sign in.
      await p.send({ recipient: to, subject: 'لديك رسالة جديدة على اضمن', body: `لديك رسالة جديدة ${ctx.body}.\n\nاعرض الرسالة على اضمن:\n${url}\n\nلإيقاف تنبيهات الرسائل بالبريد: إعدادات الإشعارات في حسابك.` });
      await settle(d.id, { status: 'SENT', provider: p.name, sentAt: new Date() });
      return 'sent';
    } catch (err) {
      await fail(d, `EMAIL:${(err as Error).message.slice(0, 120)}`);
      return 'failed';
    }
  }

  // Future channels (SMS / WhatsApp / mobile push): no provider is connected — never reported as sent.
  await settle(d.id, { status: 'SUPPRESSED', reason: 'NOT_CONFIGURED' });
  return 'suppressed';
}

/** The recipient opened a push/email/in-app alert. Telemetry only — never evidence of delivery or receipt. */
export async function markDeliveryOpened(userId: string, deliveryId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) return false;
  const r = await db
    .update(notificationDeliveries)
    .set({ status: 'OPENED', openedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.recipientUserId, userId), inArray(notificationDeliveries.status, ['SENT', 'OPENED'])))
    .returning({ id: notificationDeliveries.id });
  return r.length > 0;
}

/** Operational health for the Admin view (counts only; no message content, no endpoints). */
export async function deliveryHealth(hours = 24) {
  const byStatus = await db.execute<{ channel: string; status: string; n: number }>(sql`
    select channel, status, count(*)::int n from notification_deliveries where created_at > now() - make_interval(hours => ${hours}) group by 1, 2 order by 1, 2`);
  const reasons = await db.execute<{ channel: string; status: string; reason: string; n: number }>(sql`
    select channel, status, coalesce(reason, '-') reason, count(*)::int n from notification_deliveries
     where created_at > now() - make_interval(hours => ${hours}) and status in ('FAILED','SUPPRESSED') group by 1, 2, 3 order by n desc limit 30`);
  const failures = await db.execute<{ id: string; channel: string; event: string; reason: string | null; attempts: number; created_at: string; failed_at: string | null }>(sql`
    select id, channel, event, reason, attempts, created_at::text, failed_at::text from notification_deliveries where status = 'FAILED' order by created_at desc limit 25`);
  const queue = await db.execute<{ channel: string; n: number; oldest: string | null }>(sql`
    select channel, count(*)::int n, min(run_after)::text oldest from notification_deliveries where status = 'QUEUED' group by 1`);
  const subs = await db.execute<{ active: number; revoked: number; expired: number; failing: number }>(sql`
    select count(*) filter (where revoked_at is null)::int active, count(*) filter (where revoked_at is not null)::int revoked,
           count(*) filter (where revoked_reason = 'EXPIRED')::int expired, count(*) filter (where revoked_reason = 'FAILING')::int failing from push_subscriptions`);
  const e = env();
  return {
    byStatus: byStatus.rows,
    reasons: reasons.rows,
    failures: failures.rows,
    queue: queue.rows,
    subscriptions: subs.rows[0],
    providers: {
      PUSH: pushConfigured() ? 'VAPID مضبوط (Web Push)' : 'غير مضبوط — مفاتيح VAPID غير موجودة',
      EMAIL: e.MAIL_DRIVER === 'smtp' ? `SMTP (${e.SMTP_HOST ?? '?'})` : 'سجل فقط (log) — لا يوجد مزوّد بريد حقيقي',
      SMS: 'غير متصل (مستقبلي)',
      WHATSAPP: 'غير متصل (مستقبلي)',
      MOBILE_PUSH: 'غير متصل (مستقبلي — FCM/APNs)',
    },
  };
}
