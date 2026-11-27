import { appleAppSiteAssociation } from '@/server/core/app-links';

export const dynamic = 'force-dynamic';

/**
 * iOS Universal Links verification file (PKG-LINKS-01). Apple fetches it with no extension and requires an
 * unsigned application/json body. Deliberately empty `details` until the real Team ID is configured at
 * publish time (APP_LINKS_IOS_TEAM_ID) — empty fails safe. See docs/mobile/DEEP_LINKS.md.
 */
export async function GET() {
  return Response.json(appleAppSiteAssociation(), { headers: { 'cache-control': 'public, max-age=300' } });
}
