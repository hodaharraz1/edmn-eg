import { liveSnapshot, liveToken } from '@/server/modules/messaging/live';
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
  const conv = url.searchParams.get('conv');
  const visible = url.searchParams.get('visible') === '1';
  // Cheap path: nothing changed since the client's last token → 204, no snapshot queries at all.
  const token = await liveToken(actor, surface, { conv, visible });
  const known = url.searchParams.get('v');
  if (known && known === token) return new Response(null, { status: 204, headers: noStore });
  const snap = await liveSnapshot(actor, surface, { since: url.searchParams.get('since'), conv, after: url.searchParams.get('after'), visible, presence: false });
  return Response.json({ ...snap, token }, { headers: noStore });
}
