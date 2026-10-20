import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV_POLICY, isPrivateScannerHost, productionIsolationErrors, scannerUrlAllowed } from '@/server/core/runtime-env';
import { db } from '@/server/db/client';
import { jobLeases } from '@/server/db/schema';
import { httpScanner, parseScannerResponse, servable } from '@/server/storage/scanning';
import {
  dbChecks,
  evalForbiddenVars,
  evalInvariants,
  evalMarker,
  evalMigrations,
  evalPricing,
  evalProviders,
  isDemoEmail,
  parsePricingExpectation,
  summarize,
} from '../../scripts/prod-acceptance';

/** Self-hosted deployment package: infrastructure files and their safety properties (no server, no network). */

const ROOT = path.resolve(import.meta.dirname, '../..');
/** Minimal child-process environment (no inherited secrets). */
const childEnv = (extra: Record<string, string>) => ({ PATH: process.env.PATH ?? '', ...extra }) as unknown as NodeJS.ProcessEnv;
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const code = (text: string) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // config without comments

/* ═══════════════ 1. Malware scanner URL rule (private HTTP only under an explicit rule) ═══════════════ */
describe('scanner URL: https always; plain http only for a private destination with MALWARE_SCANNER_PRIVATE_NETWORK=true', () => {
  const ok = (url: string, priv?: string) => scannerUrlAllowed({ MALWARE_SCANNER_URL: url, MALWARE_SCANNER_PRIVATE_NETWORK: priv });

  it('public HTTP is rejected — with or without the private-network flag', () => {
    for (const u of ['http://scanner.example.com/scan', 'http://8.8.8.8/scan', 'http://scan.edmneg.com/scan', 'http://172.32.0.1/scan', 'http://192.169.1.1/scan', 'http://11.0.0.1/scan']) {
      expect(ok(u), u).toBe(false);
      expect(ok(u, 'true'), u).toBe(false);
    }
  });
  it('private HTTP is accepted ONLY with the explicit flag', () => {
    for (const u of ['http://scanner:8080/scan', 'http://localhost:8080/scan', 'http://127.0.0.1:8080/scan', 'http://10.1.2.3/scan', 'http://172.16.5.5/scan', 'http://172.31.255.1/scan', 'http://192.168.10.20/scan']) {
      expect(ok(u), `${u} without flag`).toBe(false);
      expect(ok(u, 'false'), `${u} flag=false`).toBe(false);
      expect(ok(u, 'true'), `${u} flag=true`).toBe(true);
    }
  });
  it('https is always accepted; credentials in the URL and other schemes never', () => {
    expect(ok('https://scanner.example.com/scan')).toBe(true);
    expect(ok('https://user:pw@scanner.example.com/scan')).toBe(false);
    expect(ok('http://user:pw@scanner:8080/scan', 'true')).toBe(false);
    expect(ok('ftp://scanner/scan', 'true')).toBe(false);
    expect(ok('not a url', 'true')).toBe(false);
  });
  it('private-host classifier: single-label names, loopback and RFC 1918 only', () => {
    expect(isPrivateScannerHost('scanner')).toBe(true);
    expect(isPrivateScannerHost('scanner.internal')).toBe(false); // dotted names may resolve publicly
    expect(isPrivateScannerHost('999.1.1.1')).toBe(false);
    expect(isPrivateScannerHost('169.254.1.1')).toBe(false);
  });
  it('production isolation reports the rule (and still requires a token)', () => {
    const base = { APP_URL: 'https://www.edmneg.com', ADMIN_HOST: 'admin.edmneg.com', ADMIN_APP_URL: 'https://admin.edmneg.com' };
    const errs = (extra: Record<string, string>) => productionIsolationErrors({ ...base, ...extra }).filter((e) => e.startsWith('MALWARE_SCANNER'));
    expect(errs({ MALWARE_SCANNER_URL: 'http://scanner.example.com/scan', MALWARE_SCANNER_TOKEN: 'x'.repeat(40), MALWARE_SCANNER_PRIVATE_NETWORK: 'true' })).toHaveLength(1);
    expect(errs({ MALWARE_SCANNER_URL: 'http://scanner:8080/scan', MALWARE_SCANNER_TOKEN: 'x'.repeat(40), MALWARE_SCANNER_PRIVATE_NETWORK: 'true' })).toHaveLength(0);
    expect(errs({ MALWARE_SCANNER_URL: 'http://scanner:8080/scan', MALWARE_SCANNER_PRIVATE_NETWORK: 'true' })).toEqual(['MALWARE_SCANNER_TOKEN is required with MALWARE_SCANNER_URL']);
  });
  it('the flag is a declared, non-secret policy variable', () => {
    expect(ENV_POLICY.find((p) => p.name === 'MALWARE_SCANNER_PRIVATE_NETWORK')).toMatchObject({ classification: 'OPTIONAL', secret: false });
  });
});

