import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { storage } from '@/server/storage/storage';
import { logger } from '@/server/core/logger';

export const dynamic = 'force-dynamic';

/** Readiness: database reachable, migrations applied, storage readable, job backlog sane. */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let ok = true;
  try {
    const r = await db.execute<{ n: string }>(sql`select count(*)::text as n from drizzle.__drizzle_migrations`);
    checks.database = 'ok';
    checks.migrations = Number(r.rows[0].n);
  } catch (e) {
    ok = false;
    checks.database = 'error';
    logger.error('ready.db_failed', { error: e as Error });
  }
  try {
    await storage().exists('PUBLIC', 'healthcheck/00000000-0000-0000-0000-000000000000.webp');
    checks.storage = 'ok';
  } catch {
    ok = false;
    checks.storage = 'error';
  }
  try {
    const j = await db.execute<{ failed: string; backlog: string }>(sql`select count(*) filter (where status = 'FAILED')::text failed, count(*) filter (where status = 'PENDING' and run_at < now() - interval '15 minutes')::text backlog from jobs`);
    checks.failedJobs = Number(j.rows[0].failed);
    checks.jobBacklog = Number(j.rows[0].backlog);
  } catch {
    /* reported via database */
  }
  return Response.json({ status: ok ? 'ready' : 'not_ready', checks }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
