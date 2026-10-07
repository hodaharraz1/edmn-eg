import { NextResponse } from 'next/server';
import { audit } from '@/server/audit/audit';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { economics } from '@/server/modules/pricing/profitability';
import { toCsv } from '@/server/modules/reports/service';
import { getAdminActor } from '@/server/web/session';

/** Profitability CSV (no buyer/seller personal data; formula-injection safe). Audited. */
export async function GET(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!hasPermission(actor, 'profitability.view') || !hasPermission(actor, 'reports.export')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const d = (v: string | null, fallback: Date) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+02:00`) : fallback);
  const to = d(url.searchParams.get('to'), new Date());
  const from = d(url.searchParams.get('from'), new Date(to.getTime() - 30 * 86400_000));
  const toEnd = new Date(to.getTime() + 86400_000);
  const rows = await economics({ from, to: toEnd });
  const m = (v: number) => (v / 100).toFixed(2);
  const csv = toCsv(
    ['ref', 'model', 'date', 'economic_class', 'pricing_version', 'pricing_source', 'gmv_egp', 'buyer_fee_egp', 'seller_fee_egp', 'fee_reversals_egp', 'gross_revenue_egp', 'actual_costs_egp', 'estimated_reserves_egp', 'tax_provision_estimate_egp', 'net_contribution_egp', 'margin_pct'],
    rows.map((r) => [r.ref, r.model, r.date, r.economicClass, r.pricingVersionNo, r.pricingSource, m(r.gmv), m(r.buyerFee), m(r.sellerFee), m(r.feeReversals), m(r.grossRevenue), m(r.actualCosts), m(r.estimatedReserves), m(r.taxProvision), m(r.netContribution), r.marginBps === null ? '' : (r.marginBps / 100).toFixed(2)]),
  );
  await audit(db, actor, { action: 'reports.exported', entityType: 'report', entityId: 'profitability', newValues: { from: from.toISOString(), to: to.toISOString(), rows: rows.length } });
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="edmn-profitability.csv"', 'cache-control': 'no-store' } });
}
