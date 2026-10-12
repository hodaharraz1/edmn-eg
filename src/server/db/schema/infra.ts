import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, enumCheck, ts, updatedAt } from './_helpers';

/* ═══════════════ Batch 2: infrastructure, reliability and operations ═══════════════ */

/**
 * Key check values (HMAC of a constant under the key — never the key) recorded on first hosted boot. A runtime
 * whose primary encryption key has the same id but a different check value refuses money movements: historical
 * KYC / payout ciphertexts would otherwise become unreadable or, worse, a staging key would serve production.
 */
export const secretFingerprints = pgTable('secret_fingerprints', {
  name: text().primaryKey(),
  kcv: text().notNull(),
  environment: text().notNull(),
  recordedAt: createdAt(),
});

/**
 * Singleton lease per scheduled job. Acquired with one atomic upsert (works through a transaction pooler,
 * unlike session advisory locks), so N workers / serverless instances run each schedule once per period.
 */
export const jobLeases = pgTable('job_leases', {
  jobName: text().primaryKey(),
  owner: text(),
  leaseUntil: ts().notNull(),
  everySeconds: integer(),
  lastStartedAt: ts(),
  lastSucceededAt: ts(),
  lastFailedAt: ts(),
  consecutiveFailures: integer().notNull().default(0),
  nextExpectedAt: ts(),
  updatedAt: updatedAt(),
});

export const JOB_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED'] as const;
/** One row per scheduled run (telemetry). error_safe is always a sanitized message, never a value. */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    jobName: text().notNull(),
    runId: uuid().notNull(),
    startedAt: ts().notNull().defaultNow(),
    finishedAt: ts(),
    status: text({ enum: JOB_RUN_STATUSES }).notNull(),
    worker: text().notNull(),
    attempt: integer().notNull().default(1),
    itemsProcessed: integer(),
    itemsFailed: integer(),
    errorSafe: text(),
    nextExpectedAt: ts(),
  },
  (t) => [
    uniqueIndex('job_runs_run_id_uq').on(t.runId),
    index('job_runs_name_started_idx').on(t.jobName, t.startedAt),
    index('job_runs_running_idx').on(t.status).where(sql`${t.status} = 'RUNNING'`),
    enumCheck('job_runs_status_chk', t.status, JOB_RUN_STATUSES),
  ],
);

export const LEDGER_HEALTH_STATUSES = ['OK', 'WARNING', 'CRITICAL'] as const;
/**
 * Read-only ledger health snapshots. A CRITICAL snapshot blocks NEW money movements until a later snapshot is
 * clean; nothing here ever posts, edits or "fixes" a journal.
 */
export const ledgerHealthChecks = pgTable(
  'ledger_health_checks',
  {
    id: uuid().primaryKey().defaultRandom(),
    checkedAt: ts().notNull().defaultNow(),
    status: text({ enum: LEDGER_HEALTH_STATUSES }).notNull(),
    debits: bigint({ mode: 'number' }).notNull(),
    credits: bigint({ mode: 'number' }).notNull(),
    difference: bigint({ mode: 'number' }).notNull(),
    criticalChecks: jsonb().notNull().default([]),
    warningChecks: jsonb().notNull().default([]),
    trigger: text().notNull(),
  },
  (t) => [index('ledger_health_checked_idx').on(t.checkedAt), enumCheck('ledger_health_status_chk', t.status, LEDGER_HEALTH_STATUSES)],
);

/**
 * Provider-neutral error tracking sink: grouped, redacted error events (no request bodies, no values). When an
 * external tracker is configured the same redacted event is also forwarded.
 */
export const errorEvents = pgTable(
  'error_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    fingerprint: text().notNull(),
    name: text().notNull(),
    code: text(),
    message: text().notNull(),
    source: text().notNull(),
    route: text(),
    lastRequestId: text(),
    environment: text().notNull(),
    occurrences: integer().notNull().default(1),
    firstSeenAt: createdAt(),
    lastSeenAt: ts().notNull().defaultNow(),
    forwardedAt: ts(),
  },
  (t) => [uniqueIndex('error_events_fingerprint_uq').on(t.fingerprint), index('error_events_last_seen_idx').on(t.lastSeenAt)],
);
