import { AlertTriangle, BadgeCheck, CircleDollarSign, Clock, CreditCard, Gavel, LifeBuoy, PackageSearch, RotateCcw, ShieldCheck, ShoppingBag, Store, Truck, Users, Wallet } from 'lucide-react';
import { RangeFilter } from '@/app/_components/range-filter';
import { adminDashboard, rangeFromPreset } from '@/server/modules/reports/service';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { realMoneyEnabled } from '@/server/modules/settings';
import { Alert } from '@/ui/feedback';
import { formatEGP, formatNumber } from '@/lib/format';
import { BarChart, DataTable, PageHeader, StatCard } from '@/ui/data';

export const metadata = { title: 'لوحة القيادة' };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default async function AdminDashboard(props: PageProps<'/admin'>) {
  const { actor, allowed } = await adminWith('dashboard.view');
  if (!allowed) return <Forbidden />;
  const live = await realMoneyEnabled();
  const preset = typeof (await props.searchParams).range === 'string' ? String((await props.searchParams).range) : '30d';
  const d = await adminDashboard(actor, rangeFromPreset(preset));
  return (
    <div className="space-y-6">
      <PageHeader title="لوحة القيادة التنفيذية" description="مؤشرات حقيقية من قاعدة البيانات" actions={<RangeFilter path="/admin" active={preset} />} />
      {!live && <Alert tone="warning" title="وضع الأموال التجريبية">كل المبالغ في هذه اللوحة ناتجة عن مدفوعات تجريبية (Staging / تجربة) وليست إيرادات حقيقية. الطلبات الملغاة مستبعدة.</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="إجمالي قيمة البضائع (GMV)" value={formatEGP(d.gmv)} icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="إيرادات اضمن (عمولات + رسوم)" value={formatEGP(d.revenue)} icon={<ShieldCheck className="size-5" />} tone="success" />
        <StatCard label="الطلبات (المدفوعة / الكل)" value={`${formatNumber(d.ordersPaid)} / ${formatNumber(d.ordersTotal)}`} hint={`متوسط الطلب ${formatEGP(d.aov)}`} icon={<ShoppingBag className="size-5" />} />
        <StatCard label="الصفقات الخارجية" value={formatNumber(d.deals)} hint={`قيمة النشطة ${formatEGP(d.dealsValue)}`} icon={<ShieldCheck className="size-5" />} tone="neutral" />
        <StatCard label="مشترون نشطون" value={formatNumber(d.activeBuyers)} icon={<Users className="size-5" />} tone="neutral" />
        <StatCard label="بائعون نشطون" value={formatNumber(d.activeSellers)} icon={<Store className="size-5" />} tone="neutral" />
        <StatCard label="نسبة المرتجعات" value={pct(d.returnRate)} icon={<RotateCcw className="size-5" />} tone="neutral" />
        <StatCard label="نسبة النزاعات" value={pct(d.disputeRate)} icon={<Gavel className="size-5" />} tone="neutral" />
      </div>
      <h2 className="font-bold">قوائم الانتظار التشغيلية</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="طلبات بائعين للمراجعة" value={d.pendingSellers} icon={<BadgeCheck className="size-5" />} tone={d.pendingSellers ? 'warning' : 'neutral'} href="/admin/seller-verification" />
        <StatCard label="منتجات للمراجعة" value={d.pendingProducts} icon={<PackageSearch className="size-5" />} tone={d.pendingProducts ? 'warning' : 'neutral'} href="/admin/moderation" />
        <StatCard label="مدفوعات للتحقق" value={d.pendingPayments} icon={<CreditCard className="size-5" />} tone={d.pendingPayments ? 'danger' : 'neutral'} href="/admin/payments" />
        <StatCard label="سحوبات قيد التنفيذ" value={d.pendingWithdrawals} hint={formatEGP(d.pendingWithdrawalsAmount)} icon={<Wallet className="size-5" />} tone={d.pendingWithdrawals ? 'warning' : 'neutral'} href="/admin/withdrawals" />
        <StatCard label="مستردات بانتظار الصرف" value={d.pendingRefunds} icon={<Clock className="size-5" />} tone={d.pendingRefunds ? 'warning' : 'neutral'} href="/admin/refunds" />
        <StatCard label="نزاعات مفتوحة" value={d.openDisputes} icon={<Gavel className="size-5" />} tone={d.openDisputes ? 'danger' : 'neutral'} href="/admin/disputes" />
        <StatCard label="تذاكر دعم مفتوحة" value={d.openTickets} icon={<LifeBuoy className="size-5" />} href="/admin/support" />
        <StatCard label="شحنات بلا تأكيد استلام" value={d.unconfirmedDeliveries} icon={<Truck className="size-5" />} tone={d.unconfirmedDeliveries ? 'warning' : 'neutral'} href="/admin/orders?tab=followup" />
      </div>
      <section className="card p-5"><h2 className="mb-3 font-bold">GMV اليومي</h2><BarChart data={d.daily.map((x) => ({ label: x.day, value: x.gmv }))} format={formatEGP} /></section>
      <div className="grid gap-4 lg:grid-cols-3">
        {[
          ['أعلى التصنيفات', d.topCategories.map((x) => ({ name: x.name, v: formatEGP(x.gmv) }))],
          ['أعلى البائعين', d.topSellers.map((x) => ({ name: x.name, v: formatEGP(x.gmv) }))],
          ['أعلى المنتجات', d.topProducts.map((x) => ({ name: x.name, v: formatEGP(x.gmv) }))],
        ].map(([title, rows]) => (
          <section key={title as string}>
            <h3 className="mb-2 text-sm font-bold">{title as string}</h3>
            <DataTable rows={rows as { name: string; v: string }[]} rowKey={(r) => r.name} empty={<p className="card p-4 text-sm text-muted"><AlertTriangle className="me-1 inline size-4" />لا توجد بيانات</p>} className="[&_table]:min-w-0" columns={[{ key: 'n', header: 'الاسم', cell: (r) => <span className="line-clamp-1">{r.name}</span> }, { key: 'v', header: 'GMV', cell: (r) => r.v }]} />
          </section>
        ))}
      </div>
    </div>
  );
}