describe('private scanner: every non-CLEAN outcome fails closed (file stays blocked)', () => {
  it('infected / rejected / quarantined / malformed are never CLEAN', () => {
    expect(parseScannerResponse(200, '{"result":"CLEAN"}').verdict).toBe('CLEAN');
    expect(parseScannerResponse(200, '{"result":"INFECTED","signature":"Eicar-Test-Signature"}').verdict).toBe('INFECTED');
    expect(parseScannerResponse(200, '{"result":"REJECTED"}').verdict).toBe('REJECTED');
    for (const body of ['{"result":"QUARANTINED"}', '{"result":"clean "}', '{}', 'CLEAN', '']) expect(() => parseScannerResponse(200, body), body).toThrow();
    expect(() => parseScannerResponse(503, '{"result":"CLEAN"}')).toThrow();
  });
  it('a private file that is quarantined / infected / rejected / scan-failed is never served in production', () => {
    const saved = process.env.EDMN_ENVIRONMENT;
    process.env.EDMN_ENVIRONMENT = 'production';
    try {
      for (const st of ['QUARANTINED', 'INFECTED', 'REJECTED', 'SCAN_FAILED', 'SCANNING', 'UNSCANNED']) expect(servable({ visibility: 'PRIVATE', scanStatus: st }), st).toBe(false);
      expect(servable({ visibility: 'PRIVATE', scanStatus: 'CLEAN' })).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.EDMN_ENVIRONMENT;
      else process.env.EDMN_ENVIRONMENT = saved;
    }
  });
  it('unavailable and timeout raise (→ SCAN_FAILED, retried later, never served)', async () => {
    const meta = { fileId: '00000000-0000-0000-0000-000000000000', mimeType: 'application/pdf' };
    const down = httpScanner('http://127.0.0.1:9/scan', 'token-0123456789abcdef0123456789');
    await expect(down.scan(Buffer.from('x'), meta)).rejects.toThrow();
    const { createServer } = await import('node:http');
    const slow = createServer(() => undefined).listen(0, '127.0.0.1');
    await new Promise((r) => slow.once('listening', r));
    const port = (slow.address() as { port: number }).port;
    try {
      const s = httpScanner(`http://127.0.0.1:${port}/scan`, 'token-0123456789abcdef0123456789', 300);
      await expect(s.scan(Buffer.from('x'), meta)).rejects.toThrow();
    } finally {
      slow.closeAllConnections();
      slow.close();
    }
  });
});

