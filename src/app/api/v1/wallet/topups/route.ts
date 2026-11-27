import { toHandler } from '@/server/api/http';
import { createWalletTopup, listWalletTopups } from '@/server/api/routes/wallet';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listWalletTopups);
export const POST = toHandler(createWalletTopup);
