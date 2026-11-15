import { toHandler } from '@/server/api/http';
import { getDeal } from '@/server/api/routes/deals';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getDeal);
