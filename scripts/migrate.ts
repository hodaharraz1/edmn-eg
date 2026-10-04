import './_env';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../src/server/db/client';

async function main() {
  const started = Date.now();
  await migrate(getDb(), { migrationsFolder: './drizzle' });
  console.log(`✓ migrations applied in ${Date.now() - started}ms`);
  await closeDb();
}

main().catch(async (e) => {
  console.error('✗ migration failed', e);
  await closeDb();
  process.exit(1);
});
