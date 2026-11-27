import { androidAssetLinks } from '@/server/core/app-links';

export const dynamic = 'force-dynamic';

/**
 * Android App Links verification file (PKG-LINKS-01). Deliberately `[]` until the real release/upload
 * SHA-256 fingerprints are configured at publish time (APP_LINKS_ANDROID_SHA256) — an empty list fails
 * safe: links keep opening the website. See docs/mobile/DEEP_LINKS.md.
 */
export async function GET() {
  return Response.json(androidAssetLinks(), { headers: { 'cache-control': 'public, max-age=300' } });
}
