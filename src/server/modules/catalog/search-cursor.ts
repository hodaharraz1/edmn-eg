import { sql, type SQL } from 'drizzle-orm';
import { products } from '@/server/db/schema';
import type { SearchQuery } from './search';

/**
 * PKG-PERF-01 v3 (P4): keyset (cursor) pagination for catalog search.
 *
 * Offset pagination forces PostgreSQL to sort and skip `page * pageSize` rows on every request, so page 50 of a
 * hot search costs 50 pages of work. A keyset cursor instead carries the sort-key values of the last row of the
 * previous page and asks only for rows strictly after them: every page costs one page of work, and rows inserted
 * while the shopper scrolls never duplicate or skip results.
 *
 * The cursor is bound to the filter set and sort that produced it (`fh` fingerprint): a cursor from a different
 * search is rejected instead of silently paging a different result set. The offset `page` parameter stays for
 * the web listing; the mobile API should prefer `cursor` for page 2+.
 */

const CURSOR_VERSION = 1;

/** One sort key: the SQL expression, its direction, and how to read the cursor value. */
interface KeySpec {
  expr: SQL;
  dir: 'asc' | 'desc';
}

const NEVER = sql`to_timestamp(0)`;

function keySpecs(query: SearchQuery, q: string, rank: SQL | null): KeySpec[] {
  const tsq = q ? searchTsQueryForCursor(q) : null;
  switch (query.sort) {
    case 'best_selling':
      return [{ expr: sql`${products.salesCount}`, dir: 'desc' }];
    case 'top_rated':
      return [
        { expr: sql`${products.ratingAvg}`, dir: 'desc' },
        { expr: sql`${products.ratingCount}`, dir: 'desc' },
      ];
    case 'newest':
      return [{ expr: sql`coalesce(${products.publishedAt}, ${NEVER})`, dir: 'desc' }];
    case 'price_asc':
      return [{ expr: sql`${products.minPrice}`, dir: 'asc' }];
    case 'price_desc':
      return [{ expr: sql`${products.minPrice}`, dir: 'desc' }];
    default:
      return [
        ...(rank && tsq ? [{ expr: rank, dir: 'desc' as const }] : []),
        { expr: sql`(${products.totalAvailable} > 0)`, dir: 'desc' },
        { expr: sql`(${products.ratingAvg}::numeric * ln(${products.ratingCount} + 2)) + ln(${products.salesCount} + 1)`, dir: 'desc' },
        { expr: sql`coalesce(${products.publishedAt}, ${NEVER})`, dir: 'desc' },
      ];
  }
}

// search.ts owns the canonical tsquery builder; duplicated here as a pure function so the cursor module stays
// import-cycle-free (search.ts imports this module for the WHERE builder).
function searchTsQueryForCursor(q: string) {
  const terms = q.split(' ').filter(Boolean).map((t) => t.replace(/[':&|!()*\\]/g, '')).filter(Boolean);
  return terms.map((t) => `${t}:*`).join(' & ');
}

export interface DecodedCursor {
  keys: (string | number | boolean)[];
  id: string;
  fh: string;
}

export function encodeCursor(fh: string, keys: (string | number | boolean)[], id: string): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, fh, keys, id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as DecodedCursor & { v?: number };
    if (raw.v !== CURSOR_VERSION || typeof raw.fh !== 'string' || typeof raw.id !== 'string' || !Array.isArray(raw.keys)) return null;
    if (!raw.keys.every((k) => ['string', 'number', 'boolean'].includes(typeof k))) return null;
    return { keys: raw.keys, id: raw.id, fh: raw.fh };
  } catch {
    return null;
  }
}

/**
 * The "strictly after the cursor row" condition for the ORDER BY of `searchProducts`. Mixed-direction sorts
 * (e.g. rating desc then id asc) are expanded into the equivalent OR chain, which handles each key in its own
 * direction — a row-wise `(a, b) < (x, y)` comparison cannot. NULL ordering is fixed by the same COALESCE the
 * ORDER BY uses, so equality is plain `=`.
 */
export function keysetCondition(query: SearchQuery, q: string, rank: SQL | null, cursor: DecodedCursor): SQL | null {
  const specs = [...keySpecs(query, q, rank), { expr: sql`${products.id}`, dir: 'asc' as const }];
  const values = [...cursor.keys, cursor.id];
  if (values.length !== specs.length) return null;
  const branches: SQL[] = [];
  for (let i = 0; i < specs.length; i++) {
    const parts: SQL[] = [];
    for (let j = 0; j < i; j++) parts.push(sql`${specs[j].expr} = ${cursorLiteral(specs[j], values[j])}`);
    parts.push(specs[i].dir === 'desc' ? sql`${specs[i].expr} < ${cursorLiteral(specs[i], values[i])}` : sql`${specs[i].expr} > ${cursorLiteral(specs[i], values[i])}`);
    branches.push(sql`(${sql.join(parts, sql` and `)})`);
  }
  return sql`(${sql.join(branches, sql` or `)})`;
}

/** Cursor values travel as JSON; booleans and timestamps need an explicit cast back to the column type. */
function cursorLiteral(spec: KeySpec, value: string | number | boolean): SQL {
  if (typeof value === 'boolean') return sql`${value ? 'true' : 'false'}::boolean`;
  return sql`${String(value)}`;
}

/**
 * The ORDER BY of `searchProducts`, hoisted so the keyset WHERE and the ORDER BY can never drift apart.
 * `publishedAt` is nullable; COALESCE pins NULLs to the end in descending sorts (previously they sorted first,
 * which would break cursor equality on the boundary row).
 */
export function searchOrderBy(query: SearchQuery, q: string, rank: SQL | null): SQL[] {
  return [...keySpecs(query, q, rank).map((k) => (k.dir === 'desc' ? sql`${k.expr} desc` : sql`${k.expr} asc`)), sql`${products.id} asc`];
}

/** Sort-key SELECT aliases (read back to build the next cursor). Names are stable and cursor-only. */
export function cursorKeySelect(query: SearchQuery, q: string, rank: SQL | null): Record<string, SQL> {
  const specs = keySpecs(query, q, rank);
  return Object.fromEntries(specs.map((s, i) => [`__k${i}`, s.expr]));
}

export function cursorKeysFromRow(row: Record<string, unknown>): (string | number | boolean)[] {
  const names = Object.keys(row)
    .filter((k) => /^__k\d+$/.test(k))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  return names.map((n) => {
    const v = row[n];
    if (typeof v === 'boolean') return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return v;
    return String(v);
  });
}
