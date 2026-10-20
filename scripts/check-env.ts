import './_env';
import { env } from '../src/server/core/env';

/** Validates environment configuration (stricter rules when NODE_ENV=production). */
try {
  const e = env();
  console.log(`✓ environment valid (NODE_ENV=${e.NODE_ENV}, storage=${e.STORAGE_DRIVER}, mail=${e.MAIL_DRIVER}, sms=${e.SMS_DRIVER})`);
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
}
