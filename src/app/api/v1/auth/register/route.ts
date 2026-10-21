import { toHandler } from '@/server/api/http';
import { register } from '@/server/api/routes/customer';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const POST = toHandler(register);
