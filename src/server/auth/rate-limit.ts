import { logger } from '@/server/core/logger';
import { DomainError } from '@/server/core/errors';
import { limitStore, MemoryLimitStore } from '@/server/api/limit-store';

/**
 * Fixed-window counter. PKG-PERF-01 (P1): no database write per request — the counter lives in Redis when
 * `REDIS_URL` is set and in process memory otherwise (see src/server/api/limit-store.ts). The signature and the
 * semantics are unchanged, so every existing caller keeps its exact limits and behaviour.
 * Returns true when the request is allowed.
 */
const fallback = new MemoryLimitStore(20_000);

export async function hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const store = limitStore();
  if (store.kind === 'redis') {
    try {
      return await store.hit(key, limit, windowSeconds);
    } catch (e) {
      // Availability over strictness: a limiter outage must not take the API down. Per-instance memory takes over.
      logger.warn('rate_limit.redis_failed', { error: e as Error });
      return fallback.hit(key, limit, windowSeconds);
    }
  }
  return store.hit(key, limit, windowSeconds);
}

export async function enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
  if (!(await hit(key, limit, windowSeconds))) {
    throw new DomainError('RATE_LIMITED', 'محاولات كتير. استنى شوية وجرّب تاني');
  }
}

/** Housekeeping for the in-memory store (Redis expires its own keys). Safe to call from the scheduler. */
export async function pruneRateLimits(): Promise<void> {
  await limitStore().prune();
  await fallback.prune();
}
