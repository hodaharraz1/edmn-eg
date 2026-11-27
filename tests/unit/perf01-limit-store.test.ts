import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryLimitStore } from '@/server/api/limit-store';
import { hit, pruneRateLimits } from '@/server/auth/rate-limit';

/**
 * PKG-PERF-01 (P1) regression tests. On the pre-package code `src/server/api/limit-store.ts` does not exist (the
 * counter was a PostgreSQL upsert per request), so this file fails to import there; with the store in place the
 * contract below is what every caller relies on.
 */
describe('P1 — in-memory fixed-window counter', () => {
  let store: MemoryLimitStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
    store = new MemoryLimitStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows exactly `limit` requests in a window and refuses the next one', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push(await store.hit('k', 3, 60));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('resets when the window rolls over', async () => {
    for (let i = 0; i < 4; i++) await store.hit('k', 3, 60);
    expect(await store.hit('k', 3, 60)).toBe(false);
    vi.setSystemTime(new Date('2026-11-27T12:01:00Z'));
    expect(await store.hit('k', 3, 60)).toBe(true);
  });

  it('keeps independent keys independent', async () => {
    for (let i = 0; i < 3; i++) await store.hit('a', 3, 60);
    expect(await store.hit('a', 3, 60)).toBe(false);
    expect(await store.hit('b', 3, 60)).toBe(true);
  });

  it('prunes hour-old buckets', async () => {
    await store.hit('old', 3, 60);
    vi.setSystemTime(new Date('2026-11-27T13:30:00Z'));
    await store.prune();
    expect(store.size).toBe(0);
  });

  it('stays bounded under key rotation', async () => {
    const small = new MemoryLimitStore(10);
    for (let i = 0; i < 100; i += 1) {
      await small.hit(`rotating-${i}`, 5, 60);
    }
    expect(small.size).toBeLessThanOrEqual(10);
  });

  it('the shared hit() entry point never touches the database', async () => {
    // No DATABASE_URL is reachable in this environment; if hit() still wrote to PostgreSQL this call would hang or
    // throw instead of returning a verdict.
    const allowed = await hit(`perf01-${Math.random()}`, 2, 60);
    expect(allowed).toBe(true);
    await pruneRateLimits();
  });
});
