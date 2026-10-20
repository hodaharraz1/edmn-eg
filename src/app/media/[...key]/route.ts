import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { files } from '@/server/db/schema';
import { servable } from '@/server/storage/scanning';
import { storage, isSafeKey } from '@/server/storage/storage';

/**
 * Serves PUBLIC files only (product images, logos, CMS). Private files go through /api/files/[id].
 * The bytes are served only while the file's record is live, public and servable (scan status) — an
 * INFECTED, quarantined (where scanning is required) or deleted file is a 404, its resized variants too.
 */
export async function GET(_req: Request, ctx: RouteContext<'/media/[...key]'>) {
  const { key } = await ctx.params;
  const k = key.join('/');
  if (!isSafeKey(k)) return new Response('Not found', { status: 404 });
  const base = k.replace(/_(thumb|md)\.webp$/, '.webp');
  const [row] = await db
    .select({ visibility: files.visibility, scanStatus: files.scanStatus })
    .from(files)
    .where(and(eq(files.storageKey, base), isNull(files.deletedAt)))
    .limit(1);
  if (!row || row.visibility !== 'PUBLIC' || !servable(row)) return new Response('Not found', { status: 404 });
  const data = await storage().get('PUBLIC', k);
  if (!data) return new Response('Not found', { status: 404 });
  const type = k.endsWith('.webp') ? 'image/webp' : k.endsWith('.png') ? 'image/png' : k.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': type,
      // Only a scanned-CLEAN file is cached long-term; anything else can still be withdrawn by its scan verdict.
      'cache-control': row.scanStatus === 'CLEAN' ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
