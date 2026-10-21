import { NONPROD_DB_ENDPOINT_HASHES, databaseEndpointHash } from './known-nonprod';
import { runtimeEnvironment, type RuntimeEnvironment } from './runtime-env';

/**
 * DEPLOYMENT SAFETY POLICY.
 *
 * Rule: a deployment never changes a shared database as a side effect. Building, booting, installing or previewing
 * the application performs NO migration and NO seed. Database changes are separate, deliberate operator steps, and
 * each environment has its own database:
 *
 *   context     database variable          marker      migrations / seeds
 *   LOCAL       DATABASE_URL               DEVELOPMENT  allowed (developer machine)
 *   TEST        DATABASE_URL               TEST         allowed (automated suite)
 *   PREVIEW     PREVIEW_DATABASE_URL ONLY  PREVIEW      only on a database explicitly initialised as PREVIEW
 *   STAGING     DATABASE_URL               STAGING      explicit authorized step; reference seed insert-missing only
 *   PRODUCTION  DATABASE_URL               PRODUCTION   migrations by the controlled release step; seeds refused
 *
 * PREVIEW is decided by the platform (VERCEL_ENV=preview), never by EDMN_ENVIRONMENT: a preview that inherited
 * staging variables is still a preview, and it never reads DATABASE_URL / DATABASE_URL_UNPOOLED.
 *
 * Authorization (`--authorize=<env>` + EDMN_DB_CHANGE_AUTHORIZATION=<env>:<commit>) is an extra tripwire against
 * running a step by accident. It is NOT the access control: that is credential isolation (no DDL / no staging or
 * production credentials outside the protected workflow) — see docs/runbooks/DEPLOYMENT_SAFETY.md.
 */
export type DeploymentContext = RuntimeEnvironment | 'PREVIEW';
export type DatabaseMarker = 'DEVELOPMENT' | 'TEST' | 'PREVIEW' | 'STAGING' | 'PRODUCTION' | null;
export type DatabaseChange = 'migrate' | 'seed-reference' | 'seed-demo' | 'init-preview';

type Raw = Record<string, string | undefined>;

export class DeploymentPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentPolicyError';
  }
}

export function deploymentContext(raw: Raw = process.env): DeploymentContext {
  if (raw.VERCEL_ENV === 'preview' || (raw.EDMN_DEPLOYMENT ?? '').toLowerCase() === 'preview') return 'PREVIEW';
  return runtimeEnvironment(raw);
}

/**
 * The connection string this process may use. PREVIEW uses PREVIEW_DATABASE_URL and nothing else, and refuses one
 * that is (or points at the same endpoint as) a shared database URL present in the environment or a known staging
 * endpoint. Every other context uses DATABASE_URL.
 */
export function resolveDatabaseUrl(raw: Raw = process.env): string {
  if (deploymentContext(raw) !== 'PREVIEW') {
    if (!raw.DATABASE_URL) throw new DeploymentPolicyError('DATABASE_URL is not configured');
    return raw.DATABASE_URL;
  }
  const url = raw.PREVIEW_DATABASE_URL;
  if (!url) throw new DeploymentPolicyError('PREVIEW_DATABASE_URL is not configured: a preview never uses DATABASE_URL (shared databases are off limits)');
  const ep = databaseEndpointHash(url);
  for (const shared of [raw.DATABASE_URL, raw.DATABASE_URL_UNPOOLED]) {
    if (shared && (shared === url || (ep && databaseEndpointHash(shared) === ep))) {
      throw new DeploymentPolicyError('PREVIEW_DATABASE_URL points at the same database server as DATABASE_URL: previews need an isolated database');
    }
  }
  if (ep && NONPROD_DB_ENDPOINT_HASHES.includes(ep)) throw new DeploymentPolicyError('PREVIEW_DATABASE_URL points at the shared staging database');
  return url;
}

/** Inside `next build`, an npm install/build lifecycle hook, or anywhere on Vercel (build or runtime). */
export function automaticContext(raw: Raw = process.env): string | null {
  if (raw.NEXT_PHASE === 'phase-production-build') return 'next build';
  const hook = raw.npm_lifecycle_event ?? '';
  if (['preinstall', 'install', 'postinstall', 'prepare', 'prebuild', 'build', 'postbuild', 'prestart', 'start', 'poststart'].includes(hook)) return `npm ${hook} hook`;
  if (raw.VERCEL) return 'a Vercel build or function';
  return null;
}

/**
 * The code actually being operated on: the checked-out git HEAD first (a manually dispatched workflow's GITHUB_SHA is
 * the dispatching branch, not the checked-out commit), then EDMN_RELEASE (release images carry no .git), then CI sha.
 */
