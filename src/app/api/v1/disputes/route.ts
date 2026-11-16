import { toHandler } from '@/server/api/http';
import { openDisputeRoute } from '@/server/api/routes/postpurchase';
import { listMyDisputes } from '@/server/api/routes/postpurchase';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(openDisputeRoute);
export const GET = toHandler(listMyDisputes);
