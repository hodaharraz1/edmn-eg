import type { Metadata } from 'next';
import { BadgeCheck, FileText, Handshake, PackageCheck, ShieldCheck, Wallet } from 'lucide-react';
import { LinkButton } from '@/ui/button';
import { getSetting } from '@/server/modules/settings';
import { bpsToPercentString } from '@/server/core/money';

export const metadata: Metadata = {
  title: 'اضمن صفقة خارج السوق — صفقات محمية',
  description: 'اشترِ بأمان من أي بائع خارج اضمن: تدفع لاضمن، والبائع يستلم بعد تأكيدك الاستلام.',
  alternates: { canonical: '/protected-deal' },
};

export default async function ProtectedDealLanding() {
  const fee = await getSetting('deals.feeBps');
  const steps = [
    { icon: FileText, title: 'اكتب تفاصيل الصفقة', body: 'المنتج، السعر، موعد التسليم وأي شروط خاصة اتفقت عليها.' },
    { icon: Handshake, title: 'ادعُ البائع', body: 'نرسل للبائع رابطاً آمناً لمراجعة الشروط والموافقة.' },
    { icon: Wallet, title: 'ادفع لاضمن', body: 'تحوّل المبلغ لحساب اضمن ويتم التحقق منه يدوياً.' },
    { icon: PackageCheck, title: 'استلم وأكّد', body: 'بعد الفحص تؤكد الاستلام فيتم صرف المبلغ للبائع. لو في مشكلة افتح نزاعاً.' },
  ];
  return (
    <div className="container-page space-y-10 py-8">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-l from-accent-600 to-brand-900 p-8 text-white sm:p-12">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold"><ShieldCheck className="size-4" /> اضمن صفقة خارج السوق</span>
        <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">لقيت حاجة على فيسبوك أو عند تاجر؟ اشتريها وانت مطمّن</h1>
        <p className="mt-3 max-w-2xl text-white/85">اضمن يحفظ المبلغ كطرف ثالث محايد أثناء الصفقة، ولا يتم صرفه للبائع إلا بعد تأكيدك استلام المنتج كما اتفقتم.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/account/deals/new" size="lg" className="bg-white text-accent-700 hover:bg-white/90">ابدأ صفقة محمية الآن</LinkButton>
          <LinkButton href="/legal/protected-deal-terms" size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">شروط الصفقات المحمية</LinkButton>
        </div>
      </section>
      <section>
        <h2 className="mb-4 text-xl font-bold">كيف تعمل؟</h2>
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
        <div className="card p-5"><BadgeCheck className="mb-2 size-6 text-brand-600" /><p className="font-bold">لا دفع مباشر للغرباء</p><p className="text-sm text-muted">المبلغ يذهب لحساب اضمن الموضح في صفحة الدفع فقط.</p></div>
        <div className="card p-5"><ShieldCheck className="mb-2 size-6 text-brand-600" /><p className="font-bold">نزاعات بقرار محايد</p><p className="text-sm text-muted">لو المنتج مختلف أو لم يصل، يراجع فريق اضمن الأدلة ويقرر.</p></div>
        <div className="card p-5"><Wallet className="mb-2 size-6 text-brand-600" /><p className="font-bold">رسوم واضحة</p><p className="text-sm text-muted">{fee ? `رسوم الخدمة الحالية ${bpsToPercentString(fee)}% من قيمة الصفقة.` : 'الرسوم الحالية تظهر لك قبل تأكيد الصفقة.'}</p></div>
      </section>
      <p className="text-center text-xs text-muted">تنويه: تُستخدم عبارة «صفقة محمية» لوصف آلية حفظ المبلغ والتحقق داخل منصة اضمن، ويخضع النص القانوني النهائي لاعتماد المستشار القانوني للشركة.</p>
    </div>
  );
}
