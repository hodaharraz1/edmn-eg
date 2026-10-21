import './_env';
// DDL may legitimately run longer than an application transaction.
process.env.DATABASE_STATEMENT_TIMEOUT_MS = '0';
process.env.DATABASE_LOCK_TIMEOUT_MS = '0';
process.env.DATABASE_IDLE_TX_TIMEOUT_MS = '0';
process.env.DATABASE_QUERY_TIMEOUT_MS = '0';
import { requireDatabaseChange } from './_db-change';
import { closeDb } from '../src/server/db/client';
import { preflight, runMigrations } from '../src/server/db/migrations';

/**
 * Explicit operator step — never run by a build, an install hook or a container start (deploy-policy.ts).
 *   --preflight     read-only: pending migrations + preflight problems (no authorization needed)
 *   (default)       schema migrations, then reference data in insert-missing mode (never overwrites admin data)
 *   --schema-only   schema migrations only
 * STAGING needs --authorize=staging, PRODUCTION --authorize=production, each with
 * EDMN_DB_CHANGE_AUTHORIZATION=<environment>:<commit or release>. A preview may only migrate a database that was
 * explicitly initialised as PREVIEW (scripts/preview-db-init.ts).
 */
async function main() {
  // `--preflight`: report pending migrations and preflight problems WITHOUT applying anything (deploy step 5).
  if (process.argv.includes('--preflight')) {
    const pf = await preflight();
    console.log(`• pending: ${pf.pending.join(', ') || 'none'}`);
    for (const p of pf.problems) console.error(`✗ ${p}`);
    await closeDb();
    process.exit(pf.problems.length ? 1 : 0);
  }
  const policy = requireDatabaseChange('migrate');
  const started = Date.now();
  // Preflight (environment marker + destructive-statement scan) and the advisory lock live in runMigrations.
  // Fail closed: a PRODUCTION database is permanently marked and refuses any other deployment kind.
  const res = await runMigrations({ log: (m) => console.log(`• ${m}`) });
  console.log(`✓ migrations applied in ${Date.now() - started}ms (${res.applied.length} new)`);
  console.log(`✓ database environment: ${res.marked ?? 'unmarked'}`);
  if (!process.argv.includes('--schema-only')) {
    // Reference data travels with the schema, insert-missing only: new installs get the full set, existing installs
    // only gain rows that do not exist yet. Production has no separate seed step.
    const { seedReference } = await import('../src/server/db/seed/reference');
    const ref = await seedReference({ mode: 'insert-missing' });
    console.log(`✓ reference data (insert-missing; ${policy.referenceMode === 'bootstrap' ? 'bootstrap available via db:seed' : 'no overwrite'})`, ref);
  }
  await closeDb();
}

main().catch(async (e) => {
  console.error('✗ migration failed', e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
