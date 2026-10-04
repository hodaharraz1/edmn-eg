import { Download } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { adminDashboard, rangeFromPreset } from '@/server/modules/reports/service';
import { formatEGP, formatNumber } from '@/lib/format';
import { buttonClass } from '@/ui/button';
import { PageHeader, StatCard, Tabs } from '@/ui/data';

export const metadata = { title: 'التقارير' };
const RANGES = [{ key: 'today', label: 'اليوم' }, { key: '7d', label: '7 أيام' }, { key: '30d', label: '30 يوماً' }, { key: '90d', label: '90 يوماً' }, { key: '365d', label: 'سنة' }];
const DATASETS = [{ key: 'orders', label: 'الطلبات' }, { key: 'payments', label: 'المدفوعات' }, { key: 'withdrawals', label: 'السحوبات' }, { key: 'sellers', label: 'البائعون' }, { key: 'products', label: 'المنتجات' }];

export default async function Reports(props: PageProps<'/admin/reports'>) {
  const { actor, allowed } = await adminWith('reports.view');
  if (!allowed) return <Forbidden />;
  const range = String((await props.searchParams).range ?? '30d');
  const d = await adminDashboard(actor, rangeFromPreset(range));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const kpis: [string, string][] = [
    ['إجمالي المبيعات المدفوعة (GMV)', formatEGP(d.gmv)], ['إيرادات المنصة (عمولات + رسوم)', formatEGP(d.revenue)], ['عدد الطلبات', formatNumber(d.ordersTotal)], ['الطلبات المدفوعة', formatNumber(d.ordersPaid)],
    ['متوسط قيمة الطلب', formatEGP(d.aov)], ['الصفقات المحمية', `${formatNumber(d.deals)} · ${formatEGP(d.dealsValue)}`], ['مشترون نشطون', formatNumber(d.activeBuyers)], ['بائعون نشطون', formatNumber(d.activeSellers)],
    ['معدل الإرجاع', pct(d.returnRate)], ['معدل النزاعات', pct(d.disputeRate)], ['سحوبات معلقة', `${formatNumber(d.pendingWithdrawals)} · ${formatEGP(d.pendingWithdrawalsAmount)}`], ['شحنات بلا تأكيد استلام', formatNumber(d.unconfirmedDeliveries)],
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="التقارير" description="مؤشرات محسوبة من البيانات الفعلية. ملفات التصدير بصيغة CSV (UTF-8) ولا تتضمن أرقام البطاقات القومية أو بيانات الحسابات الكاملة." />
      <Tabs active={range} tabs={RANGES.map((r) => ({ key: r.key, label: r.label, href: `/admin/reports?range=${r.key}` }))} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(([l, v]) => <StatCard key={l} label={l} value={v} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Top title="أعلى التصنيفات" rows={d.topCategories} unit="قطعة" />
        <Top title="أعلى البائعين" rows={d.topSellers} unit="طلب" />
        <Top title="أعلى المنتجات" rows={d.topProducts} unit="قطعة" />
      </div>
      {hasPermission(actor, 'reports.export') && (
        <section className="card p-5">
          <h2 className="mb-3 font-bold">تصدير البيانات ({RANGES.find((r) => r.key === range)?.label})</h2>
          <div className="flex flex-wrap gap-2">{DATASETS.map((ds) => <a key={ds.key} href={`/api/admin/export?dataset=${ds.key}&range=${range}`} className={buttonClass('outline', 'sm')}><Download className="size-4" /> {ds.label}</a>)}</div>
          <p className="mt-2 text-xs text-muted">كل عملية تصدير تُسجّل في سجل التدقيق.</p>
        </section>
      )}
    </div>
  );
}

function Top({ title, rows, unit }: { title: string; rows: { name: string; gmv: number; units?: number; orders?: number }[]; unit: string }) {
  return (
    <section className="card p-4"><h2 className="mb-2 font-bold">{title}</h2><ol className="space-y-1 text-sm">{rows.map((r, i) => <li key={i} className="flex justify-between gap-2"><span>{i + 1}. {r.name}</span><span className="text-muted">{formatEGP(r.gmv)} · {formatNumber(r.units ?? r.orders ?? 0)} {unit}</span></li>)}</ol>{rows.length === 0 && <p className="text-sm text-muted">لا توجد بيانات</p>}</section>
  );
}
