import { usedScoreRulesAction } from '@/app/_actions/used';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { getSetting } from '@/server/modules/settings';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Field, Input } from '@/ui/form';
import { SAFETY_FACTOR_LABELS, SAFETY_FACTORS, SAFETY_SCORE_DISCLAIMER } from '@/domain/used';

export const metadata = { title: 'قواعد مؤشر أمان الصفقة' };

/** Weights and thresholds of the explainable Deal Safety Score (settings.manage + fresh 2FA + reason, audited). */
export default async function UsedScoreRules() {
  const { allowed } = await adminWith('settings.manage');
  if (!allowed) return <Forbidden />;
  const r = await getSetting('used.safetyScore');
  return (
    <div className="space-y-5" data-testid="admin-used-score">
      <PageHeader title="قواعد مؤشر أمان الصفقة" description="المؤشر معلومة للمشتري بتشرح نفسها، ومش بيأثر على أي حركة فلوس." />
      <ActionForm action={usedScoreRulesAction} className="card space-y-4 p-5">
        <input type="hidden" name="back" value="/admin/used/score" />
        <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 font-bold">أوزان العوامل (0–50)</legend>
          {SAFETY_FACTORS.map((f) => (
            <Field key={f} label={SAFETY_FACTOR_LABELS[f]} htmlFor={`w_${f}`}><Input id={`w_${f}`} name={`w_${f}`} type="number" min={0} max={50} defaultValue={r.weights[f]} dir="ltr" /></Field>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="حد «مرتفع»" htmlFor="high"><Input id="high" name="high" type="number" min={1} max={100} defaultValue={r.thresholds.high} dir="ltr" /></Field>
          <Field label="حد «متوسط»" htmlFor="medium"><Input id="medium" name="medium" type="number" min={0} max={99} defaultValue={r.thresholds.medium} dir="ltr" /></Field>
          <Field label="عمر الحساب الكامل (يوم)" htmlFor="fullAccountAgeDays"><Input id="fullAccountAgeDays" name="fullAccountAgeDays" type="number" min={1} defaultValue={r.fullAccountAgeDays} dir="ltr" /></Field>
          <Field label="عدد العمليات الكامل" htmlFor="fullCompletedDeals"><Input id="fullCompletedDeals" name="fullCompletedDeals" type="number" min={1} defaultValue={r.fullCompletedDeals} dir="ltr" /></Field>
        </div>
        <Field label="سبب التعديل" htmlFor="reason" required><Input id="reason" name="reason" required minLength={3} /></Field>
        <SubmitButton>حفظ القواعد</SubmitButton>
      </ActionForm>
      <p className="text-xs text-muted">النص اللي بيظهر للمشتري: «{SAFETY_SCORE_DISCLAIMER}»</p>
    </div>
  );
}
