import { BadgeCheck, ShieldCheck, Star, Store, Truck } from 'lucide-react';
import Link from '@/ui/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { discountPercent, formatEGP, formatNumber } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { SafeImg } from '@/ui/safe-img';

export function Price({ value, compareAt, size = 'md', className }: { value: number | null; compareAt?: number | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const off = discountPercent(value, compareAt ?? null);
  const s = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' }[size];
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <span className={cn('font-bold text-ink', s)}>{formatEGP(value)}</span>
      {off && (
        <>
          <span className="text-xs text-muted line-through">{formatEGP(compareAt ?? null)}</span>
          <span className="rounded bg-deal-100 px-1.5 py-0.5 text-[11px] font-bold text-deal-600">-{off}%</span>
        </>
      )}
    </div>
  );
}

export function Stars({ value, count, size = 'sm', showValue = true }: { value: number | string; count?: number; size?: 'sm' | 'md'; showValue?: boolean }) {
  const v = Number(value) || 0;
  const icon = size === 'sm' ? 'size-3.5' : 'size-5';
  return (
    <span role="img" className="inline-flex items-center gap-1" aria-label={`التقييم ${v.toFixed(1)} من 5`}>
      <span className="flex" dir="ltr">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn(icon, i <= Math.round(v) ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200')} aria-hidden />
        ))}
      </span>
      {showValue && v > 0 && <span className="text-xs font-semibold">{v.toFixed(1)}</span>}
      {count !== undefined && <span className="text-xs text-muted">({formatNumber(count)})</span>}
    </span>
  );
}

export function ProtectedBadge({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100', className)}>
      <ShieldCheck className="size-3.5" aria-hidden />
      {compact ? 'شراء محمي' : 'شراء محمي من اضمن'}
    </span>
  );
}

export interface CardProduct {
  id: string;
  slug: string;
  titleAr: string;
  condition: string;
  usedGrade?: string | null;
  minPrice: number | null;
  maxCompareAtPrice: number | null;
  totalAvailable: number;
  ratingAvg: string | number;
  ratingCount: number;
  storeName: string;
  storeVerified: boolean;
  imageKey: string | null;
}

export function mediaUrl(key: string | null | undefined, size?: 'thumb' | 'md') {
  if (!key) return null;
  return `/media/${size ? key.replace(/\.webp$/, `_${size}.webp`) : key}`;
}

/**
 * THE product card of the marketplace (listings, search, categories, wishlist, homepage, related products).
 * Approved homepage design: large contained image on a light tile, wishlist, title, rating only when real,
 * prominent EGP price, store + verification, protected-purchase badge, and an optional purchase CTA slot.
 * The whole card opens the product (stretched title link); wishlist and CTA sit above that link.
 */
export function ProductCard({ p, wishlistSlot, priority, cta }: { p: CardProduct; wishlistSlot?: ReactNode; priority?: boolean; cta?: ReactNode }) {
  const img = mediaUrl(p.imageKey, 'md');
  const out = p.totalAvailable <= 0;
  const titleId = `pc-${p.id}`;
  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-line bg-white p-2.5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-3">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-slate-100/70">
        <SafeImg src={img} alt={p.titleAr} eager={priority} className={cn('size-full p-3 transition-transform duration-300 group-hover:scale-105', out && 'opacity-60')} />
        <div className="absolute bottom-2 start-2 flex flex-col items-start gap-1">
          {p.condition === 'USED' && <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">مستعمل{p.usedGrade ? ` · ${label('usedGrade', p.usedGrade)}` : ''}</span>}
          {out && <span className="rounded-md bg-slate-700 px-1.5 py-0.5 text-[11px] font-bold text-white">نفدت الكمية</span>}
        </div>
      </div>
      {wishlistSlot && <div className="absolute end-3 top-3 z-10 sm:end-5 sm:top-5">{wishlistSlot}</div>}
      <div className="flex flex-1 flex-col gap-1.5 pt-3">
        <Link id={titleId} href={`/product/${p.slug}`} className="line-clamp-2 min-h-[2.6em] text-sm font-semibold leading-snug after:absolute after:inset-0 after:rounded-2xl hover:text-brand-700">
          {p.titleAr}
        </Link>
        {p.ratingCount > 0 && <Stars value={p.ratingAvg} count={p.ratingCount} />}
        <Price value={p.minPrice} compareAt={p.maxCompareAtPrice} className="[&>span:first-child]:text-lg" />
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted">
          <Store className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{p.storeName}</span>
          {p.storeVerified && <BadgeCheck className="size-3.5 shrink-0 text-brand-600" aria-label="متجر موثّق" />}
        </p>
        <div className="flex items-center justify-between gap-2">
          <ProtectedBadge compact />
          {!out && p.totalAvailable <= 3 && <span className="text-[11px] font-semibold text-deal-600">فاضل {p.totalAvailable}</span>}
        </div>
        {cta && <div className="relative z-10 mt-auto pt-1.5 [&_[aria-describedby]]:w-full">{cta}</div>}
      </div>
    </article>
  );
}

