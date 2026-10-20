import { productsByIds } from '@/server/modules/catalog/search';

/** Public card data for client widgets (recently viewed). Only LIVE, visible products are returned. */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '')
    .split(',')
    .filter((x) => /^[0-9a-f-]{36}$/.test(x))
    .slice(0, 12);
  const items = await productsByIds(ids);
  return Response.json({ items }, { headers: { 'cache-control': 'public, max-age=60' } });
}
