import { logger } from '@/server/core/logger';
import { recoverStuckJobs, runOneJob, SCHEDULE } from './worker';

/**
 * One pass of the background work: due schedule entries, then queued jobs.
 * Used by the long-running worker (scripts/worker.ts) and, on serverless hosts without one,
 * by the cron route and the throttled after-response trigger (INLINE_WORKER=true).
 */
const lastRun = new Map<string, number>();

export async function runTick(opts: { force?: boolean; budgetMs?: number; isStopping?: () => boolean } = {}): Promise<{ jobs: number }> {
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  for (const s of SCHEDULE) {
    const last = lastRun.get(s.name) ?? 0;
    if (opts.force || Date.now() - last >= s.everyMs) {
      lastRun.set(s.name, Date.now());
      try {
        const res = await s.run();
        logger.debug('schedule.ran', { name: s.name, res: typeof res === 'object' ? res : { value: res } });
      } catch (e) {
        logger.error('schedule.failed', { name: s.name, error: (e as Error).message });
      }
    }
  }
  let n = 0;
  while (!opts.isStopping?.() && Date.now() < deadline && (await runOneJob())) n++;
  return { jobs: n };
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
    logger.error('inline_tick.failed', { error: (e as Error).message });
  } finally {
    inlineBusy = false;
  }
}
