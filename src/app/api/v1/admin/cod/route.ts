import { toHandler } from '@/server/api/http';
import { adminCodMonitor } from '@/server/api/routes/admin-cod';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(adminCodMonitor);
