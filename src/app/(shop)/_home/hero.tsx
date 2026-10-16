import { ArrowLeft, BadgeCheck, Handshake, KeyRound, Landmark, Search, ShieldCheck, Store } from 'lucide-react';
import Link from '@/ui/link';
import { HeroShowcase, type ShowcaseProduct } from './hero-visual';

/**
 * Homepage hero (premium redesign). States the promise in one glance — "اشتري وبيع بأمان / اضمن تحمي كل صفقة" —
 * puts search first, and offers the three real entry points: shop, sell, create a protected deal.
 * The visual side sells the idea with the product itself (real storefront, real products, protection states);
 * the step-by-step process lives in the "كيف تعمل خدمة الضمان؟" section further down.
 * Mobile order: headline → search → CTAs → compact product visual.
 */
export function HomeHero({ support, quickCategories, showcase }: { support?: string; quickCategories: { slug: string; name: string }[]; showcase: ShowcaseProduct[] }) {
  return (
    <section aria-labelledby="home-hero-title" className="edmn-hero relative isolate overflow-hidden rounded-3xl bg-brand-950 text-white shadow-[var(--shadow-lift)]">
      <div aria-hidden className="edmn-hero-glow pointer-events-none absolute inset-0 -z-10" />
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 px-5 py-9 sm:px-10 sm:py-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12 lg:px-14 lg:py-16">
        <div className="edmn-rise min-w-0 space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-brand-100 sm:text-sm">
            <ShieldCheck className="size-4 text-emerald-300" aria-hidden />
            المبلغ محفوظ لدى اضمن حتى تستلم وتأكد
          </p>
          <div className="space-y-3">
            <h1 id="home-hero-title" className="text-[2rem] font-extrabold leading-[1.2] sm:text-5xl lg:text-[3.4rem]">
              اشتري وبيع بأمان
            </h1>
            <p className="text-xl font-bold text-brand-200 sm:text-2xl">اضمن تحمي كل صفقة</p>
            {support && <p className="hidden max-w-xl text-sm leading-7 sm:block text-white/75 sm:text-base">{support}</p>}
          </div>

          <form action="/search" role="search" aria-label="ابحث في اضمن" className="max-w-xl">
            <label htmlFor="home-search" className="sr-only">
              ابحث عن منتج أو متجر
            </label>
            <div className="flex items-stretch overflow-hidden rounded-2xl bg-white p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-white/20 transition-shadow focus-within:ring-4 focus-within:ring-brand-400/60">
              <Search className="ms-3 size-5 shrink-0 self-center text-muted" aria-hidden />
              <input
                id="home-search"
                name="q"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                placeholder="ابحث عن موبايل، لابتوب، أجهزة منزلية…"
                className="h-12 min-w-0 flex-1 bg-transparent px-3 text-base text-ink placeholder:text-muted focus:outline-none"
              />
              <button type="submit" className="rounded-xl bg-brand-700 px-5 text-sm font-bold text-white transition-[background-color,transform] hover:bg-brand-800 active:scale-[0.97] sm:px-7 sm:text-base">
                ابحث
              </button>
            </div>
          </form>

          {quickCategories.length > 0 && (
            <nav aria-label="تصنيفات شائعة" className="hidden flex-wrap sm:flex items-center gap-2 text-sm">
              <span className="text-white/60">الأكثر تصفحًا:</span>
              {quickCategories.map((c) => (
                <Link key={c.slug} href={`/category/${c.slug}`} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-white/90 transition-colors hover:border-white/40 hover:bg-white/15">
                  {c.name}
                </Link>
              ))}
            </nav>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1 sm:flex sm:flex-wrap">
            <Link href="/categories" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 font-bold text-brand-900 shadow-sm hover:bg-brand-50">
              تسوق الآن <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
            </Link>
            <Link href="/sell" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 px-6 font-bold text-white hover:bg-white/15">
              <Store className="size-4" aria-hidden /> ابدأ البيع
            </Link>
            <Link href="/account/deals/new" className="edmn-cta col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent-600 px-6 font-bold text-white shadow-sm hover:bg-accent-700">
              <Handshake className="size-4" aria-hidden /> أنشئ صفقة ضمان
            </Link>
          </div>
        </div>

        <HeroShowcase products={showcase} categories={quickCategories.map((c) => c.name)} />
      </div>
    </section>
  );
}

/** Real guarantees of the platform (policy facts, not statistics). */
export function TrustStrip() {
  const items = [
    { icon: BadgeCheck, title: 'بائعون تمت مراجعتهم', body: 'هوية ومستندات كل بائع تُراجع قبل البيع' },
    { icon: Landmark, title: 'الدفع لحسابات اضمن فقط', body: 'لا تحويل مباشر لأي بائع' },
    { icon: KeyRound, title: 'رمز استلام في الصفقات المحمية', body: 'يصلك برسالة وتعطيه للبائع وقت التسليم' },
    { icon: ShieldCheck, title: 'فتح نزاع عند أي مشكلة', body: 'فريق اضمن يراجع الأدلة ويقرر' },
  ];
  return (
    <section aria-label="ضمانات اضمن" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.title} className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-line">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <it.icon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold leading-6">{it.title}</span>
            <span className="block text-xs leading-5 text-muted">{it.body}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

export function SectionHeading({ id, eyebrow, title, href, hrefLabel = 'عرض الكل' }: { id?: string; eyebrow?: string; title: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-1">
        {eyebrow && <p className="text-xs font-bold tracking-wide text-brand-600">{eyebrow}</p>}
        <h2 id={id} className="text-xl font-extrabold sm:text-2xl">
          {title}
        </h2>
      </div>
      {href && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold text-brand-700 hover:bg-brand-50">
          {hrefLabel} <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Link>
      )}
    </div>
  );
}
