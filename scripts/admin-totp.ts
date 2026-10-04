import './_env';
import { totpCode } from '../src/server/auth/totp';
import { DEMO_TOTP_SECRET } from '../src/server/db/seed/demo';

/**
 * Prints the current 2FA code for the demo staff accounts (development), or for the STAGING staff
 * accounts when run inside a staging deployment (uses STAGING_TOTP_SECRET). Never in production.
 */
const staging = process.env.EDMN_ENVIRONMENT === 'staging';
if (process.env.NODE_ENV === 'production' && !staging) {
  console.error('Not available in production');
  process.exit(1);
}
const secret = process.argv[2] ?? (staging ? process.env.STAGING_TOTP_SECRET : DEMO_TOTP_SECRET);
if (!secret) {
  console.error('No TOTP secret configured');
  process.exit(1);
}
console.log(`Current code: ${totpCode(secret)}  (valid ~${30 - (Math.floor(Date.now() / 1000) % 30)}s)`);
