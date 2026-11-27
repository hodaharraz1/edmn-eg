import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { scanCounters } from '@/server/auth/rate-limit';
import type { AlertCandidate, AlertRule } from './rules';

/**
 * SECURITY & OPS ALERT RULES (PKG-SEC-OPS-01). Five read-only rules that plug into the EXISTING alert
 * engine (engine.ts) — no parallel engine, no new tables, no notification channel of their own. They
 * close the monitoring gaps registered as SEC-142 (security-event alerting) and SEC-144 (ops-health
 * alerting): the ledger health check already blocks new money movements on CRITICAL but notifies
 * nobody, failed / stale scheduled jobs were silent, login rate-limit hammering was invisible, and a
 * burst of admin actions (the mass-extraction pattern of SEC-143) had no tripwire.
 *
 * Hard rules for this file:
 *  - READ-ONLY: candidates run SELECTs only. Rules NEVER act (no writes, no ledger recompute, no
 *    posting); they only inform people, exactly like the business rules in rules.ts.
 *  - BOUNDED: every query is time-windowed (agingHours, clamped to 1..168h by lookbackHours) and
 *    row-limited (MAX_CANDIDATES), so a busy table can never turn an alert sweep into an expensive
 *    scan. Tune windows via the existing `alerts.rules` setting (per-code { agingHours, cooldownHours,
 *    enabled }) — the same mechanism the business rules already use; no new settings keys were added.
 *  - NO SENSITIVE DATA: entity ids and refs for offender-based rules are SHA-256 fingerprints of the
 *    offending source (rate-limit key / actor id), never the phone, IP or user id itself, plus counts
 *    only. Alert bodies carry {{ref}} only, as the engine enforces.
 *
 * NOTE (intentional duplication): the tiny helpers below mirror q/at/toCandidates in rules.ts.
 * rules.ts imports THIS file, so importing its private helpers back would create a runtime module
 * cycle; only the AlertRule/AlertCandidate TYPES are imported (erased at compile time, so there is no
 * runtime dependency in that direction).
 */

const q = async <T>(conn: DbOrTx, query: ReturnType<typeof sql>) => (await conn.execute(query)).rows as T[];
const at = (v: string | null) => (v ? new Date(v) : null);

/** Clamp a configurable lookback so an override can never widen a scan past 7 days or below 1 hour. */
export const clampLookback = (h: number) => Math.min(168, Math.max(1, Number(h) || 0));
/** L7: bound integer parameter (clamped) instead of an interpolated interval string. */
export const lookbackHours = (h: number) => sql`make_interval(hours => ${clampLookback(h)}::int)`;

