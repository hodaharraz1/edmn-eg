import { BadgeCheck, CircleCheckBig, Lock, Search, ShieldCheck, ShoppingCart, Store } from 'lucide-react';
import { formatEGP } from '@/lib/format';
import { LOGO_HEIGHT, LOGO_SRC, LOGO_WIDTH } from '@/ui/logo';
import { mediaUrl, type CardProduct } from '@/ui/commerce';
import { HeroThumb } from './hero-thumb';

export type ShowcaseProduct = Pick<CardProduct, 'id' | 'titleAr' | 'minPrice' | 'storeName' | 'storeVerified' | 'imageKey'>;

/**
 * Product-led hero visual: the real EDMN storefront (live catalog products, real prices in EGP, real store names)
 * framed as a browser window, a phone showing one real product with the protected-checkout state, the EDMN shield,
 * and three small status cards. Status cards are UI states of the product, not claims about any real order;
 * there are no counts, ratings or statistics anywhere in this composition.
 * The whole composition is one image for assistive technology (its products stay reachable in the rails below).
 */
export function HeroShowcase({ products, categories }: { products: ShowcaseProduct[]; categories: string[] }) {
  const featured = products.find((p) => p.storeVerified) ?? products[0];
  const grid = products.filter((p) => p !== featured).slice(0, 3);
  while (grid.length < 3 && products.length) grid.push(products[grid.length % products.length]);
  return (
    <div role="img" aria-label="واجهة سوق اضمن: منتجات من متاجر موثّقة، والمبلغ محفوظ لدى اضمن حتى تأكيد الاستلام" className="relative mx-auto w-full max-w-[34rem] pb-8 pt-6 sm:pb-6">
      <div aria-hidden className="pointer-events-none absolute inset-x-6 inset-y-10 -z-10 rounded-full bg-brand-500/30 blur-3xl" />

      {/* Browser window: the storefront */}
      <div aria-hidden className="edmn-float relative overflow-hidden rounded-2xl bg-page shadow-[var(--shadow-lift)] ring-1 ring-white/20 sm:ml-16 sm:mb-14">
        <div className="flex items-center gap-3 bg-slate-100 px-3 py-2" dir="ltr">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-slate-300" />
            <span className="size-2.5 rounded-full bg-slate-300" />
            <span className="size-2.5 rounded-full bg-slate-300" />
          </span>
          <span className="mx-auto inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">
            <Lock className="size-3 text-emerald-600" /> edmneg.com
          </span>
        </div>
        <div className="flex items-center gap-2 border-b border-line bg-white px-3 py-2">
          <img src={LOGO_SRC} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" draggable={false} className="h-7 w-auto shrink-0 select-none object-contain" />
          <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-page px-2 text-[11px] text-muted ring-1 ring-line">
            <Search className="size-3.5 shrink-0" />
            <span className="truncate">ابحث في اضمن…</span>
          </span>
          <ShoppingCart className="size-4 shrink-0 text-brand-800" />
        </div>
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-hidden bg-brand-800 px-3 py-1.5 text-[10px] font-semibold text-white/90">
            {categories.slice(0, 4).map((c) => (
              <span key={c} className="shrink-0 rounded-full bg-white/10 px-2 py-0.5">
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5 p-2.5 sm:gap-2 sm:p-3">
          {(grid.length ? grid : [null, null, null]).map((p, i) => (
            <MiniCard key={p ? `${p.id}-${i}` : i} p={p} lifted={i === 0} />
          ))}
        </div>
      </div>

      {/* Phone: one real product with the protected checkout state */}
      {featured && (
        <div aria-hidden className="edmn-float edmn-float-alt absolute bottom-0 left-0 hidden w-[11.5rem] rounded-[1.75rem] bg-slate-900 p-1.5 shadow-[var(--shadow-lift)] ring-1 ring-white/25 sm:block">
          <div className="overflow-hidden rounded-[1.4rem] bg-white">
            <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-slate-200" />
            <HeroThumb src={mediaUrl(featured.imageKey, 'md')} className="mx-auto mt-1 aspect-[4/3] w-full p-2" />
            <div className="space-y-1.5 px-3 pb-3">
              <p className="line-clamp-1 text-[11px] font-semibold text-ink">{featured.titleAr}</p>
              <p className="text-sm font-extrabold text-ink">{formatEGP(featured.minPrice)}</p>
              <p className="flex items-center gap-1 text-[10px] text-muted">
                <Store className="size-3" />
                <span className="truncate">{featured.storeName}</span>
                {featured.storeVerified && <BadgeCheck className="size-3 shrink-0 text-brand-600" />}
              </p>
              <p className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold leading-4 text-emerald-800">
                <ShieldCheck className="size-3.5 shrink-0" /> مبلغك محفوظ لدى اضمن حتى تأكد الاستلام
              </p>
              <span className="flex h-8 items-center justify-center gap-1 rounded-lg bg-brand-700 text-[11px] font-bold text-white">
                <Lock className="size-3" /> اشتري بأمان
              </span>
            </div>
          </div>
        </div>
      )}

      {/* EDMN protection shield */}
      <div aria-hidden className="edmn-pop absolute left-2 top-0 sm:left-6 sm:top-2" style={{ '--d': '0.25s' } as React.CSSProperties}>
        <span className="edmn-shield grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white ring-4 ring-white/15 sm:size-20 sm:rounded-3xl">
          <ShieldCheck className="size-8 sm:size-11" strokeWidth={1.75} />
        </span>
      </div>

      {/* Status cards */}
      <StatusChip className="left-16 top-3 sm:left-[7.5rem] sm:top-5" delay="0.45s" icon={<ShieldCheck className="size-4" />} tone="emerald" title="المبلغ محمي" sub="محفوظ لدى اضمن" />
      <StatusChip className="right-0 top-[44%] hidden sm:flex" delay="0.6s" icon={<BadgeCheck className="size-4" />} tone="brand" title="البائع موثّق" sub={featured?.storeVerified ? featured.storeName : 'هوية ومستندات تمت مراجعتها'} />
      <StatusChip className="bottom-0 right-2 sm:bottom-2 sm:right-10" delay="0.75s" icon={<CircleCheckBig className="size-4" />} tone="emerald" title="تم تأكيد الاستلام" sub="برمز الاستلام" />
    </div>
  );
}

function MiniCard({ p, lifted, className }: { p: ShowcaseProduct | null; lifted?: boolean; className?: string }) {
  return (
    <div className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl bg-white ring-1 ring-line ${lifted ? 'z-10 shadow-[var(--shadow-pop)] ring-brand-200 sm:-translate-y-1 sm:scale-[1.04]' : 'shadow-sm'} ${className ?? ''}`}>
      {p ? <HeroThumb src={mediaUrl(p.imageKey, 'thumb')} className="aspect-square w-full p-1.5" /> : <span className="aspect-square w-full bg-slate-100" />}
      <div className="space-y-1 p-1.5 sm:p-2">
        {p ? <p className="line-clamp-1 text-[10px] font-medium text-ink">{p.titleAr}</p> : <span className="block h-2 w-3/4 rounded bg-slate-100" />}
        {p ? <p className="text-[11px] font-extrabold text-ink">{formatEGP(p.minPrice)}</p> : <span className="block h-2 w-1/2 rounded bg-slate-100" />}
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
          <ShieldCheck className="size-2.5" /> شراء محمي
        </span>
      </div>
    </div>
  );
}

function StatusChip({ className, delay, icon, tone, title, sub }: { className: string; delay: string; icon: React.ReactNode; tone: 'emerald' | 'brand'; title: string; sub: string }) {
  return (
    <div aria-hidden className={`edmn-chip absolute z-20 flex max-w-[12rem] items-center gap-2 rounded-xl bg-white/95 px-2.5 py-2 shadow-[var(--shadow-pop)] ring-1 ring-black/5 backdrop-blur ${className}`} style={{ '--d': delay } as React.CSSProperties}>
      <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${tone === 'emerald' ? 'bg-emerald-500 text-white' : 'bg-brand-600 text-white'}`}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block text-xs font-bold text-ink">{title}</span>
        <span className="block truncate text-[10px] text-slate-600">{sub}</span>
      </span>
    </div>
  );
}
