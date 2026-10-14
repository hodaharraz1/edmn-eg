/**
 * PRODUCTION CONFIG CHECKER — validates a future production.env WITHOUT printing any value.
 *
 *   npx tsx scripts/check-production-env.ts --file /etc/edmn/production.env [--migrate-file /etc/edmn/migrate.env] [--json]
 *   (in the release image:  docker run --rm --env-file /etc/edmn/production.env edmn-app:<sha> node --import tsx scripts/check-production-env.ts)
 *
 * Runs the application's own policy (validateEnvironment + productionIsolationErrors: staging fingerprints, staging /
 * local / test databases, http URLs, host layout, sender domain, shared secrets …) plus deployment checks: wrong
 * environment, placeholders, empty assignments, demo / example / localhost values, secret reuse, storage, scanner,
 * admin-host enforcement, runtime DB role, and that nothing in the environment can switch real money on.
 * Output: variable NAMES and statuses only. Exit 0 = no ERROR, 1 = errors, 2 = cannot read input.
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { ENV_POLICY, validateEnvironment } from '../src/server/core/runtime-env';

export type Level = 'ERROR' | 'WARN' | 'OK';
export interface Finding {
  level: Level;
  name: string;
  message: string;
}
type Raw = Record<string, string | undefined>;

const isPlaceholder = (v: string) => /<[A-Za-z0-9_+ -]+>|^(changeme|change-me|replace[-_]?me|todo|xxx+|secret|password)$/i.test(v.trim()) || /^replace-with/i.test(v);
const hostOf = (u?: string) => {
  try {
    return u ? new URL(u).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

export function checkProductionEnv(raw: Raw, opts: { domain?: string; migrate?: Raw; fileText?: string } = {}): Finding[] {
  const out: Finding[] = [];
  const err = (name: string, message: string) => out.push({ level: 'ERROR', name, message });
  const warn = (name: string, message: string) => out.push({ level: 'WARN', name, message });
  const domain = (opts.domain ?? 'edmneg.com').toLowerCase();

  // 1. Environment kind — the policy below only applies the PRODUCTION rules when this is right.
  if ((raw.EDMN_ENVIRONMENT ?? '').toLowerCase() !== 'production') err('EDMN_ENVIRONMENT', 'must be "production"');

  // 2. Empty assignments and placeholders (an empty value is not "unset" and breaks enum parsing).
  if (opts.fileText) for (const m of opts.fileText.matchAll(/^\s*([A-Z][A-Z0-9_]*)=\s*$/gm)) err(m[1], 'empty assignment — comment it out or give it a value');
  for (const [k, v] of Object.entries(raw)) if (v && isPlaceholder(v)) err(k, 'still a template placeholder');

  // 3. The application's own production policy (messages carry names only).
  const v = validateEnvironment({ ...raw, NODE_ENV: 'production' });
  for (const e of v.errors) err(e.split(/\s/)[0].replace(/[,:]$|=.*$/g, ""), e.replace(/^\S+\s/, ""));
  for (const w of v.warnings) warn(w.split(/\s/)[0].replace(/[,:]$/, ''), w.replace(/^\S+\s/, ''));

  // 4. Hosts: exactly the production layout.
  const expect: Record<string, string> = { APP_URL: `www.${domain}`, ADMIN_APP_URL: `admin.${domain}`, SELLER_APP_URL: `www.${domain}` };
  for (const [n, h] of Object.entries(expect)) {
    const got = hostOf(raw[n]);
    if (!raw[n]) continue;
    if (!got) err(n, 'is not a valid URL');
    else if (got !== h) err(n, `host must be ${h}`);
    if (raw[n] && !raw[n]!.startsWith('https://')) err(n, 'must be https');
  }
  if (raw.ADMIN_HOST && raw.ADMIN_HOST.toLowerCase() !== `admin.${domain}`) err('ADMIN_HOST', `must be admin.${domain}`);
  if (raw.ENFORCE_ADMIN_HOST !== 'true' && raw.ENFORCE_HOSTS !== 'true') err('ENFORCE_ADMIN_HOST', 'admin-host enforcement must be on (true)');
  if (raw.TRUSTED_PROXY !== 'true') warn('TRUSTED_PROXY', 'should be true behind the EDMN reverse proxy (per-IP rate limits)');

  // 5. Demo / example / localhost values anywhere.
  for (const [k, val] of Object.entries(raw)) {
    if (!val) continue;
    if (/\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(val) && !['MALWARE_SCANNER_URL'].includes(k)) err(k, 'points at localhost');
    if (/@[\w.-]*\.local\b|\.local\b\/|\bexample\.(com|org|net)\b|vercel\.app\b|\bstaging\b/i.test(val)) err(k, 'contains a demo / example / staging value');
  }

  // 6. Secret reuse: no two secret variables may share a value (also across the migrate file).
  const secrets = ENV_POLICY.filter((p) => p.secret).map((p) => p.name);
  const seen = new Map<string, string>();
  for (const n of secrets) {
    const val = raw[n];
    if (!val || n === 'DATABASE_URL_UNPOOLED') continue;
    const prev = seen.get(val);
    if (prev) err(n, `reuses the value of ${prev}`);
    else seen.set(val, n);
  }

  // 7. Storage, scanner, mail, push.
  if (raw.STORAGE_DRIVER !== 'database') {
    if (raw.STORAGE_DRIVER === 'local' && raw.STORAGE_LOCAL_ROOT?.startsWith('/')) warn('STORAGE_DRIVER', 'local files need their own persistent volume AND a separate backup (database is recommended)');
    else err('STORAGE_DRIVER', 'must be "database" (or "local" with an absolute STORAGE_LOCAL_ROOT on a backed-up volume)');
  }
  if (!raw.MALWARE_SCANNER_URL) warn('MALWARE_SCANNER_URL', 'not configured: private uploads stay QUARANTINED (unopenable) — required before the seller/buyer pilot');
  if (raw.MAIL_FROM && !/@edmneg\.com>?\s*"?$/i.test(raw.MAIL_FROM.trim())) err('MAIL_FROM', `must use an @${domain} sender`);
  if (raw.VAPID_PUBLIC_KEY && !raw.VAPID_PRIVATE_KEY) err('VAPID_PRIVATE_KEY', 'missing while VAPID_PUBLIC_KEY is set');
  if (raw.WORKER_DEDICATED !== 'true') warn('WORKER_DEDICATED', 'the dedicated worker container is the primary scheduler — set true');
  if (raw.INLINE_WORKER === 'true') warn('INLINE_WORKER', 'should be false when the worker container runs');

  // 8. Database roles: runtime must not be the owner; production DB over the network needs TLS.
  const dbUser = raw.DATABASE_URL?.match(/^postgres(?:ql)?:\/\/([^:@/]+)/)?.[1];
  if (dbUser && /owner|postgres|admin/i.test(dbUser)) err('DATABASE_URL', 'runtime role must be the DML-only role (edmn_app), not an owner/superuser');
  const dbHost = hostOf(raw.DATABASE_URL?.replace(/^postgres(ql)?:/, 'http:'));
  if (dbHost && dbHost.includes('.') && !/sslmode=(require|verify-ca|verify-full)/.test(raw.DATABASE_URL ?? '')) err('DATABASE_URL', 'a networked database needs sslmode=require (or verify-full)');
  if (opts.migrate) {
    const mu = opts.migrate.DATABASE_URL?.match(/^postgres(?:ql)?:\/\/([^:@/]+)/)?.[1];
    if (!mu) err('migrate.env:DATABASE_URL', 'missing');
    else if (mu === dbUser) warn('migrate.env:DATABASE_URL', 'uses the runtime role — migrations should run as the schema owner (edmn_owner)');
    const mh = hostOf(opts.migrate.DATABASE_URL?.replace(/^postgres(ql)?:/, 'http:'));
    if (mh && dbHost && mh !== dbHost) err('migrate.env:DATABASE_URL', 'points at a different database host than DATABASE_URL');
  }

  // 9. Real money can never be switched on from the environment.
  for (const k of Object.keys(raw)) if (/REAL_?MONEY|PAYMENTS?_ENABLED|LIVE_PAYMENTS/i.test(k)) err(k, 'real money is a database gate (Maker/Checker) — no environment variable may exist for it');
  if (raw.PAYMENT_WEBHOOK_SECRET) warn('PAYMENT_WEBHOOK_SECRET', 'set: real-money material present before the real-money programme — it does NOT enable real money');

  // 10. Unknown names (typos silently ignored by the app).
  const known = new Set([...ENV_POLICY.map((p) => p.name), 'NODE_ENV', 'LOG_LEVEL', 'SMTP_PORT', 'SMS_SENDER_ID', 'WORKER_DEDICATED', 'INLINE_WORKER', 'WORKER_POLL_MS', 'HEARTBEAT_MAX_AGE_SEC', 'DATABASE_POOL_MAX', 'DATABASE_STATEMENT_TIMEOUT_MS', 'DATABASE_LOCK_TIMEOUT_MS', 'DATABASE_IDLE_TX_TIMEOUT_MS', 'DATABASE_QUERY_TIMEOUT_MS', 'DATABASE_CONNECT_TIMEOUT_MS', 'STORAGE_LOCAL_ROOT', 'UPLOAD_MAX_IMAGE_MB', 'UPLOAD_MAX_DOCUMENT_MB', 'SESSION_TTL_HOURS', 'ADMIN_SESSION_TTL_HOURS', 'COOKIE_SECURE', 'SELLER_HOST', 'NEXT_PUBLIC_MAP_PROVIDER', 'NEXT_TELEMETRY_DISABLED', 'PORT', 'HOSTNAME']);
  for (const k of Object.keys(raw)) if (!known.has(k)) warn(k, 'unknown variable (typo?) — ignored by the application');

  // De-duplicate, keep the most severe per (name, message).
  const uniq = new Map<string, Finding>();
  for (const f of out) uniq.set(`${f.level}|${f.name}|${f.message}`, f);
  const list = [...uniq.values()];
  const required = ENV_POLICY.filter((p) => p.classification === 'REQUIRED' && (!p.requiredIn || p.requiredIn.includes('PRODUCTION'))).map((p) => p.name);
  for (const n of required) if (raw[n] && !list.some((f) => f.name === n && f.level === 'ERROR')) list.push({ level: 'OK', name: n, message: 'present' });
  return list.sort((a, b) => ['ERROR', 'WARN', 'OK'].indexOf(a.level) - ['ERROR', 'WARN', 'OK'].indexOf(b.level) || a.name.localeCompare(b.name));
}

function readEnvFile(path: string): { raw: Raw; text: string } {
  const text = readFileSync(path, 'utf8');
  return { raw: parseEnv(text) as Raw, text };
}

if (process.argv[1]?.endsWith('check-production-env.ts')) {
  try {
    const arg = (n: string) => {
      const i = process.argv.indexOf(`--${n}`);
      return i > 0 ? process.argv[i + 1] : undefined;
    };
    const file = arg('file');
    const src = file ? readEnvFile(file) : { raw: { ...process.env } as Raw, text: undefined };
    if (!file) for (const k of ['PATH', 'HOME', 'HOSTNAME', 'TERM', 'SHLVL', 'PWD', '_', 'NODE_VERSION', 'YARN_VERSION', 'NEXT_TELEMETRY_DISABLED', 'OLDPWD']) delete src.raw[k];
    const mig = arg('migrate-file') ? readEnvFile(arg('migrate-file')!).raw : undefined;
    const findings = checkProductionEnv(src.raw, { migrate: mig, fileText: src.text, domain: arg('domain') });
    if (process.argv.includes('--json')) console.log(JSON.stringify(findings));
    else for (const f of findings) console.log(`${f.level.padEnd(5)} ${f.name.padEnd(32)} ${f.message}`);
    const errors = findings.filter((f) => f.level === 'ERROR').length;
    console.log(`\nPRODUCTION CONFIG: ${errors ? 'INVALID' : 'VALID'} (${errors} error(s), ${findings.filter((f) => f.level === 'WARN').length} warning(s)) — no value was printed`);
    process.exit(errors ? 1 : 0);
  } catch (e) {
    console.error(`✗ cannot check: ${(e as Error).message.replace(/=.*/, '')}`);
    process.exit(2);
  }
}
