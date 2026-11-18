import { toHandler } from '@/server/api/http';
import { getWishlist } from '@/server/api/routes/wishlist';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getWishlist);
