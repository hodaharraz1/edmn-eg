import './_env';
import { logger } from '../src/server/core/logger';
import { closeDb } from '../src/server/db/client';
import { recoverStuckJobs, runOneJob, SCHEDULE } from '../src/server/jobs/worker';

/**
 * Background worker: processes queued jobs and runs periodic maintenance.
 * Run one or more instances in production (systemd / container) — job claiming is concurrency-safe.
 */
let stopping = false;
const lastRun = new Map<string, number>();

async function tick() {
  for (const s of SCHEDULE) {
    const last = lastRun.get(s.name) ?? 0;
    if (Date.now() - last >= s.everyMs) {
      lastRun.set(s.name, Date.now());
      try {
        const res = await s.run();
        logger.debug('schedule.ran', { name: s.name, res: typeof res === 'object' ? res : { value: res } });
      } catch (e) {
        logger.error('schedule.failed', { name: s.name, error: (e as Error).message });
      }
    }
  }
  while (!stopping && (await runOneJob())) {
    /* drain */
  }
}

async function main() {
  const poll = Number(process.env.WORKER_POLL_MS ?? 5000);
  logger.info('worker.started', { poll });
  await recoverStuckJobs();
  const once = process.argv.includes('--once');
  do {
    await tick();
    if (once) break;
    await new Promise((r) => setTimeout(r, poll));
  } while (!stopping);
  await closeDb();
  logger.info('worker.stopped');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stopping = true));
main().catch((e) => {
  logger.error('worker.crashed', { error: (e as Error).message });
  process.exit(1);
});
