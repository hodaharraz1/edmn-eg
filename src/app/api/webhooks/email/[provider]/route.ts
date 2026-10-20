import { handleDeliveryWebhook } from '@/server/modules/notifications/delivery-events';

/**
 * Email delivery events from the transactional email provider (DELIVERED / BOUNCED / DEFERRED / COMPLAINED).
 * 503 until EMAIL_WEBHOOK_SECRET is configured. Signed + replay-protected; never touches money.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 256 * 1024) return Response.json({ status: 'BAD_REQUEST' }, { status: 413 });
  const res = await handleDeliveryWebhook(provider, req.headers, raw);
  return Response.json({ status: res.status }, { status: res.httpStatus, headers: { 'cache-control': 'no-store' } });
}
