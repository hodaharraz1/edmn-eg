import { toHandler } from '@/server/api/http';
import { replyStoreDispute } from '@/server/api/routes/postpurchase';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(replyStoreDispute);
