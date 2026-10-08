import Link from '@/ui/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, Boxes, CircleDollarSign, Clock, PackageCheck, RotateCcw, ShoppingBag, Star, Truck, Wallet } from 'lucide-react';
import { RangeFilter } from '@/app/_components/range-filter';
import { SellerStatusGate } from '@/app/_components/seller-gate';
import { rangeFromPreset, sellerDashboard } from '@/server/modules/reports/service';
import { sellerContextForUser } from '@/server/modules/sellers/service';
import { requireUser } from '@/server/web/session';
import { formatEGP, formatNumber } from '@/lib/format';
import { BarChart, PageHeader, StatCard } from '@/ui/data';

export const metadata = { title: 'لوحة التحكم' };
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default async function SellerDashboard(props: PageProps<'/seller'>) {
  const user = await requireUser('/seller');
  const ctx = (await sellerContextForUser(user.id))!;
  if (ctx.seller.status === 'DRAFT') redirect('/seller/onboarding');
  const sp = await props.searchParams;
  const preset = typeof sp.range === 'string' ? sp.range : '30d';
  if (ctx.seller.status !== 'APPROVED' && ctx.seller.status !== 'RESTRICTED' && ctx.seller.status !== 'SUSPENDED') {
    return (
      <div className="space-y-4">
        <PageHeader title="مرحباً بك في مركز البائع" />
        <SellerStatusGate seller={ctx.seller} />
      </div>
    );
  }
  const d = await sellerDashboard(ctx.seller.id, rangeFromPreset(preset));
  // Balances are shown only to members allowed to see finance (owners, managers, finance role).
  const canSeeFinance = ctx.permissions.has('finance.view');
  return (
    <div className="space-y-6">
      <PageHeader title="لوحة التحكم" description="نظرة سريعة على أداء متجرك" actions={<RangeFilter path="/seller" active={preset} />} />
      <SellerStatusGate seller={ctx.seller} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="مبيعات اليوم" value={formatEGP(d.todaySales)} icon={<CircleDollarSign className="size-5" />} />
        <StatCard label="الطلبات (الفترة)" value={formatNumber(d.orders)} hint={`متوسط الطلب ${formatEGP(d.aov)}`} icon={<ShoppingBag className="size-5" />} />
        {canSeeFinance && <StatCard label="الرصيد المتاح" value={formatEGP(d.balances.available)} icon={<Wallet className="size-5" />} tone="success" href="/seller/balance" />}
        {canSeeFinance && <StatCard label="الرصيد المعلق" value={formatEGP(d.balances.pending)} hint="بانتظار تأكيد العملاء الاستلام" icon={<Clock className="size-5" />} tone="warning" href="/seller/balance" />}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="بانتظار تأكيدك" value={d.pendingConfirmation} tone={d.pendingConfirmation ? 'danger' : 'neutral'} icon={<AlertTriangle className="size-5" />} href="/seller/orders?tab=new" />
        <StatCard label="قيد التجهيز" value={d.processing} icon={<PackageCheck className="size-5" />} href="/seller/orders?tab=processing" />
        <StatCard label="جاهز للشحن" value={d.ready} icon={<Truck className="size-5" />} href="/seller/orders?tab=ready" />
        <StatCard label="تم الشحن" value={d.shipped} icon={<Truck className="size-5" />} href="/seller/orders?tab=shipped" />
        <StatCard label="مرتجعات مفتوحة" value={d.openReturns} tone={d.openReturns ? 'warning' : 'neutral'} icon={<RotateCcw className="size-5" />} href="/seller/returns" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-4 font-bold">المبيعات اليومية</h2>
          <BarChart data={d.daily.map((x) => ({ label: x.day, value: x.gross }))} format={(v) => formatEGP(v)} />
        </section>
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="font-bold">ملخص الفترة</h2>
          <dl className="space-y-2">
            <div className="flex justify-between"><dt className="text-muted">إجمالي المبيعات</dt><dd className="font-semibold">{formatEGP(d.gross)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">عمولة اضمن</dt><dd>-{formatEGP(d.commission)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">المستردات</dt><dd>-{formatEGP(d.refunds)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2"><dt>صافي المبيعات</dt><dd className="font-bold">{formatEGP(d.net)}</dd></div>
          </dl>
          <h3 className="pt-2 font-bold">مؤشرات الأداء</h3>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-page p-2"><dt className="text-muted">التقييم</dt><dd className="flex items-center gap-1 text-base font-bold"><Star className="size-4 fill-amber-400 text-amber-400" /> {d.rating.toFixed(1)} <span className="text-xs font-normal text-muted">({d.ratingCount})</span></dd></div>
            <div className="rounded-lg bg-page p-2"><dt className="text-muted">الشحن في الموعد</dt><dd className="text-base font-bold">{pct(d.onTimeRate)}</dd></div>
            <div className="rounded-lg bg-page p-2"><dt className="text-muted">نسبة الإلغاء</dt><dd className="text-base font-bold">{pct(d.cancellationRate)}</dd></div>
            <div className="rounded-lg bg-page p-2"><dt className="text-muted">نسبة الإرجاع</dt><dd className="text-base font-bold">{pct(d.returnRate)}</dd></div>
          </dl>
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-bold">الأكثر مبيعاً</h2>
          {d.topProducts.length ? (
            <ol className="space-y-2 text-sm">{d.topProducts.map((p, i) => <li key={p.name} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {p.name}</span><span className="shrink-0 text-muted">{p.units} قطعة · {formatEGP(p.gross)}</span></li>)}</ol>
          ) : <p className="text-sm text-muted">لا توجد مبيعات في هذه الفترة.</p>}
        </section>
        <section className="card space-y-2 p-5 text-sm">
          <h2 className="mb-1 font-bold">تنبيهات المخزون</h2>
          <p className="flex items-center gap-2"><Boxes className="size-4 text-amber-600" /> {d.lowStock} منتج بمخزون منخفض</p>
          <p className="flex items-center gap-2"><Boxes className="size-4 text-red-700" /> {d.outOfStock} منتج نفدت كميته</p>
          <Link href="/seller/inventory" className="text-brand-700 hover:underline">إدارة المخزون</Link>
          <p className="pt-2 text-xs text-muted">طلبات سحب قيد التنفيذ: {d.withdrawalsOpen} · إجمالي ما تم صرفه: {formatEGP(d.paidOut)}</p>
        </section>
      </div>
    </div>
  );
}