export function currentRelease(raw: Raw = process.env, gitHead: () => string | null = () => null): string | null {
  return gitHead() || raw.EDMN_RELEASE || raw.GITHUB_SHA || null;
}

function authorized(env: 'staging' | 'production', raw: Raw, argv: readonly string[], gitHead: () => string | null): boolean {
  if (!argv.includes(`--authorize=${env}`)) return false;
  const [tEnv, tRelease = ''] = (raw.EDMN_DB_CHANGE_AUTHORIZATION ?? '').split(':');
  const release = currentRelease(raw, gitHead);
  if (tEnv !== env || !tRelease || !release) return false;
  // Exact release id, or an abbreviated commit sha (≥ 7 characters) of the commit being operated on.
  return tRelease === release || (tRelease.length >= 7 && /^[0-9a-f]+$/.test(tRelease) && release.startsWith(tRelease));
}

/**
 * Checks before ANY connection is opened. Returns the seed mode a reference seed must use. Throws
 * DeploymentPolicyError when the change is not allowed here.
 */
export function assertDatabaseChangeAllowed(
  op: DatabaseChange,
  raw: Raw = process.env,
  argv: readonly string[] = process.argv,
  gitHead: () => string | null = () => null,
): { referenceMode: 'bootstrap' | 'insert-missing' } {
  const auto = automaticContext(raw);
  if (auto) throw new DeploymentPolicyError(`refusing to ${op} from ${auto}: database changes are separate, deliberate steps`);
  const ctx = deploymentContext(raw);
  switch (ctx) {
    case 'LOCAL':
    case 'TEST':
      if (op === 'init-preview') throw new DeploymentPolicyError('init-preview runs only with EDMN_DEPLOYMENT=preview and PREVIEW_DATABASE_URL');
      return { referenceMode: 'bootstrap' };
    case 'PREVIEW':
      return { referenceMode: 'bootstrap' }; // the marker check (PREVIEW only) happens once connected
    case 'STAGING':
      if (op === 'init-preview') throw new DeploymentPolicyError('init-preview is not a staging operation');
      if (!authorized('staging', raw, argv, gitHead)) {
        throw new DeploymentPolicyError(`refusing to ${op} on STAGING without --authorize=staging and EDMN_DB_CHANGE_AUTHORIZATION=staging:<commit being deployed>`);
      }
      return { referenceMode: 'insert-missing' };
    case 'PRODUCTION':
      if (op !== 'migrate') throw new DeploymentPolicyError(`${op} is prohibited on PRODUCTION (reference data ships with the migrate step, insert-missing only)`);
      if (!authorized('production', raw, argv, gitHead)) {
        throw new DeploymentPolicyError('refusing to migrate PRODUCTION without --authorize=production and EDMN_DB_CHANGE_AUTHORIZATION=production:<release>');
      }
      return { referenceMode: 'insert-missing' };
  }
}

/** Checks once connected: the database must be of the kind this context may change. */
export function assertMarkerAllowsChange(op: DatabaseChange, marker: DatabaseMarker, raw: Raw = process.env): void {
  const ctx = deploymentContext(raw);
  if (ctx === 'PREVIEW') {
    if (op === 'init-preview') return; // init-preview checks emptiness itself
    if (marker !== 'PREVIEW') throw new DeploymentPolicyError(`a preview may only use or change a database explicitly initialised as PREVIEW (this one is ${marker ?? 'UNMARKED'})`);
    return;
  }
  if (marker === 'PREVIEW') throw new DeploymentPolicyError(`${ctx} refuses a PREVIEW database`);
  if (ctx === 'PRODUCTION') {
    if (marker !== 'PRODUCTION' && marker !== null) throw new DeploymentPolicyError(`PRODUCTION refuses a ${marker} database`);
    return;
  }
  if (marker === 'PRODUCTION') throw new DeploymentPolicyError(`${ctx} refuses a PRODUCTION database`);
  if (ctx === 'STAGING' && (marker === 'DEVELOPMENT' || marker === 'TEST')) throw new DeploymentPolicyError(`STAGING refuses a ${marker} database`);
  if ((ctx === 'LOCAL' || ctx === 'TEST') && marker === 'STAGING') throw new DeploymentPolicyError(`${ctx} refuses a STAGING database`);
}

/** Runtime: may this process serve traffic from a database with this marker? */
export function runtimeMayUse(marker: DatabaseMarker, raw: Raw = process.env): { ok: boolean; reason?: string } {
  try {
    assertMarkerAllowsChange('migrate', marker, raw);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
