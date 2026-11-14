import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { sha256 } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import { idempotencyKeys } from '@/server/db/schema';
import { ApiError } from './errors';

/**
 * Generic request idempotency for mobile mutations (Phase 1). Mobile networks drop responses; a client that retries
 * with the same `Idempotency-Key` gets the ORIGINAL result instead of a second side effect.
 *
 *   scope   "<user or installation>:<METHOD> <concrete path>" — a key is only meaningful for one caller and one URL
 *   hash    SHA-256 of the canonical request (path, query, body); the same key with a different request is refused
 *   states  IN_PROGRESS (a concurrent retry gets 409 idempotency_in_progress) → COMPLETED (response replayed for 24h)
 *   errors  an error response is NOT stored: the row is removed so the client can correct and retry
 *
 * Never used on endpoints whose response carries credentials (login, register, refresh): a stored token would outlive
 * the request. Domain-level keys (checkout keys, ledger idempotency keys) remain the authoritative protection for
 * financial effects; this layer is the transport-level complement.
 */
const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const IDEMPOTENCY_REPLAY_HOURS = 24;
const IN_PROGRESS_LEASE_SECONDS = 60;

export interface IdemClaim {
  scope: string;
  key: string;
}

export type IdemOutcome = { kind: 'proceed'; claim: IdemClaim } | { kind: 'replay'; status: number; body: unknown };

export function canonicalRequestHash(method: string, url: URL, body: unknown): string {
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v;
  const q = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sha256(JSON.stringify([method, url.pathname, q, sortKeys(body ?? null)]));
}

export async function beginIdempotent(req: Request, owner: string, body: unknown): Promise<IdemOutcome> {
  const key = req.headers.get('idempotency-key');
  if (!key) throw new ApiError('idempotency_key_required');
  if (!KEY_RE.test(key)) throw new ApiError('validation_failed', undefined, { issues: [{ path: 'Idempotency-Key', code: 'invalid_format' }] });
  const url = new URL(req.url);
  const scope = `api:${owner}:${req.method} ${url.pathname}`;
  const requestHash = canonicalRequestHash(req.method, url, body);
  const lease = new Date(Date.now() + IN_PROGRESS_LEASE_SECONDS * 1000);
  const inserted = await db
    .insert(idempotencyKeys)
    .values({ scope, key, requestHash, status: 'IN_PROGRESS', expiresAt: lease })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted.length) return { kind: 'proceed', claim: { scope, key } };

  const [row] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  if (!row) return beginIdempotent(req, owner, body); // removed between the two statements (failed attempt) — claim again
  if (row.requestHash !== requestHash) throw new ApiError('idempotency_key_reused');
  if (row.status === 'COMPLETED' && row.responseStatus != null) return { kind: 'replay', status: row.responseStatus, body: row.responseBody };
  // IN_PROGRESS: a crashed attempt whose lease expired can be taken over; a live one cannot.
  if (row.expiresAt && row.expiresAt < new Date()) {
    const took = await db
      .update(idempotencyKeys)
      .set({ expiresAt: lease })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key), eq(idempotencyKeys.status, 'IN_PROGRESS'), lt(idempotencyKeys.expiresAt, new Date())))
      .returning({ key: idempotencyKeys.key });
    if (took.length) return { kind: 'proceed', claim: { scope, key } };
  }
  throw new ApiError('idempotency_in_progress', undefined, { retryAfterSeconds: 2 });
}

export async function completeIdempotent(claim: IdemClaim, status: number, body: unknown) {
  await db
    .update(idempotencyKeys)
    .set({ status: 'COMPLETED', responseStatus: status, responseBody: body ?? null, expiresAt: new Date(Date.now() + IDEMPOTENCY_REPLAY_HOURS * 3600_000) })
    .where(and(eq(idempotencyKeys.scope, claim.scope), eq(idempotencyKeys.key, claim.key)));
}

export async function abandonIdempotent(claim: IdemClaim) {
  await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, claim.scope), eq(idempotencyKeys.key, claim.key), eq(idempotencyKeys.status, 'IN_PROGRESS')));
}

/** Worker job: drop expired API idempotency rows. Legacy domain keys (status NULL) are never touched. */
export async function pruneApiIdempotencyKeys(): Promise<number> {
  const r = await db
    .delete(idempotencyKeys)
    .where(and(isNotNull(idempotencyKeys.status), lt(idempotencyKeys.expiresAt, sql`now() - interval '1 hour'`)))
    .returning({ key: idempotencyKeys.key });
  return r.length;
}
