import { describe, expect, it } from 'vitest';
import {
  assertDatabaseChangeAllowed,
  assertMarkerAllowsChange,
  deploymentContext,
  DeploymentPolicyError,
  resolveDatabaseUrl,
  runtimeMayUse,
  type DatabaseMarker,
} from '@/server/core/deploy-policy';

const SHA = '3c24cab55bcc3aad0dac68e841fe6cc0fb18f2d4';
const head = () => SHA;
const STAGING_NEON = 'postgresql://app:pw@ep-x.eu-central-1.aws.neon.tech/edmn?sslmode=require';

describe('deployment context', () => {
  it('PREVIEW comes from the platform, never from EDMN_ENVIRONMENT', () => {
    expect(deploymentContext({ VERCEL_ENV: 'preview', EDMN_ENVIRONMENT: 'staging' })).toBe('PREVIEW');
    expect(deploymentContext({ VERCEL_ENV: 'preview', EDMN_ENVIRONMENT: 'production' })).toBe('PREVIEW');
    expect(deploymentContext({ EDMN_DEPLOYMENT: 'preview' })).toBe('PREVIEW');
    expect(deploymentContext({ VERCEL_ENV: 'production', EDMN_ENVIRONMENT: 'staging' })).toBe('STAGING');
    expect(deploymentContext({ EDMN_ENVIRONMENT: 'production' })).toBe('PRODUCTION');
    expect(deploymentContext({})).toBe('LOCAL');
  });
});

describe('database URL selection', () => {
  it('a preview never reads DATABASE_URL / DATABASE_URL_UNPOOLED', () => {
    expect(() => resolveDatabaseUrl({ VERCEL_ENV: 'preview', DATABASE_URL: STAGING_NEON })).toThrow(/PREVIEW_DATABASE_URL is not configured/);
    expect(resolveDatabaseUrl({ VERCEL_ENV: 'preview', DATABASE_URL: STAGING_NEON, PREVIEW_DATABASE_URL: 'postgresql://p:p@preview-host/edmn_preview_1' })).toBe(
      'postgresql://p:p@preview-host/edmn_preview_1',
    );
  });

  it('a preview URL pointing at a shared database server is refused', () => {
    expect(() => resolveDatabaseUrl({ VERCEL_ENV: 'preview', DATABASE_URL: STAGING_NEON, PREVIEW_DATABASE_URL: STAGING_NEON })).toThrow(/isolated database/);
    const sameEndpoint = 'postgresql://other:pw@ep-x-pooler.eu-central-1.aws.neon.tech/other_db';
    expect(() => resolveDatabaseUrl({ VERCEL_ENV: 'preview', DATABASE_URL_UNPOOLED: STAGING_NEON, PREVIEW_DATABASE_URL: sameEndpoint })).toThrow(/isolated database/);
  });

  it('non-preview contexts use DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://x@y/z', PREVIEW_DATABASE_URL: 'postgresql://a@b/c' })).toBe('postgresql://x@y/z');
    expect(() => resolveDatabaseUrl({})).toThrow(/DATABASE_URL is not configured/);
  });
});

describe('database changes are never automatic', () => {
  const ops = ['migrate', 'seed-reference', 'seed-demo', 'init-preview'] as const;

  it('refused inside next build, any npm install/build/start hook, and anywhere on Vercel — whatever the environment', () => {
    for (const op of ops)
      for (const env of [{}, { EDMN_ENVIRONMENT: 'staging' }, { EDMN_ENVIRONMENT: 'production' }, { EDMN_DEPLOYMENT: 'preview' }]) {
        expect(() => assertDatabaseChangeAllowed(op, { ...env, NEXT_PHASE: 'phase-production-build' }, [], head), op).toThrow(DeploymentPolicyError);
        for (const hook of ['postinstall', 'prepare', 'build', 'prebuild', 'postbuild', 'start']) {
          expect(() => assertDatabaseChangeAllowed(op, { ...env, npm_lifecycle_event: hook }, [], head), `${op} ${hook}`).toThrow(/npm .* hook/);
        }
        expect(() => assertDatabaseChangeAllowed(op, { ...env, VERCEL: '1' }, [`--authorize=staging`, `--authorize=production`], head)).toThrow(/Vercel/);
      }
  });

  it('LOCAL and TEST may bootstrap', () => {
    expect(assertDatabaseChangeAllowed('migrate', {}, [], head).referenceMode).toBe('bootstrap');
    expect(assertDatabaseChangeAllowed('seed-demo', { NODE_ENV: 'test' }, [], head).referenceMode).toBe('bootstrap');
  });
});

