import { toHandler } from '@/server/api/http';
import { listReceivingAccounts } from '@/server/api/routes/wallet';
import { addReceivingAccountRoute } from '@/server/api/routes/wallet';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listReceivingAccounts);
export const POST = toHandler(addReceivingAccountRoute);
