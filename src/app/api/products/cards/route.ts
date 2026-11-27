import { hit } from '@/server/auth/rate-limit';
import { clientIp } from '@/server/web/client-ip';
import { productsByIds } from '@/server/modules/catalog/search';

/** Public card data for client widgets (recently viewed). Only LIVE, visible products are returned. */
export async function GET(req: Request) {
  // SEC-04 L1: the card endpoint runs up to 12 product reads per call; cap it per IP.
  const limited = await hit(`cards:ip:${clientIp(req.headers) ?? 'unknown'}`, 120, 60);
  if (!limited) return Response.json({ items: [] }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
  const ids = (new URL(req.url).searchParams.get('ids') ?? '')
    .split(',')
    .filter((x) => /^[0-9a-f-]{36}$/.test(x))
    .slice(0, 12);
  const items = await productsByIds(ids);
  return Response.json({ items }, { headers: { 'cache-control': 'public, max-age=60' } });
}
