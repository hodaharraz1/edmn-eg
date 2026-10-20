import { rm } from 'node:fs/promises';
import path from 'node:path';

/** Recreate the test database schema once per run, apply migrations and reference data. */
export default async function setup() {
  await import('./setup-env');
  const url = process.env.DATABASE_URL!;
  if (!/edmn_test|_test\b|test/.test(url)) throw new Error(`Refusing to run tests against non-test database: ${url}`);
  const { sql } = await import('drizzle-orm');
  const { getDb, closeDb } = await import('../../src/server/db/client');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const db = getDb();
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: path.resolve('drizzle') });
  const { seedReference } = await import('../../src/server/db/seed/reference');
  await seedReference();
  await closeDb();
  await rm(path.resolve('.test-storage'), { recursive: true, force: true });
}
