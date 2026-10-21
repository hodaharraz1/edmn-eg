import { eq, sql } from 'drizzle-orm';
import { runAlertSweep } from '@/server/modules/alerts/engine';
import { logger, safeErrorMessage } from '@/server/core/logger';
import { db } from '@/server/db/client';
import { SYSTEM_ACTOR } from '@/server/core/actor';
import { jobs } from '@/server/db/schema';
import { pruneRateLimits } from '@/server/auth/rate-limit';
import { expireOrder, expireOverdueOrders } from '@/server/modules/commerce/orders';
import { flagMissingDeliveryEvents, flagMissingDeliveryEvidence, flagSellerSlaBreaches, processBuyerResponseTimeouts } from '@/server/modules/commerce/fulfilment';
import { expireDealInvitations, expireDeliveryOtps, flagDealsAwaitingConfirmation } from '@/server/modules/deals/service';
import { runScheduledSettlement } from '@/server/modules/finance/withdrawals';
import { flushOutbound, redactExpiredSecrets } from '@/server/modules/notifications/outbox';
import { runLedgerHealthCheck } from '@/server/modules/finance/ledger-health';
import { releaseLapsedReturnHolds } from '@/server/modules/finance/holds';
import { scanPendingFiles } from '@/server/storage/scanning';
import type { ScheduledJob } from './scheduler';
import { dispatchDeliveries } from '@/server/modules/notifications/message-alerts';

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

// The reliable outbox lives in notifications/outbox.ts (claim, backoff, dead letter, sealed secrets).
export { SECRET_EVENTS, REDACTED_BODY, redactExpiredSecrets, flushOutbound } from '@/server/modules/notifications/outbox';

export const HANDLERS: Record<string, Handler> = {
  'outbound.flush': () => flushOutbound(),
  'orders.expire': (p) => expireOrder(String(p.orderId)),
  'notify.dispatch': () => dispatchDeliveries(),
  'files.scan': () => scanPendingFiles(),
};

/** Periodic maintenance tasks run by the worker (cron-like). */
export const SCHEDULE: ScheduledJob[] = [
  { name: 'orders.expire_overdue', everyMs: 5 * 60_000, run: () => expireOverdueOrders() },
  // Entitlement only (never a release): buyer window expiry, missing evidence/events, SLA flags.
  { name: 'orders.buyer_response_timeouts', everyMs: 5 * 60_000, run: () => processBuyerResponseTimeouts() },
  { name: 'orders.missing_delivery_evidence', everyMs: 15 * 60_000, run: () => flagMissingDeliveryEvidence() },
  { name: 'orders.missing_delivery_events', everyMs: 60 * 60_000, run: () => flagMissingDeliveryEvents() },
  { name: 'orders.seller_sla', everyMs: 15 * 60_000, run: () => flagSellerSlaBreaches() },
  { name: 'deals.buyer_response_timeouts', everyMs: 5 * 60_000, run: () => flagDealsAwaitingConfirmation() },
  { name: 'deals.expire_invitations', everyMs: 60 * 60_000, run: () => expireDealInvitations() },
  { name: 'deals.expire_delivery_otps', everyMs: 15 * 60_000, run: () => expireDeliveryOtps() },
  { name: 'settlement.scheduled', everyMs: 60 * 60_000, run: () => runScheduledSettlement() },
  { name: 'outbound.flush', everyMs: 60_000, run: () => flushOutbound() },
  // Message push retries + delayed email fallback (re-checks read state, preferences and cooldown first).
  { name: 'notify.dispatch', everyMs: 60_000, run: () => dispatchDeliveries() },
  { name: 'rate_limits.prune', everyMs: 6 * 60 * 60_000, run: () => pruneRateLimits() },
  // Proactive alerts: notifications only — never moves money or changes a business record.
  { name: 'alerts.sweep', everyMs: 5 * 60_000, run: () => runAlertSweep() },
  { name: 'outbound.redact_secrets', everyMs: 10 * 60_000, run: () => redactExpiredSecrets() },
  // Batch 2: read-only ledger health (never fixes anything; a CRITICAL snapshot blocks new money movements).
  { name: 'ledger.health', everyMs: 30 * 60_000, leaseMs: 10 * 60_000, run: () => runLedgerHealthCheck('scheduler') },
  // B2: release holds of seller-rejected returns once escalation is no longer possible (moves no money).
  { name: 'holds.release_lapsed_returns', everyMs: 60 * 60_000, run: () => db.transaction((tx) => releaseLapsedReturnHolds(tx, SYSTEM_ACTOR)) },
  // Malware scanning of quarantined uploads (no-op while no scanner is configured — never fakes CLEAN).
  { name: 'files.scan', everyMs: 5 * 60_000, run: () => scanPendingFiles() },
  // Operational telemetry retention (job runs, resolved error groups) — see docs/runbooks retention policy.
  { name: 'ops.prune_telemetry', everyMs: 24 * 60 * 60_000, run: () => pruneTelemetry() },
];

/** Retention of operational telemetry only (never business, financial or audit records). */
export async function pruneTelemetry() {
  const runs = await db.execute(sql`delete from job_runs where started_at < now() - interval '14 days'`);
  const errs = await db.execute(sql`delete from error_events where last_seen_at < now() - interval '90 days'`);
  return { processed: (runs.rowCount ?? 0) + (errs.rowCount ?? 0) };
}

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
        lastError: safeErrorMessage(e),
        runAt: new Date(Date.now() + Math.min(3600_000, 2 ** claimed.attempts * 30_000)),
      })
      .where(eq(jobs.id, claimed.id));
    logger.error('job.failed', { id: claimed.id, type: claimed.type, attempts: claimed.attempts, final: failed, error: safeErrorMessage(e) });
  }
  return true;
}

/** Re-queue jobs stuck in RUNNING (worker crashed mid-job). */
export async function recoverStuckJobs() {
  await db.execute(sql`update jobs set status = 'PENDING' where status = 'RUNNING' and locked_at < now() - interval '15 minutes'`);
}
