import { toHandler } from '@/server/api/http';
import { addWishlistItem, removeWishlistItem } from '@/server/api/routes/wishlist';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const PUT = toHandler(addWishlistItem);
export const DELETE = toHandler(removeWishlistItem);
