import { refundPolicyAction } from '@/app/_actions/pricing';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { REFUND_LIFECYCLE_STAGES, REFUND_REASON_CODES, RESPONSIBLE_PARTIES, SHIPPING_REFUND_RULES } from '@/server/db/schema';
import { policyVersions, SAFE_DEFAULT } from '@/server/modules/pricing/refund-policy';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Checkbox, Input, Select } from '@/ui/form';
import { pctOf, PricingNav } from '../_view';

export const metadata = { title: 'سياسة استرداد الرسوم' };
const pctIn = (bps: number) => (bps / 100).toFixed(2).replace(/\.?0+$/, '');

export default async function RefundFeePolicy() {
  const { actor, allowed } = await adminWith(['pricing.view', 'refund_fee_policy.manage']);
  if (!allowed) return <Forbidden />;
  const versions = await policyVersions();
  const canManage = hasPermission(actor, 'refund_fee_policy.manage');
  const published = versions.find((v) => v.status === 'PUBLISHED');
  const draft = versions.find((v) => v.status === 'DRAFT');
  const sel = (name: string, list: readonly string[], value: string, label: string) => (
    <Select name={name} defaultValue={value} aria-label={label} className="w-auto text-xs">{list.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="مصفوفة استرداد الرسوم وتحميل التكاليف" description="لا «كل الرسوم قابلة للاسترداد» ولا «غير قابلة» بشكل مطلق: المرحلة + السبب + المسؤول + السياسة. التاريخ المالي يتصحح بقيود عكسية فقط." />
      <PricingNav active="refund" />
      {!published ? (
        <Alert tone="warning" title="LEGAL REVIEW REQUIRED — لا توجد سياسة منشورة">
          الاستردادات تستخدم الإعداد الآمن للمستهلك: رد رسوم المشتري على الوحدات المستردة {pctOf(SAFE_DEFAULT.buyerFeeRefundBps)}، عكس رسوم البائع {pctOf(SAFE_DEFAULT.sellerFeeReversalBps)}، الشحن بقرار صريح فقط (بدون تقسيم تلقائي)، رسوم التحويل على اضمن، ومراجعة يدوية. لا يتم تحميل المستهلك أي مبلغ بصمت.
        </Alert>
      ) : (
        <Alert tone="success">السياسة المنشورة: الإصدار {published.versionNo} ({published.legalPolicyVersion}) منذ {formatDate(published.publishedAt, true)}</Alert>
      )}
      {versions.map((v) => {
        const editable = v.status === 'DRAFT' && canManage;
        const rows = editable ? [...v.rules, null, null] : v.rules;
        return (
          <section key={v.id} className="card space-y-2 overflow-x-auto p-4" data-testid={`refund-policy-${v.versionNo}`}>
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">الإصدار {v.versionNo}</h2><Badge tone={v.status === 'PUBLISHED' ? 'success' : 'neutral'}>{v.status}</Badge>{v.legalReviewRequired && <Badge tone="warning">LEGAL REVIEW REQUIRED</Badge>}</div>
            <ActionForm action={refundPolicyAction} className="space-y-2">
              <input type="hidden" name="op" value="saveRules" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="back" value="/admin/finance/pricing/refund-policy" />
              <table className="w-full min-w-[900px] text-xs">
                <thead className="text-muted"><tr><th className="p-1 text-start">المرحلة</th><th className="p-1 text-start">السبب</th><th className="p-1 text-start">المسؤول</th><th className="p-1 text-start">رد رسوم المشتري %</th><th className="p-1 text-start">عكس رسوم البائع %</th><th className="p-1 text-start">الشحن</th><th className="p-1 text-start">شحن الإرجاع على</th><th className="p-1 text-start">رسوم التحويل على</th><th className="p-1 text-start">مراجعة يدوية</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r?.id ?? `new-${i}`} className="border-t border-line">
                      {editable ? (
                        <>
                          <td className="p-1"><Select name={`r${i}_stage`} defaultValue={r?.lifecycleStage ?? ''} aria-label="المرحلة" className="w-auto text-xs"><option value="">—</option>{REFUND_LIFECYCLE_STAGES.map((x) => <option key={x}>{x}</option>)}</Select></td>
                          <td className="p-1">{sel(`r${i}_reason`, REFUND_REASON_CODES, r?.reasonCode ?? 'OTHER', 'السبب')}</td>
                          <td className="p-1">{sel(`r${i}_party`, RESPONSIBLE_PARTIES, r?.responsibleParty ?? 'UNDETERMINED', 'المسؤول')}</td>
                          <td className="p-1"><Input name={`r${i}_buyer`} defaultValue={r ? pctIn(r.buyerFeeRefundBps) : '100'} className="ltr w-16" aria-label="رد رسوم المشتري" /></td>
                          <td className="p-1"><Input name={`r${i}_seller`} defaultValue={r ? pctIn(r.sellerFeeReversalBps) : '100'} className="ltr w-16" aria-label="عكس رسوم البائع" /></td>
                          <td className="p-1">{sel(`r${i}_shipping`, SHIPPING_REFUND_RULES, r?.shippingRefund ?? 'MANUAL', 'الشحن')}</td>
                          <td className="p-1">{sel(`r${i}_returnPayer`, RESPONSIBLE_PARTIES, r?.returnShippingPayer ?? 'UNDETERMINED', 'شحن الإرجاع')}</td>
                          <td className="p-1">{sel(`r${i}_transferPayer`, RESPONSIBLE_PARTIES, r?.transferCostPayer ?? 'EDMN', 'رسوم التحويل')}</td>
                          <td className="p-1"><Checkbox name={`r${i}_manual`} label="" defaultChecked={r?.manualReview ?? true} /></td>
                        </>
                      ) : (
                        <>
                          <td className="p-1">{r!.lifecycleStage}</td><td className="p-1">{r!.reasonCode}</td><td className="p-1">{r!.responsibleParty}</td><td className="p-1">{pctOf(r!.buyerFeeRefundBps)}</td><td className="p-1">{pctOf(r!.sellerFeeReversalBps)}</td><td className="p-1">{r!.shippingRefund}</td><td className="p-1">{r!.returnShippingPayer}</td><td className="p-1">{r!.transferCostPayer}</td><td className="p-1">{r!.manualReview ? 'نعم' : 'لا'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable && <div className="flex flex-wrap items-end gap-2"><Input name="reason" required minLength={3} placeholder="سبب التعديل" aria-label="سبب التعديل" className="w-56" /><SubmitButton size="sm">حفظ القواعد</SubmitButton></div>}
            </ActionForm>
            {editable && (
              <ActionForm action={refundPolicyAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                <input type="hidden" name="op" value="publish" /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="back" value="/admin/finance/pricing/refund-policy" />
                <Checkbox name="legalReviewed" label="أؤكد اكتمال المراجعة القانونية لهذه السياسة" />
                <Input name="legalPolicyVersion" placeholder="رقم إصدار السياسة القانونية" aria-label="رقم إصدار السياسة القانونية" className="w-48" />
                <Input name="reason" placeholder="سبب النشر" aria-label="سبب النشر" className="w-48" />
                <SubmitButton size="sm" variant="outline">نشر (2FA)</SubmitButton>
              </ActionForm>
            )}
          </section>
        );
      })}
      {canManage && !draft && (
        <ActionForm action={refundPolicyAction} className="flex gap-2">
          <input type="hidden" name="op" value="createDraft" /><input type="hidden" name="from" value={published?.id ?? versions[0]?.id ?? ''} /><input type="hidden" name="back" value="/admin/finance/pricing/refund-policy" />
          <SubmitButton size="sm" variant="outline">مسودة جديدة</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
