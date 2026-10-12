import { and, eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, type Actor } from '@/server/core/actor';
import { decrypt, encrypt } from '@/server/core/crypto';
import { conflict, notFound } from '@/server/core/errors';
import { logger, safeErrorMessage } from '@/server/core/logger';
import { runtimeEnvironment } from '@/server/core/runtime-env';
import { db } from '@/server/db/client';
import { outboundMessages } from '@/server/db/schema';
import { providerFor } from './providers';

/**
 * RELIABLE OUTBOX (Batch 2) for email / SMS.
 *   claim        PENDING rows due now are claimed with FOR UPDATE SKIP LOCKED → SENDING (two flushers never send
 *                the same row); a SENDING row older than 10 minutes (crashed flusher) is returned to PENDING.
 *                Delivery is at-least-once; the outbox id is passed to the provider as an idempotency reference.
 *   retry        exponential backoff (1, 2, 4, 8 … min, max 60) up to max_attempts, then FAILED + dead_lettered_at.
 *   states       SENT = accepted by the provider (provider_message_id kept). DELIVERED / BOUNCED are recorded only
 *                from a provider delivery event (recordDeliveryEvent) — never assumed.
 *   secrets      codes, reset links and invitation links (SECRET_EVENTS): in PRODUCTION (or OUTBOX_ENCRYPT_SECRETS=true)
 *                the body is sealed with AES-256-GCM at insert (`body` holds a placeholder), decrypted only by the
 *                sender, and the ciphertext is destroyed after hand-off or dead-lettering. Everywhere, any stored copy
 *                is redacted after hand-off to a real provider and after one hour at the latest.
 */
export const SECRET_EVENTS = ['ACCOUNT_SECURITY', 'EXTERNAL_DEAL_INVITED', 'DEAL_DELIVERY_OTP'];
export const REDACTED_BODY = '[تم حذف المحتوى الأمني (رمز/رابط) بعد الإرسال أو انتهاء الصلاحية]';
export const SEALED_BODY = '[محتوى أمني مشفّر — لا يُعرض]';

export function outboxEncryptionEnabled(raw: Record<string, string | undefined> = process.env): boolean {
  if (raw.OUTBOX_ENCRYPT_SECRETS === 'true') return true;
  if (raw.OUTBOX_ENCRYPT_SECRETS === 'false' && runtimeEnvironment(raw) !== 'PRODUCTION') return false;
  return runtimeEnvironment(raw) === 'PRODUCTION';
}

/** Applied to every outbox insert: seals secret-bearing bodies when encryption is on. */
export function protectOutboxRow<T extends { body: string; event?: string | null }>(row: T): T & { bodyEnc?: string | null } {
  if (!SECRET_EVENTS.includes(row.event ?? '') || !outboxEncryptionEnabled()) return row;
  return { ...row, body: SEALED_BODY, bodyEnc: encrypt(row.body) };
}

export function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Codes and links expire within 30 minutes (deal invitations are shared from the app itself), so any stored copy
 * older than an hour is useless to the owner and only a risk: redact it (plain and sealed copies alike).
 */
export async function redactExpiredSecrets() {
  const r = await db.execute(sql`update outbound_messages set body = ${REDACTED_BODY}, body_enc = null
    where event in ('ACCOUNT_SECURITY', 'EXTERNAL_DEAL_INVITED', 'DEAL_DELIVERY_OTP') and (body <> ${REDACTED_BODY} or body_enc is not null) and created_at < now() - interval '1 hour'`);
  return r.rowCount ?? 0;
}

type Row = typeof outboundMessages.$inferSelect;

