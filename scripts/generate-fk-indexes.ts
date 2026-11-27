import { readFileSync, writeFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/server/db/schema';

/**
 * PKG-PERF-01 v3 (P5): derive every missing foreign-key index from the drizzle schema itself.
 *
 * A join or a cascade by an unindexed FK column degrades to a sequential scan as tables grow. Instead of a
 * hand-written list that silently drifts from the schema, this script reads the actual table configs: every FK's
 * local columns must be the leftmost columns of some index; whatever is missing is emitted as
 * `CREATE INDEX IF NOT EXISTS` into scripts/sql/fk-indexes.sql.
 *
 * Deliberately NOT a drizzle migration: the file is expand-only, idempotent, and safe to apply by hand on any
 * environment (`psql "$DATABASE_URL" -f scripts/sql/fk-indexes.sql`). Re-run after schema changes:
 *   npm run db:fk-indexes
 * It exits non-zero when the committed SQL is stale, so CI can gate on it.
 */

/** Same mapping as drizzle's `casing: 'snake_case'` (see drizzle.config.ts): the TS key is the SQL name snake-cased. */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const out: string[] = [];
const seen = new Set<string>();
let fkTotal = 0;
let covered = 0;

for (const table of Object.values(schema)) {
  if (typeof table !== 'object' || table === null) continue;
  let config: ReturnType<typeof getTableConfig>;
  try {
    config = getTableConfig(table as never);
  } catch {
    continue; // not a pgTable (enums, relations helpers, types)
  }
  const indexPrefixes = config.indexes.map((ix) => ix.config.columns.map((c) => ('name' in c ? snake(c.name ?? '') : String(c))));
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    const localCols = ref.columns.map((c) => snake(c.name));
    if (!localCols.length) continue;
    fkTotal++;
    const isCovered = indexPrefixes.some((cols) => localCols.every((c, i) => cols[i] === c));
    if (isCovered) {
      covered++;
      continue;
    }
    const name = `idx_${config.name}_${localCols.join('_')}_fk`.toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(`create index if not exists ${name} on ${config.name} (${localCols.join(', ')});`);
  }
}

out.sort();
const sql = `-- PKG-PERF-01 v3 (P5): missing FK indexes, derived from src/server/db/schema by scripts/generate-fk-indexes.ts.
-- ${fkTotal} foreign keys scanned, ${covered} already covered by a leftmost index, ${out.length} indexes created here.
-- Expand-only and idempotent. Apply: psql "$DATABASE_URL" -f scripts/sql/fk-indexes.sql
-- Regenerate after schema changes: npm run db:fk-indexes

${out.join('\n')}
`;

const target = 'scripts/sql/fk-indexes.sql';
let current = '';
try {
  current = readFileSync(target, 'utf8');
} catch {
  current = '';
}
if (process.argv.includes('--check')) {
  if (current !== sql) {
    console.error(`${target} is stale — run: npm run db:fk-indexes`);
    process.exit(1);
  }
  console.log(`${target} is up to date (${out.length} indexes, ${fkTotal} FKs scanned)`);
} else {
  writeFileSync(target, sql);
  console.log(`wrote ${target}: ${out.length} indexes (${fkTotal} FKs scanned, ${covered} already covered)`);
}
