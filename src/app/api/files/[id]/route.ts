import { customerActor, sellerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { readPrivateFile } from '@/server/storage/access';
import { getAdminSession, getWebSession, requestMeta } from '@/server/web/session';
import { adminActor } from '@/server/auth/actors';

/**
 * Authorization-checked download of PRIVATE files (IDs, payment proofs, waybills, evidence).
 * The id alone is never sufficient; responses are uniform 404s to avoid enumeration.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/files/[id]'>) {
  const { id } = await ctx.params;
  const meta = await requestMeta();
  const candidates: Actor[] = [];
  const admin = await getAdminSession();
  if (admin?.session.mfaVerifiedAt) candidates.push(await adminActor(admin.user.id, { ...meta, stepUpAt: admin.session.stepUpAt }));
  const web = await getWebSession();
  if (web) {
    const s = await sellerActor(web.user.id, meta);
    if (s) candidates.push(s);
    candidates.push(customerActor(web.user.id, meta));
  }
  for (const actor of candidates) {
    const res = await readPrivateFile(actor, id);
    if (res) {
      const download = new URL(req.url).searchParams.has('download');
      return new Response(new Uint8Array(res.data), {
        headers: {
          'content-type': res.file.mimeType,
          'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${res.file.id}.${res.file.mimeType === 'application/pdf' ? 'pdf' : 'webp'}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        },
      });
    }
  }
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
}
