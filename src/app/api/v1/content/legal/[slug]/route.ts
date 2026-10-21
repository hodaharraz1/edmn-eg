import { toHandler } from '@/server/api/http';
import { legalDocument } from '@/server/api/routes/public';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(legalDocument);
