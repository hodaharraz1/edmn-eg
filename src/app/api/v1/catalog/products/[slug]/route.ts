import { toHandler } from '@/server/api/http';
import { productBySlug } from '@/server/api/routes/public';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(productBySlug);
