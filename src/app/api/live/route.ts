import { liveSnapshot } from '@/server/modules/messaging/live';
import { liveActor, noStore } from '@/server/web/live-auth';

export const dynamic = 'force-dynamic';

/**
 * Live sync (badges, incoming-message alerts, open-conversation updates). Authorization is re-derived on
 * every call from the session; an unauthenticated caller gets 401 and no data.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const surface = url.searchParams.get('surface') === 'seller' ? 'seller' : 'account';
  const actor = await liveActor(surface);
  if (!actor?.userId) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: noStore });
  const snap = await liveSnapshot(actor, surface, {
    since: url.searchParams.get('since'),
    conv: url.searchParams.get('conv'),
    after: url.searchParams.get('after'),
    visible: url.searchParams.get('visible') === '1',
  });
  return Response.json(snap, { headers: noStore });
}
