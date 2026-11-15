import { toHandler } from '@/server/api/http';
import { replySupportTicket } from '@/server/api/routes/messages';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(replySupportTicket);
