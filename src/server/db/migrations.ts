import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { deploymentContext, runtimeMayUse, type DatabaseMarker } from '@/server/core/deploy-policy';
import { databaseCompatible, runtimeEnvironment } from '@/server/core/runtime-env';
import { getDb, getPool } from './client';
import { environmentMarker, markDeploymentEnvironment } from './environment';

/**
 * SAFE MIGRATION RUNNER (Batch 2).
 *   1. Preflight: the target database's environment marker must be compatible with this deployment BEFORE any
 *      DDL runs (a staging build pointed at a production database stops here, untouched).
 *   2. Preflight: pending migrations are scanned for destructive statements (DROP TABLE/COLUMN, TRUNCATE,
 *      DELETE FROM, column type change, RENAME). EDMN migrations are expand → migrate → contract: a contract
 *      step needs an explicit `-- edmn:allow-destructive: <reason>` line in its file (reviewed change).
 *   3. One migrator at a time: a session advisory lock on a dedicated DIRECT connection (DATABASE_URL_UNPOOLED);
 *      a second concurrent deploy waits up to lockTimeoutMs and then fails without touching the schema.
 */
export const MIGRATION_LOCK_KEY = 'edmn:migrations';
const FOLDER = path.resolve('drizzle');

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

export function journal(folder = FOLDER): JournalEntry[] {
  return (JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] }).entries;
}

const DESTRUCTIVE: { re: RegExp; what: string }[] = [
  { re: /^DROP\s+(TABLE|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i, what: 'DROP TABLE/SCHEMA/TYPE/VIEW' },
  { re: /^TRUNCATE\b/i, what: 'TRUNCATE' },
  { re: /^DELETE\s+FROM\b/i, what: 'DELETE FROM' },
  { re: /^ALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i, what: 'DROP COLUMN' },
  { re: /^ALTER\s+TABLE\b[\s\S]*\bALTER\s+COLUMN\b[\s\S]*\b(SET\s+DATA\s+)?TYPE\b/i, what: 'column type change' },
  { re: /^ALTER\s+TABLE\b[\s\S]*\bRENAME\b/i, what: 'RENAME' },
];

/** Destructive statements of one migration file (empty = additive). Function bodies are not statements. */
export function destructiveStatements(sqlText: string): string[] {
  if (/^--\s*edmn:allow-destructive:\s*\S+/m.test(sqlText)) return [];
  const found: string[] = [];
  for (const raw of sqlText.split('--> statement-breakpoint')) {
    const stmt = raw
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n')
      .trim();
    if (!stmt || /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(stmt)) continue;
    for (const d of DESTRUCTIVE) if (d.re.test(stmt)) found.push(`${d.what}: ${stmt.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  return found;
}

/** Migrations not yet applied to the database (journal order), by the migrator's own bookkeeping (created_at = when). */
export async function pendingMigrations(folder = FOLDER): Promise<JournalEntry[]> {
  const db = getDb();
  let applied = 0;
  try {
    const r = await db.execute<{ last: string | null }>(sql`select max(created_at)::text last from drizzle.__drizzle_migrations`);
    applied = Number(r.rows[0]?.last ?? 0);
  } catch {
    applied = 0; // fresh database
  }
  return journal(folder).filter((e) => e.when > applied);
}

export async function preflight(folder = FOLDER, opts: { initPreview?: boolean } = {}): Promise<{ pending: string[]; problems: string[] }> {
  const problems: string[] = [];
  const runtime = runtimeEnvironment();
  try {
    const r = await getDb().execute<{ e: string | null }>(sql`select (select environment from deployment_environment where id) e`);
    const marker = (r.rows[0]?.e ?? null) as DatabaseMarker;
    // A preview may only migrate a database explicitly initialised as PREVIEW (deploy-policy.ts).
    const c = deploymentContext() === 'PREVIEW' ? runtimeMayUse(marker) : databaseCompatible(runtime, marker);
    // A first-time PRODUCTION database is unmarked until this very run marks it.
    if (!c.ok && !(runtime === 'PRODUCTION' && marker === null) && !(opts.initPreview && marker === null)) problems.push(c.reason!);
  } catch {
    // Fresh database: nothing marked yet. A preview never migrates an unmarked database unless it is the explicit,
    // emptiness-checked initialisation (scripts/preview-db-init.ts).
    if (deploymentContext() === 'PREVIEW' && !opts.initPreview) problems.push('this database was never initialised as PREVIEW (run scripts/preview-db-init.ts on an EMPTY database)');
  }
  const pending = await pendingMigrations(folder);
  for (const p of pending) {
    const text = readFileSync(path.join(folder, `${p.tag}.sql`), 'utf8');
    for (const d of destructiveStatements(text)) problems.push(`${p.tag}: ${d}`);
  }
  return { pending: pending.map((p) => p.tag), problems };
}

export class MigrationLockTimeout extends Error {
  constructor() {
    super('another migration holds the migration lock');
    this.name = 'MigrationLockTimeout';
  }
}

/** Runs `fn` while holding the cluster-wide migration lock on a dedicated session. */
export async function withMigrationLock<T>(fn: () => Promise<T>, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<T> {
  const client = await getPool().connect();
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  try {
    for (;;) {
      const r = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) ok', [MIGRATION_LOCK_KEY]);
      if (r.rows[0].ok) break;
      if (Date.now() >= deadline) throw new MigrationLockTimeout();
      await new Promise((res) => setTimeout(res, opts.pollMs ?? 1000));
    }
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function runMigrations(opts: { folder?: string; lockTimeoutMs?: number; log?: (m: string) => void; initPreview?: boolean } = {}) {
  const log = opts.log ?? (() => {});
  const folder = opts.folder ?? FOLDER;
  return withMigrationLock(async () => {
    const pf = await preflight(folder, { initPreview: opts.initPreview });
    if (pf.problems.length) throw new Error(`migration preflight refused:\n${pf.problems.join('\n')}`);
    log(`preflight ok (${pf.pending.length} pending: ${pf.pending.join(', ') || 'none'})`);
    await migrate(getDb(), { migrationsFolder: folder });
    const marked = await markDeploymentEnvironment(getDb(), environmentMarker());
    return { applied: pf.pending, marked };
  }, { timeoutMs: opts.lockTimeoutMs });
}