describe('STAGING and PRODUCTION need a deliberate, release-bound authorization', () => {
  const staging = { EDMN_ENVIRONMENT: 'staging' };
  it('staging: flag AND token for the checked-out commit; reference data is insert-missing only', () => {
    expect(() => assertDatabaseChangeAllowed('migrate', staging, [], head)).toThrow(/--authorize=staging/);
    expect(() => assertDatabaseChangeAllowed('migrate', { ...staging, EDMN_DB_CHANGE_AUTHORIZATION: `staging:${SHA}` }, [], head)).toThrow(/--authorize=staging/);
    expect(() => assertDatabaseChangeAllowed('migrate', staging, ['--authorize=staging'], head)).toThrow(/EDMN_DB_CHANGE_AUTHORIZATION/);
    expect(() => assertDatabaseChangeAllowed('migrate', { ...staging, EDMN_DB_CHANGE_AUTHORIZATION: 'staging:deadbeefcafe' }, ['--authorize=staging'], head)).toThrow();
    expect(() => assertDatabaseChangeAllowed('migrate', { ...staging, EDMN_DB_CHANGE_AUTHORIZATION: `production:${SHA}` }, ['--authorize=staging'], head)).toThrow();
    expect(() => assertDatabaseChangeAllowed('migrate', { ...staging, EDMN_DB_CHANGE_AUTHORIZATION: 'staging:3c24' }, ['--authorize=staging'], head)).toThrow();
    for (const op of ['migrate', 'seed-reference', 'seed-demo'] as const) {
      expect(assertDatabaseChangeAllowed(op, { ...staging, EDMN_DB_CHANGE_AUTHORIZATION: `staging:${SHA.slice(0, 12)}` }, ['--authorize=staging'], head).referenceMode).toBe('insert-missing');
    }
  });

  it('the checked-out commit wins over GITHUB_SHA (a dispatched workflow runs on another ref)', () => {
    const env = { ...staging, GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', EDMN_DB_CHANGE_AUTHORIZATION: 'staging:aaaaaaaaaaaa' };
    expect(() => assertDatabaseChangeAllowed('migrate', env, ['--authorize=staging'], head)).toThrow();
  });

  it('production: migrate only with the release authorization; every seed is prohibited', () => {
    const prod = { EDMN_ENVIRONMENT: 'production', EDMN_RELEASE: SHA, EDMN_DB_CHANGE_AUTHORIZATION: `production:${SHA}` };
    expect(assertDatabaseChangeAllowed('migrate', prod, ['--authorize=production'], () => null).referenceMode).toBe('insert-missing');
    expect(() => assertDatabaseChangeAllowed('migrate', prod, [], () => null)).toThrow();
    for (const op of ['seed-reference', 'seed-demo', 'init-preview'] as const) {
      expect(() => assertDatabaseChangeAllowed(op, prod, ['--authorize=production'], () => null), op).toThrow(/prohibited/);
    }
  });
});

describe('database markers', () => {
  const markers: DatabaseMarker[] = ['DEVELOPMENT', 'TEST', 'PREVIEW', 'STAGING', 'PRODUCTION', null];
  it('a preview may only touch an explicitly initialised PREVIEW database (runtime and changes)', () => {
    const preview = { VERCEL_ENV: 'preview', EDMN_ENVIRONMENT: 'staging' };
    for (const m of markers) {
      expect(runtimeMayUse(m, preview).ok, String(m)).toBe(m === 'PREVIEW');
      if (m !== 'PREVIEW') expect(() => assertMarkerAllowsChange('migrate', m, preview)).toThrow();
    }
  });

  it('no other context uses a PREVIEW database; STAGING and PRODUCTION never touch each other', () => {
    for (const env of [{}, { NODE_ENV: 'test' }, { EDMN_ENVIRONMENT: 'staging' }, { EDMN_ENVIRONMENT: 'production' }]) {
      expect(runtimeMayUse('PREVIEW', env).ok).toBe(false);
    }
    expect(runtimeMayUse('PRODUCTION', { EDMN_ENVIRONMENT: 'staging' }).ok).toBe(false);
    expect(runtimeMayUse('STAGING', { EDMN_ENVIRONMENT: 'production' }).ok).toBe(false);
    expect(runtimeMayUse('STAGING', {}).ok).toBe(false);
    expect(runtimeMayUse('STAGING', { EDMN_ENVIRONMENT: 'staging' }).ok).toBe(true);
  });
});
