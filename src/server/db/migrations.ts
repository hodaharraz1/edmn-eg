import { createHash } from 'node:crypto';
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

/**
 * What the database says was applied. `null` = the bookkeeping table does not exist (a database that was never
 * migrated). Any OTHER failure — unreachable server, missing privilege — is thrown, never read as "fresh": a
 * connection problem must not make every migration look pending.
 */
export async function appliedMigrations(): Promise<{ hash: string; when: number }[] | null> {
  const db = getDb();
  const t = await db.execute<{ t: string | null }>(sql`select to_regclass('drizzle.__drizzle_migrations')::text t`);
  if (!t.rows[0]?.t) return null;
  const r = await db.execute<{ hash: string; created_at: string }>(sql`select hash, created_at::text from drizzle.__drizzle_migrations`);
  return r.rows.map((x) => ({ hash: x.hash, when: Number(x.created_at) }));
}

const fileHash = (folder: string, tag: string) => createHash('sha256').update(readFileSync(path.join(folder, `${tag}.sql`)).toString()).digest('hex');

/** Migrations not yet applied to the database (journal order), by the migrator's own bookkeeping (created_at = when). */
export async function pendingMigrations(folder = FOLDER): Promise<JournalEntry[]> {
  const applied = await appliedMigrations();
  const newest = applied?.length ? Math.max(...applied.map((a) => a.when)) : 0;
  return journal(folder).filter((e) => e.when > newest);
}

/**
 * History guard. Drizzle applies only journal entries NEWER than the newest applied one, so it would otherwise
 *   (a) silently skip an entry that sorts before it and was never applied (a branch merged after newer migrations
 *       were already applied — e.g. mobile 0020 against a database holding Marketplace 0020/0021), and
 *   (b) happily run on a database whose history this code does not know (applied migrations absent from the
 *       journal: another branch, or a newer release — never "upgrade" such a database with older code).
 * An entry counts as applied when its journal timestamp OR its SQL hash is recorded.
 */
export async function historyProblems(folder = FOLDER): Promise<string[]> {
  const applied = await appliedMigrations();
  if (!applied?.length) return [];
  const entries = journal(folder);
  const whens = new Set(applied.map((a) => a.when));
  const hashes = new Set(applied.map((a) => a.hash));
  const newest = Math.max(...whens);
  const problems: string[] = [];
  for (const e of entries) {
    if (e.when <= newest && !whens.has(e.when) && !hashes.has(fileHash(folder, e.tag))) {
      problems.push(`${e.tag}: sorts before the newest applied migration but was never applied — it would be skipped silently. Regenerate it after the current history; never apply out of order.`);
    }
  }
  const knownWhens = new Set(entries.map((e) => e.when));
  let knownHashes: Set<string> | null = null;
  for (const a of applied) {
    if (knownWhens.has(a.when)) continue;
    knownHashes ??= new Set(entries.map((e) => fileHash(folder, e.tag)));
    if (!knownHashes.has(a.hash)) problems.push(`the database has an applied migration (journal time ${a.when}) that this code does not contain — incompatible history (another branch or a newer release)`);
  }
  return problems;
}

export async function preflight(folder = FOLDER, opts: { initPreview?: boolean } = {}): Promise<{ pending: string[]; problems: string[] }> {
  const problems: string[] = [];
  const runtime = runtimeEnvironment();
  const db = getDb();
  // Errors here (unreachable database, missing privilege) propagate: they are never mistaken for a fresh database.
  const hasMarkerTable = !!(await db.execute<{ t: string | null }>(sql`select to_regclass('public.deployment_environment')::text t`)).rows[0]?.t;
  if (hasMarkerTable) {
    const r = await db.execute<{ e: string | null }>(sql`select (select environment from deployment_environment where id) e`);
    const marker = (r.rows[0]?.e ?? null) as DatabaseMarker;
    // A preview may only migrate a database explicitly initialised as PREVIEW (deploy-policy.ts).
    const c = deploymentContext() === 'PREVIEW' ? runtimeMayUse(marker) : databaseCompatible(runtime, marker);
    // A first-time PRODUCTION database is unmarked until this very run marks it.
    if (!c.ok && !(runtime === 'PRODUCTION' && marker === null) && !(opts.initPreview && marker === null)) problems.push(c.reason!);
  } else if (deploymentContext() === 'PREVIEW' && !opts.initPreview) {
    // Never-migrated database: a preview migrates it only through the explicit, emptiness-checked initialisation.
    problems.push('this database was never initialised as PREVIEW (run scripts/preview-db-init.ts on an EMPTY database)');
  }
  problems.push(...(await historyProblems(folder)));
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
