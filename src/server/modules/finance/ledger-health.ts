import { desc, sql } from 'drizzle-orm';
import { DomainError } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import { db, type DbOrTx } from '@/server/db/client';
import { ledgerHealthChecks } from '@/server/db/schema';
import { financialInvariants } from './controls';

/**
 * CONTINUOUS LEDGER HEALTH (Batch 2). READ-ONLY: it runs the financial invariants and records a snapshot.
 * It never posts, edits, reverses or "auto-fixes" anything. A CRITICAL snapshot blocks NEW money movements
 * (assertFinancialSafety) until a later snapshot is no longer critical — investigation is human (FINANCIAL_DRIFT runbook).
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

/** Throws when the most recent snapshot is CRITICAL (fail closed for new money movements only). */
export async function assertLedgerHealthy(conn: DbOrTx): Promise<void> {
  const r = await conn.execute<{ status: string; critical: unknown }>(sql`select status, critical_checks critical from ledger_health_checks order by checked_at desc limit 1`);
  if (r.rows[0]?.status === 'CRITICAL') {
    throw new DomainError('INVALID_STATE', 'الحركات المالية الجديدة موقوفة تلقائيًا: فحص سلامة دفتر الأستاذ اكتشف مخالفة حرجة. مفيش أي حركة اتعملت — فريق المالية بيراجع.');
  }
}
