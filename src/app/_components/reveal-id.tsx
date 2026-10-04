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
