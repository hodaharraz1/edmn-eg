import { toHandler } from '@/server/api/http';
import { listAccountPayoutRequests } from '@/server/api/routes/wallet';
import { createAccountPayoutRequest } from '@/server/api/routes/wallet';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listAccountPayoutRequests);
export const POST = toHandler(createAccountPayoutRequest);
