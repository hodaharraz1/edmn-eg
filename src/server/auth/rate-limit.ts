import { logger } from '@/server/core/logger';
import { DomainError } from '@/server/core/errors';
import { limitStore, MemoryLimitStore, type CounterReading } from '@/server/api/limit-store';

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

export interface CounterScan {
  /** Where the numbers came from: the shared Redis counters, or this server process only. */
  source: 'redis' | 'memory';
  /** false when the counters are per server instance (no REDIS_URL): other instances' attempts are not visible. */
  shared: boolean;
  /** true when Redis was configured but could not be read, so only this process's own counters are shown. */
  degraded: boolean;
  counters: CounterReading[];
}

/**
 * PKG-FOLLOWUP-02: the one way an admin screen or alert rule reads attempt counters. It asks the SAME store `hit()`
 * writes to (Redis, or process memory), never the old `rate_limits` table that PKG-PERF-01 stopped writing.
 */
export async function scanCounters(prefixes: string[], minCount: number, max = 100): Promise<CounterScan> {
  const store = limitStore();
  if (store.kind === 'redis') {
    let degraded = false;
    let main: CounterReading[] = [];
    try {
      main = await store.scan(prefixes, minCount, max);
    } catch (e) {
      degraded = true;
      logger.warn('rate_limit.scan_failed', { error: e as Error });
    }
    // Counters taken over by memory during a Redis outage are real attempts too.
    const local = await fallback.scan(prefixes, minCount, max);
    const merged = new Map<string, CounterReading>();
    for (const c of [...main, ...local]) {
      const prev = merged.get(c.key);
      if (!prev || c.count > prev.count) merged.set(c.key, c);
    }
    return { source: 'redis', shared: true, degraded, counters: [...merged.values()].sort((a, b) => b.count - a.count).slice(0, max) };
  }
  return { source: 'memory', shared: false, degraded: false, counters: await store.scan(prefixes, minCount, max) };
}
