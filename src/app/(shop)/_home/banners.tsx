import { ArrowLeft, BarChart3, Clock, Handshake, Home, Package, Search, ShieldCheck, ShoppingCart, Store, User } from 'lucide-react';
import Link from '@/ui/link';
import { LOGO_HEIGHT, LOGO_SRC, LOGO_WIDTH } from '@/ui/logo';
import { mediaUrl } from '@/ui/commerce';
import { SELLER_BANNER } from '@/config/home-assets';
import { SafeImg } from '@/ui/safe-img';

const SELLER_ONBOARDING = '/seller/register'; // existing seller sign-up (redirected to the seller host where configured)
const NEW_PROTECTED_DEAL = '/account/deals/new'; // existing «اضمن صفقة خارج السوق» creation flow

/**
 * Bottom of the homepage: the two commerce modes, kept separate on purpose —
 *  marketplace seller  → «افتح متجرك الآن»  (primary; the seller banner)
 *  individual deal     → «أنشئ صفقة ضمان»  (secondary; compact strip under the banner)
 * then the EDMN app banner (apps not published yet → «قريبًا», no store badges).
 */
export function HomeBanners({ products }: { products: { imageKey: string | null }[] }) {
  return (
    <section aria-label="ابدأ مع اضمن" className="space-y-4 lg:space-y-5">
      {SELLER_BANNER.ready ? <ApprovedSellerBanner /> : <InterimSellerBanner />}
      <ProtectedDealStrip />
      <AppBanner products={products} />
    </section>
  );
}

/**
 * The owner-approved seller artwork (its text and CTA are part of the image). Desktop/tablet: the full wide
 * artwork with a real link positioned exactly over the painted «افتح متجرك الآن» button. Mobile: the same
 * artwork cropped to the merchant, followed by real HTML text and a full-width CTA (the painted text would be
 * unreadable at phone width). Responsive sources keep phones from downloading the desktop file.
 */
function ApprovedSellerBanner() {
  const b = SELLER_BANNER;
  return (
    <div>
      <div className="relative hidden overflow-hidden rounded-2xl bg-brand-950 shadow-[var(--shadow-card)] lg:block" style={{ aspectRatio: `${b.width} / ${b.height}` }}>
        {/* The headline is painted in the artwork; screen readers get it as a real heading. */}
        <h2 className="sr-only">ابدأ البيع على اضمن</h2>
        <img
          src={b.desktop[b.desktop.length - 1].src}
          srcSet={b.desktop.map((s) => `${s.src} ${s.w}w`).join(', ')}
          sizes="(min-width: 1320px) 1272px, 100vw"
          width={b.width}
          height={b.height}
          alt={`${b.alt}. ابدأ البيع على اضمن: وصل لعملاء أكتر وبيع بأمان وثقة`}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
        <Link
          href={SELLER_ONBOARDING}
          aria-label="افتح متجرك الآن"
          className="absolute rounded-[1.4vw] outline-offset-4 focus-visible:outline-[3px] focus-visible:outline-white xl:rounded-2xl"
          style={{ left: `${b.cta.left}%`, top: `${b.cta.top}%`, width: `${b.cta.width}%`, height: `${b.cta.height}%` }}
        />
      </div>
      <div className="overflow-hidden rounded-2xl bg-brand-950 text-white shadow-[var(--shadow-card)] md:grid md:grid-cols-2 md:items-center lg:hidden">
        <img src={b.mobile[b.mobile.length - 1].src} srcSet={b.mobile.map((s) => `${s.src} ${s.w}w`).join(', ')} sizes="(min-width: 768px) 50vw, 100vw" width={b.mobileWidth} height={b.mobileHeight} alt={b.alt} loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover md:h-full" />
        <SellerCopy points />
      </div>
    </div>
  );
}

/** Used until the approved artwork file is in the repository: same message, real HTML, Egyptian merchant photo. */
function InterimSellerBanner() {
  return (
    <div className="relative isolate overflow-hidden rounded-2xl bg-brand-950 text-white shadow-[var(--shadow-card)] md:flex md:min-h-[17rem]">
      <img
        src="/brand/home/egyptian-seller.webp"
        srcSet="/brand/home/egyptian-seller-700.webp 700w, /brand/home/egyptian-seller.webp 1400w"
        sizes="(min-width: 768px) 1272px, 100vw"
        width={1400}
        height={781}
        alt="تاجر مصري يستخدم اضمن لإدارة وبيع منتجاته بأمان"
        loading="lazy"
        decoding="async"
        className="aspect-[4/3] w-full object-cover object-[22%_40%] md:absolute md:inset-0 md:-z-10 md:aspect-auto md:size-full"
      />
      <div aria-hidden className="absolute inset-0 -z-10 hidden bg-[linear-gradient(to_left,rgb(6_26_61/0.95)_0%,rgb(6_26_61/0.82)_40%,rgb(6_26_61/0.1)_75%,rgb(6_26_61/0)_100%)] md:block" />
      <div className="md:ms-0 md:flex md:max-w-md md:items-center">
        <SellerCopy />
      </div>
    </div>
  );
}

/** The three promises painted on the approved artwork (all existing seller features), repeated as real text. */
const SELLER_POINTS = [
  { icon: ShieldCheck, title: 'دفع آمن ومحمي', text: 'حتى استلام العميل للمنتج' },
  { icon: Package, title: 'إدارة المنتجات', text: 'بسهولة ومرونة' },
  { icon: BarChart3, title: 'تحليلات مبيعات', text: 'لمتابعة نمو متجرك' },
];

