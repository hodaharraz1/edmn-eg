import { toHandler } from '@/server/api/http';
import { getAccountDeletionRequest, requestAccountDeletion } from '@/server/api/routes/account-closure';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getAccountDeletionRequest);
export const POST = toHandler(requestAccountDeletion);
