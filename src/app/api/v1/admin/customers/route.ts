import { toHandler } from '@/server/api/http';
import { adminListCustomers } from '@/server/api/routes/admin-customers';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(adminListCustomers);
