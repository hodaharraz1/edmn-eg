import type { Metadata } from 'next';
import Link from '@/ui/link';
import { redirect } from 'next/navigation';
import { loginAction } from '@/app/_actions/auth';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Input } from '@/ui/form';
import { Alert } from '@/ui/feedback';
import { safeNext } from '@/server/web/action';
import { currentUser } from '@/server/web/session';

export const metadata: Metadata = { title: 'تسجيل الدخول', robots: { index: false } };

export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null, '/');
  if (await currentUser()) redirect(next);
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">تسجيل الدخول</h1>
      <p className="mb-6 text-sm text-muted">أهلاً بيك في اضمن. سجّل دخولك عشان تتابع طلباتك.</p>
      {sp.reset && <Alert tone="success" className="mb-4">كلمة المرور اتغيّرت. سجّل دخولك بالكلمة الجديدة.</Alert>}
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="البريد الإلكتروني أو رقم الموبايل" htmlFor="identifier" required>
          <Input id="identifier" name="identifier" autoComplete="username" required dir="ltr" className="text-start" />
        </Field>
        <Field label="كلمة المرور" htmlFor="password" required>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="flex justify-end text-sm">
          <Link href="/forgot-password" className="text-brand-700 hover:underline">نسيت كلمة المرور؟</Link>
        </div>
        <SubmitButton className="w-full" size="lg" pendingText="بنسجّل دخولك…">تسجيل الدخول</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm">
        معندكش حساب؟{' '}
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-700 hover:underline">
          اعمل حساب جديد
        </Link>
      </p>
    </>
  );
}
