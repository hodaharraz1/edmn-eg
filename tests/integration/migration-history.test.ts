import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { appliedMigrations, historyProblems, journal, pendingMigrations, preflight } from '@/server/db/migrations';

/**
 * Migration history guard: nothing is silently skipped, an unknown database history is refused, and a database that
 * cannot be read is an ERROR — never mistaken for a fresh database.
 */
describe('migration history guard', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'edmn-migrations-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const copyFolder = () => {
    cpSync(path.resolve('drizzle'), dir, { recursive: true });
    return path.join(dir, 'meta', '_journal.json');
  };

  it('the real history is linear, fully applied and has no problems; mobile migrations come after B1/B2', async () => {
    const tags = journal().map((e) => e.tag);
    const at = (t: string) => tags.indexOf(t);
    expect(at('0020_b1_financial_fail_closed')).toBeGreaterThan(0);
    expect(at('0021_b2_post_release_holds')).toBe(at('0020_b1_financial_fail_closed') + 1);
    expect(at('0022_mobile_api_foundation')).toBe(at('0021_b2_post_release_holds') + 1);
    expect(at('0023_preview_database_marker')).toBe(at('0022_mobile_api_foundation') + 1);
    const whens = journal().map((e) => e.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(new Set(tags.map((t) => t.slice(0, 4))).size).toBe(tags.length); // no duplicate numbers
    expect((await appliedMigrations())!.length).toBe(tags.length);
    expect(await historyProblems()).toEqual([]);
    expect(await pendingMigrations()).toEqual([]);
    expect((await preflight()).problems).toEqual([]);
  });

  it('an older, never-applied migration (merged after newer ones were applied) is refused instead of skipped', async () => {
    const journalPath = copyFolder();
    const j = JSON.parse(readFileSync(journalPath, 'utf8'));
    const first = j.entries[0];
    j.entries.splice(1, 0, { idx: 999, version: first.version, when: first.when + 1, tag: '0000_zz_out_of_order', breakpoints: true });
    writeFileSync(journalPath, JSON.stringify(j));
    writeFileSync(path.join(dir, '0000_zz_out_of_order.sql'), 'CREATE TABLE "never_applied" ("id" integer);');
    expect(await pendingMigrations(dir)).toEqual([]); // drizzle alone would do nothing and report success
    const pf = await preflight(dir);
    expect(pf.problems.join('\n')).toMatch(/0000_zz_out_of_order: sorts before the newest applied migration but was never applied/);
  });

  it('a database holding migrations this code does not know is refused (incompatible history)', async () => {
    const journalPath = copyFolder();
    const j = JSON.parse(readFileSync(journalPath, 'utf8'));
    j.entries.pop(); // this "older code" lacks the newest migration the database already has
    writeFileSync(journalPath, JSON.stringify(j));
    expect((await preflight(dir)).problems.join('\n')).toMatch(/does not contain — incompatible history/);
  });

  it('an unreadable database is an error, not a fresh database', async () => {
    const real = process.env.DATABASE_URL!;
    await closeDb();
    process.env.DATABASE_URL = 'postgresql://nobody:x@127.0.0.1:1/none';
    process.env.DATABASE_CONNECT_TIMEOUT_MS = '1500';
    try {
      await expect(appliedMigrations()).rejects.toThrow();
      await expect(pendingMigrations()).rejects.toThrow();
      await expect(preflight()).rejects.toThrow();
    } finally {
      await closeDb();
      process.env.DATABASE_URL = real;
      delete process.env.DATABASE_CONNECT_TIMEOUT_MS;
    }
    expect((await db.execute(sql`select 1 ok`)).rows).toHaveLength(1);
    // Missing privilege on the bookkeeping table is an error too.
    await db.execute(sql`do $$ begin if not exists (select 1 from pg_roles where rolname = 'edmn_noread') then create role edmn_noread; end if; end $$`);
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role edmn_noread`);
        await tx.execute(sql`select hash from drizzle.__drizzle_migrations`);
      }),
    ).rejects.toThrow();
  });
});