/* ═══════════════ 2. Compose: immutable image, direct start, private services ═══════════════ */
describe('docker-compose.prod.yml', () => {
  let doc: { services: Record<string, Record<string, unknown>>; networks: Record<string, Record<string, unknown> | null> };
  beforeAll(async () => {
    const yaml = (await import('js-yaml' as string)) as { load(s: string): unknown };
    doc = yaml.load(read('deploy/compose/docker-compose.prod.yml')) as typeof doc;
  });
  const cmd = (s: string) => ((doc.services[s].command as string[]) ?? []).join(' ');

  it('web and worker run the SAME image whose tag is required (commit SHA), never a mutable default', () => {
    expect(doc.services.web.image).toBe(doc.services.worker.image);
    expect(String(doc.services.web.image)).toMatch(/:\$\{EDMN_IMAGE_TAG:\?/);
    expect(String(doc.services.web.image)).not.toMatch(/latest/);
  });
  it('web / worker start directly — never start.sh, never migrate or seed (a restart cannot migrate)', () => {
    for (const s of ['web', 'worker']) {
      expect(cmd(s), s).not.toMatch(/start\.sh|migrate|seed|db:/);
      expect(doc.services[s].restart).toBe('unless-stopped');
      expect(doc.services[s].profiles).toBeUndefined();
    }
    expect(cmd('web')).toMatch(/next\/dist\/bin\/next start/);
    expect(cmd('worker')).toMatch(/scripts\/worker\.ts$/);
  });
  it('migrate / seed exist only as explicit one-off ops services (profile "ops", restart "no")', () => {
    for (const s of ['migrate', 'migrate-preflight', 'seed', 'acceptance']) {
      expect(doc.services[s].profiles, s).toEqual(['ops']);
      expect(doc.services[s].restart, s).toBe('no');
    }
    expect(cmd('migrate-preflight')).toMatch(/--preflight/);
  });
  it('only web publishes a port, and only on loopback; postgres / clamd / scanner publish nothing', () => {
    expect(doc.services.web.ports).toEqual(['127.0.0.1:${EDMN_WEB_PORT:-3000}:3000']);
    for (const s of ['worker', 'postgres', 'clamd', 'scanner', 'migrate', 'seed']) expect(doc.services[s].ports, s).toBeUndefined();
    for (const s of ['postgres', 'scanner']) expect(doc.services[s].networks, s).toEqual(['backend']);
    expect(doc.networks.backend).toMatchObject({ internal: true });
  });
  it('healthchecks, graceful stop, resource limits, log rotation, least privilege', () => {
    for (const s of ['web', 'worker', 'postgres', 'clamd', 'scanner']) {
      expect(doc.services[s].healthcheck, s).toBeDefined();
      expect(doc.services[s].logging, s).toMatchObject({ driver: 'json-file' });
    }
    for (const s of ['web', 'worker', 'postgres']) expect((doc.services[s].deploy as { resources: { limits: { memory: string } } }).resources.limits.memory, s).toBeTruthy();
    for (const s of ['web', 'worker']) {
      expect(doc.services[s].stop_grace_period).toBe('30s');
      expect(doc.services[s].cap_drop).toEqual(['ALL']);
      expect(doc.services[s].security_opt).toEqual(['no-new-privileges:true']);
    }
  });
  it('secrets only from env files outside the repository; optional profiles for postgres / scanner', () => {
    const text = code(read('deploy/compose/docker-compose.prod.yml'));
    expect(text).toMatch(/\/etc\/edmn\/production\.env/);
    expect(text).not.toMatch(/PASSWORD\s*[:=]\s*\S|SECRET\s*[:=]\s*\S|TOKEN\s*[:=]\s*[^\s#]/);
    expect(doc.services.postgres.profiles).toEqual(['postgres-local']);
    expect(doc.services.clamd.profiles).toEqual(['scanner']);
    expect(doc.services.postgres.volumes).toContain('edmn_pgdata:/var/lib/postgresql/data');
  });
});

describe('start.sh refuses PRODUCTION (it would migrate on every start)', () => {
  for (const v of ['production', 'PRODUCTION', 'Production']) {
    it(`EDMN_ENVIRONMENT=${v} → exit 64 before any migration`, () => {
      const r = spawnSync('sh', [path.join(ROOT, 'scripts/start.sh')], { env: childEnv({ EDMN_ENVIRONMENT: v }), encoding: 'utf8' });
      expect(r.status).toBe(64);
      expect(r.stdout).not.toMatch(/migrations/);
      expect(r.stderr).toMatch(/not used in PRODUCTION/);
    });
  }
  it('the Dockerfile ships ops/ (scanner wrapper) and stamps the release revision', () => {
    const d = read('Dockerfile');
    expect(d).toMatch(/COPY --chown=node:node ops \.\/ops/);
    expect(d).toMatch(/org\.opencontainers\.image\.revision=\$EDMN_RELEASE/);
    expect(d).toMatch(/^USER node$/m);
  });
});

/* ═══════════════ 3. Deploy script: order, STOP, no DB rollback ═══════════════ */
describe('deploy.sh', () => {
  const s = read('deploy/scripts/deploy.sh');
  it('runs the steps in the mandated order', () => {
    const order = ['1/12 PRECHECK', '2/12 BACKUP', '3/12 VERIFY BACKUP', '5/12 MIGRATION PREFLIGHT', '6/12 EXPLICIT MIGRATION', '7/12 REFERENCE SEED', '8/12 START WEB / WORKER', '9/12 /api/health', '10/12 /api/ready', '11/12 SMOKE', '12/12 FINANCIAL INVARIANTS', 'SUCCESS'];
    const idx = order.map((o) => s.indexOf(`step "${o}`));
    expect(idx.every((i) => i > 0), JSON.stringify(idx)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // image load / environment validation happen before the backup and before any migration
    expect(s.indexOf('4/12 LOAD / SELECT IMAGE')).toBeLessThan(s.indexOf('step "2/12 BACKUP'));
  });
  it('stops on any failure and never rolls the database back', () => {
    expect(read('deploy/scripts/lib.sh')).toMatch(/set -Eeuo pipefail/);
    expect(s).toMatch(/^source "\$\(dirname "\$0"\)\/lib\.sh"$/m);
    expect(s).toMatch(/trap on_fail EXIT/);
    expect(code(s)).not.toMatch(/pg_restore|dropdb|DROP DATABASE|psql /);
    expect(s).toMatch(/The DATABASE was NOT rolled back/);
  });
  it('first deploy requires an empty, separate database, legacy preflight, and refuses demo/E2E/staging credentials', () => {
    expect(s).toMatch(/first deploy requires an EMPTY, separate production database/);
    expect(s).toMatch(/preflight-legacy\.sh/);
    for (const v of ['STAGING_DEMO_PASSWORD', 'SEED_DEMO', 'E2E_DATABASE_URL']) expect(s).toContain(v);
    expect(s).toMatch(/ENFORCE_ADMIN_HOST=true required/);
    expect(s).toMatch(/scripts\/check-env\.ts/); // the app's own policy: staging secret fingerprints, URLs, hosts
  });
  it('rollback.sh never automates a database rollback', () => {
    const r = read('deploy/scripts/rollback.sh');
    expect(code(r)).not.toMatch(/^\s*(docker exec \S+ )?(pg_restore|dropdb|psql)\b/m);
    const run = spawnSync('bash', [path.join(ROOT, 'deploy/scripts/rollback.sh'), 'database'], { env: childEnv({ EDMN_STATE: '/nonexistent' }), encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stdout).toMatch(/DATABASE ROLLBACK IS A MANUAL, APPROVED OPERATION — nothing was changed/);
  });
  it('every shell script parses (bash -n)', () => {
    const files = [
      ...readdirSync(path.join(ROOT, 'deploy/scripts')).map((f) => `deploy/scripts/${f}`),
      ...readdirSync(path.join(ROOT, 'deploy/hardening')).map((f) => `deploy/hardening/${f}`),
      'deploy/compose/postgres/init/01-roles.sh',
    ].filter((f) => f.endsWith('.sh'));
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const f of files) {
      const r = spawnSync('bash', ['-n', path.join(ROOT, f)], { encoding: 'utf8' });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });
  it('the legacy preflight only reads (never stops, restarts, reloads or removes a service)', () => {
    const p = code(read('deploy/scripts/preflight-legacy.sh'));
    expect(p).not.toMatch(/systemctl (stop|restart|reload|disable|mask)|service \S+ (stop|restart)|docker (rm|stop|kill)|apachectl (graceful|restart|stop)|nginx -s|rm -rf? \/etc/);
  });
  it('hardening scripts default to a dry run and never touch mail / web / database services', () => {
    for (const f of ['deploy/hardening/ubuntu-debian.sh', 'deploy/hardening/almalinux-rocky.sh']) {
      const h = read(f);
      expect(h).toMatch(/APPLY=0; \[ "\$\{1:-\}" = "--apply" \] && APPLY=1/);
      expect(code(h)).not.toMatch(/(stop|disable|remove|purge|erase)\s+(apache2|httpd|nginx|mysql|mariadb|postgresql|exim|dovecot|postfix|cpanel)/i);
      expect(h).toMatch(/refusing to disable password login/);
      const dry = spawnSync('bash', [path.join(ROOT, f)], { encoding: 'utf8' });
      const out = dry.stdout + dry.stderr;
      expect(out).not.toMatch(/APPLY MODE/);
      // Either a complete dry run, or an explicit STOP (not root / other OS) — never a silent exit.
      if (dry.status === 0) expect(out).toMatch(/DRY RUN — nothing will be changed[\s\S]*Done \(dry run/);
      else expect(out, `${f} exit ${dry.status}`).toMatch(/✗ STOP: (run with sudo\/root|this script is for)/);
    }
  });
});

/* ═══════════════ 4. Reverse proxies: EDMN names only, api.edmneg.com never captured ═══════════════ */
describe('reverse proxy templates', () => {
  const nginx = read('deploy/proxy/nginx/edmn.conf');
  const apache = read('deploy/proxy/apache/edmn.conf');
  it('nginx: exact EDMN names only — no default_server, catch-all, wildcard or api host', () => {
    const c = code(nginx);
    expect(c).not.toMatch(/default_server|server_name\s+_|server_name[^;]*[*~]|api\.edmneg\.com/);
    const names = [...c.matchAll(/server_name\s+([^;]+);/g)].flatMap((m) => m[1].trim().split(/\s+/));
    expect(new Set(names)).toEqual(new Set(['edmn-guard.invalid', 'www.edmneg.com', 'edmneg.com', 'admin.edmneg.com']));
  });
  it('nginx: guard blocks come FIRST and refuse unknown hosts (never redirect/serve them) if ours became the implicit default', () => {
    const blocks = [...code(nginx).matchAll(/server \{[^}]*\}/g)].map((m) => m[0]);
    expect(blocks[0]).toMatch(/listen 80;[\s\S]*server_name edmn-guard\.invalid;[\s\S]*return 444;/);
    expect(blocks[1]).toMatch(/listen 443 ssl;[\s\S]*server_name edmn-guard\.invalid;[\s\S]*ssl_reject_handshake on;/);
    const pre = code(read('deploy/scripts/preflight-legacy.sh'));
    expect(pre).toMatch(/no explicit default_server/);
  });
  it('nginx: forwarding headers, upload limit ≥ app maximum, timeouts, apex answered by the proxy (not the app)', () => {
    const c = code(nginx).replace(/[ \t]+/g, ' ');
    for (const h of ['Host $host', 'X-Real-IP $remote_addr', 'X-Forwarded-For $remote_addr', 'X-Forwarded-Proto https']) expect(c).toContain(`proxy_set_header ${h}`);
    expect(Number(c.match(/client_max_body_size (\d+)m/)?.[1])).toBeGreaterThanOrEqual(10);
    expect(c).toMatch(/proxy_read_timeout\s+120s/);
    const apex = c.match(/server \{[^}]*server_name edmneg\.com;[^}]*\}/)?.[0] ?? '';
    expect(apex).toMatch(/return 301 https:\/\/www\.edmneg\.com\$request_uri/);
    expect(apex).not.toMatch(/proxy_pass/);
    expect(c).not.toMatch(/add_header\s+Strict-Transport-Security/i); // no includeSubDomains HSTS from the proxy
    expect(c).toMatch(/location = \/api\/cron\/tick \{\s*return 404;/);
  });
  it('apache: exact names only, no _default_ / wildcard / api host; upload limit, timeouts, forwarded headers', () => {
    const c = code(apache);
    expect(c).not.toMatch(/_default_|ServerAlias[^\n]*\*|api\.edmneg\.com/);
    expect(c).toMatch(/ProxyPreserveHost On/);
    expect(Number(c.match(/LimitRequestBody (\d+)/)?.[1])).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    expect(c).toMatch(/ProxyTimeout 120/);
    expect(c).toMatch(/RequestHeader set X-Forwarded-Proto "https"/);
    expect(c).toMatch(/RequestHeader set X-Real-IP "expr=%\{REMOTE_ADDR\}"/);
    expect(c).toMatch(/ServerName edmneg\.com\s+[\s\S]*?Redirect permanent \/ https:\/\/www\.edmneg\.com\//);
    expect(c).toMatch(/ProxyPass\s+\/\.well-known\/acme-challenge\/ !/);
  });
  it('the app trusts forwarding headers only behind our proxy (TRUSTED_PROXY in the template)', () => {
    expect(read('.env.production.example')).toMatch(/^TRUSTED_PROXY=true$/m);
  });
});

/* ═══════════════ 5. Production env template ═══════════════ */
describe('.env.production.example', () => {
  const t = read('.env.production.example');
  const vars = new Map([...t.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1], m[2]]));
  const commented = new Set([...t.matchAll(/^# ([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  it('contains the mandated production values', () => {
    expect(vars.get('APP_URL')).toBe('https://www.edmneg.com');
    expect(vars.get('SELLER_APP_URL')).toBe('https://www.edmneg.com/seller');
    expect(vars.get('ADMIN_APP_URL')).toBe('https://admin.edmneg.com');
    expect(vars.get('ADMIN_HOST')).toBe('admin.edmneg.com');
    expect(vars.get('ENFORCE_ADMIN_HOST')).toBe('true');
    expect(vars.get('MAIL_FROM')).toBe('اضمن إي جي <info@edmneg.com>');
    expect(vars.get('VAPID_SUBJECT')).toBe('mailto:info@edmneg.com');
    expect(vars.get('EDMN_ENVIRONMENT')).toBe('production');
  });
  it('covers every variable REQUIRED in PRODUCTION and only known names', () => {
    const required = ENV_POLICY.filter((p) => p.classification === 'REQUIRED' && (!p.requiredIn || p.requiredIn.includes('PRODUCTION'))).map((p) => p.name);
    for (const n of required) expect(vars.has(n), n).toBe(true);
    const known = new Set([...ENV_POLICY.map((p) => p.name), 'NODE_ENV', 'LOG_LEVEL', 'SMTP_PORT', 'SMS_SENDER_ID', 'WORKER_DEDICATED', 'INLINE_WORKER', 'WORKER_POLL_MS', 'HEARTBEAT_MAX_AGE_SEC', 'DATABASE_POOL_MAX', 'DATABASE_STATEMENT_TIMEOUT_MS']);
    for (const n of [...vars.keys(), ...commented]) expect(known.has(n), `unknown variable ${n}`).toBe(true);
  });
  it('holds no secret value: every secret is a <PLACEHOLDER> or commented out', () => {
    for (const p of ENV_POLICY.filter((x) => x.secret)) {
      const v = vars.get(p.name);
      if (v === undefined) continue;
      if (p.name === 'DATABASE_URL') expect(v).toMatch(/^postgres:\/\/edmn_app:<PW>@postgres:5432\/edmn/);
      else expect(v, p.name).toMatch(/^<[A-Z0-9_+]+>$/);
    }
    expect(t).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/); // no key-like material
  });
  it('never sets a staging-only / forbidden variable and never leaves an empty assignment', () => {
    for (const p of ENV_POLICY.filter((x) => x.classification !== 'REQUIRED' && x.classification !== 'OPTIONAL')) expect(vars.has(p.name), p.name).toBe(false);
    for (const [n, v] of vars) expect(v, `${n} is empty (comment it out instead)`).not.toBe('');
  });
  it('every variable carries a launch-tier marker', () => {
    for (const tier of ['[PUBLIC LAUNCH]', '[PILOT]', '[REAL MONEY]', '[OPTIONAL]']) expect(t).toContain(tier);
  });
  it('is not ignored by git, while real env files are', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.env$/m);
    expect(spawnSync('git', ['check-ignore', '-q', '.env.production.example'], { cwd: ROOT }).status).toBe(1);
    for (const f of ['production.env', 'deploy/compose/postgres.env', '.env']) expect(spawnSync('git', ['check-ignore', '-q', f], { cwd: ROOT }).status, f).toBe(0);
  });
});

/* ═══════════════ 6. Worker heartbeat probe (read-only) ═══════════════ */
describe('worker-health.mjs', () => {
  let saved: typeof jobLeases.$inferSelect | undefined;
  beforeAll(async () => {
    [saved] = await db.select().from(jobLeases).where(eq(jobLeases.jobName, 'outbound.flush'));
  });
  afterAll(async () => {
    await db.delete(jobLeases).where(eq(jobLeases.jobName, 'outbound.flush'));
    if (saved) await db.insert(jobLeases).values(saved);
  });
  const probe = (url = process.env.DATABASE_URL!) => spawnSync('node', [path.join(ROOT, 'scripts/worker-health.mjs'), '--json'], { env: childEnv({ DATABASE_URL: url }), encoding: 'utf8' });
  const setLast = async (secondsAgo: number) => {
    await db.delete(jobLeases).where(eq(jobLeases.jobName, 'outbound.flush'));
    await db.insert(jobLeases).values({ jobName: 'outbound.flush', leaseUntil: new Date(), everySeconds: 60, lastSucceededAt: new Date(Date.now() - secondsAgo * 1000) });
  };

  it('fresh heartbeat → exit 0 healthy', async () => {
    await setLast(10);
    const r = probe();
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ healthy: true });
  });
  it('stale heartbeat → exit 1 (container unhealthy, watch.sh CRIT)', async () => {
    await setLast(600);
    const r = probe();
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).heartbeatAgeSec).toBeGreaterThanOrEqual(599);
  });
  it('database unreachable → exit 2, no connection details printed', () => {
    const r = probe('postgresql://nobody:secret-value@127.0.0.1:1/none');
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).not.toMatch(/secret-value|nobody/);
  });
});

