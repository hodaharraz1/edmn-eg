import Link from '@/ui/link';
import { profitabilityCostAction } from '@/app/_actions/pricing';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { COST_TYPES } from '@/server/db/schema';
import { economics, edmnPayoutCosts, groupBy, kpis, type EconomicsRow } from '@/server/modules/pricing/profitability';
import { formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader, StatCard } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Input, Select } from '@/ui/form';
import { classLabel, pctOf, PricingNav } from '../pricing/_view';

export const metadata = { title: 'الربحية' };

function GroupTable({ title, rows }: { title: string; rows: ReturnType<typeof groupBy> }) {
  return (
    <section className="card overflow-x-auto p-4">
      <h2 className="mb-2 font-bold">{title}</h2>
      <table className="w-full min-w-[640px] text-xs">
        <thead className="text-muted"><tr><th className="p-1 text-start">البند</th><th className="p-1 text-start">العدد</th><th className="p-1 text-start">GMV</th><th className="p-1 text-start">إيراد اضمن</th><th className="p-1 text-start">صافي المساهمة</th><th className="p-1 text-start">الهامش</th><th className="p-1 text-start">أقل من المستهدف</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key} className="border-t border-line"><td className="p-1">{r.key}</td><td className="p-1">{r.count}</td><td className="p-1">{formatEGP(r.gmv)}</td><td className="p-1">{formatEGP(r.grossRevenue)}</td><td className="p-1">{formatEGP(r.netContribution)}</td><td className="p-1">{pctOf(r.marginBps)}</td><td className="p-1">{r.belowTarget}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

export default async function Profitability(props: PageProps<'/admin/finance/profitability'>) {
  const { actor, allowed } = await adminWith('profitability.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const to = typeof sp.to === 'string' && sp.to ? new Date(`${sp.to}T23:59:59.999+02:00`) : new Date();
  const from = typeof sp.from === 'string' && sp.from ? new Date(`${sp.from}T00:00:00+02:00`) : new Date(to.getTime() - 30 * 86400_000);
  const range = { from, to };
  const rows = await economics(range);
  const payoutEdmn = await edmnPayoutCosts(range);
  const k = kpis(rows, 5000, payoutEdmn);
  const mk = kpis(rows.filter((r) => r.model === 'MARKETPLACE'));
  const dk = kpis(rows.filter((r) => r.model === 'PROTECTED_DEAL'));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const canCost = hasPermission(actor, 'finance.controls');
  const link = (r: EconomicsRow) => (r.model === 'MARKETPLACE' ? `/admin/releases/${r.id}` : `/admin/deals/${r.id}`);
  return (
    <div className="space-y-4">
      <PageHeader title="ربحية المعاملات (هامش المساهمة)" description="محاسبة إدارية: الإيراد = رسوم المشتري + رسوم البائع − الرسوم المعكوسة في الاستردادات المعتمدة. التكاليف الفعلية منفصلة عن التقديرات/المخصصات (ليست حركة نقدية). هامش المساهمة ليس صافي ربح الشركة." />
      <PricingNav active="profit" />
      <form method="get" className="card flex flex-wrap items-end gap-2 p-4">
        <label className="text-sm">من <Input type="date" name="from" defaultValue={iso(from)} className="ltr w-40" /></label>
        <label className="text-sm">إلى <Input type="date" name="to" defaultValue={iso(to)} className="ltr w-40" /></label>
        <button className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white" type="submit">عرض</button>
        <a className="text-sm text-brand-700 underline" href={`/api/admin/profitability-export?from=${iso(from)}&to=${iso(to)}`}>تصدير CSV</a>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="profit-kpis">
        <StatCard label="GMV" value={formatEGP(k.gmv)} hint={`${k.count} معاملة`} />
        <StatCard label="رسوم المشتري / البائع" value={`${formatEGP(k.buyerFees)} / ${formatEGP(k.sellerFees)}`} />
        <StatCard label="إجمالي إيراد اضمن" value={formatEGP(k.grossRevenue)} hint={`بعد عكس ${formatEGP(k.feeReversals)}`} />
        <StatCard label="صافي المساهمة" value={formatEGP(k.netContribution)} hint={`هامش ${pctOf(k.marginBps)} (المستهدف 50%)`} />
        <StatCard label="تكاليف فعلية مباشرة" value={formatEGP(k.actualCosts + k.payoutCostsEdmn)} hint={`منها تحويلات على اضمن ${formatEGP(k.payoutCostsEdmn)}`} />
        <StatCard label="احتياطيات تقديرية" value={formatEGP(k.estimatedReserves)} hint="تقدير — ليست مصروفًا نقديًا" />
        <StatCard label="مخصص ضريبي (تقدير)" value={formatEGP(k.taxProvision)} hint="غير محسوم" />
        <StatCard label="متوسط الرسوم" value={pctOf(k.avgFeeBps)} hint={`${formatEGP(k.avgFee ?? 0)} للمعاملة`} />
        <StatCard label="نسبة الاسترداد / النزاع" value={`${pctOf(k.refundRateBps)} / ${pctOf(k.disputeRateBps)}`} />
        <StatCard label="معاملات خاسرة" value={String(k.lossMaking)} />
        <StatCard label="أقل من الهامش المستهدف" value={String(k.belowTarget)} />
        <StatCard label="السوق مقابل الضمانة" value={`${pctOf(mk.marginBps)} / ${pctOf(dk.marginBps)}`} hint={`${formatEGP(mk.grossRevenue)} / ${formatEGP(dk.grossRevenue)}`} />
      </div>
      {rows.some((r) => r.pricingSource !== 'ENGINE') && <Alert tone="info">بعض المعاملات بلقطة قديمة (LEGACY_SNAPSHOT): تُعرض بقيمها التاريخية كما هي، والتقديرات لها بافتراضات افتراضية.</Alert>}
      <GroupTable title="حسب النموذج" rows={groupBy(rows, (r) => (r.model === 'MARKETPLACE' ? 'السوق' : 'الضمانة'))} />
      <GroupTable title="حسب الفئة الاقتصادية" rows={groupBy(rows, (r) => (r.economicClass ? classLabel(r.economicClass) : 'قديم'))} />
      <GroupTable title="حسب شريحة القيمة" rows={groupBy(rows, (r) => r.tier)} />
      <GroupTable title="حسب إصدار التسعير" rows={groupBy(rows, (r) => (r.pricingVersionNo ? `${r.model === 'MARKETPLACE' ? 'سوق' : 'ضمانة'} v${r.pricingVersionNo}` : 'LEGACY'))} />
      <GroupTable title="حسب البائع" rows={groupBy(rows, (r) => r.sellerName ?? '—').slice(0, 20)} />
      <GroupTable title="حسب اليوم" rows={groupBy(rows, (r) => r.date.slice(0, 10))} />
      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-bold">المعاملات (تفصيل)</h2>
        <table className="w-full min-w-[820px] text-xs" data-testid="profit-rows">
          <thead className="text-muted"><tr><th className="p-1 text-start">المرجع</th><th className="p-1 text-start">النموذج</th><th className="p-1 text-start">GMV</th><th className="p-1 text-start">رسوم مشتري</th><th className="p-1 text-start">رسوم بائع</th><th className="p-1 text-start">معكوس</th><th className="p-1 text-start">تكاليف فعلية</th><th className="p-1 text-start">تقديرات</th><th className="p-1 text-start">صافي</th><th className="p-1 text-start">هامش</th></tr></thead>
          <tbody>
            {rows.slice(0, 100).map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="p-1"><Link className="text-brand-700" href={link(r) as never}>{r.ref}</Link>{r.pricingSource !== 'ENGINE' && <Badge className="ms-1">قديم</Badge>}</td>
                <td className="p-1">{r.model === 'MARKETPLACE' ? 'سوق' : 'ضمانة'}</td>
                <td className="p-1">{formatEGP(r.gmv)}</td><td className="p-1">{formatEGP(r.buyerFee)}</td><td className="p-1">{formatEGP(r.sellerFee)}</td><td className="p-1">{formatEGP(r.feeReversals)}</td>
                <td className="p-1">{formatEGP(r.actualCosts)}</td><td className="p-1">{formatEGP(r.estimatedReserves + r.taxProvision)}</td>
                <td className="p-1">{r.netContribution < 0 ? <Badge tone="danger">{formatEGP(r.netContribution)}</Badge> : formatEGP(r.netContribution)}</td><td className="p-1">{pctOf(r.marginBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {canCost && (
        <section className="card p-4">
          <h2 className="mb-2 font-bold">تسجيل تكلفة مباشرة على معاملة (يُسجل في التدقيق)</h2>
          <ActionForm action={profitabilityCostAction} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <input type="hidden" name="back" value="/admin/finance/profitability" />
            <Select name="entityType" aria-label="نوع المعاملة"><option value="seller_order">طلب فرعي</option><option value="external_deal">صفقة</option><option value="refund">استرداد</option><option value="withdrawal">سحب</option></Select>
            <Input name="entityId" required placeholder="معرّف المعاملة (UUID)" aria-label="معرّف المعاملة" className="ltr" />
            <Select name="costType" aria-label="نوع التكلفة">{COST_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            <Select name="nature" aria-label="طبيعة التكلفة"><option value="ACTUAL">فعلية</option><option value="ESTIMATE">تقديرية</option></Select>
            <Select name="borneBy" aria-label="يتحملها"><option value="EDMN">اضمن</option><option value="SELLER">البائع</option><option value="BUYER">المشتري</option></Select>
            <Input name="amount" required placeholder="المبلغ ج.م" aria-label="المبلغ" className="ltr" />
            <Input name="reference" placeholder="مرجع" aria-label="مرجع" />
            <Input name="notes" required minLength={3} placeholder="ملاحظة/سبب" aria-label="ملاحظة" />
            <div className="sm:col-span-3 lg:col-span-4"><SubmitButton size="sm">تسجيل (2FA)</SubmitButton></div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
