import { BadgeCheck, Store } from 'lucide-react';
import Link from '@/ui/link';
import { Price, Stars, mediaUrl, type CardProduct } from '@/ui/commerce';
import { WishlistButton } from '@/app/_components/product-bits';
import { AddToCartMini } from './add-to-cart-mini';
import { SafeImg } from './safe-img';
import { SectionHeading } from './hero';

export type FeaturedProduct = CardProduct & { singleVariantId: string | null };

/** «منتجات مميزة»: live catalog products, five across on desktop (approved reference density), two per row on phones. The whole card opens the product; wishlist and cart sit above that link. */
export function FeaturedProducts({ products, wished }: { products: FeaturedProduct[]; wished: Set<string> }) {
  if (!products.length) return null;
  return (
    <section aria-labelledby="home-featured" className="space-y-4">
      <SectionHeading id="home-featured" title="منتجات مميزة" href="/search" hrefLabel="عرض المزيد" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        {products.map((p, i) => (
          <li key={p.id} className={i === 5 ? 'lg:hidden' : ''}>
            <FeaturedCard p={p} active={wished.has(p.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeaturedCard({ p, active }: { p: FeaturedProduct; active: boolean }) {
  const titleId = `fp-${p.id}`;
  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-line bg-white p-2.5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-3">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-slate-100/70">
        <SafeImg src={mediaUrl(p.imageKey, 'md')} alt={p.titleAr} className="size-full p-3 transition-transform duration-300 group-hover:scale-105" />
        {p.condition === 'USED' && <span className="absolute bottom-2 start-2 rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">مستعمل</span>}
      </div>
      <div className="absolute end-3 top-3 z-10 sm:end-5 sm:top-5">
        <WishlistButton productId={p.id} active={active} back="/" className="size-11 xl:size-9" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 pt-3">
        <Link id={titleId} href={`/product/${p.slug}`} className="line-clamp-1 text-sm font-semibold after:absolute after:inset-0 after:rounded-2xl hover:text-brand-700">
          {p.titleAr}
        </Link>
        {p.ratingCount > 0 && <Stars value={p.ratingAvg} count={p.ratingCount} />}
        <Price value={p.minPrice} compareAt={p.maxCompareAtPrice} className="[&>span:first-child]:text-lg" />
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted">
          <Store className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{p.storeName}</span>
          {p.storeVerified && <BadgeCheck className="size-3.5 shrink-0 text-brand-600" aria-label="متجر موثّق" />}
        </p>
        <div className="relative z-10 mt-auto pt-1.5">
          {p.singleVariantId ? (
            <AddToCartMini variantId={p.singleVariantId} describedBy={titleId} />
          ) : (
            <Link href={`/product/${p.slug}`} aria-describedby={titleId} className="flex h-11 w-full items-center justify-center rounded-xl bg-brand-600 text-[13px] font-bold text-white hover:bg-brand-700 sm:text-sm">
              اختر المواصفات
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