/* ═══════════════ 7. Production acceptance suite (read-only) ═══════════════ */
describe('prod-acceptance', () => {
  it('pure evaluators: marker, migrations, demo emails, forbidden vars, pricing, providers', () => {
    expect(evalMarker('PRODUCTION').verdict).toBe('PASS');
    expect(evalMarker('STAGING').verdict).toBe('FAIL');
    expect(evalMarker(null).verdict).toBe('FAIL');
    expect(evalMigrations(19, 19).verdict).toBe('PASS');
    expect(evalMigrations(18, 19).verdict).toBe('FAIL');
    for (const e of ['admin@edmn.local', 'buyer@demo.edmn.local', 'x@e2e.local', 'a@test.local', 'b@x.test', 'c@example.com', 'd@e2e.edmneg.com']) expect(isDemoEmail(e), e).toBe(true);
    for (const e of ['info@edmneg.com', 'someone@gmail.com']) expect(isDemoEmail(e), e).toBe(false);
    expect(evalForbiddenVars({ STAGING_DEMO_PASSWORD: 'x' }).verdict).toBe('FAIL');
    expect(evalForbiddenVars({ APP_URL: 'https://www.edmneg.com' }).verdict).toBe('PASS');
    expect(parsePricingExpectation('none')).toBe('none');
    expect(parsePricingExpectation('MARKETPLACE:3,PROTECTED_DEAL:1')).toEqual({ MARKETPLACE: 3, PROTECTED_DEAL: 1 });
    expect(parsePricingExpectation('garbage')).toBeNull();
    expect(evalPricing({}, null).verdict).toBe('FAIL'); // no expectation = no evidence = FAIL, never a silent pass
    expect(evalPricing({}, 'none').verdict).toBe('PASS');
    expect(evalPricing({ MARKETPLACE: 3 }, { MARKETPLACE: 3 }).verdict).toBe('PASS');
    expect(evalPricing({ MARKETPLACE: 4 }, { MARKETPLACE: 3 }).verdict).toBe('FAIL');
    expect(evalProviders([{ provider: 'SMTP', status: 'CONFIGURED_UNVERIFIED' }]).verdict).toBe('PASS');
    expect(evalProviders([{ provider: 'SMTP', status: 'DEGRADED' }]).verdict).toBe('WARN');
    expect(evalProviders([{ provider: 'SMTP', status: 'FAILED' }]).verdict).toBe('FAIL');
  });
  it('invariants: any drift / duplicate / stranded / allocation / source mismatch, imbalance or a missing check FAILS', () => {
    const zero = ['PROJECTION_DRIFT', 'RESERVATION_DRIFT', 'DUPLICATE_BUSINESS_EVENT', 'STRANDED_BALANCE', 'WITHDRAWAL_ALLOCATION_SUM', 'WITHDRAWAL_ALLOCATION_MISSING', 'DEAL_PAYABLE_ATTRIBUTION', 'DEAL_RESERVED_ATTRIBUTION'].map((c) => ({ code: c, count: 0 }));
    const totals = { debits: 100, credits: 100, difference: 0 };
    expect(summarize(evalInvariants(totals, zero)).overall).toBe('PASS');
    expect(summarize(evalInvariants({ debits: 100, credits: 90, difference: 10 }, zero)).overall).toBe('FAIL');
    for (const c of zero) expect(summarize(evalInvariants(totals, zero.map((z) => (z.code === c.code ? { ...z, count: 1 } : z)))).overall, c.code).toBe('FAIL');
    expect(summarize(evalInvariants(totals, zero.filter((z) => z.code !== 'STRANDED_BALANCE'))).overall).toBe('FAIL');
  });
  it('DB checks run in a READ ONLY transaction and change nothing (test database)', async () => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const count = async () => (await c.query<{ n: string }>('select (select count(*) from ledger_health_checks) + (select count(*) from audit_logs) + (select count(*) from job_runs) n')).rows[0].n;
    const before = await count();
    const res = await dbChecks({ url: process.env.DATABASE_URL!, expectEnvironment: 'TEST', expectPricing: null, drill: true, raw: { STORAGE_DRIVER: 'database' } });
    expect(res.find((r) => r.id === 'READ_ONLY')?.verdict).toBe('PASS');
    expect(res.find((r) => r.id === 'DB_MARKER')?.detail).toMatch(/^marker=\S+ expected=TEST$/);
    expect(res.some((r) => r.id === 'INV_ALL')).toBe(true);
    expect(await count()).toBe(before);
    // and the database itself refuses writes inside such a transaction
    await c.query('begin transaction read only');
    await expect(c.query("insert into job_leases (job_name, lease_until) values ('ro-probe', now())")).rejects.toMatchObject({ code: '25006' });
    await c.query('rollback');
    await c.end();
  });
});

