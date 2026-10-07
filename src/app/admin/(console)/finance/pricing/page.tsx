import Link from 'next/link';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { activeVersionId, governanceFor, listVersions, loadVersion } from '@/server/modules/pricing/service';
import { channelConfigs } from '@/server/modules/pricing/payout-costs';
import { policyVersions } from '@/server/modules/pricing/refund-policy';
import { formatDate, formatEGP } from '@/lib/format';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { classLabel, pctOf, PricingNav } from './_view';

export const metadata = { title: 'التسعير والرسوم' };

export default async function PricingOverview() {
  const { allowed } = await adminWith('pricing.view');
  if (!allowed) return <Forbidden />;
  const models = await Promise.all(
    (['MARKETPLACE', 'PROTECTED_DEAL'] as const).map(async (m) => {
      const id = await activeVersionId(db, m);
      const versions = await listVersions(m);
      return { m, active: id ? await loadVersion(db, id) : null, gov: id ? await governanceFor(id) : null, scheduled: versions.filter((v) => v.displayStatus === 'SCHEDULED'), pending: versions.filter((v) => ['DRAFT', 'VALIDATED', 'APPROVED'].includes(v.displayStatus)) };
    }),
  );
  const channels = (await channelConfigs()).filter((c) => !c.effectiveTo);
  const policies = await policyVersions();
  return (
    <div className="space-y-4">
      <PageHeader title="التسعير والرسوم" description="محرك رسوم بإصدارات: لا تغيير بدون إصدار جديد، ولا نشر بدون شخص ثانٍ و2FA. المعاملات القديمة لا تتأثر أبدًا." />
      <PricingNav active="overview" />
      {models.map(({ m, active, gov, scheduled, pending }) => (
        <section key={m} className="card space-y-2 p-4" data-testid={`overview-${m}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">{m === 'MARKETPLACE' ? 'السوق' : 'الصفقات المحمية'}</h2>
            <Link className="text-sm text-brand-700" href={m === 'MARKETPLACE' ? '/admin/finance/pricing/marketplace' : '/admin/finance/pricing/protected-deals'}>إدارة الإصدارات</Link>
          </div>
          {!active ? (
            <Alert tone="danger" title="لا يوجد إصدار ساري">المعاملات الجديدة متوقفة (Fail closed) لحين نشر إصدار معتمد.</Alert>
          ) : (
            <>
              <p className="text-sm">الإصدار الساري: <b>{active.versionNo} — {active.name}</b> منذ {formatDate(active.effectiveFrom, true)} · الحد الأدنى {formatEGP(active.minFee)} · الهامش المتوقع {pctOf(gov?.expectedMarginBps)} (المستهدف {pctOf(active.targetMarginBps)})</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="text-muted"><tr><th className="p-1 text-start">الفئة</th><th className="p-1 text-start">الشريحة</th><th className="p-1 text-start">المشتري</th><th className="p-1 text-start">البائع</th><th className="p-1 text-start">الإجمالي</th></tr></thead>
                  <tbody>
                    {Object.entries(active.tiersByClass).flatMap(([c, ts]) => ts.map((t, i) => (
                      <tr key={`${c}-${i}`} className="border-t border-line"><td className="p-1">{classLabel(c)}</td><td className="p-1">{formatEGP(t.lowerBound)} – {t.upperBound === null ? 'فأكثر' : formatEGP(t.upperBound)}</td><td className="p-1">{pctOf(t.buyerBps)}</td><td className="p-1">{pctOf(t.sellerBps)}</td><td className="p-1 font-semibold">{pctOf(t.totalBps)}</td></tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {scheduled.length > 0 && <p className="text-sm">مجدول: {scheduled.map((v) => `الإصدار ${v.versionNo} في ${formatDate(v.effectiveFrom, true)}`).join('، ')}</p>}
          {pending.length > 0 && <p className="text-sm">قيد العمل: {pending.map((v) => <Badge key={v.id} className="me-1">{v.versionNo} · {v.displayStatus}</Badge>)}</p>}
        </section>
      ))}
      <section className="card p-4">
        <h2 className="mb-2 font-bold">قنوات التحويل</h2>
        <ul className="text-sm">{channels.map((c) => <li key={c.id}>{c.name}: {pctOf(c.costBps)} + {formatEGP(c.costFixed)} (أدنى {formatEGP(c.costMin)}{c.costMax !== null ? `، أقصى ${formatEGP(c.costMax)}` : ''}) · {c.payerPolicy === 'SELLER_PAYS' ? 'يتحملها البائع' : 'تتحملها اضمن'}{c.notes?.startsWith('UNVERIFIED') && <Badge tone="warning" className="ms-1">غير موثقة</Badge>}</li>)}</ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">سياسة استرداد الرسوم وتحميل التكاليف</h2>
        <p className="text-sm">{policies.some((p) => p.status === 'PUBLISHED') ? 'منشورة' : <><Badge tone="warning">LEGAL REVIEW REQUIRED</Badge> غير منشورة — الاستردادات تستخدم الإعداد الآمن للمستهلك مع مراجعة يدوية.</>}</p>
      </section>
    </div>
  );
}
