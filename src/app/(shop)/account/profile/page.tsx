import { updateProfileAction } from '@/app/_actions/account';
import { currentUser } from '@/server/web/session';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Field, Input } from '@/ui/form';
import Link from 'next/link';

export const metadata = { title: 'الملف الشخصي' };

export default async function ProfilePage() {
  const user = (await currentUser())!;
  return (
    <div className="space-y-4">
      <PageHeader title="الملف الشخصي" />
      <ActionForm action={updateProfileAction} className="card max-w-xl space-y-4 p-5" successMessage="تم الحفظ">
        <Field label="الاسم بالكامل" htmlFor="fullName"><Input id="fullName" name="fullName" defaultValue={user.fullName} required /></Field>
        <Field label="البريد الإلكتروني" htmlFor="email" hint="لتغيير البريد أو الموبايل تواصل مع الدعم"><Input id="email" value={user.email ?? ''} disabled dir="ltr" /></Field>
        <Field label="رقم الموبايل" htmlFor="phone"><Input id="phone" value={user.phone ?? ''} disabled dir="ltr" /></Field>
        <SubmitButton>حفظ</SubmitButton>
      </ActionForm>
      <p className="text-xs text-muted">لطلب حذف الحساب والبيانات راجع <Link href="/legal/data-deletion" className="underline">سياسة حذف البيانات</Link> ثم افتح تذكرة دعم من نوع «الحساب».</p>
    </div>
  );
}
