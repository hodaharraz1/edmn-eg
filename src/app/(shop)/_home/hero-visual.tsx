import { preload } from 'react-dom';
import { ShieldCheck, PackageCheck, WalletCards } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Hero product visual: the owner-approved campaign artwork (2026-10-17, public/brand/home/hero-source.webp), used for the
 * visual side only — its painted headline/buttons are cropped away (the hero's HTML carries them).
 *  - ≥640px: the wide composition (phone, products, EDMN parcel, laptop desk) — crop x0–1300 of the 2000×750 master.
 *  - <640px: a tighter crop on the phone, the parcel and two products — crop x30–815, y30–740.
 * The two floating UI elements painted in the artwork («دفع آمن» badge, protection card) are re-rendered as real HTML exactly
 * over their painted position (sharp text, screen-reader readable, no duplicated copy) — static, so the painted copy never
 * peeks out. Edges are masked into the navy hero.
 */
const DESKTOP = { w: 1300, h: 750, sizes: [650, 975, 1300] };
const MOBILE = { w: 785, h: 710, sizes: [420, 785] };
const srcset = (prefix: string, sizes: number[], ext: 'avif' | 'webp') => sizes.map((w) => `/brand/home/${prefix}-${w}.${ext} ${w}w`).join(', ');
const DESKTOP_SIZES = '(min-width: 1024px) 50vw, 92vw';
const MOBILE_SIZES = '92vw';

export const PROTECTION_STEPS = [
  { icon: ShieldCheck, text: 'المبلغ محمي لدى اضمن', tile: 'bg-emerald-500' },
  { icon: PackageCheck, text: 'استلم وتأكد من المنتج', tile: 'bg-brand-500' },
  { icon: WalletCards, text: 'تحويل المبلغ للبائع بعد التأكيد', tile: 'bg-brand-500' },
] as const;

export function HeroVisual() {
  // Only the asset for the current viewport is preloaded (mutually exclusive media queries).
  preload(`/brand/home/hero-visual-975.avif`, { as: 'image', type: 'image/avif', imageSrcSet: srcset('hero-visual', DESKTOP.sizes, 'avif'), imageSizes: DESKTOP_SIZES, media: '(min-width: 640px)', fetchPriority: 'high' });
  preload(`/brand/home/hero-visual-m-785.avif`, { as: 'image', type: 'image/avif', imageSrcSet: srcset('hero-visual-m', MOBILE.sizes, 'avif'), imageSizes: MOBILE_SIZES, media: '(max-width: 639.98px)', fetchPriority: 'high' });
  return (
    <div className="relative mx-auto w-full max-w-[27rem] sm:max-w-[40rem] lg:max-w-none">
      <div aria-hidden className="absolute inset-[8%] -z-10 rounded-full bg-brand-500/30 blur-[80px]" />
      <div className="edmn-hero-art @container relative aspect-[785/710] w-full sm:aspect-[1300/750]">
        <picture>
          <source media="(min-width: 640px)" type="image/avif" srcSet={srcset('hero-visual', DESKTOP.sizes, 'avif')} sizes={DESKTOP_SIZES} />
          <source media="(min-width: 640px)" type="image/webp" srcSet={srcset('hero-visual', DESKTOP.sizes, 'webp')} sizes={DESKTOP_SIZES} />
          <source type="image/avif" srcSet={srcset('hero-visual-m', MOBILE.sizes, 'avif')} sizes={MOBILE_SIZES} />
          <img
            src="/brand/home/hero-visual-m-785.webp"
            srcSet={srcset('hero-visual-m', MOBILE.sizes, 'webp')}
            sizes={MOBILE_SIZES}
            width={MOBILE.w}
            height={MOBILE.h}
            alt=""
            fetchPriority="high"
            loading="eager"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        </picture>
        {/* Navy tint so the artwork's bright window light settles into the hero palette. */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-brand-950/35 via-transparent to-brand-950/20" />
        <SafePaymentBadge className="absolute left-[18.5%] top-[17.8%] min-w-[34%] sm:left-[13.4%] sm:top-[20.8%] sm:min-w-[21%]" />
        <ProtectionCard className="absolute right-[7.5%] top-[12.6%] hidden min-w-[33%] sm:block" />
      </div>
      {/* Phones: the protection card sits under the visual (the cropped artwork leaves it out). */}
      <ProtectionCard className="relative z-10 mx-auto -mt-10 w-[min(100%,22rem)] sm:hidden" />
    </div>
  );
}

function SafePaymentBadge({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-[4cqw] rounded-[2.4cqw] bg-white px-[2.6cqw] py-[1.9cqw] text-brand-950 shadow-[0_18px_40px_-14px_rgb(6_26_61/0.55)] sm:gap-[1.3cqw] sm:rounded-[1.4cqw] sm:px-[1.4cqw] sm:py-[1.3cqw]', className)}>
      <span className="grid aspect-square w-[9.5cqw] shrink-0 place-items-center rounded-[2cqw] bg-brand-600 text-white sm:w-[5.4cqw] sm:rounded-[1.1cqw]">
        <ShieldCheck className="size-[60%]" aria-hidden />
      </span>
      <span className="min-w-0 whitespace-nowrap leading-tight">
        <span className="block text-[max(11px,3.5cqw)] font-bold sm:text-[max(11px,1.75cqw)]">دفع آمن</span>
        <span className="block text-[max(10px,2.8cqw)] text-muted sm:text-[max(10px,1.35cqw)]">محمي لدى اضمن</span>
      </span>
    </div>
  );
}

function ProtectionCard({ className }: { className?: string }) {
  return (
    <ul
      aria-label="كيف تحميك اضمن"
      className={cn('rounded-2xl border border-white/15 bg-[linear-gradient(160deg,rgb(30_64_140/0.97),rgb(8_30_72/0.98))] p-1.5 text-white shadow-[0_24px_50px_-18px_rgb(0_0_0/0.7)] backdrop-blur-md sm:rounded-[1.6cqw] sm:p-[0.6cqw]', className)}
    >
      {PROTECTION_STEPS.map((s, i) => (
        <li key={s.text} className={cn('flex items-center gap-3 px-3 py-2.5 sm:gap-[1.2cqw] sm:px-[1.4cqw] sm:py-[1.25cqw]', i > 0 && 'border-t border-white/10')}>
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-full shadow-[0_6px_14px_-6px_rgb(0_0_0/0.5)] sm:size-[4.2cqw]', s.tile)}>
            <s.icon className="size-[55%]" aria-hidden />
          </span>
          <span className="text-sm font-semibold leading-snug sm:whitespace-nowrap sm:text-[max(11px,1.55cqw)]">{s.text}</span>
        </li>
      ))}
    </ul>
  );
}