/** sha256 fingerprints — the only form in which a source identifier may appear in an alert. */
export const redactRef = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 10);
export const spikeEntityId = (kind: string, raw: string) => `${kind}:${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;

/** Fixed detection thresholds (operational defaults; windows and cooldowns are configurable through
 *  `alerts.rules`, counts are deliberate constants — see file header). */
export const LOGIN_SPIKE_MIN_ATTEMPTS = 20;
export const ADMIN_BURST_MIN_ACTIONS = 100;
/** Hard row cap per rule per sweep, independent of how busy the table is. */
export const MAX_CANDIDATES = 25;

type Row = { id: string; due: string | null; ref: string };
const toCandidates = (rows: Row[], entityType: string, link: string): AlertCandidate[] =>
  rows.map((r) => ({ entityType, entityId: r.id, deadlineAt: at(r.due), userIds: [], ref: r.ref, link }));

/** Rows whose raw source id must never reach a notification: fingerprint id + ref source. */
const toSpikeCandidates = (rows: { source: string; count: number }[], kind: string, label: string, link: string): AlertCandidate[] =>
  rows.map((r) => ({
    entityType: kind,
    entityId: spikeEntityId(kind, r.source),
    deadlineAt: null,
    userIds: [],
    ref: `${r.count} ${label} — مصدر ${redactRef(r.source)}`,
    link,
  }));

export const SECURITY_ALERT_RULES: AlertRule[] = [
  {
    /* SEC-144: a WARNING/CRITICAL ledger health check already blocks new movements (ledger-health.ts)
       but told nobody. Surfaces the LATEST non-OK check only, so the alert resolves on the next clean check. */
    code: 'SEC_LEDGER_HEALTH',
    category: 'SECURITY',
    title: 'فحص سلامة الدفتر غير سليم',
    body: 'آخر فحص لسلامة الدفتر أعطى نتيجة {{ref}} — الحركات المالية الجديدة موقوفة تلقائيًا حتى فحص نظيف.',
    staffPermission: 'finance.view',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 6 },
    candidates: async (c) =>
      toCandidates(
        await q<Row>(c, sql`
          select id, null::text due, status || ' — ' || to_char(checked_at, 'YYYY-MM-DD HH24:MI') ref
          from ledger_health_checks
          where status <> 'OK' and checked_at = (select max(checked_at) from ledger_health_checks)
          order by checked_at desc limit 1`),
        'ledger_health',
        '/admin/ledger',
      ),
  },
  {
    /* SEC-144: consecutive failures are tracked on job_leases but were silent. deadline = last_failed_at,
       so the engine escalates DUE → OVERDUE after cooldownHours and repeats while still failing. Resolves
       automatically when the next success resets consecutive_failures to 0. */
    code: 'SEC_JOB_FAILED',
    category: 'SECURITY',
    title: 'مهمة مجدولة فاشلة',
    body: 'المهمة {{ref}} فشلت في آخر تشغيل لها — راجع سجل التشغيل (job_runs).',
    staffPermission: 'settings.manage',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 6, agingHours: 48 },
    candidates: async (c, cfg) =>
      toCandidates(
        await q<Row>(c, sql`
          select job_name id, last_failed_at::text due, job_name || ' (×' || consecutive_failures || ')' ref
          from job_leases
          where consecutive_failures > 0 and last_failed_at > now() - ${lookbackHours(cfg.agingHours)}
          limit ${MAX_CANDIDATES}`),
        'job',
        '/admin/ops',
      ),
  },
  {
    /* SEC-144: a job that missed its expected run by more than agingHours with no live lease.
       deadline = next_expected_at, so the engine escalates it to OVERDUE over time. */
    code: 'SEC_JOB_STALE',
    category: 'SECURITY',
    title: 'مهمة مجدولة متأخرة',
    body: 'المهمة {{ref}} تجاوزت موعد تشغيلها المتوقع بدون تشغيل ناجح — راجع جدولة المهام.',
    staffPermission: 'settings.manage',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 12, agingHours: 12 },
    candidates: async (c, cfg) =>
      toCandidates(
        await q<Row>(c, sql`
          select job_name id, next_expected_at::text due, job_name ref
          from job_leases
          where next_expected_at is not null
            and next_expected_at < now() - ${lookbackHours(cfg.agingHours)}
            and lease_until < now()
          limit ${MAX_CANDIDATES}`),
        'job',
        '/admin/ops',
      ),
  },
  {
    /* SEC-142: login rate-limit keys keep counting after the cap, so a count far above the limit means
       sustained hammering, not a user mistyping. The phone/IP never leaves the database. */
    code: 'SEC_LOGIN_FAILURE_SPIKE',
    category: 'SECURITY',
    title: 'محاولات دخول مكثفة',
    body: 'رُصدت {{ref}} — راجع سجلات المصادقة وحدود المعدل.',
    staffPermission: 'audit.view',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 2, agingHours: 2 },
    candidates: async () =>
      toSpikeCandidates(
        // PKG-FOLLOWUP-02: the counters live in Redis / server memory since PKG-PERF-01, not in the rate_limits table.
        (await scanCounters(['login-id:', 'login-ip:'], LOGIN_SPIKE_MIN_ATTEMPTS, MAX_CANDIDATES)).counters.map((x) => ({ source: x.key, count: x.count })),
        'login',
        'محاولة دخول فاشلة',
        '/admin/audit',
      ),
  },
  {
    /* SEC-142/143: a burst of ADMIN-actor audit rows within the lookback window is the mass-extraction
       / mass-change pattern. The actor id is fingerprinted; reviewers open the audit log to see who. */
    code: 'SEC_ADMIN_ACTION_BURST',
    category: 'SECURITY',
    title: 'نشاط إداري غير معتاد',
    body: 'رُصدت {{ref}} — راجع سجل التدقيق.',
    staffPermission: 'audit.view',
    severity: 'HIGH',
    defaults: { preHours: 0, cooldownHours: 3, agingHours: 1 },
    candidates: async (c, cfg) =>
      toSpikeCandidates(
        await q<{ source: string; count: number }>(c, sql`
          select actor_user_id::text source, count(*)::int count from audit_logs
          where actor_type = 'ADMIN' and created_at > now() - ${lookbackHours(cfg.agingHours)}
          group by actor_user_id
          having count(*) >= ${ADMIN_BURST_MIN_ACTIONS}
          limit ${MAX_CANDIDATES}`),
        'admin',
        'إجراء إداري خلال الفترة الأخيرة',
        '/admin/audit',
      ),
  },
];
