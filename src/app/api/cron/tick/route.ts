import { timingSafeEqual } from 'node:crypto';
import { recoverStuckJobs } from '@/server/jobs/worker';
import { runTick } from '@/server/jobs/tick';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scheduled background work for hosts without a long-running worker.
 *   callers   Vercel Cron (GET, `Authorization: Bearer <CRON_SECRET>` added by Vercel) or an external scheduler
 *             (GET or POST with the same header). Without CRON_SECRET the endpoint does not exist (404).
 *   cadence   DUE-BASED: each schedule runs only when its own interval has elapsed (10 % jitter tolerance), under
 *             its database lease — so a daily cron runs everything once, a 1-minute cron keeps every job on time,
 *             and duplicate / overlapping invocations never run a job twice. A missed invocation is recovered by
 *             the next one (overdue jobs are simply due).
 *   safety    jobs never move money: release / refund / payout stay human-approved (Maker/Checker).
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function tick(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'not found' }, { status: 404 });
  await recoverStuckJobs();
  const res = await runTick({ dueRatio: 0.9, budgetMs: 45_000 });
  return Response.json({ ok: true, ...res }, { headers: { 'cache-control': 'no-store' } });
}

export const GET = tick;
export const POST = tick;
