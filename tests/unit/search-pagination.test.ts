import { describe, expect, it } from 'vitest';
import { cachedCount, clearCountCache, countCacheKey, storeCount } from '@/server/modules/catalog/count-cache';
import { cursorKeysFromRow, decodeCursor, encodeCursor, keysetCondition, searchOrderBy } from '@/server/modules/catalog/search-cursor';

/** PKG-PERF-01 v3 (P4): keyset cursor + cached count — pure-logic checks, no database needed. */

describe('P4 — search cursor', () => {
  it('round-trips keys, id and filter fingerprint', () => {
    const c = encodeCursor('fh-1', [42, true, '2026-11-27T10:00:00.000Z'], 'prod-9');
    expect(decodeCursor(c)).toEqual({ fh: 'fh-1', keys: [42, true, '2026-11-27T10:00:00.000Z'], id: 'prod-9' });
  });

  it('rejects garbage and wrong-version cursors instead of paging the wrong set', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('{"v":99,"fh":"x","keys":[],"id":"y"}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"v":1,"fh":"x","keys":[{}],"id":"y"}').toString('base64url'))).toBeNull();
  });

  it('builds one ORDER BY term per key plus the id tiebreak, in the sort direction', () => {
    for (const [sort, terms] of [
      ['best_selling', 2],
      ['top_rated', 3],
      ['newest', 2],
      ['price_asc', 2],
      ['price_desc', 2],
      ['recommended', 4], // in-stock flag, score, publishedAt, id (no rank without q)
    ] as const) {
      const orderBy = searchOrderBy({ sort }, '', null);
      expect(orderBy).toHaveLength(terms);
    }
  });

  it('the keyset condition has one OR branch per key', () => {
    const cursor = { fh: 'fh', keys: [4.5, 12], id: 'prod-1' };
    const cond = keysetCondition({ sort: 'top_rated' }, '', null, cursor);
    expect(cond).toBeTruthy();
    // A key count that does not match the sort yields no condition (caller rejects the cursor).
    expect(keysetCondition({ sort: 'top_rated' }, '', null, { fh: 'fh', keys: [1], id: 'x' })).toBeNull();
  });

  it('reads cursor keys back from a selected row in order', () => {
    expect(cursorKeysFromRow({ __k0: 7, __k1: false, __k2: new Date('2026-11-27T10:00:00.000Z'), id: 'p' })).toEqual([7, false, '2026-11-27T10:00:00.000Z']);
  });
});

describe('P4 — cached count', () => {
  it('serves the stored total within the TTL and forgets it after', () => {
    clearCountCache();
    const key = countCacheKey({ q: 'ساعة', sort: 'newest' });
    expect(cachedCount(key)).toBeNull();
    storeCount(key, 1234);
    expect(cachedCount(key)).toBe(1234);
    expect(cachedCount(key, Date.now() + 61_000)).toBeNull();
  });

  it('the key ignores key order and changes with the filters', () => {
    expect(countCacheKey({ a: 1, b: 2 })).toBe(countCacheKey({ b: 2, a: 1 }));
    expect(countCacheKey({ a: 1 })).not.toBe(countCacheKey({ a: 2 }));
  });
});
