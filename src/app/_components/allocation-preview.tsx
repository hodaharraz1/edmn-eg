'use client';

import { ActionForm, SubmitButton, useFormState, type FormAction } from '@/ui/action-form';
import { Input, Select } from '@/ui/form';

function Plan() {
  const s = useFormState();
  const plan = s.data?.plan as { source: string; amount: string }[] | undefined;
  if (!plan?.length) return null;
  return (
    <ul className="w-full space-y-1 rounded-lg bg-page p-3 text-sm" data-testid="allocation-preview">
      {plan.map((p, i) => <li key={i} className="flex justify-between gap-2"><span>{p.source}</span><b className="tabular-nums">{p.amount}</b></li>)}
    </ul>
  );
}

/** Amount + destination, with a read-only preview of the source split before requesting. */
export function AccountWithdrawalForm({ preview, request, destinations, clientKey }: { preview: FormAction; request: FormAction; destinations: { value: string; label: string }[]; clientKey: string }) {
  return (
    <div className="space-y-3" data-testid="account-withdrawal">
      <ActionForm action={preview} className="flex flex-wrap items-end gap-2">
        <Input name="amount" required inputMode="decimal" className="ltr w-36" placeholder="المبلغ" aria-label="مبلغ السحب للمعاينة" />
        <Select name="destination" aria-label="وجهة الصرف للمعاينة" className="w-auto">{destinations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</Select>
        <SubmitButton variant="outline" size="sm">احسب التوزيع</SubmitButton>
        <Plan />
      </ActionForm>
      <ActionForm action={request} className="flex flex-wrap items-end gap-2" resetOnSuccess>
        <input type="hidden" name="clientKey" value={clientKey} />
        <Input name="amount" required inputMode="decimal" className="ltr w-36" placeholder="المبلغ" aria-label="مبلغ السحب" />
        <Select name="destination" aria-label="وجهة الصرف" className="w-auto">{destinations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</Select>
        <SubmitButton>طلب سحب</SubmitButton>
      </ActionForm>
    </div>
  );
}
