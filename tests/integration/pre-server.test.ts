import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataKeyCheckValue } from '@/server/core/known-nonprod';
import { NONPROD_DATA_KEY_KCVS } from '@/server/core/known-nonprod';
import { checkProductionEnv } from '../../scripts/check-production-env';
// @ts-expect-error — plain ESM ops script (no type declarations)
import { evaluate } from '../../deploy/scripts/evaluate-server.mjs';

/** Pre-server readiness tooling: config checker, offline evaluator, discovery script, consolidated docs. */

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const rnd = (n: number, seed: string) => (seed.repeat(Math.ceil(n / seed.length)) + 'Zq9').slice(0, n);

/** A complete, valid-looking production environment made of obviously synthetic values (never real secrets). */
function goodEnv(): Record<string, string> {
  return {
    EDMN_ENVIRONMENT: 'production',
    APP_URL: 'https://www.edmneg.com',
    SELLER_APP_URL: 'https://www.edmneg.com/seller',
    ADMIN_APP_URL: 'https://admin.edmneg.com',
    ADMIN_HOST: 'admin.edmneg.com',
    ENFORCE_ADMIN_HOST: 'true',
    TRUSTED_PROXY: 'true',
    DATABASE_URL: `postgres://edmn_app:${rnd(30, 'aP4x')}@postgres:5432/edmn?sslmode=disable`,
    SESSION_SECRET: rnd(60, 'sEs7'),
    CRON_SECRET: rnd(60, 'cRo3'),
    DELIVERY_OTP_KEY: rnd(60, 'oTp5'),
    MOBILE_TOKEN_KEY: rnd(60, 'mTk8'),
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    DATA_ENCRYPTION_KEY_ID: 'prod1',
    WORKER_DEDICATED: 'true',
    INLINE_WORKER: 'false',
    STORAGE_DRIVER: 'database',
    MAIL_DRIVER: 'smtp',
    SMTP_HOST: 'smtp.mailprovider.net',
    SMTP_PORT: '587',
    SMTP_USER: 'apikey',
    SMTP_PASSWORD: rnd(40, 'sMt1'),
    MAIL_FROM: '"اضمن إي جي <info@edmneg.com>"'.replace(/^"|"$/g, ''),
    MALWARE_SCANNER_URL: 'http://scanner:8080/scan',
    MALWARE_SCANNER_PRIVATE_NETWORK: 'true',
    MALWARE_SCANNER_TOKEN: rnd(48, 'scN5'),
    VAPID_SUBJECT: 'mailto:info@edmneg.com',
  };
}
const errorsOf = (raw: Record<string, string | undefined>, opts = {}) => checkProductionEnv(raw, opts).filter((f) => f.level === 'ERROR');
const names = (raw: Record<string, string | undefined>, opts = {}) => errorsOf(raw, opts).map((f) => f.name);

