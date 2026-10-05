'use client';

import { ActionForm, SubmitButton, useFormState, type FormAction } from '@/ui/action-form';
import { Input } from '@/ui/form';

function SecretView() {
  const s = useFormState();
  const secret = s.data?.secret as string | undefined;
  if (!secret) return null;
  return (
    <p className="rounded-lg bg-page p-3 text-xs">
      المفتاح: <code className="ltr select-all font-bold">{secret}</code> — أضفه في Google Authenticator أو Microsoft Authenticator (إدخال يدوي، نوع: على أساس الوقت).
    </p>
  );
}

export function TotpSecret({ action }: { action: FormAction }) {
  return (
    <div className="space-y-3">
      <ActionForm action={action}>
        <input type="hidden" name="op" value="begin" />
        <SubmitButton variant="outline" size="sm">بدء التفعيل</SubmitButton>
        <div className="mt-2"><SecretView /></div>
      </ActionForm>
      <ActionForm action={action} className="flex items-center gap-2">
        <input type="hidden" name="op" value="verify" />
        <Input name="code" placeholder="الرمز من التطبيق" inputMode="numeric" maxLength={6} className="w-40" aria-label="رمز التحقق" />
        <SubmitButton size="sm">تأكيد</SubmitButton>
      </ActionForm>
    </div>
  );
}