export function ProductGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5', className)}>{children}</div>;
}

export function ProductRail({ title, href, children }: { title: ReactNode; href?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="text-xl font-bold text-brand-950 sm:text-2xl">{title}</h2>
        {href && (
          <Link href={href} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:text-brand-700">
            شوف الكل
          </Link>
        )}
      </div>
      <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">{children}</div>
    </section>
  );
}

export function RailItem({ children }: { children: ReactNode }) {
  return <div className="w-[46%] shrink-0 snap-start xs:w-[40%] sm:w-[30%] md:w-[23%] lg:w-[18.5%]">{children}</div>;
}

export function SellerCard({ s }: { s: { name: string; slug: string; logoKey?: string | null; ratingAvg: string | number; ratingCount: number; isVerified: boolean; description?: string | null; productCount?: number } }) {
  const logo = mediaUrl(s.logoKey ?? null, 'thumb');
  return (
    <Link href={`/store/${s.slug}`} className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-[var(--shadow-pop)]">
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-50 text-lg font-bold text-brand-700">
        {logo ? <img src={logo} alt="" className="size-full object-cover" /> : s.name.charAt(0)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-semibold">
          <span className="truncate">{s.name}</span>
          {s.isVerified && <BadgeCheck className="size-4 shrink-0 text-brand-600" aria-label="متجر موثّق" />}
        </span>
        {s.ratingCount > 0 ? <Stars value={s.ratingAvg} count={s.ratingCount} /> : <span className="text-xs text-muted">متجر جديد</span>}
        {s.productCount !== undefined && <span className="block text-xs text-muted">{formatNumber(s.productCount)} منتج</span>}
      </span>
    </Link>
  );
}

export function DeliveryLine({ fee, min, max }: { fee: number | null; min: number | null; max: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" data-testid="delivery-line">
      <Truck className="size-4 text-brand-600" aria-hidden />
      {fee === null ? 'البائع لا يشحن إلى هذه المحافظة حالياً' : fee === 0 ? 'شحن مجاني' : `الشحن ${formatEGP(fee)}`}
      {min !== null && max !== null && <span className="text-muted">· خلال {min === max ? min : `${min}–${max}`} أيام عمل</span>}
    </span>
  );
}

export function Stepper({ steps, current, hrefFor }: { steps: string[]; current: number; hrefFor?: (i: number) => string | null }) {
  return (
    <ol tabIndex={0} aria-label="خطوات" className="scrollbar-none mb-6 flex gap-2 overflow-x-auto pb-1">
      {steps.map((s, idx) => {
        const n = idx + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        const href = hrefFor?.(n);
        const inner = (
          <span className={cn('flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold', state === 'current' ? 'border-brand-600 bg-brand-600 text-white' : state === 'done' ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-line bg-white text-muted')}>
            <span className={cn('grid size-5 place-items-center rounded-full text-[11px]', state === 'current' ? 'bg-white/20' : 'bg-white')}>{n}</span>
            {s}
          </span>
        );
        return <li key={s}>{href && state !== 'current' ? <Link href={href}>{inner}</Link> : inner}</li>;
      })}
    </ol>
  );
}
