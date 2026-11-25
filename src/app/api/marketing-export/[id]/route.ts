import { adminActor } from '@/server/auth/actors';
import { downloadMarketingExport } from '@/server/modules/customers/marketing';
import { getAdminSession, requestMeta } from '@/server/web/session';

/**
 * Download of an EXECUTED marketing audience export. The file is AES-256-GCM encrypted; only the one-time
 * passphrase shown at execution opens it. Every download is audit-logged. Uniform 404s (no enumeration).
 */
export async function GET(_req: Request, ctx: RouteContext<'/api/marketing-export/[id]'>) {
  const { id } = await ctx.params;
  const meta = await requestMeta();
  const admin = await getAdminSession();
  if (admin?.session.mfaVerifiedAt) {
    try {
      const actor = await adminActor(admin.user.id, { ...meta, stepUpAt: admin.session.stepUpAt });
      const res = await downloadMarketingExport(actor, id);
      return new Response(Buffer.from(res.contentBase64, 'base64'), {
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${res.fileName}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      // fall through to the uniform 404
    }
  }
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
}
