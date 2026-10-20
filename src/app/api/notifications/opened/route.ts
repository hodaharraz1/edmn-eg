import { markDeliveryOpened } from '@/server/modules/notifications/message-alerts';
import { customerActorOrNull } from '@/server/web/session';
import { noStore, sameOrigin } from '@/server/web/live-auth';

export const dynamic = 'force-dynamic';

/** Telemetry: a push/in-app alert was opened by its recipient. Never evidence of delivery or receipt. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return Response.json({ error: 'forbidden' }, { status: 403, headers: noStore });
  const actor = await customerActorOrNull();
  if (!actor?.userId) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: noStore });
  const body = (await req.json().catch(() => ({}))) as { deliveryId?: string };
  const ok = await markDeliveryOpened(actor.userId, String(body.deliveryId ?? ''));
  return Response.json({ ok }, { headers: noStore });
}
