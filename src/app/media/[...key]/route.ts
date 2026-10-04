import { storage, isSafeKey } from '@/server/storage/storage';

/** Serves PUBLIC files only (product images, logos, CMS). Private files go through /api/files/[id]. */
export async function GET(_req: Request, ctx: RouteContext<'/media/[...key]'>) {
  const { key } = await ctx.params;
  const k = key.join('/');
  if (!isSafeKey(k)) return new Response('Not found', { status: 404 });
  const data = await storage().get('PUBLIC', k);
  if (!data) return new Response('Not found', { status: 404 });
  const type = k.endsWith('.webp') ? 'image/webp' : k.endsWith('.png') ? 'image/png' : k.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
