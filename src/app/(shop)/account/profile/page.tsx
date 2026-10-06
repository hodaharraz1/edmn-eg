import { updateProfileAction } from '@/app/_actions/account';
import { requireUser } from '@/server/web/session';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Field, Input } from '@/ui/form';
import Link from 'next/link';

export const metadata = { title: 'الملف الشخصي' };

export default async function ProfilePage() {
  const user = await requireUser('/account');
  return (
    <div className="space-y-4">
      <PageHeader title="الملف الشخصي" />
      <ActionForm action={updateProfileAction} className="card max-w-xl space-y-4 p-5" successMessage="بياناتك اتحفظت">
        <Field label="الاسم بالكامل" htmlFor="fullName"><Input id="fullName" name="fullName" defaultValue={user.fullName} required /></Field>
        <Field label="البريد الإلكتروني" htmlFor="email" hint="عشان تغيّر البريد أو الموبايل، تواصل معانا"><Input id="email" value={user.email ?? ''} disabled dir="ltr" /></Field>
        <Field label="رقم الموبايل" htmlFor="phone"><Input id="phone" value={user.phone ?? ''} disabled dir="ltr" /></Field>
        <SubmitButton>حفظ</SubmitButton>
      </ActionForm>
      <p className="text-xs text-muted">عشان تطلب حذف حسابك وبياناتك، راجع <Link href="/legal/data-deletion" className="underline">سياسة حذف البيانات</Link> وبعدين افتح تذكرة دعم من نوع «الحساب».</p>
    </div>
  );
}
