import { toHandler } from '@/server/api/http';
import { cancelAccountDeletionRequest } from '@/server/api/routes/account-closure';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(cancelAccountDeletionRequest);
