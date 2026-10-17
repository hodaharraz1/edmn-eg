import { updateProfileAction } from '@/app/_actions/account';
import { requireUser } from '@/server/web/session';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Field, Input } from '@/ui/form';
import Link from '@/ui/link';
import { BadgeCheck, Mail, Phone, UserRound } from 'lucide-react';
import { FormSection } from '@/ui/form';

export const metadata = { title: 'الملف الشخصي' };

export default async function ProfilePage() {
  const user = await requireUser('/account');
  const initials = user.fullName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return (
    <div className="space-y-4">
      <PageHeader title="الملف الشخصي" description="بياناتك الأساسية على اضمن." />
      <section className="relative isolate overflow-hidden rounded-2xl bg-brand-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-6">
        <div aria-hidden className="absolute -left-12 -top-12 -z-10 size-48 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-xl font-bold ring-1 ring-white/20" aria-hidden>{initials}</span>
          <div className="min-w-0 space-y-1.5">
            <p className="truncate text-lg font-bold">{user.fullName}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Verified ok={!!user.emailVerifiedAt} icon={Mail} label={user.email ? 'البريد' : 'مفيش بريد'} />
              <Verified ok={!!user.phoneVerifiedAt} icon={Phone} label={user.phone ? 'الموبايل' : 'مفيش موبايل'} />
            </div>
          </div>
        </div>
      </section>
      <FormSection title="البيانات الشخصية" icon={UserRound} description="البريد ورقم الموبايل بيستخدموا لتأمين حسابك وإشعارات طلباتك. تأكيدهم من صفحة «الأمان».">
        <ActionForm action={updateProfileAction} className="max-w-xl space-y-4" successMessage="بياناتك اتحفظت">
          <Field label="الاسم بالكامل" htmlFor="fullName"><Input id="fullName" name="fullName" defaultValue={user.fullName} required /></Field>
          <Field label="البريد الإلكتروني" htmlFor="email" hint="عشان تغيّر البريد أو الموبايل، تواصل معانا"><Input id="email" value={user.email ?? ''} disabled dir="ltr" /></Field>
          <Field label="رقم الموبايل" htmlFor="phone"><Input id="phone" value={user.phone ?? ''} disabled dir="ltr" /></Field>
          <SubmitButton>حفظ</SubmitButton>
        </ActionForm>
      </FormSection>
      <p className="text-xs leading-6 text-muted">عشان تطلب حذف حسابك وبياناتك، راجع <Link href="/legal/data-deletion" className="font-semibold text-brand-700 underline underline-offset-4">سياسة حذف البيانات</Link> وبعدين افتح تذكرة دعم من نوع «الحساب».</p>
    </div>
  );
}

function Verified({ ok, icon: Icon, label }: { ok: boolean; icon: typeof Mail; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ring-1 ${ok ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30' : 'bg-white/10 text-white/75 ring-white/15'}`}>
      {ok ? <BadgeCheck className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />} {label} {ok ? 'مؤكد' : 'غير مؤكد'}
    </span>
  );
}
