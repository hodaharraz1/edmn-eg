import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
/** A transaction handle; services accept either and call `withTx` to guarantee atomicity. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __edmnPool?: Pool; __edmnDb?: DB; __edmnUrl?: string };

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return url;
}

export function getPool(): Pool {
  const url = databaseUrl();
  if (!globalForDb.__edmnPool || globalForDb.__edmnUrl !== url) {
    globalForDb.__edmnPool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    globalForDb.__edmnUrl = url;
    globalForDb.__edmnDb = undefined;
  }
  return globalForDb.__edmnPool;
}

export function getDb(): DB {
  if (!globalForDb.__edmnDb) {
    globalForDb.__edmnDb = drizzle(getPool(), { schema, casing: 'snake_case' });
  }
  return globalForDb.__edmnDb;
}

/** Lazy proxy so modules can `import { db }` without opening connections at import time. */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

/** Run `fn` inside a transaction (re-uses the caller's transaction when one is passed). */
export async function withTx<T>(conn: DbOrTx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (conn && conn !== db && 'rollback' in conn) return fn(conn as Tx);
  return db.transaction(fn);
}

export async function closeDb() {
  if (globalForDb.__edmnPool) {
    await globalForDb.__edmnPool.end();
    globalForDb.__edmnPool = undefined;
    globalForDb.__edmnDb = undefined;
  }
}

export { schema };
