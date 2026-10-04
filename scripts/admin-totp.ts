import './_env';
import { totpCode } from '../src/server/auth/totp';
import { DEMO_TOTP_SECRET } from '../src/server/db/seed/demo';

/** DEVELOPMENT helper: prints the current 2FA code for the demo staff accounts. */
if (process.env.NODE_ENV === 'production') {
  console.error('Not available in production');
  process.exit(1);
}
const secret = process.argv[2] ?? DEMO_TOTP_SECRET;
console.log(`Current code: ${totpCode(secret)}  (valid ~${30 - (Math.floor(Date.now() / 1000) % 30)}s)`);
