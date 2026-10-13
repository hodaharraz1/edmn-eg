import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { sql } from 'drizzle-orm';
import { logger, safeErrorMessage } from '@/server/core/logger';
import { db } from '@/server/db/client';

/**
 * RELIABLE SCHEDULED JOBS (Batch 2).
 *   singleton   one atomic lease upsert per job (job_leases): N workers / serverless instances → one run per period
 *   cadence     "due" is decided from the database (last_started_at), not per-process memory
 *   telemetry   job_runs row per run: started/finished, status, worker, attempt, items, sanitized error, next run
 *   failure     consecutive_failures + last_failed_at; the next due tick retries (the job bodies are idempotent)
 *   stuck       a RUNNING run whose lease expired is marked ABANDONED (the lease is then free again)
 * Jobs never move money by themselves: release/refund/payout stay human-approved (Maker/Checker).
 */
export interface ScheduledJob {
  name: string;
  everyMs: number;
  /** Lease length; a run longer than this is treated as stuck. */
  leaseMs?: number;
  run: () => Promise<unknown>;
}

export const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/** Atomically takes the lease if the job is due (or forced) and no live lease exists. */
/**
 * `dueRatio` (0 < r ≤ 1) lets an external scheduler whose invocations jitter by a few seconds still find a job due
 * (e.g. 0.9 → a 60 s job is due after 54 s). It never allows two runs at once: the live lease still decides.
 */
export async function acquireLease(job: Pick<ScheduledJob, 'name' | 'everyMs' | 'leaseMs'>, owner: string, force = false, dueRatio = 1): Promise<boolean> {
  const leaseMs = job.leaseMs ?? Math.min(15 * 60_000, Math.max(60_000, job.everyMs));
  const every = Math.round(job.everyMs / 1000);
  const dueAfter = Math.max(1, Math.round(every * Math.min(1, Math.max(0.5, dueRatio))));
  const r = await db.execute<{ job_name: string }>(sql`
    insert into job_leases (job_name, owner, lease_until, every_seconds, last_started_at, next_expected_at)
    values (${job.name}, ${owner}, now() + make_interval(secs => ${leaseMs / 1000}), ${every}, now(), now() + make_interval(secs => ${every}))
    on conflict (job_name) do update set
      owner = excluded.owner, lease_until = excluded.lease_until, every_seconds = excluded.every_seconds,
      last_started_at = now(), next_expected_at = excluded.next_expected_at, updated_at = now()
    where job_leases.lease_until < now()
      and (${force} or job_leases.last_started_at is null or job_leases.last_started_at <= now() - make_interval(secs => ${dueAfter}))
    returning job_name`);
  return r.rows.length > 0;
}

async function releaseLease(name: string, owner: string, ok: boolean) {
  await db.execute(sql`update job_leases set lease_until = now(), updated_at = now(),
      last_succeeded_at = case when ${ok} then now() else last_succeeded_at end,
      last_failed_at = case when ${ok} then last_failed_at else now() end,
      consecutive_failures = case when ${ok} then 0 else consecutive_failures + 1 end
    where job_name = ${name} and owner = ${owner}`);
}

function items(res: unknown): { processed: number | null; failed: number | null } {
  if (typeof res === 'number') return { processed: res, failed: null };
  if (res && typeof res === 'object') {
    const o = res as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    return { processed: num(o.processed) ?? num(o.created) ?? num(o.sent) ?? num(o.count), failed: num(o.failed) };
  }
  return { processed: null, failed: null };
}

export type RunOutcome = 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

