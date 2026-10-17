import * as Icons from 'lucide-react';
import { BadgeCheck, Bell, Heart, Home, LayoutGrid, PackageCheck, Search, ShieldCheck, ShoppingCart, User, Wallet, type LucideIcon } from 'lucide-react';
import { formatEGP } from '@/lib/format';
import { LOGO_HEIGHT, LOGO_SRC, LOGO_WIDTH } from '@/ui/logo';
import { mediaUrl } from '@/ui/commerce';
import { SafeImg } from '@/ui/safe-img';

export interface DeviceProduct {
  titleAr: string;
  minPrice: number | null;
  storeName: string;
  storeVerified: boolean;
  imageKey: string | null;
}

/**
 * Hero product composition, four depth layers:
 *  1. environment (glow, rings, podium)   2. the phone — a real EDMN storefront screen with a LIVE catalog product
 *  3. the EDMN protection shield           4. floating UI: «دفع آمن» card and the transaction-status panel.
 * Everything is HTML/CSS/SVG (no screenshots). Status rows describe the product's protection flow, not any real order;
 * no counts, ratings or statistics appear here. One accessible image description for the whole composition.
 */
export function HeroDevice({ featured, categories }: { featured: DeviceProduct | null; categories: { nameAr: string; icon: string | null }[] }) {
  return (
    <div role="img" aria-label="تطبيق اضمن على موبايل يعرض منتجًا من متجر موثّق، مع درع حماية اضمن وحالة الدفع المحمي" className="relative mx-auto h-[22.5rem] w-full max-w-[36rem] sm:h-[33rem] lg:h-[35rem]">
      {/* 1 — environment */}
      <div aria-hidden className="absolute left-1/2 top-[42%] size-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/35 blur-[90px] sm:size-[28rem]" />
      <div aria-hidden className="edmn-podium absolute bottom-3 left-1/2 h-14 w-[15rem] -translate-x-1/2 sm:bottom-4 sm:h-20 sm:w-[22rem] sm:-translate-x-[56%] lg:-translate-x-[59%]" />

      {/* 2 — phone */}
      <div aria-hidden className="edmn-float absolute left-1/2 top-0 -translate-x-[50%] [perspective:1600px] sm:-translate-x-[56%] lg:-translate-x-[59%]">
        <div className="origin-top scale-[0.64] sm:scale-90 lg:scale-100">
          <Phone featured={featured} categories={categories} />
        </div>
      </div>

      {/* 3 — protection shield */}
      <div aria-hidden className="absolute bottom-6 left-0 z-10 flex w-28 flex-col items-center sm:bottom-10 sm:-left-2 sm:w-40 lg:w-44">
        <div className="edmn-pop" style={{ '--d': '0.3s' } as React.CSSProperties}>
          <Shield className="edmn-shield-glow w-24 sm:w-36 lg:w-40" />
        </div>
        <p className="mt-1 text-center text-xs font-bold leading-5 text-white sm:text-base sm:leading-6">
          حماية المشتري
          <br />
          والبائع
        </p>
      </div>

      {/* 4 — floating protection card */}
      <div aria-hidden className="edmn-chip absolute left-0 top-10 z-20 flex items-center gap-2 rounded-2xl bg-white/95 px-3 py-2.5 text-ink shadow-[0_18px_40px_-16px_rgb(0_0_0/0.6)] ring-1 ring-white/60 backdrop-blur sm:left-[6%] sm:top-14" style={{ '--d': '0.5s' } as React.CSSProperties}>
        <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white">
          <ShieldCheck className="size-5" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold">دفع آمن</span>
          <span className="block text-[11px] font-medium text-slate-600">محمي لدى اضمن</span>
        </span>
      </div>

      {/* 4 — transaction status panel */}
      <div aria-hidden className="edmn-chip absolute right-0 top-[8.5rem] z-20 hidden w-[12.5rem] space-y-1 rounded-2xl border border-white/15 bg-[#0b2350]/75 p-3 shadow-[0_24px_50px_-20px_rgb(0_0_0/0.8)] backdrop-blur-md sm:block lg:w-[13.5rem]" style={{ '--d': '0.7s' } as React.CSSProperties}>
        {[
          { icon: ShieldCheck, text: 'المبلغ محمي لدى اضمن', tone: 'bg-emerald-500' },
          { icon: PackageCheck, text: 'استلم وتأكد من المنتج', tone: 'bg-brand-500' },
          { icon: Wallet, text: 'تحويل المبلغ للبائع بعد التأكيد', tone: 'bg-brand-500' },
        ].map((r, i) => (
          <div key={r.text} className={`flex items-center gap-2.5 py-2 ${i > 0 ? 'border-t border-white/10' : ''}`}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full ${r.tone} text-white`}>
              <r.icon className="size-4" />
            </span>
            <span className="text-xs font-semibold leading-5 text-white">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Phone({ featured, categories }: { featured: DeviceProduct | null; categories: { nameAr: string; icon: string | null }[] }) {
  return (
    <div className="edmn-phone relative h-[32rem] w-[15.5rem] rounded-[2.9rem] p-[0.6rem] [transform:rotateY(-14deg)_rotateX(5deg)_rotateZ(2deg)] [transform-style:preserve-3d]">
      {/* side buttons */}
      <span className="absolute -left-[3px] top-28 h-12 w-[3px] rounded-l bg-slate-500" />
      <span className="absolute -left-[3px] top-44 h-12 w-[3px] rounded-l bg-slate-500" />
      <span className="absolute -right-[3px] top-36 h-16 w-[3px] rounded-r bg-slate-500" />
      <div className="relative h-full overflow-hidden rounded-[2.35rem] bg-[#f4f7fc]">
        <span className="absolute left-1/2 top-2 z-10 h-[1.35rem] w-[5.5rem] -translate-x-1/2 rounded-full bg-black" />
        {/* app header */}
        <div className="bg-white px-3 pb-2.5 pt-9 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between">
            <img src={LOGO_SRC} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" draggable={false} className="h-7 w-auto object-contain" />
            <Bell className="size-4 text-brand-900" />
          </div>
          <div className="mt-2 flex h-8 items-center gap-1.5 rounded-full bg-[#f1f4f9] px-3 text-[10px] text-slate-600 ring-1 ring-slate-200">
            <Search className="size-3.5" /> ابحث في اضمن…
          </div>
        </div>
        {/* category row (real categories) */}
        <div className="grid grid-cols-4 gap-1 px-2.5 pt-3">
          {categories.slice(0, 4).map((c) => {
            const Icon = ((c.icon && (Icons as unknown as Record<string, LucideIcon>)[c.icon]) || LayoutGrid) as LucideIcon;
            return (
              <div key={c.nameAr} className="flex flex-col items-center gap-1">
                <span className="grid size-9 place-items-center rounded-xl bg-white text-brand-600 shadow-[var(--shadow-card)] ring-1 ring-slate-100">
                  <Icon className="size-4" />
                </span>
                <span className="w-full truncate text-center text-[8px] font-medium text-slate-600">{c.nameAr}</span>
              </div>
            );
          })}
        </div>
        {/* product card (live catalog product) */}
        <div className="mx-2.5 mt-3 overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_-12px_rgb(15_23_42/0.35)] ring-1 ring-slate-100">
          <div className="relative h-[9.5rem] bg-gradient-to-b from-slate-50 to-slate-100">
            <SafeImg src={featured ? mediaUrl(featured.imageKey, 'md') : null} className="size-full p-3" eager />
            <span className="absolute start-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-emerald-700 px-1.5 py-0.5 text-[8px] font-bold text-white">
              <ShieldCheck className="size-2.5" /> شراء محمي
            </span>
            <Heart className="absolute end-2 top-2 size-4 text-slate-400" />
          </div>
          <div className="space-y-1 p-2.5">
            <p className="line-clamp-1 text-[11px] font-bold text-ink">{featured?.titleAr ?? 'منتجات من متاجر موثّقة'}</p>
            {featured && (
              <p className="flex items-center gap-1 text-[9px] text-slate-600">
                <span className="truncate">{featured.storeName}</span>
                {featured.storeVerified && <BadgeCheck className="size-3 shrink-0 text-brand-600" />}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              {featured && <span className="text-[13px] font-extrabold text-ink">{formatEGP(featured.minPrice)}</span>}
              <span className="inline-flex h-7 items-center gap-1 rounded-xl bg-brand-600 px-2.5 text-[9px] font-bold text-white">
                <ShoppingCart className="size-3" /> أضف للسلة
              </span>
            </div>
          </div>
        </div>
        {/* protected payment strip */}
        <div className="mx-2.5 mt-2.5 flex items-center gap-2 rounded-xl bg-emerald-50 px-2.5 py-2 text-[9px] font-semibold text-emerald-800 ring-1 ring-emerald-100">
          <ShieldCheck className="size-4 shrink-0" /> مبلغك محفوظ لدى اضمن حتى تأكد الاستلام
        </div>
        {/* tab bar */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-around border-t border-slate-100 bg-white px-2 pb-4 pt-2 text-slate-400">
          <Home className="size-4 text-brand-600" />
          <LayoutGrid className="size-4" />
          <ShieldCheck className="size-4" />
          <ShoppingCart className="size-4" />
          <User className="size-4" />
        </div>
      </div>
    </div>
  );
}

/** EDMN protection shield: dimensional SVG (bevel, face gradient, gloss, check). */
function Shield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 190" className={className} aria-hidden>
      <defs>
        <linearGradient id="edmn-sh-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#bfdbff" />
          <stop offset="0.45" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#0b3a8c" />
        </linearGradient>
        <linearGradient id="edmn-sh-face" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#4f9bff" />
          <stop offset="0.55" stopColor="#1d5fd6" />
          <stop offset="1" stopColor="#0a3a9e" />
        </linearGradient>
        <linearGradient id="edmn-sh-gloss" x1="0" y1="0" x2="0.9" y2="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M80 4 152 30v58c0 45-30 79-72 98C38 167 8 133 8 88V30Z" fill="url(#edmn-sh-edge)" />
      <path d="M80 18 138 39v49c0 37-24 66-58 83-34-17-58-46-58-83V39Z" fill="url(#edmn-sh-face)" />
      <path d="M80 18 138 39v26C108 56 60 70 22 98V39Z" fill="url(#edmn-sh-gloss)" />
      <path d="M50 93 72 115 113 70" fill="none" stroke="#fff" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
