import { sql } from 'drizzle-orm';
import { safeErrorMessage } from '@/server/core/logger';
import { db } from '@/server/db/client';

/**
 * PROVIDER HEALTH (production infrastructure batch).
 *   NOT_CONFIGURED         the adapter has no configuration (nothing is attempted, nothing is claimed)
 *   CONFIGURED_UNVERIFIED  configured, but no real success has ever been observed
 *   HEALTHY                last observed outcome was a success, within the freshness window
 *   DEGRADED               recent failures (< FAILED_AFTER in a row) or the last success is stale
 *   FAILED                 FAILED_AFTER or more consecutive failures since the last success
 * HEALTHY is never derived from configuration: only from a recorded success (provider_health / job_leases).
 */
export const PROVIDERS = ['SMTP', 'EMAIL_WEBHOOK', 'ERROR_TRACKING', 'MALWARE_SCANNER', 'SCHEDULER', 'WEB_PUSH'] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export type ProviderStatus = 'NOT_CONFIGURED' | 'CONFIGURED_UNVERIFIED' | 'HEALTHY' | 'DEGRADED' | 'FAILED';
export const FAILED_AFTER = 3;

/** How old a success may be and still count as current evidence. Webhooks/pushes are traffic-driven, so wider. */
const FRESH_MS: Record<ProviderName, number> = {
  SMTP: 24 * 3600_000,
  EMAIL_WEBHOOK: 7 * 24 * 3600_000,
  ERROR_TRACKING: 7 * 24 * 3600_000,
  MALWARE_SCANNER: 24 * 3600_000,
  SCHEDULER: 2 * 3600_000,
  WEB_PUSH: 7 * 24 * 3600_000,
};

export interface Evidence {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
}

/** Pure status derivation (tested). */
export function deriveStatus(provider: ProviderName, configured: boolean, ev: Evidence | null, now = Date.now()): ProviderStatus {
  if (!configured) return 'NOT_CONFIGURED';
  if (!ev || (!ev.lastSuccessAt && !ev.lastFailureAt)) return 'CONFIGURED_UNVERIFIED';
  if (ev.consecutiveFailures >= FAILED_AFTER) return 'FAILED';
  if (!ev.lastSuccessAt) return ev.consecutiveFailures > 0 ? 'DEGRADED' : 'CONFIGURED_UNVERIFIED';
  if (ev.consecutiveFailures > 0) return 'DEGRADED';
  return now - ev.lastSuccessAt.getTime() <= FRESH_MS[provider] ? 'HEALTHY' : 'DEGRADED';
}

/** Records one real outcome. Never throws: observing a provider must not break the flow that used it. */
export async function recordProviderResult(provider: ProviderName, ok: boolean, error?: unknown): Promise<void> {
  try {
    const err = ok ? null : safeErrorMessage(error ?? 'failure').slice(0, 300);
    await db.execute(sql`insert into provider_health (provider, last_success_at, last_failure_at, consecutive_failures, last_error_safe)
      values (${provider}, ${ok ? sql`now()` : null}, ${ok ? null : sql`now()`}, ${ok ? 0 : 1}, ${err})
      on conflict (provider) do update set
        last_success_at = case when ${ok} then now() else provider_health.last_success_at end,
        last_failure_at = case when ${ok} then provider_health.last_failure_at else now() end,
        consecutive_failures = case when ${ok} then 0 else provider_health.consecutive_failures + 1 end,
        last_error_safe = case when ${ok} then provider_health.last_error_safe else excluded.last_error_safe end,
        updated_at = now()`);
  } catch {
    /* best effort */
  }
}

/** Which adapters are configured in this runtime (names only — never values). */
export function providerConfigured(raw: Record<string, string | undefined> = process.env): Record<ProviderName, boolean> {
  return {
    SMTP: raw.MAIL_DRIVER === 'smtp' && !!raw.SMTP_HOST,
    EMAIL_WEBHOOK: !!raw.EMAIL_WEBHOOK_SECRET,
    ERROR_TRACKING: !!raw.ERROR_TRACKING_DSN,
    MALWARE_SCANNER: !!raw.MALWARE_SCANNER_URL,
    SCHEDULER: !!raw.CRON_SECRET || raw.INLINE_WORKER === 'true' || !!raw.WORKER_DEDICATED,
    WEB_PUSH: !!(raw.VAPID_PUBLIC_KEY && raw.VAPID_PRIVATE_KEY),
  };
}

/** The schedules whose regular success the real-money gate requires. */
export const CRITICAL_SCHEDULES = ['ledger.health', 'outbound.flush', 'alerts.sweep'] as const;

async function schedulerEvidence(): Promise<Evidence | null> {
  const r = await db.execute<{ ok: string; total: string; failing: string; last_ok: Date | null; last_fail: Date | null }>(sql`select
      count(*) filter (where last_succeeded_at > now() - make_interval(secs => greatest(every_seconds * 3, 600)))::text ok,
      count(*)::text total,
      coalesce(max(consecutive_failures), 0)::text failing,
      min(last_succeeded_at) last_ok,
      max(last_failed_at) last_fail
    from job_leases where job_name in ('ledger.health', 'outbound.flush', 'alerts.sweep')`);
  const x = r.rows[0];
  if (!x || Number(x.total) === 0) return null;
  // Every critical schedule must be current for the scheduler to count as a success right now.
  const allCurrent = Number(x.ok) === CRITICAL_SCHEDULES.length;
  return {
    lastSuccessAt: allCurrent && x.last_ok ? new Date(x.last_ok) : null,
    lastFailureAt: x.last_fail ? new Date(x.last_fail) : null,
    consecutiveFailures: allCurrent ? Number(x.failing) : Math.max(1, Number(x.failing)),
  };
}

export interface ProviderHealthRow extends Evidence {
  provider: ProviderName;
  configured: boolean;
  status: ProviderStatus;
  lastErrorSafe: string | null;
}

export async function providerHealthReport(raw: Record<string, string | undefined> = process.env): Promise<ProviderHealthRow[]> {
  const configured = providerConfigured(raw);
  const rows = await db
    .execute<{ provider: string; last_success_at: Date | null; last_failure_at: Date | null; consecutive_failures: number; last_error_safe: string | null }>(sql`select provider, last_success_at, last_failure_at, consecutive_failures, last_error_safe from provider_health`)
    .then((r) => r.rows)
    .catch(() => []);
  const byName = new Map(rows.map((r) => [r.provider, r]));
  const sched = await schedulerEvidence().catch(() => null);
  return PROVIDERS.map((p) => {
    const row = byName.get(p);
    const ev: Evidence | null =
      p === 'SCHEDULER'
        ? sched
        : row
          ? { lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null, lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null, consecutiveFailures: Number(row.consecutive_failures) }
          : null;
    return {
      provider: p,
      configured: configured[p],
      status: deriveStatus(p, configured[p], ev),
      lastSuccessAt: ev?.lastSuccessAt ?? null,
      lastFailureAt: ev?.lastFailureAt ?? null,
      consecutiveFailures: ev?.consecutiveFailures ?? 0,
      lastErrorSafe: row?.last_error_safe ?? null,
    };
  });
}
