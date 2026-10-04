import './_env';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/server/db/client';

/** DEVELOPMENT ONLY: drops and recreates the public schema. Refuses in production. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('db:reset is disabled in production');
  const url = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) && !process.argv.includes('--force')) {
    throw new Error(`Refusing to reset non-local database host ${url.hostname} (pass --force if you are sure)`);
  }
  const db = getDb();
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  console.log('✓ database reset');
  await closeDb();
}
main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
