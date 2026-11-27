import { readinessCached } from '@/server/ops/health';

export const dynamic = 'force-dynamic';

/**
 * Readiness: database reachable, migrations applied, environment fingerprint, configuration policy, storage.
 * Public: status words only. The detailed view is the Admin/Ops deep health page (/admin/ops).
 */
export async function GET() {
  const r = await readinessCached();
  // L9: a short shared cache (5 s) in front of the in-process memo, so probes cannot turn into DB load.
  return Response.json(
    { status: r.ready ? 'ready' : 'not_ready', checks: r.checks },
    { status: r.ready ? 200 : 503, headers: { 'cache-control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=25' } },
  );
}
