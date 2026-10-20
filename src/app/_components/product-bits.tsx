import { Heart } from 'lucide-react';
import { eq, inArray, and } from 'drizzle-orm';
import Link from '@/ui/link';
import { AddToCartMini } from '@/app/_components/add-to-cart-mini';
import { toggleWishlistAction } from '@/app/_actions/shop';
import { cn } from '@/lib/cn';
import { db } from '@/server/db/client';
import { productVariants, wishlistItems } from '@/server/db/schema';
import { getWebSession } from '@/server/web/session';
import { ProductCard, type CardProduct } from '@/ui/commerce';

export async function wishlistSet(productIds: string[]): Promise<Set<string>> {
  const s = await getWebSession();
  if (!s || !productIds.length) return new Set();
  const rows = await db.select({ id: wishlistItems.productId }).from(wishlistItems).where(and(eq(wishlistItems.userId, s.user.id), inArray(wishlistItems.productId, productIds)));
  return new Set(rows.map((r) => r.id));
}

export function WishlistButton({ productId, active, back, className }: { productId: string; active: boolean; back: string; className?: string }) {
  return (
    <form action={toggleWishlistAction}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="back" value={back} />
      <button
        className={cn('grid size-11 place-items-center rounded-full bg-white/95 shadow ring-1 ring-line transition-transform hover:scale-105 xl:size-9', className)}
        aria-label={active ? 'شيل من المفضلة' : 'ضيف للمفضلة'}
        aria-pressed={active}
      >
        <Heart className={cn('size-4', active ? 'fill-accent-600 text-accent-600' : 'text-slate-500')} />
      </button>
    </form>
  );
}

/** Active option per product, for the one-tap add to cart (one query for the whole grid). */
async function singleVariants(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true)));
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.productId, [...(by.get(r.productId) ?? []), r.id]);
  return new Map([...by].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
}

/**
 * Product cards with wishlist state and the purchase CTA: single-option products add to the cart directly
 * (same server action as the product page, quantity 1); others open the product to choose the option.
 */
export async function Cards({ items, back, priorityCount = 0, withCta = true }: { items: CardProduct[]; back: string; priorityCount?: number; withCta?: boolean }) {
  const [wished, single] = await Promise.all([wishlistSet(items.map((i) => i.id)), withCta ? singleVariants(items.map((i) => i.id)) : Promise.resolve(new Map<string, string>())]);
  return (
    <>
      {items.map((p, i) => {
        const v = single.get(p.id);
        const cta = !withCta ? undefined : p.totalAvailable <= 0 ? null : v ? (
          <AddToCartMini variantId={v} describedBy={`pc-${p.id}`} />
        ) : (
          <Link href={`/product/${p.slug}`} aria-describedby={`pc-${p.id}`} className="flex h-11 w-full items-center justify-center rounded-xl bg-brand-600 text-[13px] font-bold text-white hover:bg-brand-700 sm:text-sm">
            اختر المواصفات
          </Link>
        );
        return <ProductCard key={p.id} p={p} priority={i < priorityCount} cta={cta} wishlistSlot={<WishlistButton productId={p.id} active={wished.has(p.id)} back={back} />} />;
      })}
    </>
  );
}
