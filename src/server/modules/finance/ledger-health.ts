import { desc, sql } from 'drizzle-orm';
import { DomainError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import { db, type DbOrTx } from '@/server/db/client';
import { ledgerHealthChecks } from '@/server/db/schema';
import { financialInvariants } from './controls';

/**
 * CONTINUOUS LEDGER HEALTH (Batch 2). READ-ONLY: it runs the financial invariants and records a snapshot.
 * It never posts, edits, reverses or "auto-fixes" anything. NEW money movements (assertFinancialSafety) need a
 * recent non-critical snapshot: a CRITICAL, missing, stale or unreadable one blocks them until a later healthy
 * snapshot exists — investigation is human (FINANCIAL_DRIFT runbook).
 *
 * CRITICAL = the books themselves cannot be trusted (imbalance, drift, duplicate events, money leaving beyond
 * its source). WARNING = operational follow-up that does not make a further movement unsafe.
 */
export const CRITICAL_INVARIANTS = new Set([
  'TRIAL_BALANCE',
  'PROJECTION_DRIFT',
  'UNBALANCED_ENTRY',
  'DUPLICATE_BUSINESS_EVENT',
  'REFUND_OVERAGE',
  'WITHDRAWAL_OVERAGE',
  'WITHDRAWAL_ALLOCATION_SUM',
  'DEAL_PAYABLE_ATTRIBUTION',
  'DEAL_RESERVED_ATTRIBUTION',
]);

export type LedgerHealth = typeof ledgerHealthChecks.$inferSelect;

export async function runLedgerHealthCheck(trigger: string, conn: DbOrTx = db): Promise<LedgerHealth> {
  const inv = await financialInvariants(conn);
  const failing = inv.checks.filter((c) => c.count > 0);
  const critical = failing.filter((c) => CRITICAL_INVARIANTS.has(c.code)).map((c) => ({ code: c.code, count: c.count }));
  const warning = failing.filter((c) => !CRITICAL_INVARIANTS.has(c.code)).map((c) => ({ code: c.code, count: c.count }));
  if (inv.totals.difference !== 0 && !critical.some((c) => c.code === 'TRIAL_BALANCE')) critical.push({ code: 'TRIAL_BALANCE', count: 1 });
  const status = critical.length ? 'CRITICAL' : warning.length ? 'WARNING' : 'OK';
  const [row] = await conn
    .insert(ledgerHealthChecks)
    .values({ status, debits: inv.totals.debits, credits: inv.totals.credits, difference: inv.totals.difference, criticalChecks: critical, warningChecks: warning, trigger: trigger.slice(0, 60) })
    .returning();
  if (status === 'CRITICAL') logger.error('ledger.health_critical', { checks: critical, difference: inv.totals.difference });
  return row;
}

export async function latestLedgerHealth(conn: DbOrTx = db): Promise<LedgerHealth | null> {
  const [row] = await conn.select().from(ledgerHealthChecks).orderBy(desc(ledgerHealthChecks.checkedAt)).limit(1);
  return row ?? null;
}

/**
 * A money movement needs a RECENT, positively readable snapshot. The scheduler records one every 30 minutes;
 * the window matches the go-live gate (2 hours). A snapshot dated beyond the tolerated clock skew is not trusted.
 */
export const LEDGER_HEALTH_MAX_AGE_MINUTES = 120;
const LEDGER_HEALTH_FUTURE_SKEW_MINUTES = 5;
/** Only these results permit a new movement; anything else (CRITICAL, unknown) blocks it. */
const MOVEMENT_PERMITTING_STATUSES: ReadonlySet<string> = new Set(['OK', 'WARNING']);

export type LedgerHealthBlock = 'UNREADABLE' | 'MISSING' | 'STALE' | 'CRITICAL' | 'INDETERMINATE';

const BLOCK_MESSAGES: Record<LedgerHealthBlock, string> = {
  CRITICAL: 'الحركات المالية الجديدة موقوفة تلقائيًا: فحص سلامة دفتر الأستاذ اكتشف مخالفة حرجة. مفيش أي حركة اتعملت — فريق المالية بيراجع.',
  MISSING: 'الحركات المالية الجديدة موقوفة: مفيش أي فحص لسلامة دفتر الأستاذ متسجل. مفيش أي حركة اتعملت — شغّل فحص السلامة الأول.',
  STALE: `الحركات المالية الجديدة موقوفة: آخر فحص لسلامة دفتر الأستاذ أقدم من ${LEDGER_HEALTH_MAX_AGE_MINUTES / 60} ساعة (أو تاريخه غير منطقي). مفيش أي حركة اتعملت — شغّل فحص السلامة من جديد.`,
  UNREADABLE: 'الحركات المالية الجديدة موقوفة: تعذّر قراءة نتيجة فحص سلامة دفتر الأستاذ. مفيش أي حركة اتعملت.',
  INDETERMINATE: 'الحركات المالية الجديدة موقوفة: نتيجة فحص سلامة دفتر الأستاذ غير مفهومة. مفيش أي حركة اتعملت — فريق المالية بيراجع.',
};

/**
 * Why a new money movement must not happen right now, or null when the latest snapshot positively permits it.
 * FAIL CLOSED: a missing, stale, future-dated, CRITICAL, unknown or unreadable result all block.
 */
export async function ledgerHealthBlock(conn: DbOrTx): Promise<LedgerHealthBlock | null> {
  let row: { status: unknown; fresh: unknown; future: unknown } | undefined;
  try {
    const r = await conn.execute<{ status: unknown; fresh: unknown; future: unknown }>(sql`select status,
      checked_at > now() - ${sql.raw(`interval '${LEDGER_HEALTH_MAX_AGE_MINUTES} minutes'`)} fresh,
      checked_at > now() + ${sql.raw(`interval '${LEDGER_HEALTH_FUTURE_SKEW_MINUTES} minutes'`)} future
      from ledger_health_checks order by checked_at desc limit 1`);
    row = r.rows[0];
  } catch {
    return 'UNREADABLE';
  }
  if (!row) return 'MISSING';
  if (row.status === 'CRITICAL') return 'CRITICAL';
  if (row.fresh !== true || row.future !== false) return 'STALE';
  if (typeof row.status !== 'string' || !MOVEMENT_PERMITTING_STATUSES.has(row.status)) return 'INDETERMINATE';
  return null;
}

/** Throws unless the latest ledger-health snapshot positively permits a new money movement (fail closed). */
export async function assertLedgerHealthy(conn: DbOrTx): Promise<void> {
  const block = await ledgerHealthBlock(conn);
  if (block) throw new DomainError('INVALID_STATE', BLOCK_MESSAGES[block]);
}
