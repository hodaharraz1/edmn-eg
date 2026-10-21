import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { keyCheckValue, primaryKeyId } from '@/server/core/crypto';
import { env } from '@/server/core/env';
import { logger } from '@/server/core/logger';
import { deploymentContext, runtimeMayUse } from '@/server/core/deploy-policy';
import { databaseCompatible, runtimeEnvironment, type DatabaseMarker, type RuntimeEnvironment } from '@/server/core/runtime-env';
import { db, type DbOrTx } from './client';
import { secretCheckValue } from '@/server/core/known-nonprod';

/**
 * ENVIRONMENT FINGERPRINT (Batch 2). A runtime proves it is wired to resources of its own kind:
 *   database   deployment_environment marker compatible with the runtime (see databaseCompatible)
 *   storage    local disk carries a marker file of the same kind; the database driver shares the DB marker
 *   key        the primary encryption key's check value matches the one recorded for this environment
 * A violation is fail-closed: money movements are refused (assertFinancialSafety) and readiness reports 503.
 */
export interface FingerprintResult {
  status: 'OK' | 'VIOLATION' | 'UNVERIFIED';
  runtime: RuntimeEnvironment;
  database: DatabaseMarker | 'UNREACHABLE';
  storage: string;
  key: 'RECORDED' | 'MATCH' | 'MISMATCH' | 'NOT_TRACKED';
  reasons: string[];
  checkedAt: string;
}

const STORAGE_MARKER = '.edmn-environment';

async function databaseMarker(conn: DbOrTx): Promise<DatabaseMarker> {
  const r = await conn.execute<{ e: string | null }>(sql`select (select environment from deployment_environment where id) e`);
  return (r.rows[0]?.e ?? null) as DatabaseMarker;
}

/** Local-disk storage marker: written once, then must match. The database driver lives in the (checked) database. */
async function storageFingerprint(runtime: RuntimeEnvironment, raw: Record<string, string | undefined>): Promise<{ storage: string; reason?: string }> {
  const driver = raw.STORAGE_DRIVER || 'local';
  if (driver === 'database') return { storage: 'database (same fingerprint as the database)' };
  // No literal path here: a literal fallback makes the bundler trace the whole project into the function.
  const root = path.resolve(raw.STORAGE_LOCAL_ROOT || env().STORAGE_LOCAL_ROOT);
  const file = path.join(root, STORAGE_MARKER);
  let current: string | null = null;
  try {
    current = (await readFile(file, 'utf8')).trim();
  } catch {
    /* absent */
  }
  // Only a hosted runtime (STAGING / PRODUCTION) claims an unmarked storage root. Local tooling (seeds, tests,
  // scripts) may use a root but never claims it — and is refused by a root a hosted environment already claimed.
  if (!current) {
    if (runtime !== 'STAGING' && runtime !== 'PRODUCTION') return { storage: 'local:UNCLAIMED' };
    try {
      await mkdir(root, { recursive: true });
      await writeFile(file, runtime, { flag: 'wx' });
    } catch {
      /* concurrent writer or read-only root */
    }
    current = (await readFile(file, 'utf8').catch(() => runtime)).trim();
  }
  const ok = current === runtime;
  return ok ? { storage: `local:${current}` } : { storage: `local:${current}`, reason: `storage root is marked ${current}, runtime is ${runtime}` };
}

/**
 * Check values of the other environment-bound secrets (evidence only, never compared here): they feed the
 * non-production denylist production checks at boot (src/server/core/known-nonprod.ts). secret_fingerprints is
 * append-only (no UPDATE): the first recording stands; a later rotation is recorded under the key-id process.
 */
export async function recordSecretCheckValues(conn: DbOrTx, runtime: RuntimeEnvironment, raw: Record<string, string | undefined> = process.env) {
  for (const n of ['SESSION_SECRET', 'CRON_SECRET'] as const) {
    const v = raw[n];
    if (v) await conn.execute(sql`insert into secret_fingerprints (name, kcv, environment) values (${n}, ${secretCheckValue(n, v)}, ${runtime}) on conflict (name) do nothing`);
  }
}

