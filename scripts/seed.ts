import './_env';
import { closeDb } from '../src/server/db/client';
import { seedReference } from '../src/server/db/seed/reference';

async function main() {
  const demo = process.argv.includes('--demo');
  const ref = await seedReference();
  console.log('✓ reference data', ref);
  if (demo) {
    if (process.env.NODE_ENV === 'production' && !process.argv.includes('--i-know-this-is-not-production')) {
      throw new Error('Refusing to load DEMO commerce data with NODE_ENV=production');
    }
    const { seedDemo, DEMO_PASSWORD, DEMO_ADMIN_PASSWORD, DEMO_TOTP_SECRET } = await import('../src/server/db/seed/demo');
    const res = await seedDemo();
    if (res.skipped) console.log('• demo data already present — skipped');
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
