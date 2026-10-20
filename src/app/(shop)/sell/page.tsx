import Link from '@/ui/link';
import type { Metadata } from 'next';
import { BadgeCheck, BarChart3, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { startSellerAction } from '@/app/_actions/seller-onboarding';
import { currentUser } from '@/server/web/session';
import { sellerContextForUser } from '@/server/modules/sellers/service';
import { LinkButton } from '@/ui/button';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Radio } from '@/ui/form';

export const metadata: Metadata = { title: 'بيع على اضمن', description: 'افتح متجرك على اضمن ووصّل لعملاء في كل محافظات مصر.', alternates: { canonical: '/sell' } };

export default async function SellLanding() {
  const user = await currentUser();
  const seller = user ? await sellerContextForUser(user.id) : null;
  return (
    <div className="container-page space-y-10 py-8">
      <section className="grid items-center gap-8 rounded-3xl bg-brand-900 p-6 text-white sm:p-12 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">بيع منتجاتك الجديدة والمستعملة لعملاء في كل مصر</h1>
          <p className="text-white/80">سجّل كفرد أو شركة، وبعد مراجعة بياناتك تقدر تضيف منتجاتك، تحدد مصاريف الشحن لكل محافظة، وتسحب مستحقاتك بعد استلام العميل وموافقة الإدارة.</p>
          {seller ? (
            <LinkButton href="/seller" size="lg" className="bg-white text-brand-950 shadow-none hover:bg-brand-50">روح لمركز البائع</LinkButton>
          ) : user ? (
            <ActionForm action={startSellerAction} className="space-y-3 rounded-2xl bg-white p-4 text-ink">
              <p className="font-semibold">نوع الحساب</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Radio name="type" value="INDIVIDUAL" defaultChecked label="فرد" description="هتبيع باسمك الشخصي" />
                <Radio name="type" value="BUSINESS" label="شركة / نشاط تجاري" description="عندك سجل تجاري" />
              </div>
              <SubmitButton size="lg" className="w-full">سجّل كبائع</SubmitButton>
            </ActionForm>
          ) : (
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/seller/register" size="lg" className="bg-white text-brand-950 shadow-none hover:bg-brand-50">اعمل حساب وابدأ</LinkButton>
              <LinkButton href="/seller/login" size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">عندي حساب</LinkButton>
            </div>
          )}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            [BadgeCheck, 'شارة البائع الموثّق', 'بعد مراجعة هويتك، متجرك بيظهر كمتجر موثّق.'],
            [Truck, 'تحكم كامل في الشحن', 'حدد السعر ومدة التوصيل لكل محافظة.'],
            [Wallet, 'مستحقات واضحة', 'رصيدك بيبقى متاح للسحب بعد استلام العميل وموافقة الإدارة على الإتاحة.'],
            [BarChart3, 'لوحة تحكم واضحة', 'مبيعاتك، طلباتك، مخزونك ورصيدك في مكان واحد.'],
          ].map(([I, t, b]) => {
            const Icon = I as typeof BadgeCheck;
            return (
              <li key={t as string} className="rounded-2xl bg-white/10 p-4">
                <Icon className="mb-2 size-6 text-sky-300" aria-hidden />
                <p className="font-semibold">{t as string}</p>
                <p className="text-sm text-white/75">{b as string}</p>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-3 text-lg font-bold">خطوات الانضمام</h2>
          <ol className="list-inside list-decimal space-y-2 text-sm">
            <li>بيانات الهوية والعنوان (الرقم القومي وصورة البطاقة).</li>
            <li>بيانات النشاط للشركات (السجل التجاري والبطاقة الضريبية حسب السياسة).</li>
            <li>بيانات المتجر وعنوان الإرجاع.</li>
            <li>بيانات استلام الأموال (حساب بنكي / إنستاباي / محفظة).</li>
            <li>الموافقة على اتفاقية البائع وإرسال الطلب للمراجعة.</li>
          </ol>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-emerald-600" /> بيانات الهوية متشفّرة، ومحدش بيشوفها غير فريق المراجعة المختص.</p>
        </div>
        <div className="card p-6">
          <h2 className="mb-3 text-lg font-bold">الرسوم والعمولات</h2>
          {/* Fees come from the published pricing version (fee engine); the legacy commission table no longer prices anything. */}
          <p className="text-sm text-muted">الرسوم بتتحسب وقت البيع حسب نسخة التسعير المعتمدة، ومش بتتغير على الطلبات اللي فاتت. التفاصيل في صفحة <Link href="/legal/fees" className="text-brand-700 underline">الرسوم والعمولات</Link>.</p>
        </div>
      </section>
    </div>
  );
}
