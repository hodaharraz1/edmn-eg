import { toHandler } from '@/server/api/http';
import { getSellerProduct } from '@/server/api/routes/seller-setup';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getSellerProduct);
