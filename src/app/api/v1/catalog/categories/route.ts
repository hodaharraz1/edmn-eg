import { toHandler } from '@/server/api/http';
import { categories } from '@/server/api/routes/public';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(categories);
