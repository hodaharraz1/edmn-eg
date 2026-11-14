import { toHandler } from '@/server/api/http';
import { getPayment } from '@/server/api/routes/buyer';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getPayment);
