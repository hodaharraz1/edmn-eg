import { createHash } from 'node:crypto';

/**
 * PKG-PERF-01 v3 (P4): cached result counts for catalog search.
 *
 * The exact `count(*)` over the full filter set is the second-most-expensive query on every search page, and it
 * returns the same number for every page of the same filter set. So the first page computes it once and every
 * subsequent page (cursor or offset) of the same filters reuses it for a short TTL. Counts can lag reality by up to
 * `TTL_MS`; the items themselves are always live. Per-instance memory only (same model as the rate-limit store when
 * REDIS_URL is absent): worst case under multiple instances is a few extra count queries, never a wrong page.
 */

const TTL_MS = 60_000;
const MAX_KEYS = 1_000;

const cache = new Map<string, { total: number; expiresAt: number }>();

/** Stable key for a filter set: everything that changes the count, nothing that only changes the page. */
export function countCacheKey(filterFingerprint: Record<string, unknown>): string {
  // Top-level keys in sorted order; nested objects (e.g. attribute filters) keep their own keys.
  const ordered = Object.fromEntries(Object.entries(filterFingerprint).sort(([a], [b]) => (a < b ? -1 : 1)));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('base64url');
}

export function cachedCount(key: string, now = Date.now()): number | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return hit.total;
}

export function storeCount(key: string, total: number, now = Date.now()): void {
  if (cache.size >= MAX_KEYS) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
    // Still full: drop the oldest quarter so the map stays bounded under filter churn.
    if (cache.size >= MAX_KEYS) {
      const keep = [...cache.entries()].sort((a, b) => b[1].expiresAt - a[1].expiresAt).slice(0, Math.floor((MAX_KEYS * 3) / 4));
      cache.clear();
      for (const [k, v] of keep) cache.set(k, v);
    }
  }
  cache.set(key, { total, expiresAt: now + TTL_MS });
}

/** Test hook. */
export function clearCountCache(): void {
  cache.clear();
}
