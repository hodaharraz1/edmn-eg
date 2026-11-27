import { hit } from '@/server/auth/rate-limit';
import { clientIp } from '@/server/web/client-ip';
import { handleProviderCallback } from '@/server/modules/payments/webhooks';

/**
 * Provider callback endpoint (no provider is connected; returns 503 until a signing secret is set).
 * Evidence only — never changes a payment, balance or payout.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  // SEC-04 L1: unauthenticated POST surface — bound it before reading the body.
  if (!(await hit(`webhook:payments:${clientIp(req.headers) ?? 'unknown'}`, 300, 60))) {
    return Response.json({ status: 'RATE_LIMITED' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
  }
  const { provider } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 64 * 1024) return Response.json({ status: 'BAD_REQUEST' }, { status: 413 });
  const res = await handleProviderCallback(provider, { signature: req.headers.get('x-edmn-signature'), timestamp: req.headers.get('x-edmn-timestamp') }, raw);
  return Response.json({ status: res.status }, { status: res.httpStatus, headers: { 'cache-control': 'no-store' } });
}
