import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sellerLoginAction } from '@/app/_actions/seller-auth';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Field, Input } from '@/ui/form';
import { currentUser } from '@/server/web/session';
import { sellerContextForUser } from '@/server/modules/sellers/service';
import { safeNext } from '@/server/web/action';

export const metadata: Metadata = { title: 'دخول البائعين' };

export default async function SellerLoginPage(props: PageProps<'/seller/login'>) {
  const sp = await props.searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null, '/seller');
  const user = await currentUser();
  if (user) redirect((await sellerContextForUser(user.id)) ? next : '/seller/register');
  return (
    <>
      <h2 className="mb-1 text-xl font-bold">دخول البائعين</h2>
      <p className="mb-6 text-sm text-muted">سجّل الدخول لإدارة متجرك على اضمن.</p>
      <ActionForm action={sellerLoginAction} className="space-y-4">
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
        <SubmitButton className="w-full" size="lg" pendingText="جارٍ الدخول…">دخول مركز البائع</SubmitButton>
      </ActionForm>
      <div className="mt-6 rounded-xl bg-page p-4 text-center text-sm">
        <p className="font-semibold">لسه ما عندكش متجر على اضمن؟</p>
        <Link href="/seller/register" className="mt-1 inline-block font-semibold text-brand-700 hover:underline">سجّل كبائع جديد (فرد أو شركة)</Link>
      </div>
    </>
  );
}
