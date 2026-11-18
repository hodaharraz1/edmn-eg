import { z } from 'zod';
import { addToWishlist, myWishlist, removeFromWishlist } from '@/server/modules/mobile/wishlist';
import { defineRoute } from '../http';
import { productCard, uuid } from '../schemas';

/**
 * Wishlist ("المفضلة"): the session user's saved products, the same list as the web /account/wishlist page.
 * Add and remove are idempotent by design (PUT / DELETE of one product), so a retried request never flips the state.
 */
const base = { api: 'mobile' as const, auth: 'customer' as const, tags: ['Wishlist'] };
const errors = ['forbidden' as const, 'not_found' as const];
const wishlistOut = z
  .object({
    items: z.array(productCard).meta({ description: 'Saved products that are publicly visible now, newest first.' }),
    productIds: z.array(uuid).meta({ description: 'Ids of the items above, for marking hearts on other screens.' }),
  })
  .meta({ id: 'Wishlist' });
const params = z.object({ productId: uuid });

export const getWishlist = defineRoute({
  ...base, id: 'getWishlist', method: 'GET', path: '/api/v1/wishlist',
  summary: 'My wishlist', rate: 'read', errors, response: wishlistOut,
  handler: ({ actor }) => myWishlist(actor!),
});

export const addWishlistItem = defineRoute({
  ...base, id: 'addWishlistItem', method: 'PUT', path: '/api/v1/wishlist/{productId}',
  summary: 'Save a publicly visible product (already saved = no change)', rate: 'write', idempotency: 'required',
  errors, params, response: wishlistOut,
  handler: ({ actor, params }) => addToWishlist(actor!, params.productId),
});

export const removeWishlistItem = defineRoute({
  ...base, id: 'removeWishlistItem', method: 'DELETE', path: '/api/v1/wishlist/{productId}',
  summary: 'Remove a product from my wishlist (not saved = no change)', rate: 'write', idempotency: 'required',
  errors, params, response: wishlistOut,
  handler: ({ actor, params }) => removeFromWishlist(actor!, params.productId),
});

export const wishlistRoutes = [getWishlist, addWishlistItem, removeWishlistItem];
