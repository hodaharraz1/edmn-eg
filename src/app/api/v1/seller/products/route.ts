import { toHandler } from '@/server/api/http';
import { listSellerProducts } from '@/server/api/routes/seller';
import { createSellerProduct } from '@/server/api/routes/seller-setup';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listSellerProducts);
export const POST = toHandler(createSellerProduct);
