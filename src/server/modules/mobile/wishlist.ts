import { and, desc, eq } from 'drizzle-orm';
import { requireUser, type Actor } from '@/server/core/actor';
import { notFound } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { wishlistItems } from '@/server/db/schema';
import { publicProductCards } from '@/server/modules/catalog/public-read';

/**
 * The session user's wishlist (the same `wishlist_items` rows the web /account/wishlist page uses).
 *
 * Add and remove are explicit and idempotent (a retry changes nothing), unlike a toggle, which a lost-response retry
 * would undo. Only publicly visible products can be added, and the list shows only products that are visible now, as
 * on the web; hidden ones stay saved and reappear if the product becomes visible again.
 */
const MAX_ITEMS = 500;

export async function myWishlist(actor: Actor) {
  const userId = requireUser(actor);
  const rows = await db
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt))
    .limit(MAX_ITEMS);
  const items = await publicProductCards(rows.map((r) => r.productId));
  return { items, productIds: items.map((p) => p.id) };
}

export async function addToWishlist(actor: Actor, productId: string) {
  const userId = requireUser(actor);
  const [visible] = await publicProductCards([productId]);
  if (!visible) throw notFound();
  await db.insert(wishlistItems).values({ userId, productId }).onConflictDoNothing();
  return myWishlist(actor);
}

export async function removeFromWishlist(actor: Actor, productId: string) {
  const userId = requireUser(actor);
  // Removing works for any saved product, visible or not; removing one that is not saved is a no-op.
  await db.delete(wishlistItems).where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)));
  return myWishlist(actor);
}
