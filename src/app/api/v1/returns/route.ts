import { toHandler } from '@/server/api/http';
import { createReturnRoute } from '@/server/api/routes/postpurchase';
import { listMyReturns } from '@/server/api/routes/postpurchase';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(createReturnRoute);
export const GET = toHandler(listMyReturns);
