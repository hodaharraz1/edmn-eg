import './_env';
process.env.DATABASE_STATEMENT_TIMEOUT_MS = '0';
process.env.DATABASE_LOCK_TIMEOUT_MS = '0';
process.env.DATABASE_IDLE_TX_TIMEOUT_MS = '0';
process.env.DATABASE_QUERY_TIMEOUT_MS = '0';
import { Client } from 'pg';
import { requireDatabaseChange } from './_db-change';
import { resolveDatabaseUrl } from '../src/server/core/deploy-policy';
import { allowUnmarkedPreviewDatabaseForInit, closeDb, getDb } from '../src/server/db/client';
import { markPreviewDatabase } from '../src/server/db/environment';
import { runMigrations } from '../src/server/db/migrations';

/**
 * Explicitly initialise an ISOLATED preview database (the only way a database becomes PREVIEW):
 *
 *   EDMN_DEPLOYMENT=preview PREVIEW_DATABASE_URL=postgres://…/edmn_preview_x \
 *     npx tsx scripts/preview-db-init.ts --confirm-database=edmn_preview_x
 *
 * Refuses unless the target is EMPTY (no tables in public / drizzle): an existing database — staging, production, or a
 * copy of either — can never become a preview database. Then migrates, marks PREVIEW and loads reference data.
 * Demo data is a separate explicit step (`EDMN_DEPLOYMENT=preview npx tsx scripts/seed.ts --demo`).
 */
async function main() {
  requireDatabaseChange('init-preview');
  const url = resolveDatabaseUrl(process.env);
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  const confirm = process.argv.find((a) => a.startsWith('--confirm-database='))?.split('=')[1];
  if (!confirm || confirm !== name) throw new Error(`pass --confirm-database=${name} to initialise this database as PREVIEW`);
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query<{ n: string }>(`select count(*)::text n from pg_tables where schemaname in ('public', 'drizzle')`);
    if (Number(r.rows[0].n) > 0) throw new Error(`refusing: database "${name}" is not empty (${r.rows[0].n} tables). A preview database must be created empty.`);
  } finally {
    await c.end();
  }
  allowUnmarkedPreviewDatabaseForInit();
  await runMigrations({ initPreview: true, log: (m) => console.log(`• ${m}`) });
  await markPreviewDatabase(getDb());
  const { seedReference } = await import('../src/server/db/seed/reference');
  await seedReference({ mode: 'bootstrap' });
  console.log(`✓ "${name}" initialised as an isolated PREVIEW database`);
  await closeDb();
}

main().catch(async (e) => {
  console.error('✗ preview-db-init failed:', e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