function SellerCopy({ points }: { points?: boolean }) {
  return (
    <div className="space-y-3 p-5 sm:p-8">
      <h2 className="text-2xl font-bold leading-tight sm:text-[1.75rem]">
        ابدأ البيع على <span className="text-sky-300">اضمن</span>
      </h2>
      <p className="text-base leading-7 text-white/85">وصل لعملاء أكتر وبيع بأمان وثقة</p>
      {points && (
        <ul className="grid gap-2 py-1">
          {SELLER_POINTS.map((pt) => (
            <li key={pt.title} className="flex items-center gap-3 text-sm">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15"><pt.icon className="size-4 text-sky-300" aria-hidden /></span>
              <span><span className="font-bold">{pt.title}</span> <span className="text-white/70">{pt.text}</span></span>
            </li>
          ))}
        </ul>
      )}
      <Link href={SELLER_ONBOARDING} className="edmn-cta flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-12px_rgb(37_99_235/0.9)] hover:bg-brand-500 sm:w-fit">
        <Store className="size-5" aria-hidden /> افتح متجرك الآن
      </Link>
    </div>
  );
}

/** Secondary: protected deals between individuals for anything not listed on the marketplace. */
function ProtectedDealStrip() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-brand-100 bg-gradient-to-l from-brand-50 to-[#f5f9ff] p-4 shadow-[0_6px_20px_-14px_rgb(6_26_61/0.35)] sm:flex-row sm:items-center sm:gap-5 sm:p-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-950 text-white shadow-[0_8px_18px_-8px_rgb(6_26_61/0.7)]">
        <ShieldCheck className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold text-brand-950 sm:text-lg">بتشتري أو بتبيع مع شخص خارج اضمن؟</h2>
        <p className="mt-0.5 text-sm leading-6 text-muted">اضمن صفقتك وخلي المبلغ محمي حتى إتمامها.</p>
      </div>
      <Link href={NEW_PROTECTED_DEAL} className="edmn-cta flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-brand-950 bg-white px-5 text-sm font-bold text-brand-950 hover:bg-brand-950 hover:text-white sm:w-auto">
        <Handshake className="size-5" aria-hidden /> أنشئ صفقة ضمان
      </Link>
    </div>
  );
}

function AppBanner({ products }: { products: { imageKey: string | null }[] }) {
  return (
    <div className="relative isolate flex items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900 via-brand-950 to-[#04122c]">
      <div aria-hidden className="absolute -left-10 top-1/2 -z-10 size-72 -translate-y-1/2 rounded-full bg-brand-500/30 blur-3xl" />
      <div className="flex flex-1 flex-col gap-2.5 p-5 text-white sm:p-8">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-sky-200 ring-1 ring-white/15">
          <Clock className="size-3.5" aria-hidden /> قريبًا
        </span>
        <h2 className="text-2xl font-bold leading-tight">تطبيق اضمن</h2>
        <p className="text-base leading-7 text-white/80">تسوق وأدر متجرك من أي مكان</p>
        <p className="text-sm leading-6 text-white/65">لحين إطلاق التطبيق، اضمن متاح بالكامل من متصفح موبايلك.</p>
        <Link href="/categories" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-bold text-sky-300 hover:text-white">
          تسوّق من المتصفح <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Link>
      </div>
      <div aria-hidden className="relative hidden h-[15rem] w-[13rem] shrink-0 sm:block lg:me-10">
        <MiniPhone className="absolute left-16 top-4 rotate-[8deg]" products={products.slice(2, 4)} />
        <MiniPhone className="absolute left-2 top-9 -rotate-[6deg]" products={products.slice(0, 2)} />
      </div>
    </div>
  );
}

function MiniPhone({ className, products }: { className?: string; products: { imageKey: string | null }[] }) {
  return (
    <div className={`edmn-phone h-[13.5rem] w-[6.75rem] rounded-[1.4rem] p-[0.3rem] ${className ?? ''}`}>
      <div className="relative h-full overflow-hidden rounded-[1.15rem] bg-[#f4f7fc]">
        <span className="absolute left-1/2 top-1 h-2 w-8 -translate-x-1/2 rounded-full bg-black" />
        <div className="bg-white px-1.5 pb-1 pt-4">
          <img src={LOGO_SRC} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" className="h-4 w-auto" />
          <div className="mt-1 flex h-3.5 items-center gap-0.5 rounded-full bg-slate-100 px-1 text-slate-400">
            <Search className="size-2" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 p-1.5">
          {products.map((p, i) => (
            <div key={i} className="overflow-hidden rounded-lg bg-white ring-1 ring-slate-100">
              <SafeImg src={mediaUrl(p.imageKey, 'thumb')} className="aspect-square w-full p-0.5" />
              <span className="m-0.5 block h-1 w-3/4 rounded bg-slate-200" />
            </div>
          ))}
        </div>
        <div className="mx-1.5 flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.5 text-[5px] font-bold text-emerald-700">
          <ShieldCheck className="size-2" /> شراء محمي
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-around bg-white py-1.5 text-slate-400">
          <Home className="size-2.5 text-brand-600" />
          <ShoppingCart className="size-2.5" />
          <User className="size-2.5" />
        </div>
      </div>
    </div>
  );
}
