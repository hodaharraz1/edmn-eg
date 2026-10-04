import { NextResponse } from 'next/server';
import { isDomainError } from '@/server/core/errors';
import { exportDataset, rangeFromPreset } from '@/server/modules/reports/service';
import { audit } from '@/server/audit/audit';
import { db } from '@/server/db/client';
import { getAdminActor } from '@/server/web/session';

const DATASETS = ['orders', 'sellers', 'withdrawals', 'payments', 'products'] as const;

/** CSV export for admins with reports.export. Every export is audit-logged. */
export async function GET(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const dataset = url.searchParams.get('dataset') as (typeof DATASETS)[number];
  if (!DATASETS.includes(dataset)) return NextResponse.json({ error: 'unknown dataset' }, { status: 400 });
  const preset = url.searchParams.get('range') ?? '30d';
  try {
    const csv = await exportDataset(actor, dataset, rangeFromPreset(preset));
    await audit(db, actor, { action: 'reports.exported', entityType: 'report', entityId: dataset, newValues: { range: preset } });
    return new NextResponse(csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="edmn-${dataset}-${preset}.csv"`, 'cache-control': 'no-store' },
    });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