describe('check-production-env: validates without printing values', () => {
  it('a complete synthetic production environment passes', () => {
    expect(errorsOf(goodEnv())).toEqual([]);
  });
  it('wrong environment, missing required vars, placeholders and empty assignments fail', () => {
    expect(names({ ...goodEnv(), EDMN_ENVIRONMENT: 'staging' })).toContain('EDMN_ENVIRONMENT');
    const { SESSION_SECRET: _s, ...noSecret } = goodEnv();
    expect(names(noSecret)).toContain('SESSION_SECRET');
    expect(names({ ...goodEnv(), SMTP_PASSWORD: '<SMTP_PASSWORD>' })).toContain('SMTP_PASSWORD');
    expect(names(goodEnv(), { fileText: 'SMS_DRIVER=\nAPP_URL=https://www.edmneg.com\n' })).toContain('SMS_DRIVER');
  });
  it('staging values, known staging fingerprints, localhost and demo values fail', () => {
    expect(names({ ...goodEnv(), APP_URL: 'https://edmn-staging.vercel.app' })).toContain('APP_URL');
    expect(names({ ...goodEnv(), DATABASE_URL: `postgres://edmn_app:${rnd(30, 'q')}@localhost:5432/edmn` })).toContain('DATABASE_URL');
    expect(names({ ...goodEnv(), MAIL_FROM: 'EDMN <no-reply@example.com>' })).toContain('MAIL_FROM');
    expect(names({ ...goodEnv(), VAPID_SUBJECT: 'mailto:admin@edmn.local' })).toContain('VAPID_SUBJECT');
    // a key whose fingerprint is on the non-production list is refused (the list itself never holds key material)
    expect(NONPROD_DATA_KEY_KCVS.length).toBeGreaterThan(0);
    const devKey = Buffer.alloc(32, 7).toString('base64'); // the public test-suite key
    if (NONPROD_DATA_KEY_KCVS.includes(dataKeyCheckValue(devKey))) expect(names({ ...goodEnv(), DATA_ENCRYPTION_KEY: devKey })).toContain('DATA_ENCRYPTION_KEY');
  });
  it('secret reuse, wrong hosts, no admin-host enforcement, unsafe storage, http public scanner fail', () => {
    const g = goodEnv();
    expect(names({ ...g, CRON_SECRET: g.SESSION_SECRET })).toContain('CRON_SECRET');
    expect(names({ ...g, ADMIN_APP_URL: 'https://www.edmneg.com/admin' })).toContain('ADMIN_APP_URL');
    expect(names({ ...g, ADMIN_HOST: 'adm.edmneg.com' })).toContain('ADMIN_HOST');
    expect(names({ ...g, ENFORCE_ADMIN_HOST: 'false' })).toContain('ENFORCE_ADMIN_HOST');
    expect(names({ ...g, STORAGE_DRIVER: 'local' })).toContain('STORAGE_DRIVER');
    expect(names({ ...g, MALWARE_SCANNER_URL: 'http://scanner.example.org/scan' }).length).toBeGreaterThan(0);
  });
  it('runtime DB role must be DML-only; networked DB needs TLS; migrate.env must use the owner on the same host', () => {
    const g = goodEnv();
    expect(names({ ...g, DATABASE_URL: `postgres://edmn_owner:${rnd(30, 'w')}@postgres:5432/edmn` })).toContain('DATABASE_URL');
    expect(names({ ...g, DATABASE_URL: `postgres://edmn_app:${rnd(30, 'w')}@db.prod-host.net:5432/edmn` })).toContain('DATABASE_URL');
    expect(names(g, { migrate: { DATABASE_URL: `postgres://edmn_owner:${rnd(30, 'm')}@other-host:5432/edmn` } })).toContain('migrate.env:DATABASE_URL');
    expect(names(g, { migrate: { DATABASE_URL: `postgres://edmn_owner:${rnd(30, 'm')}@postgres:5432/edmn` } })).toEqual([]);
  });
  it('no environment variable can switch real money on', () => {
    expect(names({ ...goodEnv(), REAL_MONEY_ENABLED: 'true' })).toContain('REAL_MONEY_ENABLED');
  });
  it('CLI output never contains a value', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'edmn-envcheck-'));
    const g: Record<string, string> = { ...goodEnv(), CRON_SECRET: goodEnv().SESSION_SECRET };
    writeFileSync(path.join(dir, 'p.env'), Object.entries(g).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n'));
    const r = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts/check-production-env.ts'), '--file', path.join(dir, 'p.env')], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(1);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/CRON_SECRET\s+reuses the value of SESSION_SECRET/);
    for (const v of [g.SESSION_SECRET, g.SMTP_PASSWORD, g.MALWARE_SCANNER_TOKEN, g.DATA_ENCRYPTION_KEY, 'aP4x']) expect(out).not.toContain(v);
  });
  it('the shipped template is recognised as an unfilled template (placeholders), not as valid', () => {
    const r = spawnSync('npx', ['tsx', path.join(ROOT, 'scripts/check-production-env.ts'), '--file', path.join(ROOT, '.env.production.example')], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/still a template placeholder/);
  });
});

