import './_env';
import { requireDatabaseChange } from './_db-change';
import { assertMarkerAllowsChange } from '../src/server/core/deploy-policy';
import { closeDb, getDb } from '../src/server/db/client';
import { databaseEnvironment } from '../src/server/db/environment';
import { seedReference } from '../src/server/db/seed/reference';

/**
 * Explicit operator step — never run by a build, an install hook or a container start.
 *   LOCAL / TEST / initialised PREVIEW   reference bootstrap (+ --demo)
 *   STAGING                              --authorize=staging + EDMN_DB_CHANGE_AUTHORIZATION; reference insert-missing only
 *   PRODUCTION                           refused (reference data ships with the migrate step)
 */
const policy = requireDatabaseChange(process.argv.includes('--demo') ? 'seed-demo' : 'seed-reference');

async function main() {
  const demo = process.argv.includes('--demo');
  assertMarkerAllowsChange(demo ? 'seed-demo' : 'seed-reference', await databaseEnvironment(getDb()).catch(() => null));
  const ref = await seedReference({ mode: policy.referenceMode });
  console.log(`• reference mode: ${policy.referenceMode}`);
  console.log('✓ reference data', ref);
  // Batch 1.5 legacy KYC mapping (idempotent, additive): existing seller applications that already hold a legal
  // name, an encrypted National ID and front/back scans get a user-level identity case in PENDING_REVIEW that
  // LINKS those files. Never approved automatically — an identity reviewer decides each case.
  const { mapLegacySellerIdentities } = await import('../src/server/modules/identity/service');
  console.log('✓ legacy seller identity mapping', await mapLegacySellerIdentities());
  if (demo) {
    // Demo data is allowed on development machines and on explicitly-marked STAGING deployments only.
    if (process.env.NODE_ENV === 'production' && process.env.EDMN_ENVIRONMENT !== 'staging') {
      throw new Error('Refusing to load DEMO commerce data with NODE_ENV=production (set EDMN_ENVIRONMENT=staging only on a staging deployment)');
    }
    const { seedDemo, demoCredentials, DEMO_PASSWORD, DEMO_ADMIN_PASSWORD, DEMO_TOTP_SECRET } = await import('../src/server/db/seed/demo');
    const staging = demoCredentials().staging; // validates staging secrets before writing anything
    const res = await seedDemo();
    // Trusted Used Commerce demo documentation (idempotent backfill; also completes a fresh database's review).
    const { seedUsedDemo } = await import('../src/server/db/seed/used-demo');
    await seedUsedDemo();
    if (res.skipped) console.log('• demo data already present — skipped');
    else if (staging) console.log('✓ STAGING demo data', res, '— credentials come from the STAGING_* environment variables (never printed)');
    else {
      console.log('✓ demo data', res);
      console.log(`
  ── DEVELOPMENT ACCOUNTS (demo only) ─────────────────────────
  Admin:      admin@edmn.local / ${DEMO_ADMIN_PASSWORD}   (2FA TOTP secret: ${DEMO_TOTP_SECRET})
              other staff: ops@, payments@, checker@, finance@, support@, catalog@ edmn.local (same password & TOTP)
  Sellers:    techzone@demo.edmn.local, anaqa@…, used@…, homestyle@…, newseller@… (pending)  / ${DEMO_PASSWORD}
  Customers:  ahmed@demo.edmn.local, mona@…, omar@…  / ${DEMO_PASSWORD}
  Get the current admin 2FA code with:  npm run admin:totp
  ──────────────────────────────────────────────────────────────`);
    }
  }
  await closeDb();
}

main().catch(async (e) => {
  console.error('✗ seed failed', e);
  await closeDb();
  process.exit(1);
});
