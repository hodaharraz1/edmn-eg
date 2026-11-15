import { toHandler } from '@/server/api/http';
import { myStore } from '@/server/api/routes/seller';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(myStore);
