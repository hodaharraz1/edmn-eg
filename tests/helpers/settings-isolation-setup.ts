import { afterAll, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';

/**
 * Shared-setting isolation (Q3, PKG-FOLLOWUP-01). Every integration file shares one database and runs in sequence, so a
 * test that flips a setting (orders.codEnabled, wallet.topUpEnabled, notifications.devicePushEnabled, a kill switch ...)
 * and does not put it back changes what the NEXT file sees. This safety net snapshots `system_settings` before each
 * file and restores it exactly (rows added, changed or deleted by the file) after the file's own hooks have run.
 * Files should still close their own flags (see tests/helpers/settings.ts); this guarantees a failing test cannot leak.
 * Unit tests have no database: the net is a no-op for them.
 */
let snapshot: { key: string; value: unknown }[] | null = null;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    const { db } = await import('@/server/db/client');
    const r = await db.execute<{ key: string; value: unknown }>(sql`select key, value from system_settings`);
    snapshot = r.rows;
  } catch {
    snapshot = null; // no reachable database (a pure unit run): nothing to protect
  }
});

afterAll(async () => {
  if (!snapshot) return;
  const { db } = await import('@/server/db/client');
  await db.transaction(async (tx) => {
    // One JSON parameter (drizzle would spread a JS array into a row tuple, which cannot be cast to text[]).
    await tx.execute(sql`delete from system_settings where key not in (select jsonb_array_elements_text(${JSON.stringify(snapshot!.map((s) => s.key))}::jsonb))`);
    for (const s of snapshot!) {
      await tx.execute(sql`insert into system_settings (key, value) values (${s.key}, ${JSON.stringify(s.value)}::jsonb) on conflict (key) do update set value = excluded.value`);
    }
  });
  snapshot = null;
});
