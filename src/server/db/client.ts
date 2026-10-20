import { sql } from 'drizzle-orm';
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
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
      // Client-side ceiling (longer than the server statement timeout below, so the server cancels first).
      query_timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? 60_000) || undefined,
    });
    globalForDb.__edmnUrl = url;
    globalForDb.__edmnDb = undefined;
  }
  return globalForDb.__edmnPool;
}

/**
 * Server-side limits for every application transaction (Batch 2). Applied with SET LOCAL semantics
 * (set_config(..., true)) so they work through a transaction pooler and never leak to another transaction.
 * A statement / lock wait that exceeds them aborts the WHOLE transaction: a money movement is either fully
 * committed or not at all. 0 disables a limit (the migration runner does this).
 */
export function transactionTimeouts() {
  const n = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Math.max(0, Number(v) || 0));
  return {
    statementMs: n(process.env.DATABASE_STATEMENT_TIMEOUT_MS, 30_000),
    lockMs: n(process.env.DATABASE_LOCK_TIMEOUT_MS, 10_000),
    idleInTxMs: n(process.env.DATABASE_IDLE_TX_TIMEOUT_MS, 60_000),
  };
}

export function getDb(): DB {
  if (!globalForDb.__edmnDb) {
    const real = drizzle(getPool(), { schema, casing: 'snake_case' });
    const begin = real.transaction.bind(real);
    real.transaction = ((fn: (tx: Tx) => Promise<unknown>, config?: Parameters<DB['transaction']>[1]) =>
      begin(async (tx) => {
        const t = transactionTimeouts();
        if (t.statementMs || t.lockMs || t.idleInTxMs) {
          await tx.execute(
            sql`select set_config('statement_timeout', ${String(t.statementMs)}, true), set_config('lock_timeout', ${String(t.lockMs)}, true), set_config('idle_in_transaction_session_timeout', ${String(t.idleInTxMs)}, true)`,
          );
        }
        return fn(tx);
      }, config)) as DB['transaction'];
    globalForDb.__edmnDb = real;
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
