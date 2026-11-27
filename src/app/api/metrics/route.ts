import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { readiness } from '@/server/ops/health';

/**
 * PKG-INFRA-01 — Prometheus scrape endpoint.
 *
 * Auth: `Authorization: Bearer ${METRICS_TOKEN}`. With no token configured the route answers 404 (never an open
 * metrics endpoint: it names tables, job states and ledger health). The scrape is deliberately cheap and bounded:
 * a handful of counts, no table scans beyond indexed state columns.
 *
 * Metric names are the ones ops/prometheus/edmn-alerts.yml and ops/grafana/edmn-dashboard.json expect.
 */
export const dynamic = 'force-dynamic';

function line(name: string, value: number | string, labels = '') {
  return `${name}${labels ? `{${labels}}` : ''} ${value}`;
}

export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return new Response('Not found', { status: 404 });
  if (req.headers.get('authorization') !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 });

  const out: string[] = [];
  const ready = await readiness();
  out.push(line('edmn_ready', ready.ready ? 1 : 0));
  for (const [check, status] of Object.entries(ready.checks)) out.push(line('edmn_ready_check', status === 'ok' ? 1 : status === 'degraded' ? 0.5 : 0, `check="${check}"`));

  const mem = process.memoryUsage();
  out.push(line('edmn_process_resident_bytes', mem.rss));
  out.push(line('edmn_process_heap_bytes', mem.heapUsed));
  out.push(line('edmn_process_uptime_seconds', Math.round(process.uptime())));

  try {
    const q = await db.execute<{ failed: string; backlog: string; oldest_min: string | null; ledger_status: string | null; ledger_age_min: string | null }>(sql`
      select
        (select count(*) from jobs where status = 'FAILED')::text failed,
        (select count(*) from jobs where status = 'PENDING' and run_at < now() - interval '15 minutes')::text backlog,
        (select round(extract(epoch from (now() - min(run_at))) / 60)::text from jobs where status = 'PENDING') oldest_min,
        (select status from ledger_health_checks order by checked_at desc limit 1) ledger_status,
        (select round(extract(epoch from (now() - max(checked_at))) / 60)::text from ledger_health_checks) ledger_age_min`);
    const r = q.rows[0];
    out.push(line('edmn_jobs_failed', Number(r?.failed ?? 0)));
    out.push(line('edmn_jobs_backlog', Number(r?.backlog ?? 0)));
    out.push(line('edmn_jobs_oldest_pending_minutes', Number(r?.oldest_min ?? 0)));
    out.push(line('edmn_ledger_health_ok', r?.ledger_status === 'OK' ? 1 : 0));
    out.push(line('edmn_ledger_check_age_minutes', Number(r?.ledger_age_min ?? 0)));
  } catch {
    out.push(line('edmn_metrics_db_error', 1));
  }

  return new Response(out.join('\n') + '\n', {
    headers: { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' },
  });
}
