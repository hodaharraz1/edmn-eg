import type { Metadata } from 'next';
import Link from 'next/link';
import { registerAction } from '@/app/_actions/auth';
import { ActionForm, FieldError, SubmitButton } from '@/ui/action-form';
import { Checkbox, Field, Input } from '@/ui/form';

export const metadata: Metadata = { title: 'إنشاء حساب', robots: { index: false } };

export default async function RegisterPage(props: PageProps<'/register'>) {
  const sp = await props.searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '/';
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">إنشاء حساب جديد</h1>
      <p className="mb-6 text-sm text-muted">حساب واحد للتسوق، الصفقات المحمية، والبيع على اضمن.</p>
      <ActionForm action={registerAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="الاسم بالكامل" htmlFor="fullName" required>
          <Input id="fullName" name="fullName" autoComplete="name" required minLength={3} />
          <FieldError name="fullName" />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email" required>
          <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" className="text-start" />
          <FieldError name="email" />
        </Field>
        <Field label="رقم الموبايل" htmlFor="phone" required hint="مثال: 01012345678">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" required dir="ltr" className="text-start" inputMode="tel" />
          <FieldError name="phone" />
        </Field>
        <Field label="كلمة المرور" htmlFor="password" required hint="8 أحرف على الأقل وتحتوي على حروف وأرقام">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
          <FieldError name="password" />
        </Field>
        <Checkbox
          name="terms"
          required
          label={
            <>
              أوافق على <Link href="/legal/terms" className="text-brand-700 underline" target="_blank">شروط الاستخدام</Link> و<Link href="/legal/privacy" className="text-brand-700 underline" target="_blank">سياسة الخصوصية</Link>
            </>
          }
        />
        <SubmitButton className="w-full" size="lg" pendingText="جارٍ إنشاء الحساب…">إنشاء حساب</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm">
        لديك حساب بالفعل؟{' '}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-700 hover:underline">سجّل الدخول</Link>
      </p>
    </>
  );
}