/** Records (first hosted boot) or compares the primary key's check value. Never stores or logs the key. */
async function keyFingerprint(conn: DbOrTx, runtime: RuntimeEnvironment): Promise<{ key: FingerprintResult['key']; reason?: string }> {
  if (runtime !== 'STAGING' && runtime !== 'PRODUCTION') return { key: 'NOT_TRACKED' };
  const name = `DATA_ENCRYPTION_KEY:${primaryKeyId()}`;
  const kcv = keyCheckValue();
  await conn.execute(sql`insert into secret_fingerprints (name, kcv, environment) values (${name}, ${kcv}, ${runtime}) on conflict (name) do nothing`);
  const r = await conn.execute<{ kcv: string; environment: string }>(sql`select kcv, environment from secret_fingerprints where name = ${name}`);
  const row = r.rows[0];
  await recordSecretCheckValues(conn, runtime);
  if (row.environment !== runtime) return { key: 'MISMATCH', reason: `encryption key fingerprint was recorded by ${row.environment}` };
  if (row.kcv !== kcv) return { key: 'MISMATCH', reason: `primary encryption key (${primaryKeyId()}) differs from the recorded key: rotate with a new key id, never in place` };
  return { key: 'MATCH' };
}

export async function verifyRuntimeFingerprint(conn: DbOrTx = db, raw: Record<string, string | undefined> = process.env): Promise<FingerprintResult> {
  const runtime = runtimeEnvironment(raw);
  const reasons: string[] = [];
  const out: FingerprintResult = { status: 'OK', runtime, database: null, storage: '', key: 'NOT_TRACKED', reasons, checkedAt: new Date().toISOString() };
  try {
    out.database = await databaseMarker(conn);
  } catch {
    out.database = 'UNREACHABLE';
    out.status = 'UNVERIFIED';
    reasons.push('database unreachable or not migrated');
    return out;
  }
  const dbc = deploymentContext(raw) === 'PREVIEW' ? runtimeMayUse(out.database as DatabaseMarker, raw) : databaseCompatible(runtime, out.database);
  if (!dbc.ok) reasons.push(dbc.reason!);
  const st = await storageFingerprint(runtime, raw);
  out.storage = st.storage;
  if (st.reason) reasons.push(st.reason);
  if (dbc.ok) {
    try {
      const k = await keyFingerprint(conn, runtime);
      out.key = k.key;
      if (k.reason) reasons.push(k.reason);
    } catch {
      out.status = 'UNVERIFIED';
      reasons.push('key fingerprint table unavailable (migration pending)');
    }
  }
  // Any real mismatch wins over "could not verify".
  if (reasons.some((r) => !/unreachable|unavailable/.test(r))) out.status = 'VIOLATION';
  return out;
}

/* ─────────── process-wide state (set at boot by instrumentation, refreshed by the money gate) ─────────── */

const g = globalThis as unknown as { __edmnFingerprint?: FingerprintResult };
const TTL_MS = 5 * 60_000;

export function currentFingerprint(): FingerprintResult | null {
  return g.__edmnFingerprint ?? null;
}
export function resetFingerprintForTests() {
  g.__edmnFingerprint = undefined;
}

/** Verifies (cached for 5 minutes) and remembers the result. A VIOLATION is sticky for the process lifetime. */
export async function ensureFingerprint(conn: DbOrTx = db): Promise<FingerprintResult> {
  const cur = g.__edmnFingerprint;
  if (cur?.status === 'VIOLATION') return cur;
  if (cur && cur.status === 'OK' && Date.now() - Date.parse(cur.checkedAt) < TTL_MS) return cur;
  const res = await verifyRuntimeFingerprint(conn);
  g.__edmnFingerprint = res;
  if (res.status === 'VIOLATION') logger.error('environment.fingerprint_violation', { runtime: res.runtime, database: res.database, storage: res.storage, key: res.key, reasons: res.reasons });
  return res;
}
