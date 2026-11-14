import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client, Pool, type PoolClient, type PoolConfig } from 'pg';
import { deploymentContext, resolveDatabaseUrl, runtimeMayUse, type DatabaseMarker } from '@/server/core/deploy-policy';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
/** A transaction handle; services accept either and call `withTx` to guarantee atomicity. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __edmnPool?: Pool; __edmnDb?: DB; __edmnUrl?: string };

/** DATABASE_URL, or PREVIEW_DATABASE_URL in a preview (which never reads the shared URLs) — see deploy-policy.ts. */
function databaseUrl(): string {
  return resolveDatabaseUrl(process.env);
}

/**
 * Preview runtime guard: before the FIRST connection is handed out (to queries, transactions and migrations alike),
 * the database must prove it is an explicitly initialised PREVIEW database. Anything else — the shared staging or
 * production database, an unmarked database — fails every connection of the process, so a preview can neither read
 * nor write it. Checked on a separate connection, outside the pool.
 */
let previewInitInProgress = false;
/**
 * Only scripts/preview-db-init.ts calls this, after proving the target database is EMPTY: it lets that one process
 * migrate the unmarked database before marking it PREVIEW. Deliberately not reachable from an environment variable.
 */
export function allowUnmarkedPreviewDatabaseForInit() {
  previewInitInProgress = true;
}

class PreviewGuardedPool extends Pool {
  private verified: Promise<void> | null = null;
  constructor(private readonly guardConfig: PoolConfig) {
    super(guardConfig);
  }

  private verify(): Promise<void> {
    this.verified ??= (async () => {
      const c = new Client({ connectionString: this.guardConfig.connectionString, connectionTimeoutMillis: this.guardConfig.connectionTimeoutMillis });
      await c.connect();
      let marker: DatabaseMarker = null;
      try {
        const r = await c.query<{ e: DatabaseMarker }>('select environment as e from deployment_environment where id');
        marker = r.rows[0]?.e ?? null;
      } catch {
        marker = null; // not migrated / not initialised
      } finally {
        await c.end().catch(() => undefined);
      }
      if (previewInitInProgress && marker === null) return;
      const ok = runtimeMayUse(marker);
      if (!ok.ok) throw new Error(`preview database refused: ${ok.reason}`);
    })().catch((e) => {
      this.verified = null; // re-checked on the next attempt; still refused unless the database is PREVIEW
      throw e;
    });
    return this.verified;
  }

  // pg-pool calls connect() for query() as well (callback form), so this guards every path.
  override connect(): Promise<PoolClient>;
  override connect(cb: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void): void;
  override connect(cb?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void): Promise<PoolClient> | void {
    const p = this.verify().then(() => super.connect());
    if (!cb) return p;
    p.then(
      (client) => cb(undefined, client, (release) => client.release(release as boolean | Error | undefined)),
      (err: Error) => cb(err, undefined, () => undefined),
    );
  }
}

export function getPool(): Pool {
  const url = databaseUrl();
  if (!globalForDb.__edmnPool || globalForDb.__edmnUrl !== url) {
    const PoolClass = deploymentContext(process.env) === 'PREVIEW' ? PreviewGuardedPool : Pool;
    globalForDb.__edmnPool = new PoolClass({
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
