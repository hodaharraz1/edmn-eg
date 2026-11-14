import { execFileSync } from 'node:child_process';
import { assertDatabaseChangeAllowed, DeploymentPolicyError, type DatabaseChange } from '../src/server/core/deploy-policy';

/** Git HEAD of the checkout the operator runs from (null outside a git checkout, e.g. a release image). */
export function gitHead(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/** Policy gate for scripts that change a database: exits 78 (configuration error) BEFORE any connection is opened. */
export function requireDatabaseChange(op: DatabaseChange) {
  try {
    return assertDatabaseChangeAllowed(op, process.env, process.argv, gitHead);
  } catch (e) {
    if (e instanceof DeploymentPolicyError) {
      console.error(`✗ ${e.message}`);
      process.exit(78);
    }
    throw e;
  }
}
