import './_env';
// DDL may legitimately run longer than an application transaction.
process.env.DATABASE_STATEMENT_TIMEOUT_MS = '0';
process.env.DATABASE_LOCK_TIMEOUT_MS = '0';
process.env.DATABASE_IDLE_TX_TIMEOUT_MS = '0';
process.env.DATABASE_QUERY_TIMEOUT_MS = '0';
import { closeDb } from '../src/server/db/client';
import { preflight, runMigrations } from '../src/server/db/migrations';

async function main() {
  // `--preflight`: report pending migrations and preflight problems WITHOUT applying anything (deploy step 5).
  if (process.argv.includes('--preflight')) {
    const pf = await preflight();
    console.log(`• pending: ${pf.pending.join(', ') || 'none'}`);
    for (const p of pf.problems) console.error(`✗ ${p}`);
    await closeDb();
    process.exit(pf.problems.length ? 1 : 0);
  }
  const started = Date.now();
  // Preflight (environment marker + destructive-statement scan) and the advisory lock live in runMigrations.
  // Fail closed: a PRODUCTION database is permanently marked and refuses any other deployment kind.
  const res = await runMigrations({ log: (m) => console.log(`• ${m}`) });
  console.log(`✓ migrations applied in ${Date.now() - started}ms (${res.applied.length} new)`);
  console.log(`✓ database environment: ${res.marked ?? 'unmarked'}`);
  await closeDb();
}

main().catch(async (e) => {
  console.error('✗ migration failed', e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
