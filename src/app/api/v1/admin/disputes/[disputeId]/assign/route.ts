import { toHandler } from '@/server/api/http';
import { adminAssignDispute } from '@/server/api/routes/admin-monitoring';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(adminAssignDispute);
