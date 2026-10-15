import { ArrowLeft, BadgeCheck, Check, Handshake, KeyRound, Landmark, LockKeyhole, PackageCheck, Search, ShieldCheck, Store } from 'lucide-react';
import Link from '@/ui/link';
import { LOGO_HEIGHT, LOGO_SRC, LOGO_WIDTH } from '@/ui/logo';

/**
 * Homepage hero (premium redesign). States the promise in one glance — "اشتري وبيع بأمان / اضمن تحمي كل صفقة" —
 * puts search first, and offers the three real entry points: shop, sell, create a protected deal.
 * The visual on the end side is an ILLUSTRATION of how a protected payment moves (no amounts, no names, no people,
 * no statistics) so nothing on it can be mistaken for real data.
 */
export function HomeHero({ support, quickCategories }: { support?: string; quickCategories: { slug: string; name: string }[] }) {
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
            {support && <p className="max-w-xl text-sm leading-7 text-white/75 sm:text-base">{support}</p>}
          </div>

          <form action="/search" role="search" aria-label="ابحث في اضمن" className="hidden max-w-xl sm:block">
            <label htmlFor="home-search" className="sr-only">
              ابحث عن منتج أو متجر
            </label>
            <div className="flex items-stretch overflow-hidden rounded-2xl bg-white p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-white/20 focus-within:ring-4 focus-within:ring-brand-400/60">
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
              <button type="submit" className="rounded-xl bg-brand-700 px-5 text-sm font-bold text-white transition-colors hover:bg-brand-800 sm:px-7 sm:text-base">
                ابحث
              </button>
            </div>
          </form>

          {quickCategories.length > 0 && (
            <nav aria-label="تصنيفات شائعة" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/60">الأكثر تصفحًا:</span>
              {quickCategories.map((c) => (
                <Link key={c.slug} href={`/category/${c.slug}`} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-white/90 transition-colors hover:border-white/40 hover:bg-white/15">
                  {c.name}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap">
            <Link href="/categories" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 font-bold text-brand-900 shadow-sm hover:bg-brand-50">
              تسوق الآن <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
            </Link>
            <Link href="/sell" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 px-6 font-bold text-white hover:bg-white/15">
              <Store className="size-4" aria-hidden /> ابدأ البيع
            </Link>
            <Link href="/account/deals/new" className="edmn-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent-600 px-6 font-bold text-white shadow-sm hover:bg-accent-700">
              <Handshake className="size-4" aria-hidden /> أنشئ صفقة ضمان
            </Link>
          </div>
        </div>

        <ProtectionIllustration />
      </div>
    </section>
  );
}

const ILLUSTRATION_STEPS = [
  { icon: Landmark, label: 'الدفع لحساب اضمن', state: 'done' },
  { icon: PackageCheck, label: 'البائع يسلّم المنتج', state: 'done' },
  { icon: KeyRound, label: 'تأكيد التسليم برمز الاستلام', state: 'current' },
  { icon: BadgeCheck, label: 'تأكيد الاستلام بعد الفحص', state: 'next' },
  { icon: LockKeyhole, label: 'إتاحة المبلغ للبائع بموافقة الإدارة', state: 'next' },
] as const;

function ProtectionIllustration() {
  return (
    <figure className="edmn-rise edmn-rise-delay relative mx-auto w-full max-w-md" aria-label="رسم توضيحي لمراحل حماية المبلغ في اضمن">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-brand-500/20 blur-3xl" />
      <div className="rounded-3xl bg-white p-5 text-ink shadow-[var(--shadow-lift)] ring-1 ring-black/5 sm:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <img src={LOGO_SRC} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" decoding="async" draggable={false} className="h-10 w-auto select-none object-contain" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
            <ShieldCheck className="size-4" aria-hidden /> المبلغ محمي
          </span>
        </div>
        <ol className="relative mt-4 space-y-1">
          {ILLUSTRATION_STEPS.map((s, i) => (
            <li key={s.label} className="relative flex items-center gap-3 rounded-xl px-2 py-2.5">
              {i < ILLUSTRATION_STEPS.length - 1 && <span aria-hidden className={`absolute start-[1.65rem] top-11 h-[calc(100%-1.5rem)] w-0.5 ${s.state === 'done' ? 'bg-emerald-300' : 'bg-line'}`} />}
              <span
                className={
                  s.state === 'done'
                    ? 'relative grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500 text-white'
                    : s.state === 'current'
                      ? 'edmn-pulse relative grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white ring-4 ring-brand-100'
                      : 'relative grid size-9 shrink-0 place-items-center rounded-full bg-page text-muted ring-1 ring-line'
                }
              >
                {s.state === 'done' ? <Check className="size-4" aria-hidden /> : <s.icon className="size-4" aria-hidden />}
              </span>
              <span className={s.state === 'next' ? 'text-sm text-muted' : 'text-sm font-semibold'}>{s.label}</span>
            </li>
          ))}
        </ol>
        <figcaption className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-xs leading-6 text-brand-900">
          مثال توضيحي: البائع لا يحصل على المبلغ إلا بعد تأكيد الاستلام وموافقة إدارة اضمن.
        </figcaption>
      </div>
    </figure>
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
