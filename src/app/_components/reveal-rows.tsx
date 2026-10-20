'use client';

import { ActionForm, SubmitButton, useFormState, type FormAction } from '@/ui/action-form';

function Rows() {
  const s = useFormState();
  const rows = s.data?.rows as { label: string; value: string }[] | undefined;
  if (!rows) return null;
  return (
    <dl className="mt-2 grid w-full gap-1 rounded-xl bg-amber-50 p-3 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-xs text-muted">{r.label}</dt>
          <dd className="ltr select-all font-semibold">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Reveal-on-demand of a sensitive value (permission + fresh 2FA + audit are enforced server-side). */
export function RevealRows({ action, id, back, label }: { action: FormAction; id: string; back: string; label: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} />
      <SubmitButton size="sm" variant="outline">{label}</SubmitButton>
      <Rows />
    </ActionForm>
  );
}
