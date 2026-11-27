import { hit } from '@/server/auth/rate-limit';
import { clientIp } from '@/server/web/client-ip';
import { handleDeliveryWebhook } from '@/server/modules/notifications/delivery-events';

/**
 * Email delivery events from the transactional email provider (DELIVERED / BOUNCED / DEFERRED / COMPLAINED).
 * 503 until EMAIL_WEBHOOK_SECRET is configured. Signed + replay-protected; never touches money.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  // SEC-04 L1: unauthenticated POST surface — bound it before reading the body.
  if (!(await hit(`webhook:email:${clientIp(req.headers) ?? 'unknown'}`, 300, 60))) {
    return Response.json({ status: 'RATE_LIMITED' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
  }
  const { provider } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 256 * 1024) return Response.json({ status: 'BAD_REQUEST' }, { status: 413 });
  const res = await handleDeliveryWebhook(provider, req.headers, raw);
  return Response.json({ status: res.status }, { status: res.httpStatus, headers: { 'cache-control': 'no-store' } });
}
