import { ShieldCheck } from 'lucide-react';
import { adminLoginAction } from '@/app/_actions/admin-auth';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Input } from '@/ui/form';
import { Logo } from '@/ui/logo';

export const metadata = { title: 'دخول الإدارة' };

export default function AdminLogin() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center text-brand-900"><Logo href="/admin/login" /></div>
        <ActionForm action={adminLoginAction} className="card space-y-4 p-6">
          <h1 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="size-5 text-brand-700" /> دخول فريق اضمن</h1>
          <Field label="البريد الإلكتروني" htmlFor="email" required><Input id="email" name="email" type="email" autoComplete="username" dir="ltr" required /></Field>
          <Field label="كلمة المرور" htmlFor="password" required><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
          <SubmitButton className="w-full">متابعة</SubmitButton>
          <p className="text-xs text-muted">الدخول للموظفين المصرح لهم فقط. المصادقة الثنائية إلزامية وكل الإجراءات مسجلة.</p>
        </ActionForm>
      </div>
    </main>
  );
}
