import { toHandler } from '@/server/api/http';
import { deleteSellerProductImage } from '@/server/api/routes/seller-setup';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const DELETE = toHandler(deleteSellerProductImage);
