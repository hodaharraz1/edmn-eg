'use client';

import { useState } from 'react';
import { RETURN_CONDITION_KEYS, RETURN_CONDITION_LABELS, RETURN_SHIPPING_LABELS, RETURN_SHIPPING_PAYERS, NO_VOLUNTARY_TEXT, type ReturnPolicy } from '@/domain/return-policy';
import { Field, Input, Select, Textarea } from '@/ui/form';

/**
 * Seller's voluntary return policy (fields prefixed "rp_"). Choosing "no voluntary returns" never
 * removes the buyer's right to report a defective / wrong / damaged / not-as-described item.
 */
export function ReturnPolicyFields({ defaults, mandatoryNotice, title = 'سياسة الاسترجاع' }: { defaults?: Partial<ReturnPolicy> | null; mandatoryNotice: string; title?: string }) {
  const [type, setType] = useState<'VOLUNTARY' | 'NONE'>(defaults?.type ?? 'VOLUNTARY');
  return (
    <fieldset className="space-y-3 rounded-xl border border-line p-4" data-testid="return-policy-fields">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={title}>
        {(['VOLUNTARY', 'NONE'] as const).map((t) => (
          <label key={t} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${type === t ? 'border-brand-500 bg-brand-50' : 'border-line'}`}>
            <input type="radio" name="rp_type" value={t} checked={type === t} onChange={() => setType(t)} className="mt-1" />
            <span className="font-semibold">{t === 'VOLUNTARY' ? 'يسمح بالاسترجاع الاختياري' : 'لا يوفر استرجاعًا اختياريًا'}</span>
          </label>
        ))}
      </div>
      {type === 'VOLUNTARY' ? (
        <div className="space-y-3">
          <Field label="مدة الاسترجاع (أيام من الاستلام)" htmlFor="rp_windowDays" required>
            <Input id="rp_windowDays" name="rp_windowDays" type="number" min={1} max={90} inputMode="numeric" defaultValue={defaults?.windowDays ?? 3} required />
          </Field>
          <div className="space-y-1">
            <p className="text-sm font-medium">شروط الاسترجاع</p>
            {RETURN_CONDITION_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="rp_conditions" value={k} defaultChecked={defaults?.conditions ? defaults.conditions.includes(k) : true} /> {RETURN_CONDITION_LABELS[k]}
              </label>
            ))}
          </div>
          <Field label="مسؤولية شحن الإرجاع" htmlFor="rp_shippingPayer">
            <Select id="rp_shippingPayer" name="rp_shippingPayer" defaultValue={defaults?.shippingPayer ?? 'BY_REASON'}>
              {RETURN_SHIPPING_PAYERS.map((p) => <option key={p} value={p}>{RETURN_SHIPPING_LABELS[p]}</option>)}
            </Select>
          </Field>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{NO_VOLUNTARY_TEXT} {mandatoryNotice}</p>
      )}
      <Field label="ملاحظات الاسترجاع (اختياري)" htmlFor="rp_notes"><Textarea id="rp_notes" name="rp_notes" rows={2} defaultValue={defaults?.notes ?? ''} maxLength={1000} /></Field>
      <p className="text-xs text-muted">في كل الأحوال يحق للمشتري الإبلاغ عن منتج معيب أو مختلف عن الوصف أو تالف أو خاطئ أو لم يصل، ولا تُلغي سياسة الاسترجاع ذلك.</p>
    </fieldset>
  );
}
