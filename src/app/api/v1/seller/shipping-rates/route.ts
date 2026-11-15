import { toHandler } from '@/server/api/http';
import { getSellerShippingRates } from '@/server/api/routes/seller-setup';
import { saveSellerShippingRates } from '@/server/api/routes/seller-setup';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getSellerShippingRates);
export const PUT = toHandler(saveSellerShippingRates);
