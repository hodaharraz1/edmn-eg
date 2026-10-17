import { ArrowLeft, BadgeCheck, CircleCheck, CreditCard, Headset, ShieldCheck, ShoppingBag, Store } from 'lucide-react';
import Link from '@/ui/link';
import { HeroVisual } from './hero-visual';

/**
 * Homepage hero: full-bleed cinematic navy. Right (RTL start, ~50%): the promise, short copy, two CTAs and three trust
 * indicators — all real HTML. Left (~50%): the approved campaign artwork (phone with the EDMN storefront, products, EDMN
 * parcel) blended into the navy, with the «دفع آمن» badge and the protection card as real HTML (see hero-visual.tsx).
 * Mobile / tablet portrait: headline → copy → CTAs → visual (+ protection card) → trust indicators.
 */
export function HomeHero() {
  return (
    <section aria-labelledby="home-hero-title" className="edmn-hero relative isolate overflow-hidden bg-brand-950 text-white">
      <HeroBackdrop />
      <div className="container-page grid grid-cols-[minmax(0,1fr)] items-center gap-x-10 gap-y-6 pb-10 pt-6 sm:pt-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:grid-rows-[auto_auto] xl:grid-cols-2 lg:pb-12 lg:pt-8">
        <div className="edmn-rise min-w-0 space-y-5 sm:space-y-6 lg:col-start-1 lg:row-start-1 lg:self-end">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-brand-100 lg:hidden">
            <ShieldCheck className="size-4 text-emerald-300" aria-hidden /> دفع آمن — محمي لدى اضمن
          </p>
          <h1 id="home-hero-title" className="text-[clamp(1.7rem,8.6vw,2.6rem)] font-bold leading-[1.3] tracking-tight sm:text-6xl sm:leading-[1.22] lg:text-[2.75rem] xl:text-[4.1rem]">
            <span className="block">اشتري وبيع بأمان</span>
            <span className="block">
              <span className="bg-gradient-to-l from-sky-300 to-brand-400 bg-clip-text text-transparent">اضمن</span> تحمي كل صفقة
            </span>
          </h1>
          <p className="max-w-xl text-[0.95rem] leading-7 text-brand-100/85 sm:text-lg sm:leading-8">سوق إلكتروني مصري موثوق بنظام ضمان يحمي المشتري والبائع؛ المبلغ يظل محفوظًا لدى اضمن حتى تستلم المنتج وتتأكد منه.</p>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            <Link href="/categories" className="edmn-cta inline-flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-brand-600 px-3 text-[15px] font-bold sm:px-8 sm:text-base text-white shadow-[0_14px_34px_-12px_rgb(37_99_235/0.9)] hover:bg-brand-500">
              <ShoppingBag className="size-5" aria-hidden /> تسوق الآن
            </Link>
            <Link href="/sell" className="edmn-cta inline-flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/30 bg-white/5 px-3 text-[15px] font-bold sm:px-8 sm:text-base text-white backdrop-blur-sm hover:bg-white/15">
              <Store className="size-5" aria-hidden /> ابدأ البيع
            </Link>
          </div>
        </div>

        <div className="edmn-rise edmn-rise-delay min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <HeroVisual />
        </div>

        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-white/85 lg:col-start-1 lg:row-start-2 lg:self-start">
          {['دفع آمن ومحمي', 'بائعون موثقون', 'تجربة سهلة وسريعة'].map((x) => (
            <li key={x} className="flex items-center gap-2">
              <CircleCheck className="size-5 text-emerald-400" aria-hidden /> {x}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="edmn-hero-bg absolute inset-0" />
      <div className="edmn-hero-grid absolute inset-0" />
      <div className="absolute left-[8%] top-[18%] hidden size-[34rem] rounded-full border border-white/[0.05] lg:block" />
      <div className="absolute left-[1%] top-[6%] hidden size-[46rem] rounded-full border border-white/[0.035] lg:block" />
      <div className="edmn-beam absolute -top-10 left-[30%] h-[130%] w-40 rotate-[18deg]" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-brand-950/60" />
    </div>
  );
}

/** White benefits strip right under the hero (real guarantees and the real payment methods). */
export function TrustStrip() {
  const items = [
    { icon: ShieldCheck, title: 'ضمان كامل للصفقات', body: 'المبلغ محمي حتى استلام المنتج' },
    { icon: BadgeCheck, title: 'بائعون موثقون', body: 'متاجر تمت مراجعة هويتها ومستنداتها' },
    { icon: CreditCard, title: 'دفع آمن ومتعدد الوسائل', body: 'تحويل بنكي أو إنستاباي أو محفظة موبايل' },
    { icon: Headset, title: 'دعم متواصل', body: 'خدمة دعم عند الحاجة' },
  ];
  return (
    <section aria-label="ضمانات اضمن" className="border-b border-line bg-white">
      <ul className="container-page grid grid-cols-2 gap-y-1 py-3 lg:grid-cols-4 lg:py-5">
        {items.map((it, i) => (
          <li key={it.title} className={`flex items-center gap-3 px-2 py-3 sm:px-4 ${i > 0 ? 'lg:border-s lg:border-line' : ''} ${i % 2 === 1 ? 'border-s border-line lg:border-s' : ''}`}>
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100 sm:size-12">
              <it.icon className="size-5 sm:size-6" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-6 sm:text-[0.95rem]">{it.title}</span>
              <span className="block text-xs leading-5 text-muted">{it.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SectionHeading({ id, title, href, hrefLabel = 'عرض الكل' }: { id?: string; title: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 id={id} className="text-xl font-bold sm:text-2xl">
        {title}
      </h2>
      {href && (
        <Link href={href} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-brand-600 hover:bg-brand-50 hover:text-brand-700">
          {hrefLabel} <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Link>
      )}
    </div>
  );
}
