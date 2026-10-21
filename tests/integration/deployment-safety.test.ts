import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Deployment safety (end to end, real scripts in child processes, real PostgreSQL scratch databases):
 *  - nothing in build / install / start paths runs migrations or seeds;
 *  - migrate / seed refuse to run from a build, an npm hook or Vercel, and touch nothing;
 *  - a preview can neither change nor read a STAGING / PRODUCTION / unmarked database;
 *  - only an EMPTY database can become PREVIEW, and markers cannot be converted;
 *  - STAGING needs the release-bound authorization; PRODUCTION never seeds;
 *  - insert-missing never modifies existing data and, on an empty database, equals the bootstrap reference set.
 */
const ROOT = path.resolve('.');
const BASE_URL = process.env.DATABASE_URL!;
const RUN = Date.now().toString(36);
const created: string[] = [];

const urlFor = (db: string) => {
  const u = new URL(BASE_URL);
  u.pathname = `/${db}`;
  return u.toString();
};

async function sqlOn<T = Record<string, unknown>>(db: string, text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: urlFor(db) });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

async function scratch(label: string): Promise<string> {
  const name = `edmn_test_deploy_${label}_${RUN}`;
  const admin = new Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`create database "${name}"`);
  await admin.end();
  created.push(name);
  return name;
}

const BASE_ENV: Record<string, string> = {
  PATH: process.env.PATH!,
  HOME: process.env.HOME ?? '/tmp',
  NODE_ENV: 'test',
  SESSION_SECRET: process.env.SESSION_SECRET!,
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY!,
  STORAGE_LOCAL_ROOT: process.env.STORAGE_LOCAL_ROOT!,
  MAIL_DRIVER: 'log',
  SMS_DRIVER: 'log',
};

