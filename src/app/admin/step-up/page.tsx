import { adminStepUpAction } from '@/app/_actions/admin-auth';
import { requireAdmin } from '@/server/web/session';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Input } from '@/ui/form';

export const metadata = { title: 'تأكيد الهوية' };

export default async function StepUp(props: PageProps<'/admin/step-up'>) {
  await requireAdmin();
  const next = (await props.searchParams).next;
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-4">
      <ActionForm action={adminStepUpAction} className="card w-full max-w-sm space-y-3 p-6">
        <h1 className="text-lg font-bold">تأكيد الهوية لإجراء مالي حساس</h1>
        <p className="text-sm text-muted">أدخل رمز المصادقة الثنائية. صالح لمدة 10 دقائق.</p>
        <input type="hidden" name="next" value={typeof next === 'string' ? next : '/admin'} />
        <Field label="الرمز" htmlFor="code"><Input id="code" name="code" inputMode="numeric" maxLength={6} required dir="ltr" className="text-center text-lg tracking-widest" /></Field>
        <SubmitButton className="w-full">تأكيد</SubmitButton>
      </ActionForm>
    </main>
  );
}
