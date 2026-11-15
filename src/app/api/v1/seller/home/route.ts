import { toHandler } from '@/server/api/http';
import { sellerDashboardRoute } from '@/server/api/routes/seller';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(sellerDashboardRoute);