function run(script: string, args: string[], env: Record<string, string | undefined>) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, script), ...args], { cwd: ROOT, env: { ...BASE_ENV, ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 240_000 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const tableCount = async (db: string) => Number((await sqlOn<{ n: string }>(db, `select count(*)::text n from pg_tables where schemaname in ('public','drizzle')`))[0].n);
const marker = async (db: string) => (await sqlOn<{ e: string }>(db, 'select environment e from deployment_environment where id'))[0]?.e ?? null;
const migrationCount = async (db: string) => Number((await sqlOn<{ n: string }>(db, 'select count(*)::text n from drizzle.__drizzle_migrations'))[0].n);
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();

/** Fully migrated TEST database with bootstrap reference data, then given `mark`. */
async function preparedDb(label: string, mark: 'TEST' | 'STAGING' | 'PRODUCTION') {
  const db = await scratch(label);
  const m = run('scripts/migrate.ts', ['--schema-only'], { DATABASE_URL: urlFor(db) });
  expect(m.status, m.out).toBe(0);
  const s = run('scripts/seed.ts', [], { DATABASE_URL: urlFor(db) });
  expect(s.status, s.out).toBe(0);
  if (mark !== 'TEST') await sqlOn(db, 'update deployment_environment set environment = $1 where id', [mark]);
  return db;
}

let stagingDb = '';
let productionDb = '';
beforeAll(async () => {
  stagingDb = await preparedDb('staging', 'STAGING');
  productionDb = await preparedDb('prod', 'PRODUCTION');
}, 600_000);

afterAll(async () => {
  const admin = new Client({ connectionString: BASE_URL });
  await admin.connect();
  for (const name of created) await admin.query(`drop database if exists "${name}" with (force)`).catch(() => undefined);
  await admin.end();
});

describe('build, install and start paths never change a database', () => {
  it('the Vercel build command is a plain build; no npm lifecycle hook exists; the build script is gone', () => {
    const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    expect(vercel.buildCommand).toBe('npm run build');
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toBe('next build');
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prebuild', 'postbuild', 'prestart', 'poststart']) expect(pkg.scripts[hook], hook).toBeUndefined();
    expect(() => readFileSync(path.join(ROOT, 'scripts/vercel-build.sh'))).toThrow();
    const docker = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    for (const line of docker.split('\n').filter((l) => /^\s*RUN\b/.test(l))) expect(line).not.toMatch(/migrate|seed|db:/);
  });

  it('start.sh changes a database only for a LOCAL container (never staging / production)', () => {
    const s = readFileSync(path.join(ROOT, 'scripts/start.sh'), 'utf8');
    const local = s.slice(s.indexOf('if [ -z "$KIND" ]'), s.indexOf('\nfi\n', s.indexOf('if [ -z "$KIND" ]')));
    // Executable lines only (comments and messages may mention migrations).
    const commands = (t: string) => t.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && !/^\s*echo\b/.test(l)).join('\n');
    expect(commands(local)).toMatch(/migrate\.ts/);
    expect(commands(s.replace(local, ''))).not.toMatch(/migrate|seed\.ts|db:migrate|db:seed/);
  });

  it('production deploy: release-bound migrate, no seed step, no seed service', () => {
    const deploy = readFileSync(path.join(ROOT, 'deploy/scripts/deploy.sh'), 'utf8');
    expect(deploy).toMatch(/EDMN_DB_CHANGE_AUTHORIZATION="production:\$TAG" migrate/);
    expect(deploy).not.toMatch(/-T seed\b/);
    const compose = readFileSync(path.join(ROOT, 'deploy/compose/docker-compose.prod.yml'), 'utf8');
    expect(compose).not.toMatch(/command: \[[^\]]*scripts\/seed\.ts/);
    expect(compose).not.toMatch(/^  seed:/m);
    expect(compose).toMatch(/scripts\/migrate\.ts", "--authorize=production"/);
  });

  it('migrate / seed exit before connecting when run from a build, an npm hook or Vercel — the database is untouched', async () => {
    const db = await scratch('auto');
    for (const env of [{ NEXT_PHASE: 'phase-production-build' }, { npm_lifecycle_event: 'postinstall' }, { npm_lifecycle_event: 'build' }, { VERCEL: '1', VERCEL_ENV: 'production', EDMN_ENVIRONMENT: 'staging' }]) {
      for (const [script, args] of [['scripts/migrate.ts', []], ['scripts/seed.ts', []], ['scripts/seed.ts', ['--demo']]] as const) {
        const r = run(script, [...args], { DATABASE_URL: urlFor(db), ...env });
        expect(r.status, `${script} ${JSON.stringify(env)}\n${r.out}`).toBe(78);
      }
    }
    expect(await tableCount(db)).toBe(0);
    // Even a STAGING deployment's build with full authorization cannot migrate.
    const r = run('scripts/migrate.ts', ['--authorize=staging'], { DATABASE_URL: urlFor(stagingDb), EDMN_ENVIRONMENT: 'staging', VERCEL: '1', EDMN_DB_CHANGE_AUTHORIZATION: `staging:${HEAD}` });
    expect(r.status).toBe(78);
  }, 300_000);
});

describe('previews are isolated from STAGING and PRODUCTION (changes and runtime)', () => {
  it('preview migrate / seed refuse STAGING, PRODUCTION and unmarked databases', async () => {
    const empty = await scratch('unmarked');
    for (const db of [stagingDb, productionDb, empty]) {
      const before = db === empty ? 0 : await migrationCount(db);
      for (const [script, args] of [['scripts/migrate.ts', []], ['scripts/seed.ts', []], ['scripts/seed.ts', ['--demo']]] as const) {
        const r = run(script, [...args], { EDMN_DEPLOYMENT: 'preview', EDMN_ENVIRONMENT: 'staging', PREVIEW_DATABASE_URL: urlFor(db) });
        expect(r.status, `${script} on ${db}\n${r.out}`).not.toBe(0);
      }
      if (db === empty) expect(await tableCount(db)).toBe(0);
      else expect(await migrationCount(db)).toBe(before);
    }
  }, 300_000);

  it('a preview never falls back to DATABASE_URL, even when staging credentials leak into its environment', () => {
    const r = run('scripts/migrate.ts', [], { EDMN_DEPLOYMENT: 'preview', EDMN_ENVIRONMENT: 'staging', DATABASE_URL: urlFor(stagingDb), DATABASE_URL_UNPOOLED: urlFor(stagingDb) });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/PREVIEW_DATABASE_URL is not configured/);
    const same = run('scripts/migrate.ts', [], { EDMN_DEPLOYMENT: 'preview', DATABASE_URL: urlFor(stagingDb), PREVIEW_DATABASE_URL: urlFor(stagingDb) });
    expect(same.out).toMatch(/isolated database/);
  });

  it('a preview RUNTIME cannot read or write a STAGING / PRODUCTION / unmarked database (every connection refused)', async () => {
    const empty = await scratch('rt');
    for (const db of [stagingDb, productionDb, empty]) {
      const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tests/helpers/preview-runtime-probe.ts')], {
        cwd: ROOT,
        env: { ...BASE_ENV, VERCEL_ENV: 'preview', EDMN_ENVIRONMENT: 'staging', PREVIEW_DATABASE_URL: urlFor(db) } as unknown as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(r.stdout, `${db}\n${r.stderr}`).toMatch(/QUERY-REFUSED preview database refused/);
      expect(r.stdout).toMatch(/TX-REFUSED preview database refused/);
      expect(r.stdout).not.toMatch(/CONNECTED/);
    }
    // Control: the same probe on an initialised PREVIEW database connects.
    {
      const ok = await scratch('rtok');
      expect(run('scripts/preview-db-init.ts', [`--confirm-database=${ok}`], { EDMN_DEPLOYMENT: 'preview', PREVIEW_DATABASE_URL: urlFor(ok) }).status).toBe(0);
      const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tests/helpers/preview-runtime-probe.ts')], {
        cwd: ROOT,
        env: { ...BASE_ENV, VERCEL_ENV: 'preview', EDMN_ENVIRONMENT: 'staging', PREVIEW_DATABASE_URL: urlFor(ok) } as unknown as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(r.stdout, r.stderr).toMatch(/QUERY-CONNECTED/);
      expect(r.stdout).toMatch(/TX-CONNECTED/);
    }
  }, 120_000);
});

describe('isolated preview databases are created explicitly and only from an empty database', () => {
  it('init refuses a non-empty database and needs the database name typed back', async () => {
    const r = run('scripts/preview-db-init.ts', [`--confirm-database=${stagingDb}`], { EDMN_DEPLOYMENT: 'preview', PREVIEW_DATABASE_URL: urlFor(stagingDb) });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/not empty/);
    expect(await marker(stagingDb)).toBe('STAGING');
    const empty = await scratch('noconfirm');
    expect(run('scripts/preview-db-init.ts', [], { EDMN_DEPLOYMENT: 'preview', PREVIEW_DATABASE_URL: urlFor(empty) }).status).not.toBe(0);
    expect(await tableCount(empty)).toBe(0);
    // Never from a Vercel build / function, and not outside a preview context.
    expect(run('scripts/preview-db-init.ts', [`--confirm-database=${empty}`], { VERCEL: '1', VERCEL_ENV: 'preview', PREVIEW_DATABASE_URL: urlFor(empty) }).status).toBe(78);
    expect(run('scripts/preview-db-init.ts', [`--confirm-database=${empty}`], { DATABASE_URL: urlFor(empty) }).status).toBe(78);
  }, 120_000);

  it('an empty database becomes PREVIEW; then preview migrate/seed and runtime work; markers cannot be converted', async () => {
    const db = await scratch('preview');
    const init = run('scripts/preview-db-init.ts', [`--confirm-database=${db}`], { EDMN_DEPLOYMENT: 'preview', PREVIEW_DATABASE_URL: urlFor(db) });
    expect(init.status, init.out).toBe(0);
    expect(await marker(db)).toBe('PREVIEW');
    const m = run('scripts/migrate.ts', [], { EDMN_DEPLOYMENT: 'preview', EDMN_ENVIRONMENT: 'staging', PREVIEW_DATABASE_URL: urlFor(db) });
    expect(m.status, m.out).toBe(0);
    expect(await marker(db)).toBe('PREVIEW'); // EDMN_ENVIRONMENT=staging never re-marks it
    // A non-preview context refuses it.
    const asLocal = run('scripts/migrate.ts', [], { DATABASE_URL: urlFor(db) });
    expect(asLocal.status).not.toBe(0);
    // Database-level: PREVIEW <-> STAGING / PRODUCTION conversions are refused.
    await expect(sqlOn(db, `update deployment_environment set environment = 'STAGING' where id`)).rejects.toThrow(/cannot be re-marked/);
    await expect(sqlOn(stagingDb, `update deployment_environment set environment = 'PREVIEW' where id`)).rejects.toThrow(/cannot be re-marked/);
    await expect(sqlOn(db, `delete from deployment_environment`)).rejects.toThrow(/cannot be unmarked/);
    // Removing a shared database's marker does not open a path either: PREVIEW needs an empty database.
    const copy = await preparedDb('copy', 'TEST');
    await sqlOn(copy, `insert into users (email, full_name, password_hash) values ('copied-user@example.com', 'مستخدم منسوخ', 'x')`);
    await sqlOn(copy, `delete from deployment_environment`);
    await expect(sqlOn(copy, `insert into deployment_environment (id, environment) values (true, 'PREVIEW')`)).rejects.toThrow(/only an empty database/);
    await expect(sqlOn(productionDb, `update deployment_environment set environment = 'PREVIEW' where id`)).rejects.toThrow(/cannot be re-marked/);
  }, 300_000);
});

