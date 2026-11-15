import { toHandler } from '@/server/api/http';
import { getSellerApplication } from '@/server/api/routes/seller-setup';
import { startSellerApplicationRoute } from '@/server/api/routes/seller-setup';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getSellerApplication);
export const POST = toHandler(startSellerApplicationRoute);
