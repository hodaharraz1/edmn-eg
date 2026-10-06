import type { Metadata } from 'next';
import { BadgeCheck, FileText, Handshake, PackageCheck, ShieldCheck, Wallet } from 'lucide-react';
import { LinkButton } from '@/ui/button';
import { getSetting } from '@/server/modules/settings';
import { bpsToPercentString } from '@/server/core/money';

export const metadata: Metadata = {
  title: 'اضمن صفقة خارج السوق — صفقات محمية',
  description: 'اشتري من أي بائع برّه اضمن وانت مطمّن: بتدفع لاضمن، والبائع ما بياخدش فلوسه غير بعد التسليم برمز الاستلام وتأكيدك (أو انتهاء مهلتك بدون اعتراض) وموافقة الإدارة.',
  alternates: { canonical: '/protected-deal' },
};

export default async function ProtectedDealLanding() {
  const fee = await getSetting('deals.feeBps');
  const steps = [
    { icon: FileText, title: 'اكتب تفاصيل الصفقة', body: 'المنتج، السعر، موعد التسليم، وأي شروط خاصة اتفقتوا عليها.' },
    { icon: Handshake, title: 'ابعت للبائع', body: 'هتاخد رابط آمن تبعته للبائع، يراجع منه الشروط ويوافق.' },
    { icon: Wallet, title: 'ادفع لاضمن', body: 'بتحوّل المبلغ لحساب اضمن، وفريقنا بيراجع التحويل يدويًا.' },
    { icon: PackageCheck, title: 'استلم وأكّد', body: 'بعد ما تفحص المنتج، أكّد الاستلام والمبلغ يتصرف للبائع. لو فيه مشكلة افتح نزاع.' },
  ];
  return (
    <div className="container-page space-y-10 py-8">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-l from-accent-600 to-brand-900 p-8 text-white sm:p-12">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold"><ShieldCheck className="size-4" /> اضمن صفقة خارج السوق</span>
        <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">لقيت حاجة على فيسبوك أو عند تاجر؟ اشتريها وانت مطمّن</h1>
        <p className="mt-3 max-w-2xl text-white/85">اضمن بيحتفظ بالمبلغ طول الصفقة، ومش بيتصرف للبائع غير بعد التسليم برمز الاستلام، وتأكيدك أو انتهاء مهلة الفحص بدون اعتراض، وموافقة يدوية من الإدارة.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/account/deals/new" size="lg" className="bg-white text-accent-700 hover:bg-white/90">ابدأ صفقة محمية</LinkButton>
          <LinkButton href="/legal/protected-deal-terms" size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">شروط الصفقات المحمية</LinkButton>
        </div>
      </section>
      <section>
        <h2 className="mb-4 text-xl font-bold">إزاي بتشتغل؟</h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="card space-y-2 p-5">
              <span className="flex items-center gap-2 text-sm font-bold text-accent-700"><s.icon className="size-6" /> {i + 1}</span>
              <p className="font-bold">{s.title}</p>
              <p className="text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-5"><BadgeCheck className="mb-2 size-6 text-brand-600" /><p className="font-bold">مفيش دفع مباشر لحد متعرفوش</p><p className="text-sm text-muted">بتدفع بس لحساب اضمن اللي ظاهر في صفحة الدفع.</p></div>
        <div className="card p-5"><ShieldCheck className="mb-2 size-6 text-brand-600" /><p className="font-bold">نزاعات بقرار محايد</p><p className="text-sm text-muted">لو المنتج مختلف أو موصلش، فريق اضمن بيراجع الأدلة ويقرر.</p></div>
        <div className="card p-5"><Wallet className="mb-2 size-6 text-brand-600" /><p className="font-bold">رسوم واضحة</p><p className="text-sm text-muted">{fee ? `رسوم الخدمة دلوقتي ${bpsToPercentString(fee)}% من قيمة الصفقة.` : 'هتشوف الرسوم قبل ما تأكد الصفقة.'}</p></div>
      </section>
    </div>
  );
}