describe('STAGING and PRODUCTION changes are deliberate', () => {
  it('staging: refused without the release-bound authorization; allowed with it (insert-missing)', async () => {
    const env = { DATABASE_URL: urlFor(stagingDb), EDMN_ENVIRONMENT: 'staging' };
    expect(run('scripts/migrate.ts', [], env).status).toBe(78);
    expect(run('scripts/migrate.ts', ['--authorize=staging'], { ...env, EDMN_DB_CHANGE_AUTHORIZATION: 'staging:0000000000000' }).status).toBe(78);
    expect(run('scripts/seed.ts', ['--demo'], env).status).toBe(78);
    const ok = run('scripts/migrate.ts', ['--authorize=staging'], { ...env, EDMN_DB_CHANGE_AUTHORIZATION: `staging:${HEAD.slice(0, 12)}` });
    expect(ok.status, ok.out).toBe(0);
    expect(ok.out).toMatch(/insert-missing/);
    expect(await marker(stagingDb)).toBe('STAGING');
    // Read-only preflight needs no authorization.
    expect(run('scripts/migrate.ts', ['--preflight'], env).status).toBe(0);
  }, 300_000);

  it('production: every seed is refused even with an authorization; migrate needs its own', async () => {
    const env = { DATABASE_URL: urlFor(productionDb), EDMN_ENVIRONMENT: 'production', EDMN_RELEASE: HEAD, EDMN_DB_CHANGE_AUTHORIZATION: `production:${HEAD}` };
    expect(run('scripts/seed.ts', ['--authorize=production'], env).status).toBe(78);
    expect(run('scripts/seed.ts', ['--demo', '--authorize=production'], env).status).toBe(78);
    expect(run('scripts/migrate.ts', [], env).status).toBe(78);
  }, 120_000);
});

