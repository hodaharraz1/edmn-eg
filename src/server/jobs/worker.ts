import { and, eq, lte, sql } from 'drizzle-orm';
import { logger } from '@/server/core/logger';
import { db } from '@/server/db/client';
import { jobs, outboundMessages } from '@/server/db/schema';
import { pruneRateLimits } from '@/server/auth/rate-limit';
import { expireOrder, expireOverdueOrders } from '@/server/modules/commerce/orders';
import { completeDeliveredOrders, flagUnconfirmedDeliveries } from '@/server/modules/commerce/fulfilment';
import { expireDealInvitations, flagDealsAwaitingConfirmation } from '@/server/modules/deals/service';
import { runScheduledSettlement } from '@/server/modules/finance/withdrawals';
import { providerFor } from '@/server/modules/notifications/providers';

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

/** Events whose message body carries a one-time code, reset link or invitation link. */
export const SECRET_EVENTS = ['ACCOUNT_SECURITY', 'EXTERNAL_DEAL_INVITED'];
export const REDACTED_BODY = '[تم حذف المحتوى الأمني (رمز/رابط) بعد الإرسال أو انتهاء الصلاحية]';

/**
 * Codes and links expire within 30 minutes (deal invitations are shared from the app itself), so
 * any stored copy older than an hour is useless to the owner and only a risk: redact it.
 */
export async function redactExpiredSecrets() {
  const r = await db.execute(sql`update outbound_messages set body = ${REDACTED_BODY}
    where event in ('ACCOUNT_SECURITY', 'EXTERNAL_DEAL_INVITED') and body <> ${REDACTED_BODY} and created_at < now() - interval '1 hour'`);
  return r.rowCount ?? 0;
}

/** Sends pending email/SMS through the configured adapters with retry bookkeeping. */
export async function flushOutbound(limit = 50) {
  const pending = await db.select().from(outboundMessages).where(and(eq(outboundMessages.status, 'PENDING'), lte(outboundMessages.attempts, 4))).limit(limit);
  let sent = 0;
  for (const m of pending) {
    try {
      const p = await providerFor(m.channel);
      await p.send({ recipient: m.recipient, subject: m.subject, body: m.body });
      // Once a real provider has delivered it, a message carrying a code or secret link is redacted at rest.
      const redact = !p.name.startsWith('log') && SECRET_EVENTS.includes(m.event ?? '');
      await db
        .update(outboundMessages)
        .set({ status: 'SENT', sentAt: new Date(), provider: p.name, attempts: m.attempts + 1, ...(redact ? { body: REDACTED_BODY } : {}) })
        .where(eq(outboundMessages.id, m.id));
      sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      await db
        .update(outboundMessages)
        .set({ attempts, lastError: (e as Error).message.slice(0, 500), status: attempts >= 5 ? 'FAILED' : 'PENDING' })
        .where(eq(outboundMessages.id, m.id));
      logger.warn('outbound.send_failed', { id: m.id, channel: m.channel, attempts, error: (e as Error).message });
    }
  }
  return sent;
}

export const HANDLERS: Record<string, Handler> = {
  'outbound.flush': () => flushOutbound(),
  'orders.expire': (p) => expireOrder(String(p.orderId)),
};

/** Periodic maintenance tasks run by the worker (cron-like). */
export const SCHEDULE: { name: string; everyMs: number; run: () => Promise<unknown> }[] = [
  { name: 'orders.expire_overdue', everyMs: 5 * 60_000, run: () => expireOverdueOrders() },
  { name: 'orders.flag_unconfirmed', everyMs: 60 * 60_000, run: () => flagUnconfirmedDeliveries() },
  { name: 'orders.complete_delivered', everyMs: 60 * 60_000, run: () => completeDeliveredOrders() },
  { name: 'deals.flag_unconfirmed', everyMs: 60 * 60_000, run: () => flagDealsAwaitingConfirmation() },
  { name: 'deals.expire_invitations', everyMs: 60 * 60_000, run: () => expireDealInvitations() },
  { name: 'settlement.scheduled', everyMs: 60 * 60_000, run: () => runScheduledSettlement() },
  { name: 'outbound.flush', everyMs: 60_000, run: () => flushOutbound() },
  { name: 'rate_limits.prune', everyMs: 6 * 60 * 60_000, run: () => pruneRateLimits() },
  { name: 'outbound.redact_secrets', everyMs: 10 * 60_000, run: () => redactExpiredSecrets() },
];

/** Claims one due job with FOR UPDATE SKIP LOCKED (safe with multiple workers). */
export async function runOneJob(): Promise<boolean> {
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from jobs where status = 'PENDING' and run_at <= now() order by run_at limit 1 for update skip locked`);
    if (!rows.rows.length) return null;
    const [job] = await tx
      .update(jobs)
      .set({ status: 'RUNNING', lockedAt: new Date(), attempts: sql`${jobs.attempts} + 1`, dedupeKey: null })
      .where(eq(jobs.id, rows.rows[0].id))
      .returning();
    return job;
  });
  if (!claimed) return false;
  const handler = HANDLERS[claimed.type];
  try {
    if (!handler) throw new Error(`no handler for ${claimed.type}`);
    await handler(claimed.payload as Record<string, unknown>);
    await db.update(jobs).set({ status: 'DONE', finishedAt: new Date() }).where(eq(jobs.id, claimed.id));
  } catch (e) {
    const failed = claimed.attempts >= claimed.maxAttempts;
    await db
      .update(jobs)
      .set({
        status: failed ? 'FAILED' : 'PENDING',
        lastError: (e as Error).message.slice(0, 1000),
        runAt: new Date(Date.now() + Math.min(3600_000, 2 ** claimed.attempts * 30_000)),
      })
      .where(eq(jobs.id, claimed.id));
    logger.error('job.failed', { id: claimed.id, type: claimed.type, attempts: claimed.attempts, final: failed, error: (e as Error).message });
  }
  return true;
}

/** Re-queue jobs stuck in RUNNING (worker crashed mid-job). */
export async function recoverStuckJobs() {
  await db.execute(sql`update jobs set status = 'PENDING' where status = 'RUNNING' and locked_at < now() - interval '15 minutes'`);
}
