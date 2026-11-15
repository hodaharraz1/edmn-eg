import { toHandler } from '@/server/api/http';
import { listSupportTickets } from '@/server/api/routes/messages';
import { openSupportTicket } from '@/server/api/routes/messages';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listSupportTickets);
export const POST = toHandler(openSupportTicket);
