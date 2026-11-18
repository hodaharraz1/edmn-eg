import { toHandler } from '@/server/api/http';
import { getWalletActivity } from '@/server/api/routes/wallet';

export const runtime = 'nodejs';
export const GET = toHandler(getWalletActivity);
