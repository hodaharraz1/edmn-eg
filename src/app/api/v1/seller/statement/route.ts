import { toHandler } from '@/server/api/http';
import { getStoreStatement } from '@/server/api/routes/wallet';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getStoreStatement);
