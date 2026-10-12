import { logger, safeErrorMessage } from '@/server/core/logger';
import { markAbandonedRuns, runScheduled } from './scheduler';
import { recoverStuckJobs, runOneJob, SCHEDULE } from './worker';

/**
 * One pass of the background work: due schedule entries, then queued jobs.
 * Used by the long-running worker (scripts/worker.ts) and, on serverless hosts without one,
 * by the cron route and the throttled after-response trigger (INLINE_WORKER=true).
 */
/**
 * Batch 2: each schedule entry runs under its database lease (one run per period across every worker and
 * serverless instance) with job_runs telemetry; the cadence is decided by the database, not process memory.
 */
export async function runTick(opts: { force?: boolean; budgetMs?: number; isStopping?: () => boolean } = {}): Promise<{ jobs: number; schedules: Record<string, number> }> {
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  const schedules: Record<string, number> = { SUCCEEDED: 0, FAILED: 0, SKIPPED: 0 };
  await markAbandonedRuns().catch((e) => logger.warn('schedule.abandon_scan_failed', { error: safeErrorMessage(e) }));
  for (const s of SCHEDULE) {
    if (opts.isStopping?.() || Date.now() >= deadline) break;
    schedules[await runScheduled(s, { force: opts.force })]++;
  }
  let n = 0;
  while (!opts.isStopping?.() && Date.now() < deadline && (await runOneJob())) n++;
  return { jobs: n, schedules };
}

let inlineBusy = false;
let inlineLast = 0;

/** Serverless fallback: at most one pass per instance per minute, after a response is sent. */
export async function maybeRunInlineTick(): Promise<void> {
  if (inlineBusy || Date.now() - inlineLast < 60_000) return;
  inlineBusy = true;
  inlineLast = Date.now();
  try {
    await recoverStuckJobs();
    await runTick({ budgetMs: 20_000 });
  } catch (e) {
    logger.error('inline_tick.failed', { error: safeErrorMessage(e) });
  } finally {
    inlineBusy = false;
  }
}
