import { sql } from 'drizzle-orm';
import { errorTrackingStatus } from '@/server/core/error-tracking';
import { logger } from '@/server/core/logger';
import { validateEnvironment } from '@/server/core/runtime-env';
import { db } from '@/server/db/client';
import { EXPECTED_MIGRATIONS, LATEST_MIGRATION } from '@/server/db/expected-migrations';
import { ensureFingerprint } from '@/server/db/fingerprint';
import { scheduleHealth } from '@/server/jobs/scheduler';
import { latestLedgerHealth } from '@/server/modules/finance/ledger-health';
import { killSwitchStates } from '@/server/modules/finance/controls';
import { outboxStats } from '@/server/modules/notifications/outbox';
import { pushConfigured } from '@/server/modules/notifications/push';
import { getSetting } from '@/server/modules/settings';
import { scannerStatus } from '@/server/storage/scanning';
import { storage } from '@/server/storage/storage';

/**
 * HEALTH MODEL (Batch 2)
 *   liveness   /api/health — the process answers; touches nothing.
 *   readiness  /api/ready  — may this instance serve traffic: database, environment fingerprint, migrations,
 *              secrets policy, storage. Public output is status words only (no counts, names or values).
 *   deep       deepHealth() — Admin/Ops only (/admin/ops): jobs, outbox, ledger health, kill switches, scanner,
 *              error tracking, push, thresholds. Degradations here do not take the instance out of rotation.
 */
type Check = 'ok' | 'error' | 'degraded';

export async function readiness(): Promise<{ ready: boolean; checks: Record<string, Check> }> {
  const checks: Record<string, Check> = {};
  try {
    const r = await db.execute<{ n: string }>(sql`select count(*)::text n from drizzle.__drizzle_migrations`);
    checks.database = 'ok';
    // Fewer applied than shipped = schema behind code; more = an older build against a newer schema (allowed: expand/contract).
    checks.migrations = Number(r.rows[0].n) >= EXPECTED_MIGRATIONS ? 'ok' : 'error';
  } catch (e) {
    checks.database = 'error';
    checks.migrations = 'error';
    logger.error('ready.db_failed', { error: e as Error });
  }
  try {
    const fp = await ensureFingerprint();
    checks.environment = fp.status === 'OK' ? 'ok' : fp.status === 'VIOLATION' ? 'error' : 'degraded';
  } catch {
    checks.environment = 'error';
  }
  checks.configuration = validateEnvironment().errors.length ? 'error' : 'ok';
  try {
    await storage().exists('PUBLIC', 'healthcheck/00000000-0000-0000-0000-000000000000.webp');
    checks.storage = 'ok';
  } catch {
    checks.storage = 'error';
  }
  const ready = Object.values(checks).every((c) => c !== 'error');
  return { ready, checks };
}

export async function deepHealth() {
  const { SCHEDULE } = await import('@/server/jobs/worker');
  const [ready, fp, jobs, outbox, ledger, switches, scanner, thresholds] = await Promise.all([
    readiness(),
    ensureFingerprint(),
    scheduleHealth(SCHEDULE),
    outboxStats(),
    latestLedgerHealth(),
    killSwitchStates(),
    scannerStatus(),
    getSetting('ops.thresholds'),
  ]);
  const q = await db.execute<{ failed_jobs: string; backlog: string; errors_1h: string; error_groups: string; applied: string }>(sql`select
    (select count(*) from jobs where status = 'FAILED')::text failed_jobs,
    (select count(*) from jobs where status = 'PENDING' and run_at < now() - interval '15 minutes')::text backlog,
    (select coalesce(sum(occurrences), 0) from error_events where last_seen_at > now() - interval '1 hour')::text errors_1h,
    (select count(*) from error_events where last_seen_at > now() - interval '24 hours')::text error_groups,
    (select count(*) from drizzle.__drizzle_migrations)::text applied`);
  const x = q.rows[0];
  const env = validateEnvironment();
  const alerts: string[] = [];
  const over = (v: number, t: number | null | undefined) => t !== null && t !== undefined && v > t;
  if (over(outbox.deadLetters, thresholds.deadLetters)) alerts.push(`رسائل فشلت نهائيًا (dead letter): ${outbox.deadLetters}`);
  if (over(Number(x.failed_jobs), thresholds.failedJobs)) alerts.push(`مهام فشلت نهائيًا: ${x.failed_jobs}`);
  const stale = jobs.filter((j) => j.health === 'STALE' || j.health === 'FAILING');
  if (over(stale.length, thresholds.staleSchedules)) alerts.push(`مهام مجدولة متأخرة/فاشلة: ${stale.map((j) => j.name).join(', ')}`);
  if (over(outbox.due, thresholds.outboxBacklog)) alerts.push(`رسائل متأخرة في الطابور: ${outbox.due}`);
  if (over(Number(x.errors_1h), thresholds.errorEventsPerHour)) alerts.push(`أخطاء في آخر ساعة: ${x.errors_1h}`);
  if (over((scanner.counts.QUARANTINED ?? 0) + (scanner.counts.SCAN_FAILED ?? 0), thresholds.quarantinedFiles)) alerts.push('ملفات محجوزة بانتظار الفحص');
  if (ledger?.status === 'CRITICAL') alerts.push('سلامة دفتر الأستاذ: مخالفة حرجة — الحركات المالية الجديدة موقوفة');
  if (fp.status !== 'OK') alerts.push(`بصمة البيئة: ${fp.status}`);
  return {
    environment: env.environment,
    ready,
    fingerprint: fp,
    configuration: { errors: env.errors, warnings: env.warnings, variables: env.variables },
    migrations: { applied: Number(x.applied), expected: EXPECTED_MIGRATIONS, latest: LATEST_MIGRATION },
    jobs,
    queue: { failedJobs: Number(x.failed_jobs), backlog: Number(x.backlog) },
    outbox,
    ledger,
    killSwitches: switches,
    scanner,
    errors: { lastHour: Number(x.errors_1h), groups24h: Number(x.error_groups), tracking: errorTrackingStatus() },
    providers: {
      email: process.env.MAIL_DRIVER === 'smtp' ? 'SMTP CONFIGURED — DELIVERY UNVERIFIED' : 'EMAIL CODE READY / PROVIDER NOT CONFIGURED',
      sms: process.env.SMS_DRIVER === 'http' ? 'HTTP SMS CONFIGURED — DELIVERY UNVERIFIED' : 'SMS CODE READY / PROVIDER NOT CONFIGURED',
      push: pushConfigured() ? 'VAPID CONFIGURED — REAL-DEVICE TEST REQUIRED' : 'PUSH NOT CONFIGURED',
      malwareScanner: scanner.active ? 'SCANNER CONFIGURED' : 'MALWARE SCANNER ACTIVE: NO',
    },
    alerts,
    checkedAt: new Date().toISOString(),
  };
}