describe('reference data: insert-missing', () => {
  /** Normalised reference set (no ids or timestamps; foreign keys by natural key). */
  async function referenceSnapshot(db: string) {
    const q = (text: string) => sqlOn(db, text);
    return {
      governorates: await q('select id, code, name_ar, name_en, sort_order from governorates order by id'),
      roles: await q('select code, name_ar, name_en, is_system from roles order by code'),
      rolePermissions: await q('select role_code, permission from role_permissions order by role_code, permission'),
      paymentMethods: await q('select code, name_ar, name_en, sort_order, is_enabled from payment_methods order by code'),
      categories: await q('select c.slug, c.name_ar, c.name_en, p.slug parent, c.sort_order, c.is_restricted, c.depth from categories c left join categories p on p.id = c.parent_id order by c.slug'),
      attributes: await q('select code, name_ar, name_en, type, unit from attributes order by code'),
      attributeOptions: await q('select a.code, o.value, o.label_ar, o.sort_order from attribute_options o join attributes a on a.id = o.attribute_id order by a.code, o.value'),
      categoryAttributes: await q('select c.slug, a.code, ca.is_required, ca.is_filterable, ca.is_variant_axis from category_attributes ca join categories c on c.id = ca.category_id join attributes a on a.id = ca.attribute_id order by c.slug, a.code'),
      commission: await q('select c.slug, r.percent_bps from commission_rules r left join categories c on c.id = r.category_id order by c.slug nulls first'),
      policyRules: await q('select kind, pattern, reason_code from listing_policy_rules order by kind, pattern'),
      legal: await q('select code, version, status, is_current, title, body from legal_documents order by code, version'),
      cms: await q('select placement, type, title, sort_order, data from cms_blocks order by sort_order'),
      grants: await q(`select value from system_settings where key = 'rbac.additiveGrants'`),
      counts: await q(`select (select count(*) from pricing_versions)::int pv, (select count(*) from pricing_tiers)::int pt, (select count(*) from payout_channel_configs)::int pc,
                              (select count(*) from refund_fee_policy_rules)::int rf, (select count(*) from used_category_policies)::int up`),
    };
  }

  it('on an empty database, insert-missing produces exactly the bootstrap reference set (fresh install)', async () => {
    const boot = await scratch('boot');
    expect(run('scripts/migrate.ts', ['--schema-only'], { DATABASE_URL: urlFor(boot) }).status).toBe(0);
    expect(run('scripts/seed.ts', [], { DATABASE_URL: urlFor(boot) }).status).toBe(0);
    const fresh = await scratch('fresh');
    const r = run('scripts/migrate.ts', [], { DATABASE_URL: urlFor(fresh) }); // schema + insert-missing reference data
    expect(r.status, r.out).toBe(0);
    const a = await referenceSnapshot(boot);
    const b = await referenceSnapshot(fresh);
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(b[k], k).toEqual(a[k]);
  }, 300_000);

  it('on an existing installation, admin edits survive and only missing rows are added (upgrade, staging path)', async () => {
    const db = await preparedDb('upgrade', 'TEST');
    const one = async <T,>(text: string) => (await sqlOn<T>(db, text))[0];
    const cat = await one<{ slug: string }>('select slug from categories order by slug limit 1');
    const opt = await one<{ id: string; attribute_id: string; value: string }>('select id, attribute_id, value from attribute_options order by value limit 1');
    const rule = await one<{ id: string; pattern: string }>('select id, pattern from listing_policy_rules order by pattern limit 1');
    const removed = await one<{ role_code: string; permission: string }>(`select role_code, permission from role_permissions where role_code = 'CUSTOMER_SUPPORT' order by permission limit 1`);
    // Admin edits
    await sqlOn(db, `update governorates set name_ar = 'القاهرة (تعديل إداري)' where id = 1`);
    await sqlOn(db, `update categories set name_ar = 'اسم إداري' where slug = $1`, [cat.slug]);
    await sqlOn(db, `update payment_methods set is_enabled = true, name_ar = 'إنستاباي (معدّل)' where code = 'INSTAPAY'`);
    await sqlOn(db, `update cms_blocks set title = 'عنوان إداري' where type = 'HERO'`);
    await sqlOn(db, `delete from role_permissions where role_code = $1 and permission = $2`, [removed.role_code, removed.permission]);
    await sqlOn(db, `update legal_documents set is_current = false where code = 'TERMS_OF_USE' and is_current`);
    await sqlOn(db, `insert into legal_documents (code, version, title, body, status, is_current) values ('TERMS_OF_USE', '9.0-admin', 'شروط معدّلة', 'نص إداري', 'APPROVED', true)`);
    // Rows that went missing
    await sqlOn(db, 'delete from attribute_options where id = $1', [opt.id]);
    await sqlOn(db, 'delete from listing_policy_rules where id = $1', [rule.id]);
    const legalBefore = await sqlOn(db, 'select code, version, is_current, status from legal_documents order by code, version');

    const env = { DATABASE_URL: urlFor(db), EDMN_ENVIRONMENT: 'staging', EDMN_DB_CHANGE_AUTHORIZATION: `staging:${HEAD}` };
    await sqlOn(db, `update deployment_environment set environment = 'STAGING' where id`);
    for (const [script, args] of [['scripts/migrate.ts', ['--authorize=staging']], ['scripts/seed.ts', ['--authorize=staging']]] as const) {
      const r = run(script, [...args], env);
      expect(r.status, `${script}\n${r.out}`).toBe(0);
    }

    expect((await one<{ name_ar: string }>('select name_ar from governorates where id = 1')).name_ar).toBe('القاهرة (تعديل إداري)');
    expect((await sqlOn<{ name_ar: string }>(db, 'select name_ar from categories where slug = $1', [cat.slug]))[0].name_ar).toBe('اسم إداري');
    expect(await one('select is_enabled, name_ar from payment_methods where code = \'INSTAPAY\'')).toEqual({ is_enabled: true, name_ar: 'إنستاباي (معدّل)' });
    expect((await one<{ title: string }>(`select title from cms_blocks where type = 'HERO'`)).title).toBe('عنوان إداري');
    expect(await sqlOn(db, 'select 1 from role_permissions where role_code = $1 and permission = $2', [removed.role_code, removed.permission])).toHaveLength(0);
    expect(await sqlOn(db, 'select code, version, is_current, status from legal_documents order by code, version')).toEqual(legalBefore);
    expect((await one<{ version: string }>(`select version from legal_documents where code = 'TERMS_OF_USE' and is_current`)).version).toBe('9.0-admin');
    // Missing reference rows are back.
    expect(await sqlOn(db, 'select 1 from attribute_options where attribute_id = $1 and value = $2', [opt.attribute_id, opt.value])).toHaveLength(1);
    expect(await sqlOn(db, 'select 1 from listing_policy_rules where pattern = $1', [rule.pattern])).toHaveLength(1);
  }, 300_000);
});