/** Runs one scheduled job under its lease, recording telemetry. Never throws. */
export async function runScheduled(job: ScheduledJob, opts: { force?: boolean; owner?: string; dueRatio?: number } = {}): Promise<RunOutcome> {
  const owner = opts.owner ?? WORKER_ID;
  let leased = false;
  try {
    leased = await acquireLease(job, owner, !!opts.force, opts.dueRatio ?? 1);
  } catch (e) {
    logger.error('schedule.lease_failed', { name: job.name, error: safeErrorMessage(e) });
    return 'SKIPPED';
  }
  if (!leased) return 'SKIPPED';
  const runId = randomUUID();
  const attempt = await db
    .execute<{ n: string }>(sql`select (consecutive_failures + 1)::text n from job_leases where job_name = ${job.name}`)
    .then((r) => Number(r.rows[0]?.n ?? 1))
    .catch(() => 1);
  await db
    .execute(sql`insert into job_runs (job_name, run_id, status, worker, attempt, next_expected_at)
      values (${job.name}, ${runId}, 'RUNNING', ${owner}, ${attempt}, now() + make_interval(secs => ${Math.round(job.everyMs / 1000)}))`)
    .catch((e) => logger.warn('schedule.telemetry_failed', { name: job.name, error: safeErrorMessage(e) }));
  try {
    const res = await job.run();
    const it = items(res);
    await db.execute(sql`update job_runs set status = 'SUCCEEDED', finished_at = now(), items_processed = ${it.processed}, items_failed = ${it.failed} where run_id = ${runId}`).catch(() => {});
    await releaseLease(job.name, owner, true).catch(() => {});
    return 'SUCCEEDED';
  } catch (e) {
    const msg = safeErrorMessage(e);
    await db.execute(sql`update job_runs set status = 'FAILED', finished_at = now(), error_safe = ${msg} where run_id = ${runId}`).catch(() => {});
    await releaseLease(job.name, owner, false).catch(() => {});
    logger.error('schedule.failed', { name: job.name, attempt, error: msg });
    const { captureError } = await import('@/server/core/error-tracking');
    await captureError(e, { source: 'schedule', route: job.name });
    return 'FAILED';
  }
}

/** Runs whose lease expired while still RUNNING (crashed / timed-out instance) become ABANDONED. */
export async function markAbandonedRuns(): Promise<number> {
  const r = await db.execute(sql`update job_runs r set status = 'ABANDONED', finished_at = now(), error_safe = 'lease expired while running (instance crashed or timed out)'
    where r.status = 'RUNNING' and not exists (
      select 1 from job_leases l where l.job_name = r.job_name and l.owner = r.worker and l.lease_until > now())
      and r.started_at < now() - interval '1 minute'`);
  return r.rowCount ?? 0;
}

export type JobHealth = 'OK' | 'STALE' | 'FAILING' | 'NEVER_RAN' | 'RUNNING';

/** Health per scheduled job: last success, next expected run, failures, staleness (3 missed periods). */
export async function scheduleHealth(schedule: Pick<ScheduledJob, 'name' | 'everyMs'>[]) {
  const r = await db.execute<{ job_name: string; last_started_at: Date | null; last_succeeded_at: Date | null; last_failed_at: Date | null; consecutive_failures: number; next_expected_at: Date | null; lease_until: Date }>(
    sql`select job_name, last_started_at, last_succeeded_at, last_failed_at, consecutive_failures, next_expected_at, lease_until from job_leases`,
  );
  const byName = new Map(r.rows.map((x) => [x.job_name, x]));
  const now = Date.now();
  return schedule.map((s) => {
    const l = byName.get(s.name);
    let health: JobHealth = 'OK';
    if (!l || !l.last_started_at) health = 'NEVER_RAN';
    else if (new Date(l.lease_until).getTime() > now) health = 'RUNNING';
    else if (l.consecutive_failures > 0) health = 'FAILING';
    else if (!l.last_succeeded_at || now - new Date(l.last_succeeded_at).getTime() > 3 * s.everyMs) health = 'STALE';
    return {
      name: s.name,
      everyMs: s.everyMs,
      health,
      lastStartedAt: l?.last_started_at ?? null,
      lastSucceededAt: l?.last_succeeded_at ?? null,
      lastFailedAt: l?.last_failed_at ?? null,
      consecutiveFailures: l?.consecutive_failures ?? 0,
      nextExpectedAt: l?.next_expected_at ?? null,
    };
  });
}
