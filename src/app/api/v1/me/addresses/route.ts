import { toHandler } from '@/server/api/http';
import { createAddress, listAddresses } from '@/server/api/routes/buyer';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listAddresses);
export const POST = toHandler(createAddress);
