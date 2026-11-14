import { toHandler } from '@/server/api/http';
import { me } from '@/server/api/routes/customer';
import { updateProfile } from '@/server/api/routes/buyer';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(me);
export const PATCH = toHandler(updateProfile);
