import { isDomainError } from '@/server/core/errors';
import { markRead, unreadForSeller, unreadForUser } from '@/server/modules/messaging/service';
import { liveActor, noStore, sameOrigin } from '@/server/web/live-auth';

export const dynamic = 'force-dynamic';

/** The participant's client reports the conversation was on screen (visible tab) up to `upTo`. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: 'forbidden' }, { status: 403, headers: noStore });
  const body = (await req.json().catch(() => ({}))) as { surface?: string; conversationId?: string; upTo?: string };
  const surface = body.surface === 'seller' ? 'seller' : 'account';
  const actor = await liveActor(surface);
  if (!actor?.userId) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: noStore });
  try {
    await markRead(actor, String(body.conversationId ?? ''), body.upTo ? String(body.upTo) : undefined);
  } catch (e) {
    if (isDomainError(e)) return Response.json({ error: 'not found' }, { status: 404, headers: noStore });
    throw e;
  }
  const unreadMessages = surface === 'seller' ? await unreadForSeller(actor) : await unreadForUser(actor.userId);
  return Response.json({ ok: true, unreadMessages }, { headers: noStore });
}
