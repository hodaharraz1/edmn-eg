import { headers } from 'next/headers';
import { isDomainError } from '@/server/core/errors';
import { revokeSubscription, saveSubscription } from '@/server/modules/notifications/push';
import { customerActorOrNull } from '@/server/web/session';
import { noStore, sameOrigin } from '@/server/web/live-auth';

export const dynamic = 'force-dynamic';

/** Register (or refresh) this browser's push subscription for the signed-in user. Opt-in only. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: 'forbidden' }, { status: 403, headers: noStore });
  const actor = await customerActorOrNull();
  if (!actor?.userId) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: noStore });
  const body = (await req.json().catch(() => ({}))) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; expirationTime?: unknown } };
  try {
    await saveSubscription(actor.userId, body.subscription ?? {}, (await headers()).get('user-agent'));
  } catch (e) {
    if (isDomainError(e)) return Response.json({ error: e.message }, { status: 400, headers: noStore });
    throw e;
  }
  return Response.json({ ok: true }, { headers: noStore });
}

/** The browser unsubscribed (or the user turned notifications off on this device). */
export async function DELETE(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: 'forbidden' }, { status: 403, headers: noStore });
  const actor = await customerActorOrNull();
  if (!actor?.userId) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: noStore });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (body.endpoint) await revokeSubscription(actor.userId, { endpoint: String(body.endpoint) }, 'BROWSER_UNSUBSCRIBED').catch(() => undefined);
  return Response.json({ ok: true }, { headers: noStore });
}
