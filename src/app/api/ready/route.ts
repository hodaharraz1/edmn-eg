import { readiness } from '@/server/ops/health';

export const dynamic = 'force-dynamic';

/**
 * Readiness: database reachable, migrations applied, environment fingerprint, configuration policy, storage.
 * Public: status words only. The detailed view is the Admin/Ops deep health page (/admin/ops).
 */
export async function GET() {
  const r = await readiness();
  return Response.json({ status: r.ready ? 'ready' : 'not_ready', checks: r.checks }, { status: r.ready ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
