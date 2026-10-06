import Link from 'next/link';
import type { Metadata } from 'next';
import { BadgeCheck, BarChart3, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { asc, eq, isNotNull } from 'drizzle-orm';
import { startSellerAction } from '@/app/_actions/seller-onboarding';
import { db } from '@/server/db/client';
import { categories, commissionRules } from '@/server/db/schema';
import { currentUser } from '@/server/web/session';
import { sellerContextForUser } from '@/server/modules/sellers/service';
import { bpsToPercentString } from '@/server/core/money';
import { LinkButton } from '@/ui/button';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Radio } from '@/ui/form';

export const metadata: Metadata = { title: 'بيع على اضمن', description: 'افتح متجرك على اضمن ووصّل لعملاء في كل محافظات مصر.' };

export default async function SellLanding() {
  const user = await currentUser();
  const seller = user ? await sellerContextForUser(user.id) : null;
  const rules = await db
    .select({ name: categories.nameAr, bps: commissionRules.percentBps })
    .from(commissionRules)
    .innerJoin(categories, eq(categories.id, commissionRules.categoryId))
    .where(isNotNull(commissionRules.categoryId))
    .orderBy(asc(commissionRules.percentBps))
    .limit(12);
  return (
    <div className="container-page space-y-10 py-8">
      <section className="grid items-center gap-8 rounded-3xl bg-brand-900 p-8 text-white sm:p-12 lg:grid-cols-2">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">بيع منتجاتك الجديدة والمستعملة لعملاء في كل مصر</h1>
          <p className="text-white/80">سجّل كفرد أو شركة، وبعد مراجعة بياناتك تقدر تضيف منتجاتك، تحدد مصاريف الشحن لكل محافظة، وتسحب أرباحك بعد ما العميل يأكّد الاستلام.</p>
          {seller ? (
            <LinkButton href="/seller" size="lg" className="bg-amber-400 text-brand-950 hover:bg-amber-300">روح لمركز البائع</LinkButton>
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
            <div className="flex gap-2">
              <LinkButton href="/seller/register" size="lg" className="bg-amber-400 text-brand-950 hover:bg-amber-300">اعمل حساب وابدأ</LinkButton>
              <LinkButton href="/seller/login" size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">عندي حساب</LinkButton>
            </div>
          )}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            [BadgeCheck, 'شارة البائع الموثّق', 'بعد مراجعة هويتك، متجرك بيظهر كمتجر موثّق.'],
            [Truck, 'تحكم كامل في الشحن', 'حدد السعر ومدة التوصيل لكل محافظة.'],
            [Wallet, 'سحب سريع للأرباح', 'رصيدك بيبقى متاح أول ما العميل يأكّد الاستلام.'],
            [BarChart3, 'لوحة تحكم واضحة', 'مبيعاتك، طلباتك، مخزونك ورصيدك في مكان واحد.'],
          ].map(([I, t, b]) => {
            const Icon = I as typeof BadgeCheck;
            return (
              <li key={t as string} className="rounded-2xl bg-white/10 p-4">
                <Icon className="mb-2 size-6 text-amber-300" />
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
            <li>وسيلة استلام الأرباح (حساب بنكي / إنستاباي / محفظة).</li>
            <li>الموافقة على اتفاقية البائع وإرسال الطلب للمراجعة.</li>
          </ol>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-emerald-600" /> بيانات الهوية متشفّرة، ومحدش بيشوفها غير فريق المراجعة المختص.</p>
        </div>
        <div className="card p-6">
          <h2 className="mb-3 text-lg font-bold">العمولات حسب التصنيف</h2>
          <p className="mb-3 text-xs text-muted">العمولة على قيمة المنتجات بس، وبتتحسب وقت البيع ومش بتتغير على الطلبات اللي فاتت. النسب الحالية ممكن الإدارة تحدّثها — <Link href="/legal/fees" className="underline">التفاصيل</Link>.</p>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {rules.map((r) => <li key={r.name} className="flex justify-between rounded-lg bg-page px-3 py-2"><span>{r.name}</span><span className="font-semibold">{bpsToPercentString(r.bps)}%</span></li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}
