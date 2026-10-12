import './_env';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../src/server/db/client';
import { environmentMarker, markDeploymentEnvironment } from '../src/server/db/environment';

async function main() {
  const started = Date.now();
  await migrate(getDb(), { migrationsFolder: './drizzle' });
  console.log(`✓ migrations applied in ${Date.now() - started}ms`);
  // Fail closed: a PRODUCTION database is permanently marked and refuses any other deployment kind.
  const marked = await markDeploymentEnvironment(getDb(), environmentMarker());
  console.log(`✓ database environment: ${marked ?? 'unmarked'}`);
  await closeDb();
}

main().catch(async (e) => {
  console.error('✗ migration failed', e);
  await closeDb();
  process.exit(1);
});