async function claim(limit: number): Promise<Row[]> {
  await db.execute(sql`update outbound_messages set status = 'PENDING', locked_at = null where status = 'SENDING' and locked_at < now() - interval '10 minutes'`);
  const r = await db.execute(sql`update outbound_messages set status = 'SENDING', locked_at = now()
    where id in (select id from outbound_messages where status = 'PENDING' and coalesce(next_attempt_at, created_at) <= now()
                 order by created_at limit ${limit} for update skip locked)
    returning id`);
  const ids = (r.rows as { id: string }[]).map((x) => x.id);
  if (!ids.length) return [];
  return db.select().from(outboundMessages).where(sql`${outboundMessages.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
}

/** Sends due email/SMS through the configured adapters. Returns { sent, failed, deadLettered }. */
export async function flushOutbound(limit = 50) {
  const rows = await claim(limit);
  let sent = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const m of rows) {
    const secret = SECRET_EVENTS.includes(m.event ?? '');
    try {
      const body = m.bodyEnc ? decrypt(m.bodyEnc) : m.body;
      if (body === REDACTED_BODY) throw new Error('secret content expired before delivery');
      const p = await providerFor(m.channel);
      const res = await p.send({ recipient: m.recipient, subject: m.subject, body, secret, reference: m.id });
      // Once a real provider has accepted it, a message carrying a code or secret link is redacted at rest.
      // Delivery OTPs are never kept after hand-off to any driver (the buyer's staging display uses its own encrypted copy).
      const redact = secret && (!p.name.startsWith('log') || m.event === 'DEAL_DELIVERY_OTP');
      await db
        .update(outboundMessages)
        .set({ status: 'SENT', sentAt: new Date(), provider: p.name, attempts: m.attempts + 1, lockedAt: null, providerMessageId: res?.providerMessageId ?? null, bodyEnc: null, ...(redact ? { body: REDACTED_BODY } : {}) })
        .where(eq(outboundMessages.id, m.id));
      sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      const dead = attempts >= m.maxAttempts || (e instanceof Error && e.message === 'secret content expired before delivery');
      await db
        .update(outboundMessages)
        .set({
          attempts,
          lastError: safeErrorMessage(e),
          lockedAt: null,
          status: dead ? 'FAILED' : 'PENDING',
          nextAttemptAt: dead ? null : new Date(Date.now() + backoffMs(attempts)),
          ...(dead ? { deadLetteredAt: new Date() } : {}),
          // A secret (code / reset link) that will never be delivered is destroyed immediately.
          ...(dead && secret ? { body: REDACTED_BODY, bodyEnc: null } : {}),
        })
        .where(eq(outboundMessages.id, m.id));
      if (dead) deadLettered++;
      failed++;
      logger.warn('outbound.send_failed', { id: m.id, channel: m.channel, attempts, deadLettered: dead, error: safeErrorMessage(e) });
    }
  }
  // Expiry redaction also runs with every flush (the scheduled job alone depends on traffic on Vercel Hobby).
  await redactExpiredSecrets();
  return { sent, failed, deadLettered, processed: rows.length };
}

/**
 * Provider delivery event (webhook / polling adapter). Only a provider can say DELIVERED or BOUNCED; the status
 * never moves backwards and an unknown provider id is ignored.
 */
export async function recordDeliveryEvent(providerMessageId: string, event: 'DELIVERED' | 'BOUNCED'): Promise<boolean> {
  const r = await db
    .update(outboundMessages)
    .set(event === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: new Date() } : { status: 'BOUNCED', bouncedAt: new Date() })
    .where(and(eq(outboundMessages.providerMessageId, providerMessageId), eq(outboundMessages.status, 'SENT')))
    .returning({ id: outboundMessages.id });
  return r.length > 0;
}

/** Operator retry of a dead letter (non-secret messages only: a secret's content was destroyed). Audited. */
export async function requeueDeadLetter(actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'notifications.manage');
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(outboundMessages).where(eq(outboundMessages.id, id)).for('update');
    if (!m) throw notFound();
    if (m.status !== 'FAILED') throw conflict('الرسالة مش في قائمة الفشل النهائي');
    if (SECRET_EVENTS.includes(m.event ?? '')) throw conflict('رسالة أمنية: محتواها اتمسح. المستخدم يطلب رمز/رابط جديد.');
    await tx.update(outboundMessages).set({ status: 'PENDING', attempts: 0, nextAttemptAt: null, deadLetteredAt: null, lastError: null }).where(eq(outboundMessages.id, id));
    await audit(tx, actor, { action: 'outbox.dead_letter_requeued', entityType: 'outbound_message', entityId: id, reason });
  });
}

export async function outboxStats() {
  const r = await db.execute<{ pending: string; sending: string; failed: string; due: string; oldest_pending_min: string | null; sent_24h: string; delivered_24h: string; bounced_24h: string }>(sql`select
    count(*) filter (where status = 'PENDING')::text pending,
    count(*) filter (where status = 'SENDING')::text sending,
    count(*) filter (where status = 'FAILED')::text failed,
    count(*) filter (where status = 'PENDING' and coalesce(next_attempt_at, created_at) <= now())::text due,
    (extract(epoch from now() - min(created_at) filter (where status = 'PENDING')) / 60)::int::text oldest_pending_min,
    count(*) filter (where status in ('SENT','DELIVERED','BOUNCED') and sent_at > now() - interval '24 hours')::text sent_24h,
    count(*) filter (where status = 'DELIVERED' and delivered_at > now() - interval '24 hours')::text delivered_24h,
    count(*) filter (where status = 'BOUNCED' and bounced_at > now() - interval '24 hours')::text bounced_24h
    from outbound_messages`);
  const x = r.rows[0];
  return {
    pending: Number(x.pending),
    sending: Number(x.sending),
    deadLetters: Number(x.failed),
    due: Number(x.due),
    oldestPendingMinutes: x.oldest_pending_min === null ? null : Number(x.oldest_pending_min),
    sent24h: Number(x.sent_24h),
    delivered24h: Number(x.delivered_24h),
    bounced24h: Number(x.bounced_24h),
  };
}

