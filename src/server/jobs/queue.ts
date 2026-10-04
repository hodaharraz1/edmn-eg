import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobs } from '@/server/db/schema';

export async function enqueueJob(
  tx: DbOrTx,
  type: string,
  payload: Record<string, unknown> = {},
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<void> {
  const q = tx.insert(jobs).values({
    type,
    payload,
    runAt: opts.runAt ?? new Date(),
    dedupeKey: opts.dedupeKey ?? null,
    maxAttempts: opts.maxAttempts ?? 5,
  });
  if (opts.dedupeKey) {
    // A pending job with the same dedupe key already exists → nothing to do.
    await q.onConflictDoNothing({ target: jobs.dedupeKey, where: sql`${jobs.dedupeKey} is not null` });
  } else {
    await q;
  }
}
