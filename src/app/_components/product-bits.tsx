import { Heart } from 'lucide-react';
import { eq, inArray, and } from 'drizzle-orm';
import { toggleWishlistAction } from '@/app/_actions/shop';
import { cn } from '@/lib/cn';
import { db } from '@/server/db/client';
import { wishlistItems } from '@/server/db/schema';
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
        className={cn('grid size-9 place-items-center rounded-full bg-white/95 shadow ring-1 ring-line hover:scale-105', className)}
        aria-label={active ? 'شيل من المفضلة' : 'ضيف للمفضلة'}
        aria-pressed={active}
      >
        <Heart className={cn('size-4', active ? 'fill-accent-600 text-accent-600' : 'text-slate-500')} />
      </button>
    </form>
  );
}

export async function Cards({ items, back, priorityCount = 0 }: { items: CardProduct[]; back: string; priorityCount?: number }) {
  const wished = await wishlistSet(items.map((i) => i.id));
  return (
    <>
      {items.map((p, i) => (
        <ProductCard key={p.id} p={p} priority={i < priorityCount} wishlistSlot={<WishlistButton productId={p.id} active={wished.has(p.id)} back={back} />} />
      ))}
    </>
  );
}
