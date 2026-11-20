import { toHandler } from '@/server/api/http';
import { adminDisputeDetail } from '@/server/api/routes/admin-monitoring';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(adminDisputeDetail);
