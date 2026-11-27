import { toHandler } from '@/server/api/http';
import { adminReplySupportTicket } from '@/server/api/routes/admin-support';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(adminReplySupportTicket);
