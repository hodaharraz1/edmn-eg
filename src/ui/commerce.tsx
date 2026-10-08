import { BadgeCheck, ShieldCheck, Star, Store, Truck } from 'lucide-react';
import Link from '@/ui/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { discountPercent, formatEGP, formatNumber } from '@/lib/format';
import { label } from '@/lib/i18n/labels';

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
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700', className)}>
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

export function ProductCard({ p, wishlistSlot, priority }: { p: CardProduct; wishlistSlot?: ReactNode; priority?: boolean }) {
  const img = mediaUrl(p.imageKey, 'md');
  const out = p.totalAvailable <= 0;
  return (
    <article className="card group relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-[var(--shadow-pop)]">
      <Link href={`/product/${p.slug}`} className="relative block aspect-square overflow-hidden bg-white">
        {img ? (
          <img src={img} alt={p.titleAr} loading={priority ? 'eager' : 'lazy'} className={cn('size-full object-contain p-2 transition-transform duration-300 group-hover:scale-105', out && 'opacity-60')} />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted">مفيش صورة</div>
        )}
        <div className="absolute top-2 start-2 flex flex-col items-start gap-1">
          {p.condition === 'USED' && <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">مستعمل{p.usedGrade ? ` · ${label('usedGrade', p.usedGrade)}` : ''}</span>}
          {out && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-bold text-white">نفدت الكمية</span>}
        </div>
      </Link>
      {wishlistSlot && <div className="absolute top-2 end-2">{wishlistSlot}</div>}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link href={`/product/${p.slug}`} className="line-clamp-2 min-h-[2.6em] text-sm font-medium leading-snug hover:text-brand-700">
          {p.titleAr}
        </Link>
        {p.ratingCount > 0 ? <Stars value={p.ratingAvg} count={p.ratingCount} /> : <span className="text-[11px] text-muted">مفيش تقييمات لسه</span>}
        <Price value={p.minPrice} compareAt={p.maxCompareAtPrice} />
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <Store className="size-3" aria-hidden />
            <span className="max-w-[9rem] truncate">{p.storeName}</span>
            {p.storeVerified && <BadgeCheck className="size-3.5 text-brand-600" aria-label="متجر موثّق" />}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <ProtectedBadge compact />
          {!out && p.totalAvailable <= 3 && <span className="text-[11px] font-semibold text-deal-600">فاضل {p.totalAvailable}</span>}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', className)}>{children}</div>;
}

export function ProductRail({ title, href, children }: { title: ReactNode; href?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="text-lg font-bold sm:text-xl">{title}</h2>
        {href && (
          <Link href={href} className="text-sm font-semibold text-brand-700 hover:underline">
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
