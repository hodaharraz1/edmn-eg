import { toHandler } from '@/server/api/http';
import { listDeals } from '@/server/api/routes/deals';
import { createDealRoute } from '@/server/api/routes/deals';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listDeals);
export const POST = toHandler(createDealRoute);
