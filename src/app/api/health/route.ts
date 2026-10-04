/** Liveness: the process is up. Does not touch dependencies. */
export function GET() {
  return Response.json({ status: 'ok', service: 'edmn-marketplace', time: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
}
