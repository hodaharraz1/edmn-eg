import { describe, expect, it } from 'vitest';
import { APP_LINK_PATHS, androidAssetLinks, appLinksConfig, appleAppSiteAssociation, type AppLinksEnv } from '@/server/core/app-links';
import { GET as assetlinksGET } from '@/app/.well-known/assetlinks.json/route';
import { GET as aasaGET } from '@/app/.well-known/apple-app-site-association/route';

/**
 * PKG-LINKS-01 guardrails: the verification files fail SAFE (empty) until real publish fingerprints /
 * Team ID are configured, and never invent a value.
 */

const base: AppLinksEnv = {
  APP_LINKS_ANDROID_PACKAGE: 'com.edmneg.edmn_customer',
  APP_LINKS_ANDROID_SHA256: '',
  APP_LINKS_IOS_TEAM_ID: '',
  APP_LINKS_IOS_BUNDLE_ID: 'com.edmneg.edmnCustomer',
};

describe('app links config', () => {
  it('parses a comma-separated fingerprint list, trimming blanks', () => {
    const c = appLinksConfig({ ...base, APP_LINKS_ANDROID_SHA256: ' AA:BB , ,CC:DD ' });
    expect(c.androidSha256).toEqual(['AA:BB', 'CC:DD']);
  });

  it('covers the shared web paths: product, order, deal invitation (current and legacy)', () => {
    for (const p of ['/product/*', '/account/orders/*', '/deal/invite/*', '/deal-invite/*']) {
      expect(APP_LINK_PATHS).toContain(p);
    }
  });
});

describe('assetlinks.json (Android App Links)', () => {
  it('is an empty array while no publish fingerprint is configured (fails safe)', () => {
    expect(androidAssetLinks(appLinksConfig(base))).toEqual([]);
  });

  it('claims handle_all_urls for the customer app once real fingerprints exist', () => {
    const out = androidAssetLinks(appLinksConfig({ ...base, APP_LINKS_ANDROID_SHA256: 'AA:BB' }));
    expect(out).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.edmneg.edmn_customer', sha256_cert_fingerprints: ['AA:BB'] },
      },
    ]);
  });
});

describe('apple-app-site-association (Universal Links)', () => {
  it('has empty details while no Team ID is configured (fails safe)', () => {
    expect(appleAppSiteAssociation(appLinksConfig(base))).toEqual({ applinks: { apps: [], details: [] } });
  });

  it('lists the app with the shared paths once the real Team ID exists', () => {
    const out = appleAppSiteAssociation(appLinksConfig({ ...base, APP_LINKS_IOS_TEAM_ID: 'TEAM123456' }));
    expect(out.applinks.details).toEqual([{ appID: 'TEAM123456.com.edmneg.edmnCustomer', paths: [...APP_LINK_PATHS] }]);
  });
});

describe('route handlers', () => {
  it('serve JSON (AASA requires an unsigned application/json body)', async () => {
    for (const get of [assetlinksGET, aasaGET]) {
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toContain('max-age=300');
      await expect(res.json()).resolves.toBeDefined();
    }
  });
});
