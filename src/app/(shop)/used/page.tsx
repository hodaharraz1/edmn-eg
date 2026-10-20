import type { Metadata } from 'next';
import { BadgeCheck, Camera, ClipboardCheck, FileSearch, Handshake, KeyRound, Landmark, LockKeyhole, ScanSearch, Search, ShieldCheck, ShieldHalf } from 'lucide-react';
import Link from '@/ui/link';
import { searchProducts } from '@/server/modules/catalog/search';
import { Cards } from '@/app/_components/product-bits';
import { PROTECTION_LEVEL_LABELS, PROTECTION_LEVEL_SUMMARY, type ProtectionLevel } from '@/domain/used';

export const metadata: Metadata = {
  title: 'سوق المستعمل المضمون',
  description: 'اشتري مستعمل من شخص متعرفوش، وفلوسك تفضل محمية لحد ما تستلم وتتأكد. حالة موثّقة في جواز المنتج، وفترة فحص بعد الاستلام، ونزاع لو المنتج مش مطابق.',
  alternates: { canonical: '/used' },
};

const LEVELS: { level: ProtectionLevel; icon: typeof ShieldCheck; tone: string }[] = [
  { level: 'PROTECTED', icon: ShieldHalf, tone: 'bg-brand-50 text-brand-800 ring-brand-200' },
  { level: 'VERIFIED', icon: BadgeCheck, tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  { level: 'INSPECTED', icon: ScanSearch, tone: 'bg-brand-950 text-white ring-brand-800' },
];

const STEPS = [
  { icon: ClipboardCheck, title: 'البائع يوثّق الحالة', body: 'بيانات منظمة: البطارية، الشاشة، الوظائف، العيوب، الملحقات — ورقم الجهاز مخفي.' },
  { icon: Camera, title: 'صور التوثيق', body: 'صور من كل الجهات والشاشة شغالة وصفحة البطارية، وصور أي عيب.' },
  { icon: FileSearch, title: 'جواز المنتج', body: 'كل ده بيتثبت في جواز منتج، ووقت الاتفاق بيتجمّد ومينفعش يتغير من غير موافقتك.' },
  { icon: Landmark, title: 'تدفع لاضمن', body: 'المبلغ بيفضل محمي عند اضمن، مش عند البائع.' },
  { icon: KeyRound, title: 'تستلم برمز', body: 'رمز الاستلام بيثبت إن الطرد وصلك — مش أكتر.' },
  { icon: Search, title: 'فترة فحص', body: 'تفحص المنتج على راحتك: «المنتج مطابق» أو «توجد مشكلة».' },
  { icon: LockKeyhole, title: 'إتاحة بموافقة الإدارة', body: 'حتى بعد موافقتك، المبلغ بيتاح للبائع بموافقة يدوية من فريقين مختلفين.' },
];

export default async function UsedLanding() {
  const { items } = await searchProducts({ condition: 'USED', sort: 'recommended', pageSize: 10, inStock: true });
  return (
    <>
      <section aria-labelledby="used-title" className="relative isolate overflow-hidden bg-brand-950 text-white" data-testid="used-hero">
        <div aria-hidden className="edmn-hero-bg absolute inset-0 -z-20" />
        <div aria-hidden className="edmn-hero-grid absolute inset-0 -z-10" />
        <div className="container-page grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold text-brand-100">
              <ShieldCheck className="size-4 text-emerald-300" aria-hidden /> سوق المستعمل المضمون
            </span>
            <h1 id="used-title" className="text-[clamp(1.8rem,6.4vw,3.2rem)] font-bold leading-[1.3]">
              اشتري مستعمل من شخص متعرفوش،
              <span className="block text-sky-300">وفلوسك تفضل محمية لحد ما تستلم وتتأكد.</span>
            </h1>
            <p className="max-w-xl leading-8 text-brand-100/85">
              حالة المنتج بتتوثّق في «جواز المنتج» وبتتجمّد وقت الاتفاق، وبعد ما تستلم عندك فترة فحص. لو المنتج مش مطابق تفتح نزاع، والمبلغ بيفضل محجوز لحد ما اضمن تقرر.
            </p>
            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <Link href="/account/deals/new?condition=USED" data-testid="used-cta" className="edmn-cta inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 text-base font-bold text-white shadow-[var(--shadow-cta)] hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
                <Handshake className="size-5" aria-hidden /> لقيتها في أي مكان؟ اضمنها هنا.
              </Link>
              <Link href="/search?condition=USED" className="edmn-cta inline-flex h-14 items-center justify-center rounded-xl border border-white/30 bg-white/5 px-7 text-base font-bold hover:bg-white/15">
                تصفح المستعمل على اضمن
              </Link>
            </div>
          </div>
          <div className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/15 backdrop-blur">
            <p className="text-sm font-bold text-sky-200">اضمن بتحميك في إيه بالظبط؟</p>
            <ul className="mt-3 space-y-3 text-sm leading-6">
              <li><span className="font-bold">حماية الفلوس:</span> <span className="text-white/80">المبلغ عند اضمن لحد الاستلام والفحص وموافقة الإدارة.</span></li>
              <li><span className="font-bold">توثيق الحالة:</span> <span className="text-white/80">مراجعة فريق اضمن لبيانات وصور البائع — مراجعة مستندات، مش فحص فني.</span></li>
              <li><span className="font-bold">الفحص الفني:</span> <span className="text-white/80">بيظهر بس لما يكون فيه تقرير فحص فعلي متسجّل.</span></li>
              <li><span className="font-bold">الضمان:</span> <span className="text-white/80">اضمن مش بتقدّم ضمان على المنتج — الضمان بيكون من البائع لو أعلن عنه.</span></li>
            </ul>
          </div>
        </div>
      </section>

      <div className="container-page space-y-12 py-10">
        <section aria-labelledby="levels-title" className="space-y-4">
          <h2 id="levels-title" className="text-xl font-bold text-brand-950 sm:text-2xl">مستويات الحماية</h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {LEVELS.map(({ level, icon: Icon, tone }) => (
              <li key={level} className="card space-y-3 p-5">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ring-1 ${tone}`}>
                  <Icon className="size-4" aria-hidden /> {PROTECTION_LEVEL_LABELS[level]}
                </span>
                <p className="text-sm leading-7 text-muted">{PROTECTION_LEVEL_SUMMARY[level]}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">مفيش وعود مطلقة: «مؤشر أمان الصفقة» تقييم استرشادي بيشرح نفسه، ومش احتمال نجاح ولا ضمان للمنتج.</p>
        </section>

        <section aria-labelledby="how-title" className="space-y-4">
          <h2 id="how-title" className="text-xl font-bold text-brand-950 sm:text-2xl">إزاي بيشتغل؟</h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card flex gap-3 p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">
                    {i + 1}. {s.title}
                  </span>
                  <span className="block text-sm leading-6 text-muted">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {items.length > 0 && (
          <section aria-labelledby="used-items" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="used-items" className="text-xl font-bold text-brand-950 sm:text-2xl">مستعمل على اضمن دلوقتي</h2>
              <Link href="/search?condition=USED" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">عرض الكل</Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
              <Cards items={items} back="/used" />
            </div>
          </section>
        )}

        <section className="relative isolate overflow-hidden rounded-3xl bg-brand-950 p-6 text-white sm:p-10">
          <div aria-hidden className="absolute -left-12 -top-12 -z-10 size-56 rounded-full bg-brand-500/30 blur-3xl" />
          <h2 className="text-xl font-bold sm:text-2xl">لقيت موبايل مستعمل على جروب أو صفحة أو موقع تاني؟</h2>
          <p className="mt-2 max-w-2xl leading-7 text-white/80">اعمل صفقة محمية وابعت الرابط للبائع: هو يوثّق الحالة والصور، وانت تراجع وتوافق، وفلوسك تفضل عند اضمن لحد ما تستلم وتتأكد.</p>
          <Link href="/account/deals/new?condition=USED" className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-brand-950 hover:bg-brand-50">
            <Handshake className="size-5" aria-hidden /> لقيتها في أي مكان؟ اضمنها هنا.
          </Link>
        </section>
      </div>
    </>
  );
}
