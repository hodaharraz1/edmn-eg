import { env } from './env';

/**
 * PKG-LINKS-01 — App Links (Android) / Universal Links (iOS) verification payloads.
 *
 * Shared https://www.edmneg.com links (product, order, protected-deal invitation) open directly in the
 * customer app once the platform verifies these files. The apps map web paths to their own routes
 * (apps/customer_mobile/lib/src/deep_links.dart); anything unmapped stays on the website.
 *
 * Real signing fingerprints / Apple Team ID are injected AT PUBLISH TIME through the environment — never
 * hardcoded, never a sample. While they are unset the payloads are deliberately EMPTY: the platforms then
 * keep opening the website (safe) instead of the app claiming links it cannot prove ownership of.
 * Publish steps: docs/mobile/DEEP_LINKS.md.
 */

/** Web paths the customer app opens directly. Shared by assetlinks.json and the AASA file. */
export const APP_LINK_PATHS = [
  '/product/*', // web product page → app /products/:slug
  '/account/orders/*', // web order page (incl. /pay) → app /orders/:id
  '/deal/invite/*', // protected-deal invitation → app /deals/join?token=
  '/deal-invite/*', // legacy invitation path (the web redirects it; the app maps it too)
  '/deals/*', // app-native deal paths shared from the app
  '/orders/*', // app-native order paths
  '/products/*', // app-native product paths
] as const;

export interface AppLinksEnv {
  APP_LINKS_ANDROID_PACKAGE: string;
  APP_LINKS_ANDROID_SHA256: string;
  APP_LINKS_IOS_TEAM_ID: string;
  APP_LINKS_IOS_BUNDLE_ID: string;
}

export interface AppLinksConfig {
  androidPackage: string;
  androidSha256: readonly string[];
  iosTeamId: string;
  iosBundleId: string;
}

/** Reads the publish-time values from the environment; pure apart from that read (tests pass their own). */
export function appLinksConfig(e: AppLinksEnv = env()): AppLinksConfig {
  return {
    androidPackage: e.APP_LINKS_ANDROID_PACKAGE,
    androidSha256: e.APP_LINKS_ANDROID_SHA256.split(',').map((s) => s.trim()).filter(Boolean),
    iosTeamId: e.APP_LINKS_IOS_TEAM_ID.trim(),
    iosBundleId: e.APP_LINKS_IOS_BUNDLE_ID,
  };
}

/** assetlinks.json statements. Empty array until real publish fingerprints are configured. */
export function androidAssetLinks(c: AppLinksConfig = appLinksConfig()) {
  if (c.androidSha256.length === 0) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: c.androidPackage, sha256_cert_fingerprints: [...c.androidSha256] },
    },
  ];
}

/** apple-app-site-association body. Empty details until the real Team ID is configured. */
export function appleAppSiteAssociation(c: AppLinksConfig = appLinksConfig()) {
  const details = c.iosTeamId ? [{ appID: `${c.iosTeamId}.${c.iosBundleId}`, paths: [...APP_LINK_PATHS] }] : [];
  return { applinks: { apps: [] as string[], details } };
}
