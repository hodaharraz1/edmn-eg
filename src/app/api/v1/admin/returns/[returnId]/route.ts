import { toHandler } from '@/server/api/http';
import { adminReturnDetail } from '@/server/api/routes/admin-returns';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(adminReturnDetail);
