import { toHandler } from '@/server/api/http';
import { myPushTokenStatus, saveMyPushToken, deleteMyPushToken } from '@/server/api/routes/customer';

/** Thin transport mount: the contract, auth, limits and handler live in the route definition. */
export const dynamic = 'force-dynamic';
export const GET = toHandler(myPushTokenStatus);
export const POST = toHandler(saveMyPushToken);
export const DELETE = toHandler(deleteMyPushToken);
