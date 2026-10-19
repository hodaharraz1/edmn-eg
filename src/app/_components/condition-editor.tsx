import { CheckCircle2, CircleAlert, Lock, Trash2 } from 'lucide-react';
import { usedAddEvidenceAction, usedDeclareAction, usedRemoveEvidenceAction, usedSaveAnswersAction } from '@/app/_actions/used';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { mediaUrl } from '@/ui/commerce';
import { Alert } from '@/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/ui/form';
import { cn } from '@/lib/cn';
import { USED_FIELD_GROUP_LABELS, USED_FIELD_GROUPS, type UsedAnswers } from '@/domain/used';
import type { ReportBundle } from '@/server/modules/used/reports';
import { PassportLink } from './used';

/**
 * Seller-side guided documentation of a used item: structured condition (from the category policy), the device
 * identifier (stored encrypted, shown masked), guided evidence slots, and the declaration. Shared by marketplace
 * listings (mode="product") and protected deals (mode="deal").
 */
export function ConditionEditor({ b, mode, back }: { b: ReportBundle; mode: 'product' | 'deal'; back: string }) {
  const answers = (b.report.answers ?? {}) as UsedAnswers;
  const locked = b.report.status === 'LOCKED';
  const pct = Math.round(((b.check.conditionCompleteness + b.check.evidenceCompleteness) / 2) * 100);
  const hidden = (
    <>
      <input type="hidden" name="reportId" value={b.report.id} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  const bySlot = (code: string) => b.evidence.filter((e) => e.slot === code);
  return (
    <div className="space-y-6" data-testid="condition-editor" data-status={b.report.status}>
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">اكتمال التوثيق</h2>
          <span className="ltr text-sm font-bold text-brand-700" data-testid="completeness">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
        </div>
        {locked ? (
          <Alert tone="info" title="الحالة متثبتة في اتفاق">
            <Lock className="inline size-4" aria-hidden /> البيانات دي اتجمّدت لما المشتري وافق على العرض، ومينفعش تتعدل. لو ظهر تغيير جوهري قبل الشحن، اقترح «تعديل على الحالة» من صفحة الصفقة والمشتري يوافق عليه.
          </Alert>
        ) : b.check.complete ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden /> البيانات والصور كاملة{b.report.status === 'DECLARED' ? ' ومقرّ بيها.' : ' — فاضل الإقرار تحت.'}
          </p>
        ) : (
          <ul className="list-inside list-disc text-sm text-muted">
            {b.check.problems.slice(0, 8).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {b.passport && <PassportLink code={b.passport.code} level={b.passport.level as 'PROTECTED'} />}
      </section>

      <ActionForm action={usedSaveAnswersAction} className="card space-y-5 p-5" data-testid="condition-form">
        {hidden}
        <h2 className="text-lg font-bold">بيانات الحالة — {b.policy.title}</h2>
        {USED_FIELD_GROUPS.map((g) => {
          const fields = b.policy.fields.filter((f) => f.group === g);
          if (!fields.length) return null;
          return (
            <fieldset key={g} disabled={locked} className="space-y-3">
              <legend className="mb-1 text-sm font-bold text-brand-800">{USED_FIELD_GROUP_LABELS[g]}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => {
                  const id = `f_${f.code}`;
                  const v = answers[f.code];
                  if (f.identifier)
                    return (
                      <Field key={f.code} label={f.label} htmlFor={id} required={f.required} hint={b.report.identifierMasked ? `محفوظ: ${b.report.identifierMasked} — اكتب الرقم تاني بس لو عايز تغيّره. ${f.hint ?? ''}` : f.hint}>
                        <Input id={id} name={id} dir="ltr" inputMode="text" autoComplete="off" placeholder={b.report.identifierMasked ?? ''} />
                      </Field>
                    );
                  if (f.type === 'SELECT')
                    return (
                      <Field key={f.code} label={f.label} htmlFor={id} required={f.required} hint={f.hint}>
                        <Select id={id} name={id} defaultValue={typeof v === 'string' ? v : ''}>
                          <option value="">— اختار —</option>
                          {f.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </Select>
                      </Field>
                    );
                  if (f.type === 'BOOLEAN')
                    return (
                      <Field key={f.code} label={f.label} htmlFor={id} required={f.required} hint={f.hint}>
                        <Select id={id} name={id} defaultValue={v === true ? 'true' : v === false ? 'false' : ''}>
                          <option value="">— اختار —</option>
                          <option value="true">أيوه</option>
                          <option value="false">لأ</option>
                        </Select>
                      </Field>
                    );
                  if (f.type === 'NUMBER')
                    return (
                      <Field key={f.code} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} htmlFor={id} required={f.required} hint={f.hint}>
                        <Input id={id} name={id} type="number" inputMode="numeric" min={f.min} max={f.max} defaultValue={typeof v === 'number' ? v : ''} dir="ltr" />
                      </Field>
                    );
                  return (
                    <Field key={f.code} label={f.label} htmlFor={id} required={f.required} hint={f.hint} className="sm:col-span-2">
                      <Input id={id} name={id} defaultValue={typeof v === 'string' ? v : ''} maxLength={500} />
                    </Field>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        {!locked && <SubmitButton pendingText="جاري الحفظ…">حفظ البيانات</SubmitButton>}
      </ActionForm>

      <section className="card space-y-4 p-5" data-testid="evidence-slots">
        <h2 className="text-lg font-bold">صور التوثيق</h2>
        <p className="text-sm text-muted">صور حقيقية للقطعة نفسها. البيانات الوصفية للصور (زي المكان) بتتشال تلقائيًا. الصور المقفولة 🔒 مش بتظهر للعامة.</p>
        <ul className="grid gap-4 md:grid-cols-2">
          {b.policy.evidence.map((s) => {
            const items = bySlot(s.code);
            const needed = s.required || (s.requiredWhenDefects && b.check.defects.length > 0);
            return (
              <li key={s.code} className={cn('space-y-3 rounded-2xl p-4 ring-1', needed && !items.length ? 'bg-amber-50 ring-amber-200' : 'bg-slate-50 ring-line')} data-slot={s.code}>
                <p className="flex items-center justify-between gap-2 text-sm font-bold">
                  <span>
                    {s.label}
                    {s.private ? ' 🔒' : ''}
                    {needed ? ' *' : ' (اختياري)'}
                  </span>
                  <span className="text-xs text-muted">{items.length}/{s.maxFiles}</span>
                </p>
                {s.hint && <p className="text-xs text-muted">{s.hint}</p>}
                {items.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {items.map((e) => (
                      <li key={e.id} className="relative">
                        <img src={e.visibility === 'PRIVATE' ? `/api/files/${e.fileId}` : (mediaUrl(e.storageKey, 'thumb') ?? '')} alt={s.label} className="size-20 rounded-xl object-cover ring-1 ring-line" />
                        {!locked && (
                          <form action={usedRemoveEvidenceAction} className="absolute -top-2 -end-2">
                            {hidden}
                            <input type="hidden" name="evidenceId" value={e.id} />
                            <button type="submit" aria-label={`حذف صورة ${s.label}`} className="grid size-8 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-line hover:bg-red-50">
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!locked && items.length < s.maxFiles && (
                  <ActionForm action={usedAddEvidenceAction} encType="multipart/form-data" className="space-y-2" resetOnSuccess>
                    {hidden}
                    <input type="hidden" name="slot" value={s.code} />
                    <FileInput name="files" multiple={s.maxFiles - items.length > 1} label={`ارفع ${s.label}`} />
                    <SubmitButton size="sm" variant="secondary" pendingText="جاري الرفع…">رفع</SubmitButton>
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {!locked && (
        <ActionForm action={usedDeclareAction} className="card space-y-3 border-brand-200 p-5" data-testid="declare-form">
          {hidden}
          <h2 className="text-lg font-bold">الإقرار</h2>
          <p className="rounded-xl bg-brand-50 p-3 text-sm leading-7 text-brand-950">{b.policy.declaration}</p>
          {!b.check.complete && (
            <p className="flex items-center gap-2 text-sm text-amber-800">
              <CircleAlert className="size-4" aria-hidden /> كمّل البيانات والصور الأول.
            </p>
          )}
          <Checkbox name="declare" label="أقر بإن البيانات والصور دي صحيحة وبتمثل حالة المنتج الفعلية" required />
          <SubmitButton pendingText="جاري التأكيد…">{b.report.status === 'DECLARED' ? 'تأكيد الإقرار تاني' : 'أقر وأنشئ جواز المنتج'}</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