/* ═══════════════ 8. Postgres role separation + backup tooling ═══════════════ */
describe('postgres init + backup tooling', () => {
  const roles = read('deploy/compose/postgres/init/01-roles.sh');
  it('owner / runtime (DML only) / backup (read-only) roles; UTF8; UTC; passwords never interpolated', () => {
    expect(roles).toMatch(/CREATE ROLE edmn_owner/);
    expect(roles).toMatch(/CREATE ROLE edmn_app[^;]*NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    expect(roles).toMatch(/GRANT pg_read_all_data TO edmn_backup/);
    expect(roles).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edmn_app/);
    expect(roles).not.toMatch(/GRANT ALL|TRUNCATE|SUPERUSER(?! )/);
    expect(roles).toMatch(/ENCODING %L/);
    expect(roles).toMatch(/SET timezone TO %L', :'db', 'UTC'/);
    expect(roles).toMatch(/PASSWORD :'app_pw'/);
  });
  it('backups are encrypted with a public key, verified, and labelled honestly when not off-server', () => {
    const b = read('deploy/scripts/backup.sh');
    expect(b).toMatch(/unencrypted backups are not allowed/);
    expect(b).toMatch(/pg_restore --list/);
    expect(b).toMatch(/LOCAL COPY — NOT DISASTER-RECOVERY BACKUP/);
    expect(b).toMatch(/BACKUP_UPLOAD_CMD/);
    expect(code(b)).not.toMatch(/(AWS_SECRET|aws_secret_access_key|rclone\.conf|B2_APPLICATION_KEY)\s*=/);
    const d = read('deploy/scripts/restore-drill.sh');
    for (const k of ['--network', 'tmpfs', 'critical snapshot', '--drill']) expect(d).toContain(k);
  });
});
