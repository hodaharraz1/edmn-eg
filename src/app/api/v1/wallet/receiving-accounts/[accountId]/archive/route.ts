import { toHandler } from '@/server/api/http';
import { archiveReceivingAccount } from '@/server/api/routes/wallet';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(archiveReceivingAccount);
