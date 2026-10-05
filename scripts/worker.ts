import './_env';
import { logger } from '../src/server/core/logger';
import { closeDb } from '../src/server/db/client';
import { recoverStuckJobs } from '../src/server/jobs/worker';
import { runTick } from '../src/server/jobs/tick';

/**
 * Background worker: processes queued jobs and runs periodic maintenance.
 * Run one or more instances in production (systemd / container) — job claiming is concurrency-safe.
 */
let stopping = false;

async function main() {
  const poll = Number(process.env.WORKER_POLL_MS ?? 5000);
  logger.info('worker.started', { poll });
  await recoverStuckJobs();
  const once = process.argv.includes('--once');
  do {
    await runTick({ isStopping: () => stopping });
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