/* ═══════════════ offline evaluator ═══════════════ */
const base = {
  schema: 'edmn-discovery/1',
  run_as_root: 'yes',
  arch: 'x86_64',
  os_id: 'ubuntu',
  os_version: '22.04',
  virtualization: 'kvm',
  docker_version: '27.1.1',
  docker_compose_version: '2.29.1',
  mem_total_mb: '8000',
  cpu_count: '4',
  root_fs_free_gb: '120',
  var_fs_free_gb: '120',
  port_80_owner: '',
  port_443_owner: '',
  port_3000_owner: '',
  port_5432_owner: '',
  cpanel_version: 'absent',
  nginx_default_server: 'unknown',
  refs_api_edmneg_com: 'none',
  refs_www_edmneg_com: 'none',
  refs_admin_edmneg_com: 'none',
  disk_pressure: '',
  systemd: 'systemd 249',
  podman: 'absent',
  clamav_version: 'absent',
};
describe('evaluate-server.mjs (offline, never applies)', () => {
  it('cPanel/Apache in front → profile A', () => {
    const r = evaluate({ ...base, cpanel_version: '118.0 (build 12)', port_80_owner: 'httpd', port_443_owner: 'httpd' });
    expect(r.proxy).toBe('A');
    expect(r.verdict).not.toBe('BLOCKED');
    expect(r.applied).toBe(false);
  });
  it('nginx with an explicit default_server → profile B; without one → BLOCKED (implicit-default capture risk)', () => {
    expect(evaluate({ ...base, port_80_owner: 'nginx', port_443_owner: 'nginx', nginx_default_server: 'explicit' })).toMatchObject({ proxy: 'B', verdict: 'SUPPORTED_WITH_WARNINGS' });
    expect(evaluate({ ...base, port_80_owner: 'nginx', port_443_owner: 'nginx', nginx_default_server: 'implicit' }).verdict).toBe('BLOCKED');
  });
  it('small server → profile C (external PostgreSQL) and ClamAV deferred', () => {
    const r = evaluate({ ...base, mem_total_mb: '3000', port_80_owner: 'nginx', port_443_owner: 'nginx', nginx_default_server: 'explicit' });
    expect(r.profile).toMatch(/^C/);
    expect(r.postgres).toBe('EXTERNAL');
    expect(r.clamav).toBe('DEFERRED');
  });
  it('blocks: tiny RAM, tiny disk, unknown process on 80/443, OpenVZ without Docker, non-root report', () => {
    expect(evaluate({ ...base, mem_total_mb: '1024' }).verdict).toBe('BLOCKED');
    expect(evaluate({ ...base, var_fs_free_gb: '10', root_fs_free_gb: '10' }).verdict).toBe('BLOCKED');
    expect(evaluate({ ...base, port_443_owner: 'java' }).verdict).toBe('BLOCKED');
    expect(evaluate({ ...base, docker_version: 'absent', virtualization: 'openvz' }).verdict).toBe('BLOCKED');
    expect(evaluate({ ...base, run_as_root: 'no' }).verdict).toBe('BLOCKED');
  });
  it('a big, clean server with Docker → SUPPORTED_WITH_WARNINGS (off-server backup is always a warning until configured)', () => {
    const r = evaluate({ ...base, port_80_owner: 'nginx', port_443_owner: 'nginx', nginx_default_server: 'explicit' });
    expect(r.verdict).toBe('SUPPORTED_WITH_WARNINGS');
    expect(r.checks.some((c: { area: string }) => c.area === 'backup')).toBe(true);
  });
});

