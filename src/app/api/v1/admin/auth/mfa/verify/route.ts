import { toHandler } from '@/server/api/http';
import { adminMfaVerify } from '@/server/api/routes/admin';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(adminMfaVerify);
