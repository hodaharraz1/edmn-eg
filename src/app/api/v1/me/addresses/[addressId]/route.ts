import { toHandler } from '@/server/api/http';
import { deleteAddress, updateAddress } from '@/server/api/routes/buyer';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const PUT = toHandler(updateAddress);
export const DELETE = toHandler(deleteAddress);