/* ═══════════════ discovery script ═══════════════ */
describe('server-discovery.sh', () => {
  const s = read('deploy/scripts/server-discovery.sh');
  const code = s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  it('is read-only: no service control, package, user, firewall, docker or file mutation outside its report dir', () => {
    expect(code).not.toMatch(/systemctl (start|stop|restart|reload|enable|disable|mask)|apt(-get)? install|dnf install|yum install|useradd|usermod|ufw (allow|deny|enable)|firewall-cmd --(add|remove|permanent)|docker (run|rm|stop|kill|pull|exec)|nginx -s|apachectl (graceful|restart|stop)|\brm -|\bmv \/|chmod [0-7]+ \/|crontab -/);
    expect(code).not.toMatch(/cat [^|]*\.env|pg_dump|mysqldump|psql .*-c/); // never reads secret files or data
  });
  it('produces valid JSON + summary and redacts secrets', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'edmn-disc-'));
    const r = spawnSync('bash', [path.join(ROOT, 'deploy/scripts/server-discovery.sh'), '--out', dir], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const j = JSON.parse(readFileSync(path.join(dir, 'discovery.json'), 'utf8'));
    expect(j.schema).toBe('edmn-discovery/1');
    for (const k of ['os_id', 'kernel', 'arch', 'cpu_count', 'mem_total_mb', 'root_fs_free_gb', 'docker_version', 'port_80_owner', 'port_443_owner', 'refs_api_edmneg_com', 'refs_server_edmneg_com', 'nginx_default_server', 'exim', 'dovecot', 'certbot', 'firewall_csf', 'fail2ban']) expect(j, k).toHaveProperty(k);
    expect(readFileSync(path.join(dir, 'summary.txt'), 'utf8')).toMatch(/EDMN SERVER DISCOVERY/);
    expect(evaluate(j).verdict).toMatch(/SUPPORTED|BLOCKED/);
    const redact = spawnSync('bash', ['-c', `source <(sed -n '/^redact()/,/^}/p' ${path.join(ROOT, 'deploy/scripts/server-discovery.sh')}); redact`], {
      // fixtures assembled at runtime so the repository secret scanner never sees a literal credential / key header
      input: ['postgres', '://u:topsecretvalue@db/x\n'].join('') + 'SMTP_PASSWORD=topsecretvalue\nAuthorization: Bearer topsecretvalue\n' + ['-----BEGIN', 'OPENSSH PRIVATE KEY-----\n'].join(' '),
      encoding: 'utf8',
    });
    expect(redact.stdout).not.toContain('topsecretvalue');
    expect(redact.stdout).not.toContain('BEGIN OPENSSH');
  });
});

/* ═══════════════ consolidated documentation ═══════════════ */
describe('PRODUCTION_GO_LIVE.md is the single starting point', () => {
  const doc = read('docs/runbooks/PRODUCTION_GO_LIVE.md');
  it('links every sub-runbook and tool in execution order', () => {
    const order = ['server-discovery.sh', 'evaluate-server.mjs', 'SERVER_INSTALL_PROFILES.md', 'preflight-legacy.sh', 'PRODUCTION_SECRETS_MANIFEST.md', 'check-production-env.ts', 'PRODUCTION_DATABASE_PLAN.md', 'deploy.sh first', 'create-admin.ts', 'prod-acceptance.ts', 'SELF_HOSTED_DNS_CUTOVER.md'];
    const idx = order.map((o) => doc.indexOf(o));
    expect(idx.every((i) => i >= 0), JSON.stringify(Object.fromEntries(order.map((o, i) => [o, idx[i]])))).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    for (const f of ['PRODUCTION_PROVIDER_MATRIX.md', 'REAL_MONEY_ACTIVATION_GATE.md', 'DISASTER_RECOVERY.md', 'GO_LIVE_ACCEPTANCE_MATRIX.md']) expect(doc).toContain(f);
  });
  it('every linked runbook exists', () => {
    for (const m of doc.matchAll(/\]\(([^)#]+\.md)\)/g)) expect(() => readFileSync(path.join(ROOT, 'docs/runbooks', m[1])), m[1]).not.toThrow();
  });
  it('older Vercel-era production instructions are marked superseded (one authoritative path)', () => {
    for (const f of ['docs/runbooks/PRODUCTION_DEPLOYMENT.md', 'docs/DEPLOYMENT.md']) expect(read(f), f).toMatch(/SUPERSEDED for production.*PRODUCTION_GO_LIVE\.md/);
  });
});
