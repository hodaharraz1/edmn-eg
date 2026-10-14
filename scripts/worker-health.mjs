#!/usr/bin/env node
/**
 * Worker heartbeat probe (self-hosted deployment): READ-ONLY.
 *   node scripts/worker-health.mjs            → exit 0 healthy, 1 unhealthy, 2 database unreachable
 *   node scripts/worker-health.mjs --json     → also prints a JSON summary (no secrets, no record values)
 * Healthy = the critical schedule `outbound.flush` (every minute) succeeded within HEARTBEAT_MAX_AGE_SEC (default 180 s).
 * Also reports ledger health, failing schedules and dead letters for the watchdog. Uses DATABASE_URL.
 */
import pg from 'pg';

const maxAge = Number(process.env.HEARTBEAT_MAX_AGE_SEC ?? 180);
const json = process.argv.includes('--json');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });

try {
  await client.connect();
  await client.query('begin transaction read only');
  const hb = await client.query(`select extract(epoch from now() - last_succeeded_at)::int age from job_leases where job_name = 'outbound.flush'`);
  const failing = await client.query(`select job_name from job_leases where consecutive_failures > 0 order by job_name`);
  const ledger = await client.query(`select status, extract(epoch from now() - checked_at)::int age from ledger_health_checks order by checked_at desc limit 1`);
  const dead = await client.query(`select count(*)::int n from outbound_messages where status = 'FAILED'`);
  await client.query('rollback');
  const age = hb.rows[0]?.age ?? null;
  const out = {
    heartbeatAgeSec: age,
    healthy: age !== null && age <= maxAge,
    failingSchedules: failing.rows.map((r) => r.job_name),
    ledgerHealth: ledger.rows[0] ? { status: ledger.rows[0].status, ageSec: ledger.rows[0].age } : null,
    deadLetters: dead.rows[0].n,
  };
  if (json) console.log(JSON.stringify(out));
  await client.end();
  process.exit(out.healthy ? 0 : 1);
} catch {
  if (json) console.log(JSON.stringify({ healthy: false, error: 'database unreachable or not migrated' }));
  await client.end().catch(() => {});
  process.exit(2);
}
