import { toHandler } from '@/server/api/http';
import { getSellerStore } from '@/server/api/routes/seller-setup';
import { saveSellerStoreSettingsRoute } from '@/server/api/routes/seller-setup';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getSellerStore);
export const PUT = toHandler(saveSellerStoreSettingsRoute);
