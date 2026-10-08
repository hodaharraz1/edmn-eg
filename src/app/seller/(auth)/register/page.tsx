import type { Metadata } from 'next';
import Link from '@/ui/link';
import { redirect } from 'next/navigation';
import { sellerRegisterAction } from '@/app/_actions/seller-auth';
import { startSellerAction } from '@/app/_actions/seller-onboarding';
import { ActionForm, FieldError, SubmitButton } from '@/ui/action-form';
import { Checkbox, Field, Input, Radio } from '@/ui/form';
import { currentUser } from '@/server/web/session';
import { marketHref } from '@/lib/market-url';
import { sellerContextForUser } from '@/server/modules/sellers/service';

export const metadata: Metadata = { title: 'التسجيل كبائع' };

function AccountType() {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-semibold">نوع حساب البائع</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <Radio name="type" value="INDIVIDUAL" defaultChecked label="فرد" description="تبيع باسمك الشخصي ببطاقة الرقم القومي" />
        <Radio name="type" value="BUSINESS" label="شركة / نشاط تجاري" description="لديك سجل تجاري وبطاقة ضريبية" />
      </div>
    </fieldset>
  );
}

export default async function SellerRegisterPage() {
  const user = await currentUser();
  if (user && (await sellerContextForUser(user.id))) redirect('/seller');
  return (
    <>
      <h2 className="mb-1 text-xl font-bold">التسجيل كبائع على اضمن</h2>
      <p className="mb-6 text-sm text-muted">
        بعد التسجيل ستكمل بيانات الهوية، المتجر، عنوان المرتجعات، المستندات وطريقة استلام الأرباح، ثم نراجع طلبك.
      </p>
      {user ? (
        <ActionForm action={startSellerAction} className="space-y-4">
          <p className="rounded-lg bg-page p-3 text-sm">
            مسجّل الدخول باسم <span className="font-semibold">{user.fullName}</span>. سيُربط المتجر بهذا الحساب.
          </p>
          <AccountType />
          <SubmitButton className="w-full" size="lg">ابدأ طلب التسجيل كبائع</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={sellerRegisterAction} className="space-y-4">
          <AccountType />
          <Field label="الاسم بالكامل (كما في البطاقة)" htmlFor="fullName" required>
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
                أوافق على <Link href={marketHref('/legal/terms')} className="text-brand-700 underline" target="_blank">شروط الاستخدام</Link> و<Link href={marketHref('/legal/privacy')} className="text-brand-700 underline" target="_blank">سياسة الخصوصية</Link>. اتفاقية البائع تُعرض للموافقة قبل إرسال الطلب.
              </>
            }
          />
          <SubmitButton className="w-full" size="lg" pendingText="جارٍ إنشاء الحساب…">إنشاء حساب بائع</SubmitButton>
        </ActionForm>
      )}
      <p className="mt-6 text-center text-sm">
        عندك حساب بائع؟ <Link href="/seller/login" className="font-semibold text-brand-700 hover:underline">سجّل الدخول</Link>
      </p>
    </>
  );
}
