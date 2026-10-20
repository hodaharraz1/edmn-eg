# Job Failure

Model (`src/server/jobs/scheduler.ts`): every scheduled job runs under a DB lease (`job_leases`, one runner across all instances), with telemetry in `job_runs` (status, worker, attempt, items, sanitized error, next expected run). Queue jobs (`jobs` table) are claimed with `FOR UPDATE SKIP LOCKED`, retried with backoff and end FAILED after `max_attempts` (dead letter).

## Health states (`/admin/ops`)
OK · RUNNING · STALE (no success for 3 periods) · FAILING (consecutive failures) · NEVER_RAN. On Vercel Hobby the scheduler is the daily cron + traffic ("INLINE_WORKER"), so STALE on staging is expected and is **not** production scheduling.

## Steps
1. Read the job's last `error_safe` (`job_runs`) and the grouped error (`error_events`, source=schedule).
2. Stuck run (instance died): the next tick marks it ABANDONED and frees the lease automatically; nothing to do unless it repeats.
3. Re-run on demand: `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` (forced run, still singleton), or `npm run worker:once` against the right environment.
4. Money: jobs never move money (release / refund / payout need human Maker/Checker). SLA jobs never invent SLA values (`support.sla` empty = no SLA alerts).
5. Dead-lettered queue job: fix the cause, then requeue by setting it PENDING via a reviewed operation (audited).
