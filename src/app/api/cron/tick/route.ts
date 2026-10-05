import { timingSafeEqual } from 'node:crypto';
import { recoverStuckJobs } from '@/server/jobs/worker';
import { runTick } from '@/server/jobs/tick';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scheduled background work for hosts without a long-running worker (e.g. Vercel Cron).
 * Requires `Authorization: Bearer <CRON_SECRET>`; disabled when CRON_SECRET is unset.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  await recoverStuckJobs();
  const res = await runTick({ force: true, budgetMs: 45_000 });
  return Response.json({ ok: true, ...res }, { headers: { 'cache-control': 'no-store' } });
}
