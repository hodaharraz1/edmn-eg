import path from 'node:path';

for (const f of ['.env.test.local', '.env.local']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* optional */
  }
}
// Tests ALWAYS run against the dedicated test database and a throwaway storage root.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://edmn:edmn@localhost:5432/edmn_test';
process.env.STORAGE_LOCAL_ROOT = path.resolve('.test-storage');
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789abcdef0123456789';
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.MAIL_DRIVER = 'log';
process.env.SMS_DRIVER = 'log';
