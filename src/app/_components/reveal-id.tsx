'use client';

import { ActionForm, SubmitButton, useFormState, type FormAction } from '@/ui/action-form';

function Value() {
  const s = useFormState();
  const v = s.data?.nationalId as string | undefined;
  return v ? <code className="ltr select-all rounded bg-amber-50 px-2 py-1 font-bold">{v}</code> : null;
}

export function RevealNationalId({ action, sellerId }: { action: FormAction; sellerId: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="sellerId" value={sellerId} /><input type="hidden" name="back" value={`/admin/sellers/${sellerId}`} />
      <SubmitButton size="sm" variant="outline">كشف الرقم القومي (مسجل)</SubmitButton>
      <Value />
    </ActionForm>
  );
}

function PayoutRows() {
  const s = useFormState();
  const rows = s.data?.payout as { label: string; value: string }[] | undefined;
  if (!rows) return null;
  return (
    <dl className="mt-2 grid w-full gap-1 rounded-lg bg-amber-50 p-3 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-xs text-muted">{r.label}</dt>
          <dd className="ltr select-all font-semibold">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Reveals full payout details for executing a transfer (step-up + audit enforced server-side). */
export function RevealPayout({ action, kind, id, back }: { action: FormAction; kind: 'withdrawal' | 'deal_payout'; id: string; back: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} />
      <SubmitButton size="sm" variant="outline">عرض بيانات التحويل كاملة (مسجّل)</SubmitButton>
      <PayoutRows />
    </ActionForm>
  );
}
