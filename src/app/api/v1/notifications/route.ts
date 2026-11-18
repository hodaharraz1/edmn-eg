import { toHandler } from '@/server/api/http';
import { listNotifications } from '@/server/api/routes/notifications';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(listNotifications);
