import { redirect } from 'next/navigation';
import { LogoImage } from '@/ui/logo';
import { adminHasTotp, adminTotpVerifyAction } from '@/app/_actions/admin-auth';
import { getAdminSession } from '@/server/web/session';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Input } from '@/ui/form';
import { Enroll } from './enroll';

export const metadata = { title: 'التحقق بخطوتين' };

export default async function Admin2fa() {
  const s = await getAdminSession();
  if (!s) redirect('/admin/login');
  if (s.session.mfaVerifiedAt) redirect('/admin');
  const enrolled = await adminHasTotp();
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-4">
      <div className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex justify-center"><LogoImage variant="auth" /></div>
        <h1 className="text-lg font-bold">التحقق بخطوتين</h1>
        {!enrolled && <Enroll />}
        <ActionForm action={adminTotpVerifyAction} className="space-y-3">
          <Field label="الرمز المكون من 6 أرقام من تطبيق المصادقة" htmlFor="code" required>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required dir="ltr" className="text-center text-lg tracking-widest" />
          </Field>
          <SubmitButton className="w-full">تحقق</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
