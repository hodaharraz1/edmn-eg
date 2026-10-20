import { sql } from 'drizzle-orm';
import { DomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';

/**
 * Fixed-window counter stored in PostgreSQL so limits hold across multiple app instances.
 * Returns true when the request is allowed.
 */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const res = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  return Number(res.rows[0]?.count ?? 0) <= limit;
}

export async function enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
  if (!(await hit(key, limit, windowSeconds))) {
    throw new DomainError('RATE_LIMITED', 'محاولات كتير. استنى شوية وجرّب تاني');
  }
}

export async function pruneRateLimits(): Promise<void> {
  await db.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
}
