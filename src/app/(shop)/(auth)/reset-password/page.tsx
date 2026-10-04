import type { Metadata } from 'next';
import { resetPasswordAction } from '@/app/_actions/auth';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Input } from '@/ui/form';
import { Alert } from '@/ui/feedback';

export const metadata: Metadata = { title: 'تعيين كلمة مرور جديدة', robots: { index: false } };

export default async function ResetPasswordPage(props: PageProps<'/reset-password'>) {
  const sp = await props.searchParams;
  const token = typeof sp.token === 'string' ? sp.token : '';
  if (!token) return <Alert tone="danger">الرابط غير صالح.</Alert>;
  return (
    <>
      <h1 className="mb-6 text-xl font-bold">تعيين كلمة مرور جديدة</h1>
      <ActionForm action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="كلمة المرور الجديدة" htmlFor="password" required>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <Field label="تأكيد كلمة المرور" htmlFor="confirm" required>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <SubmitButton className="w-full" size="lg">حفظ</SubmitButton>
      </ActionForm>
    </>
  );
}
