import type { Metadata } from 'next';
import Link from 'next/link';
import { forgotPasswordAction } from '@/app/_actions/auth';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Input } from '@/ui/form';

export const metadata: Metadata = { title: 'استعادة كلمة المرور', robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">نسيت كلمة المرور؟</h1>
      <p className="mb-6 text-sm text-muted">اكتب بريدك أو رقم موبايلك وهنبعتلك رابط تغيّر بيه كلمة المرور.</p>
      <ActionForm action={forgotPasswordAction} className="space-y-4" resetOnSuccess>
        <Field label="البريد الإلكتروني أو رقم الموبايل" htmlFor="identifier" required>
          <Input id="identifier" name="identifier" required dir="ltr" className="text-start" />
        </Field>
        <SubmitButton className="w-full" size="lg">ابعت الرابط</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">ارجع لتسجيل الدخول</Link></p>
    </>
  );
}
