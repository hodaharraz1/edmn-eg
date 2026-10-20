import { RangeFilter } from '@/app/_components/range-filter';
import { SellerForbidden } from '@/app/_components/seller-forbidden';
import { rangeFromPreset, sellerDashboard } from '@/server/modules/reports/service';
import { requireSellerActor } from '@/server/web/session';
import { formatEGP } from '@/lib/format';
import { BarChart, DataTable, PageHeader, StatCard } from '@/ui/data';

export const metadata = { title: 'التحليلات' };

export default async function SellerAnalytics(props: PageProps<'/seller/analytics'>) {
  const actor = await requireSellerActor('/seller/analytics');
  // Sales and net figures are financial data: same permission as the finance pages.
  if (!actor.sellerPermissions?.has('finance.view')) return <SellerForbidden />;
  const sp = await props.searchParams;
  const preset = typeof sp.range === 'string' ? sp.range : '30d';
  const d = await sellerDashboard(actor.sellerId!, rangeFromPreset(preset));
  return (
    <div className="space-y-5">
      <PageHeader title="التحليلات" actions={<RangeFilter path="/seller/analytics" active={preset} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="المبيعات" value={formatEGP(d.gross)} />
        <StatCard label="الطلبات" value={d.orders} />
        <StatCard label="متوسط قيمة الطلب" value={formatEGP(d.aov)} />
        <StatCard label="صافي المبيعات" value={formatEGP(d.net)} />
      </div>
      <section className="card p-5"><h2 className="mb-3 font-bold">المبيعات</h2><BarChart data={d.daily.map((x) => ({ label: x.day, value: x.gross }))} format={formatEGP} /></section>
      <section className="card p-5"><h2 className="mb-3 font-bold">عدد الطلبات</h2><BarChart data={d.daily.map((x) => ({ label: x.day, value: x.orders }))} format={(v) => `${v} طلب`} /></section>
      <DataTable rows={d.topProducts} rowKey={(r) => r.name} columns={[{ key: 'n', header: 'المنتج', cell: (r) => r.name }, { key: 'u', header: 'الكمية', cell: (r) => r.units }, { key: 'g', header: 'المبيعات', cell: (r) => formatEGP(r.gross) }]} />
    </div>
  );
}
