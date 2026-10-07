import { payoutChannelAction } from '@/app/_actions/pricing';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { PAYOUT_CHANNELS } from '@/server/db/schema';
import { channelConfigs } from '@/server/modules/pricing/payout-costs';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, Badge } from '@/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/ui/form';
import { pctOf, PricingNav } from '../_view';

export const metadata = { title: 'تكاليف وحدود التحويل' };
const money = (v: number | null) => (v === null ? 'بدون حد' : formatEGP(v));
const pctIn = (bps: number) => (bps / 100).toFixed(2).replace(/\.?0+$/, '');

export default async function PayoutCosts() {
  const { actor, allowed } = await adminWith(['pricing.view', 'payout_costs.manage']);
  if (!allowed) return <Forbidden />;
  const rows = await channelConfigs();
  const canManage = hasPermission(actor, 'payout_costs.manage');
  const current = PAYOUT_CHANNELS.map((c) => rows.find((r) => r.channel === c && !r.effectiveTo) ?? null);
  return (
    <div className="space-y-4">
      <PageHeader title="تكاليف وحدود قنوات التحويل" description="رسوم التحويل منفصلة تمامًا عن رسوم خدمة اضمن. السياسة الحالية: البائع يتحمل تكلفة التحويل الفعلية المعلنة قبل الطلب. كل تعديل = إصدار جديد (لا يُعدل إصدار قديم) ويسجل في التدقيق." />
      <PricingNav active="payout" />
      <Alert tone="warning">القيم الأولية «غير موثقة» حتى تراجعها المالية مقابل تعريفة البنك/المزود الحالية. لا يتم تقسيم سحب تلقائيًا ولا تغيير القناة بدون إجراء مصرح.</Alert>
      {PAYOUT_CHANNELS.map((ch, i) => {
        const c = current[i];
        return (
          <section key={ch} className="card space-y-2 p-4" data-testid={`channel-${ch}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold">{c?.name ?? ch}</h2>
              {c ? <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'فعالة' : 'موقوفة'}</Badge> : <Badge tone="neutral">غير مضبوطة (السحب عليها متوقف)</Badge>}
              {c?.notes?.startsWith('UNVERIFIED') && <Badge tone="warning">غير موثقة</Badge>}
              {c && <span className="text-xs text-muted">إصدار {c.version} · منذ {formatDate(c.effectiveFrom, true)} · آخر مراجعة {formatDate(c.lastReviewedAt, true)}</span>}
            </div>
            {c && (
              <p className="text-sm">التكلفة: {pctOf(c.costBps)} + {formatEGP(c.costFixed)} (أدنى {formatEGP(c.costMin)}، أقصى {money(c.costMax)}) · {c.payerPolicy === 'SELLER_PAYS' ? 'يتحملها البائع' : 'تتحملها اضمن'} · الحدود: عملية {money(c.maxPerTransaction)}، يوم {money(c.maxPerDay)}، شهر {money(c.maxPerMonth)}، مستفيد/يوم {money(c.recipientMaxPerDay)}، مستفيد/شهر {money(c.recipientMaxPerMonth)} · تحذير عند {pctOf(c.warningThresholdBps)} {c.sourceReference ? `· المصدر: ${c.sourceReference}` : ''}</p>
            )}
            {canManage && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-brand-700">حفظ إصدار جديد</summary>
                <ActionForm action={payoutChannelAction} className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="channel" value={ch} /><input type="hidden" name="back" value="/admin/finance/pricing/payout-costs" />
                  <Field label="الاسم" htmlFor={`${ch}-name`}><Input id={`${ch}-name`} name="name" defaultValue={c?.name ?? ch} /></Field>
                  <Field label="النسبة %" htmlFor={`${ch}-pct`}><Input id={`${ch}-pct`} name="costPct" defaultValue={c ? pctIn(c.costBps) : '0'} className="ltr" /></Field>
                  <Field label="ثابت (ج.م)" htmlFor={`${ch}-fx`}><Input id={`${ch}-fx`} name="costFixed" defaultValue={c ? toInputAmount(c.costFixed) : '0'} className="ltr" /></Field>
                  <Field label="أدنى (ج.م)" htmlFor={`${ch}-min`}><Input id={`${ch}-min`} name="costMin" defaultValue={c ? toInputAmount(c.costMin) : '0'} className="ltr" /></Field>
                  <Field label="أقصى (ج.م)" htmlFor={`${ch}-max`}><Input id={`${ch}-max`} name="costMax" defaultValue={c?.costMax !== null && c ? toInputAmount(c.costMax) : ''} className="ltr" /></Field>
                  <Field label="من يتحمل التكلفة" htmlFor={`${ch}-payer`}><Select id={`${ch}-payer`} name="payerPolicy" defaultValue={c?.payerPolicy ?? 'SELLER_PAYS'}><option value="SELLER_PAYS">البائع</option><option value="EDMN_PAYS">اضمن</option></Select></Field>
                  <Field label="حد العملية (ج.م)" htmlFor={`${ch}-tx`}><Input id={`${ch}-tx`} name="maxPerTransaction" defaultValue={c?.maxPerTransaction ? toInputAmount(c.maxPerTransaction) : ''} className="ltr" /></Field>
                  <Field label="حد يومي (ج.م)" htmlFor={`${ch}-d`}><Input id={`${ch}-d`} name="maxPerDay" defaultValue={c?.maxPerDay ? toInputAmount(c.maxPerDay) : ''} className="ltr" /></Field>
                  <Field label="حد شهري (ج.م)" htmlFor={`${ch}-m`}><Input id={`${ch}-m`} name="maxPerMonth" defaultValue={c?.maxPerMonth ? toInputAmount(c.maxPerMonth) : ''} className="ltr" /></Field>
                  <Field label="حد المستفيد يوميًا" htmlFor={`${ch}-rd`}><Input id={`${ch}-rd`} name="recipientMaxPerDay" defaultValue={c?.recipientMaxPerDay ? toInputAmount(c.recipientMaxPerDay) : ''} className="ltr" /></Field>
                  <Field label="حد المستفيد شهريًا" htmlFor={`${ch}-rm`}><Input id={`${ch}-rm`} name="recipientMaxPerMonth" defaultValue={c?.recipientMaxPerMonth ? toInputAmount(c.recipientMaxPerMonth) : ''} className="ltr" /></Field>
                  <Field label="تحذير عند % من الحد" htmlFor={`${ch}-w`}><Input id={`${ch}-w`} name="warningPct" defaultValue={c ? pctIn(c.warningThresholdBps) : '80'} className="ltr" /></Field>
                  <Field label="يسري من (فارغ = الآن)" htmlFor={`${ch}-eff`}><Input id={`${ch}-eff`} type="datetime-local" name="effectiveFrom" className="ltr" /></Field>
                  <Field label="المصدر/المرجع" htmlFor={`${ch}-src`}><Input id={`${ch}-src`} name="sourceReference" defaultValue={c?.sourceReference ?? ''} /></Field>
                  <Field label="ملاحظات" htmlFor={`${ch}-notes`}><Input id={`${ch}-notes`} name="notes" defaultValue={c?.notes?.startsWith('UNVERIFIED') ? '' : (c?.notes ?? '')} /></Field>
                  <Field label="سبب التعديل" htmlFor={`${ch}-reason`}><Input id={`${ch}-reason`} name="reason" required minLength={3} /></Field>
                  <Checkbox name="isActive" label="فعالة" defaultChecked={c?.isActive ?? true} />
                  <div className="sm:col-span-2 lg:col-span-4"><SubmitButton size="sm">حفظ إصدار جديد (2FA)</SubmitButton></div>
                </ActionForm>
              </details>
            )}
          </section>
        );
      })}
      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-bold">سجل الإصدارات</h2>
        <table className="w-full min-w-[560px] text-xs">
          <thead className="text-muted"><tr><th className="p-1 text-start">القناة</th><th className="p-1 text-start">إصدار</th><th className="p-1 text-start">من</th><th className="p-1 text-start">إلى</th><th className="p-1 text-start">التكلفة</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-line"><td className="p-1">{r.channel}</td><td className="p-1">{r.version}</td><td className="p-1">{formatDate(r.effectiveFrom, true)}</td><td className="p-1">{r.effectiveTo ? formatDate(r.effectiveTo, true) : 'سارية'}</td><td className="p-1">{pctOf(r.costBps)} + {formatEGP(r.costFixed)}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
