import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Fresh database for every E2E run: reset → migrate → reference + demo seed (real domain flows). */
export default function globalSetup() {
  // Remote runs (staging) must NEVER reset or reseed the target database.
  if (process.env.E2E_BASE_URL) return;
  const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://edmn:edmn@localhost:5432/edmn_e2e';
  if (!/localhost|127\.0\.0\.1/.test(DATABASE_URL)) throw new Error('E2E database must be local');
  const env = { ...process.env, DATABASE_URL, STORAGE_LOCAL_ROOT: './.e2e-storage', NODE_ENV: 'development' as const };
  rmSync('.e2e-storage', { recursive: true, force: true });
  for (const cmd of ['npm run -s db:reset', 'npm run -s db:migrate', 'npm run -s db:seed:demo']) execSync(cmd, { stdio: 'inherit', env });
}
