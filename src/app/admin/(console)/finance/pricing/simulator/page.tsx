import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { parseEgp } from '@/server/core/money';
import { db } from '@/server/db/client';
import { PAYOUT_CHANNELS } from '@/server/db/schema';
import { activeVersionId, batchFor, listVersions, simulateWith } from '@/server/modules/pricing/service';
import { activeChannelConfig, transferCostFor } from '@/server/modules/pricing/payout-costs';
import { formatEGP } from '@/lib/format';
import { DefinitionList, PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Input, Select } from '@/ui/form';
import { classLabel, pctOf, PricingNav } from '../_view';

export const metadata = { title: 'محاكي التسعير' };

export default async function Simulator(props: PageProps<'/admin/finance/pricing/simulator'>) {
  const { allowed } = await adminWith(['pricing.simulate', 'pricing.view']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const model = sp.model === 'PROTECTED_DEAL' ? 'PROTECTED_DEAL' : 'MARKETPLACE';
  const versions = (await listVersions(model)).filter((v) => v.displayStatus !== 'CANCELLED');
  const versionId = typeof sp.v === 'string' && versions.some((v) => v.id === sp.v) ? sp.v : ((await activeVersionId(db, model)) ?? versions[0]?.id);
  const cls = typeof sp.cls === 'string' ? sp.cls : 'STANDARD';
  let amount = 100000;
  let shipping = 7500;
  let error: string | null = null;
  try {
    if (typeof sp.amount === 'string' && sp.amount) amount = parseEgp(sp.amount);
    if (typeof sp.shipping === 'string' && sp.shipping) shipping = parseEgp(sp.shipping);
  } catch {
    error = 'المبلغ غير صحيح';
  }
  const channel = (typeof sp.channel === 'string' && (PAYOUT_CHANNELS as readonly string[]).includes(sp.channel) ? sp.channel : 'INSTAPAY') as (typeof PAYOUT_CHANNELS)[number];
  const ch = await activeChannelConfig(db, channel);
  let extra = 0;
  try {
    if (typeof sp.extra === 'string' && sp.extra) extra = parseEgp(sp.extra);
  } catch {
    error = 'التكلفة الإضافية غير صحيحة';
  }
  const preliminary = versionId ? await simulateWith(versionId, { amount, shipping, economicClass: cls }) : null;
  const payout = ch && preliminary ? transferCostFor(ch, preliminary.sellerNetBeforePayout) : 0;
  const sim = versionId ? await simulateWith(versionId, { amount, shipping, economicClass: cls, sellerPayoutCost: ch?.payerPolicy === 'SELLER_PAYS' ? payout : 0, edmnPayoutCost: ch?.payerPolicy === 'EDMN_PAYS' ? payout : undefined, extraDirectCost: extra }) : null;
  const batch = versionId ? await batchFor(versionId) : [];
  return (
    <div className="space-y-4">
      <PageHeader title="محاكي التسعير والربحية" description="تقديرات لإدارة التسعير فقط — لا تنشئ أي معاملة ولا تغيّر أي سجل." />
      <PricingNav active="sim" />
      <form className="card grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-7" method="get">
        <Select name="model" defaultValue={model} aria-label="النموذج"><option value="MARKETPLACE">السوق</option><option value="PROTECTED_DEAL">الضمانة</option></Select>
        <Select name="v" defaultValue={versionId} aria-label="الإصدار">{versions.map((v) => <option key={v.id} value={v.id}>الإصدار {v.versionNo} ({v.displayStatus})</option>)}</Select>
        <Select name="cls" defaultValue={cls} aria-label="الفئة"><option value="LOW_MARGIN">هامش منخفض</option><option value="STANDARD">قياسي</option><option value="HIGH_MARGIN">هامش مرتفع</option></Select>
        <Input name="amount" defaultValue={(amount / 100).toString()} aria-label="القيمة ج.م" className="ltr" />
        <Input name="shipping" defaultValue={(shipping / 100).toString()} aria-label="الشحن ج.م" className="ltr" />
        <Select name="channel" defaultValue={channel} aria-label="قناة التحويل">{PAYOUT_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Input name="extra" defaultValue={(extra / 100).toString()} aria-label="تكلفة مباشرة إضافية ج.م" className="ltr" />
        <button className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white sm:col-span-3 lg:col-span-7" type="submit">احسب</button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {!versionId && <Alert tone="danger">لا يوجد إصدار تسعير لهذا النموذج.</Alert>}
      {sim && (
        <section className="card p-4" data-testid="sim-result">
          <DefinitionList
            items={[
              { label: 'رسوم المشتري', value: formatEGP(sim.buyerFee) },
              { label: 'رسوم البائع', value: formatEGP(sim.sellerFee) },
              { label: 'إجمالي رسوم اضمن', value: <b>{formatEGP(sim.totalFee)}{sim.minApplied && <Badge className="ms-1">حد أدنى</Badge>}</b> },
              { label: 'يدفعه المشتري', value: formatEGP(sim.buyerPayable) },
              { label: 'صافي البائع قبل التحويل', value: formatEGP(sim.sellerNetBeforePayout) },
              { label: `رسوم التحويل (${ch?.payerPolicy === 'EDMN_PAYS' ? 'على اضمن' : 'على البائع'})`, value: formatEGP(payout) },
              { label: 'صافي البائع بعد التحويل', value: formatEGP(sim.sellerNetAfterPayout) },
              { label: 'تكاليف مباشرة تقديرية', value: formatEGP(sim.directCosts) },
              { label: 'احتياطيات (تقدير)', value: formatEGP(sim.reserves) },
              { label: 'صافي المساهمة (تقدير)', value: <b>{formatEGP(sim.netContribution)}</b> },
              { label: 'هامش المساهمة (تقدير)', value: <b data-testid="sim-margin">{pctOf(sim.marginBps)}</b> },
            ]}
          />
        </section>
      )}
      {batch.length > 0 && (
        <section className="card overflow-x-auto p-4">
          <h2 className="mb-2 font-bold">محاكاة مجمعة</h2>
          <table className="w-full min-w-[640px] text-xs" data-testid="sim-batch">
            <thead className="text-muted"><tr><th className="p-1 text-start">الفئة</th><th className="p-1 text-start">القيمة</th><th className="p-1 text-start">المشتري</th><th className="p-1 text-start">البائع</th><th className="p-1 text-start">الإجمالي</th><th className="p-1 text-start">الهامش</th></tr></thead>
            <tbody>{batch.map((r) => <tr key={`${r.economicClass}-${r.amount}`} className="border-t border-line"><td className="p-1">{classLabel(r.economicClass)}</td><td className="p-1">{formatEGP(r.amount)}</td><td className="p-1">{formatEGP(r.buyerFee)}</td><td className="p-1">{formatEGP(r.sellerFee)}</td><td className="p-1 font-semibold">{formatEGP(r.totalFee)}</td><td className="p-1">{pctOf(r.marginBps)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
