import { inArray } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { systemSettings } from '@/server/db/schema';

/**
 * Put shared settings back to their DEFAULT (no row = the schema default) at the end of a test file:
 *   afterAll(() => resetSettings('orders.codEnabled', 'orders.codFee'));
 * Only the keys a file itself changed should be listed. A global net (settings-isolation-setup.ts) also restores the whole
 * table after each file, so a failing test cannot leak a flag into the next file.
 */
export async function resetSettings(...keys: string[]) {
  if (keys.length) await db.delete(systemSettings).where(inArray(systemSettings.key, keys));
}
