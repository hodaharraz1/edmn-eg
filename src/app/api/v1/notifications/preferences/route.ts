import { toHandler } from '@/server/api/http';
import { getNotificationPreferences } from '@/server/api/routes/notifications';
import { saveNotificationPreferences } from '@/server/api/routes/notifications';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(getNotificationPreferences);
export const PUT = toHandler(saveNotificationPreferences);
