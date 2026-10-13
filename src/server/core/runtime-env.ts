import { NONPROD_DATA_KEY_KCVS, NONPROD_DB_ENDPOINT_HASHES, NONPROD_SECRET_KCVS, dataKeyCheckValue, databaseEndpointHash, secretCheckValue } from './known-nonprod';

/**
 * ENVIRONMENT MODEL (Batch 2).
 *
 *   LOCAL       a developer machine (`npm run dev`, local E2E build) — EDMN_ENVIRONMENT unset/development/local
 *   TEST        the automated vitest suite (NODE_ENV=test)                 — EDMN_ENVIRONMENT=test
 *   STAGING     the hosted pre-production deployment (Vercel, Neon)        — EDMN_ENVIRONMENT=staging
 *   PRODUCTION  the real marketplace                                        — EDMN_ENVIRONMENT=production
 *
 * The kind is always explicit for hosted builds (NODE_ENV=production): there is no silent fallback from a
 * missing variable to staging or production. Pure module: no database, no secrets values, safe in tests.
 */
export const RUNTIME_ENVIRONMENTS = ['LOCAL', 'TEST', 'STAGING', 'PRODUCTION'] as const;
export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

type Raw = Record<string, string | undefined>;

export function runtimeEnvironment(raw: Raw = process.env): RuntimeEnvironment {
  const k = (raw.EDMN_ENVIRONMENT ?? '').toLowerCase();
  if (k === 'production') return 'PRODUCTION';
  if (k === 'staging') return 'STAGING';
  if (k === 'test' || raw.NODE_ENV === 'test') return 'TEST';
  return 'LOCAL';
}

/* ═══════════════ Environment-variable policy ═══════════════ */

export type VarClass = 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN_IN_PRODUCTION' | 'STAGING_ONLY';
export interface VarPolicy {
  name: string;
  classification: VarClass;
  /** Secret values are never printed, logged or returned — only presence. */
  secret: boolean;
  /** Environments where the variable must be present (REQUIRED applies everywhere unless narrowed). */
  requiredIn?: RuntimeEnvironment[];
  purpose: string;
}

const HOSTED: RuntimeEnvironment[] = ['STAGING', 'PRODUCTION'];

export const ENV_POLICY: VarPolicy[] = [
  { name: 'DATABASE_URL', classification: 'REQUIRED', secret: true, purpose: 'Runtime database (pooled on Neon)' },
  { name: 'DATABASE_URL_UNPOOLED', classification: 'OPTIONAL', secret: true, purpose: 'Direct connection for migrations (advisory lock needs a session)' },
  { name: 'SESSION_SECRET', classification: 'REQUIRED', secret: true, purpose: 'Signs tokens / HMACs' },
  { name: 'DATA_ENCRYPTION_KEY', classification: 'REQUIRED', secret: true, purpose: 'AES-256-GCM primary key (national IDs, payout details, TOTP)' },
  { name: 'DATA_ENCRYPTION_KEY_ID', classification: 'OPTIONAL', secret: false, purpose: 'Key id of the primary key; when set, new ciphertexts are written as v2.<kid>' },
  { name: 'DATA_ENCRYPTION_KEYS_PREVIOUS', classification: 'OPTIONAL', secret: true, purpose: 'Decrypt-only previous keys "kid:base64,…" during a rotation' },
  { name: 'EDMN_ENVIRONMENT', classification: 'REQUIRED', secret: false, requiredIn: HOSTED, purpose: 'Deployment kind (never implied)' },
  { name: 'APP_URL', classification: 'REQUIRED', secret: false, requiredIn: HOSTED, purpose: 'Public https URL' },
  { name: 'CRON_SECRET', classification: 'REQUIRED', secret: true, requiredIn: HOSTED, purpose: 'Authenticates the scheduler (/api/cron/tick)' },
  { name: 'STORAGE_DRIVER', classification: 'REQUIRED', secret: false, requiredIn: HOSTED, purpose: 'local | database (a hosted build must be explicit)' },
  { name: 'MAIL_DRIVER', classification: 'REQUIRED', secret: false, requiredIn: ['PRODUCTION'], purpose: 'smtp in production' },
  { name: 'SMTP_HOST', classification: 'REQUIRED', secret: false, requiredIn: ['PRODUCTION'], purpose: 'Email provider host' },
  { name: 'SMTP_USER', classification: 'OPTIONAL', secret: true, purpose: 'Email provider user' },
  { name: 'SMTP_PASSWORD', classification: 'OPTIONAL', secret: true, purpose: 'Email provider password / API key' },
  // SMS is NOT required to boot: without it, the SMS-dependent flows (mobile verification → seller onboarding,
  // Protected Deals and their delivery OTP) are refused with a clear message, and no SMS is ever faked as sent.
  { name: 'SMS_DRIVER', classification: 'OPTIONAL', secret: false, purpose: 'http enables mobile verification + Protected Deal delivery OTP' },
  { name: 'SMS_HTTP_URL', classification: 'OPTIONAL', secret: false, purpose: 'SMS provider endpoint (required when SMS_DRIVER=http)' },
  { name: 'SMS_HTTP_TOKEN', classification: 'OPTIONAL', secret: true, purpose: 'SMS provider token' },
  { name: 'PAYMENT_WEBHOOK_SECRET', classification: 'OPTIONAL', secret: true, purpose: 'Provider webhook signature (required by the real-money gate, not by boot)' },
  { name: 'VAPID_PUBLIC_KEY', classification: 'OPTIONAL', secret: false, purpose: 'Web Push (reported NOT CONFIGURED when absent)' },
  { name: 'VAPID_PRIVATE_KEY', classification: 'OPTIONAL', secret: true, purpose: 'Web Push signing key' },
  { name: 'VAPID_SUBJECT', classification: 'OPTIONAL', secret: false, purpose: 'Web Push contact' },
  { name: 'ERROR_TRACKING_DSN', classification: 'OPTIONAL', secret: true, purpose: 'Provider-neutral error tracking endpoint (NOT CONFIGURED when absent)' },
  { name: 'MALWARE_SCANNER_URL', classification: 'OPTIONAL', secret: false, purpose: 'Malware scanner endpoint (MALWARE SCANNER ACTIVE: NO when absent)' },
  { name: 'ENFORCE_ADMIN_HOST', classification: 'OPTIONAL', secret: false, purpose: 'Admin console only on ADMIN_HOST (own origin); Seller Center stays on www/seller' },
  { name: 'ENFORCE_HOSTS', classification: 'OPTIONAL', secret: false, purpose: 'Seller and admin each on their own host' },
  { name: 'ADMIN_HOST', classification: 'OPTIONAL', secret: false, purpose: 'Admin console host (default admin.edmneg.com)' },
  { name: 'MAIL_FROM', classification: 'REQUIRED', secret: false, requiredIn: ['PRODUCTION'], purpose: 'Sender of every email (real domain, never example.com)' },
  { name: 'TRUSTED_PROXY', classification: 'OPTIONAL', secret: false, purpose: 'Self-hosted only: trust X-Real-IP / X-Forwarded-For from our own reverse proxy' },
  { name: 'ADMIN_IDLE_TIMEOUT_MINUTES', classification: 'OPTIONAL', secret: false, purpose: 'Staff session idle timeout (default 30, max 240)' },
  { name: 'MALWARE_SCAN_REQUIRED', classification: 'OPTIONAL', secret: false, purpose: 'Gate private files on a scan outside production (always on in production)' },
  { name: 'OUTBOX_ENCRYPT_SECRETS', classification: 'OPTIONAL', secret: false, purpose: 'Seal codes/links in the outbox outside production (always on in production)' },
  { name: 'ADMIN_APP_URL', classification: 'REQUIRED', secret: false, requiredIn: ['PRODUCTION'], purpose: 'Admin console origin (https://admin host)' },
  { name: 'SELLER_APP_URL', classification: 'OPTIONAL', secret: false, purpose: 'Seller Center URL (www/seller at launch)' },
  { name: 'ERROR_TRACKING_PROVIDER', classification: 'OPTIONAL', secret: false, purpose: 'sentry | webhook (detected from the DSN when absent)' },
  { name: 'ERROR_TRACKING_TOKEN', classification: 'OPTIONAL', secret: true, purpose: 'Bearer token for a generic webhook error tracker' },
  { name: 'EDMN_RELEASE', classification: 'OPTIONAL', secret: false, purpose: 'Release tag for error tracking (defaults to the Vercel git SHA)' },
  { name: 'EMAIL_WEBHOOK_SECRET', classification: 'OPTIONAL', secret: true, purpose: 'Signing secret of the email delivery webhook (DELIVERED/BOUNCED evidence)' },
  { name: 'MALWARE_SCANNER_TOKEN', classification: 'OPTIONAL', secret: true, purpose: 'Bearer token of the private scanner wrapper' },
  { name: 'MALWARE_SCANNER_TIMEOUT_MS', classification: 'OPTIONAL', secret: false, purpose: 'Scanner request timeout (default 30000; a timeout is a scan failure)' },
  { name: 'PUSH_ALLOW_ANY_ENDPOINT', classification: 'FORBIDDEN_IN_PRODUCTION', secret: false, purpose: 'Test tooling: accept non-standard push endpoints' },
  { name: 'STAGING_DEMO_PASSWORD', classification: 'STAGING_ONLY', secret: true, purpose: 'Staging demo accounts password' },
  { name: 'STAGING_ADMIN_PASSWORD', classification: 'STAGING_ONLY', secret: true, purpose: 'Staging demo admin password' },
  { name: 'STAGING_TOTP_SECRET', classification: 'STAGING_ONLY', secret: true, purpose: 'Staging demo admin TOTP seed' },
  { name: 'SEED_DEMO', classification: 'STAGING_ONLY', secret: false, purpose: 'Seeds demo data at staging build' },
  { name: 'E2E_DATABASE_URL', classification: 'FORBIDDEN_IN_PRODUCTION', secret: true, purpose: 'E2E database (test tooling only)' },
  { name: 'TEST_DATABASE_URL', classification: 'FORBIDDEN_IN_PRODUCTION', secret: true, purpose: 'Vitest database (test tooling only)' },
  { name: 'E2E_BASE_URL', classification: 'FORBIDDEN_IN_PRODUCTION', secret: false, purpose: 'E2E target (test tooling only)' },
];

/** Repository/test defaults that are public: never acceptable on a hosted environment. */
const PUBLIC_SECRET_VALUES = new Set([
  'test-session-secret-0123456789abcdef0123456789',
  Buffer.alloc(32, 7).toString('base64'),
]);
const looksPlaceholder = (v: string) => v.startsWith('replace-with') || PUBLIC_SECRET_VALUES.has(v);

export interface EnvironmentReport {
  environment: RuntimeEnvironment;
  /** Boot must refuse (fail closed). */
  errors: string[];
  /** Reported on readiness / ops health, never fatal. */
  warnings: string[];
  variables: { name: string; classification: VarClass; secret: boolean; present: boolean; requiredHere: boolean }[];
}

/**
 * Validates the environment against the policy. NEVER includes a value in its output.
 * New rules are fatal in PRODUCTION; in STAGING they are warnings so an existing deployment is never taken down
 * by a rule it predates (rules that already existed in `unsafeProductionConfig` stay fatal there).
 */
export function validateEnvironment(raw: Raw = process.env, kind: RuntimeEnvironment = runtimeEnvironment(raw)): EnvironmentReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (m: string) => (kind === 'PRODUCTION' ? errors : warnings).push(m);
  const present = (n: string) => typeof raw[n] === 'string' && raw[n] !== '';
  const variables = ENV_POLICY.map((p) => {
    const requiredHere = p.classification === 'REQUIRED' && (!p.requiredIn || p.requiredIn.includes(kind));
    return { name: p.name, classification: p.classification, secret: p.secret, present: present(p.name), requiredHere };
  });
  for (const v of variables) {
    if (v.requiredHere && !v.present) (['DATABASE_URL', 'SESSION_SECRET', 'DATA_ENCRYPTION_KEY'].includes(v.name) ? errors : kind === 'PRODUCTION' ? errors : warnings).push(`${v.name} is required in ${kind}`);
    if (kind === 'PRODUCTION' && v.present && (v.classification === 'FORBIDDEN_IN_PRODUCTION' || v.classification === 'STAGING_ONLY')) errors.push(`${v.name} must not be set in PRODUCTION`);
  }
  if (kind === 'STAGING' || kind === 'PRODUCTION') {
    for (const n of ['SESSION_SECRET', 'DATA_ENCRYPTION_KEY']) if (present(n) && looksPlaceholder(raw[n]!)) errors.push(`${n} is a public/placeholder value`);
    if (present('SESSION_SECRET') && raw.SESSION_SECRET === raw.DATA_ENCRYPTION_KEY) fail('SESSION_SECRET and DATA_ENCRYPTION_KEY must be different secrets');
    if (present('APP_URL') && !raw.APP_URL!.startsWith('https://')) fail('APP_URL must be https');
    // An ephemeral serverless filesystem would silently lose National ID scans and payment proofs.
    if (raw.VERCEL && (raw.STORAGE_DRIVER ?? 'local') === 'local') fail('STORAGE_DRIVER=local is ephemeral on Vercel (use database or an object store)');
    if (present('CRON_SECRET') && raw.CRON_SECRET!.length < 24) fail('CRON_SECRET is too short (≥ 24 chars)');
  }
  if (kind === 'PRODUCTION') {
    if (raw.MAIL_DRIVER !== 'smtp') errors.push('MAIL_DRIVER=smtp is required in PRODUCTION');
    if (!raw.MAIL_FROM || /example\.(com|org|net)|\.local\b/i.test(raw.MAIL_FROM)) errors.push('MAIL_FROM must be the real sender address in PRODUCTION');
    // The admin console must not share an origin with public pages (their CSP allows inline scripts).
    if (raw.ENFORCE_HOSTS !== 'true' && raw.ENFORCE_ADMIN_HOST !== 'true') errors.push('ENFORCE_ADMIN_HOST=true (admin on its own host) or ENFORCE_HOSTS=true is required in PRODUCTION');
    if (raw.SMS_DRIVER !== 'http') warnings.push('SMS not configured: mobile verification, seller onboarding and Protected Deals stay disabled');
    if (raw.SMS_DRIVER === 'http' && (!raw.SMS_HTTP_URL || !raw.SMS_HTTP_TOKEN)) errors.push('SMS_DRIVER=http needs SMS_HTTP_URL and SMS_HTTP_TOKEN');
    if (!raw.VERCEL && raw.TRUSTED_PROXY !== 'true') warnings.push('Self-hosted without TRUSTED_PROXY=true: client IPs are unknown (per-IP rate limits share one bucket)');
    if (raw.INLINE_WORKER !== 'true' && !raw.WORKER_DEDICATED) warnings.push('No dedicated worker declared (WORKER_DEDICATED) and INLINE_WORKER is off: jobs only run on the daily cron');
    errors.push(...productionIsolationErrors(raw));
  }
  if (kind !== 'PRODUCTION' && kind !== 'STAGING' && raw.NODE_ENV === 'production' && !raw.EDMN_ENVIRONMENT) errors.push('EDMN_ENVIRONMENT must be set for a production build');
  if (present('DATA_ENCRYPTION_KEYS_PREVIOUS') && !/^([a-z0-9_-]{1,16}:[A-Za-z0-9+/=]{20,})(,[a-z0-9_-]{1,16}:[A-Za-z0-9+/=]{20,})*$/i.test(raw.DATA_ENCRYPTION_KEYS_PREVIOUS!)) errors.push('DATA_ENCRYPTION_KEYS_PREVIOUS must be "kid:base64,kid:base64"');
  if (present('DATA_ENCRYPTION_KEY_ID') && !/^[a-z0-9_-]{1,16}$/i.test(raw.DATA_ENCRYPTION_KEY_ID!)) errors.push('DATA_ENCRYPTION_KEY_ID must be 1-16 chars [a-z0-9_-]');
  return { environment: kind, errors, warnings, variables };
}

const hostOf = (u: string | undefined) => {
  try {
    return u ? new URL(u).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};
const baseDomain = (h: string) => h.split('.').slice(-2).join('.');

/**
 * PRODUCTION ISOLATION (production infrastructure batch): refuses staging / test resources and secrets, and an
 * inconsistent host layout. Pure — only one-way fingerprints are compared (src/server/core/known-nonprod.ts).
 */
export interface NonProdDenylist {
  dataKeys: readonly string[];
  secrets: readonly string[];
  dbEndpoints: readonly string[];
}
const DENY: NonProdDenylist = { dataKeys: NONPROD_DATA_KEY_KCVS, secrets: NONPROD_SECRET_KCVS, dbEndpoints: NONPROD_DB_ENDPOINT_HASHES };

export function productionIsolationErrors(raw: Raw, deny: NonProdDenylist = DENY): string[] {
  const errors: string[] = [];
  const present = (n: string) => typeof raw[n] === 'string' && raw[n] !== '';
  // Secrets: never a known staging/test value, never shared between purposes, a deliberate key id.
  if (present('DATA_ENCRYPTION_KEY') && deny.dataKeys.includes(dataKeyCheckValue(raw.DATA_ENCRYPTION_KEY!))) errors.push('DATA_ENCRYPTION_KEY is a known staging/test key');
  for (const n of ['SESSION_SECRET', 'CRON_SECRET']) if (present(n) && deny.secrets.includes(secretCheckValue(n, raw[n]!))) errors.push(`${n} is a known staging/test secret`);
  if (!present('DATA_ENCRYPTION_KEY_ID') || raw.DATA_ENCRYPTION_KEY_ID === 'default') errors.push('DATA_ENCRYPTION_KEY_ID must be set to a production key id (not "default")');
  const secrets = ['SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'CRON_SECRET'].filter(present).map((n) => raw[n]);
  if (new Set(secrets).size !== secrets.length) errors.push('SESSION_SECRET, DATA_ENCRYPTION_KEY and CRON_SECRET must all be different secrets');
  // Database: never the staging endpoint, never a local / test / staging database.
  for (const n of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    if (!present(n)) continue;
    const url = raw[n]!;
    const h = databaseEndpointHash(url);
    if (h && deny.dbEndpoints.includes(h)) errors.push(`${n} points at the staging database`);
    if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url)) errors.push(`${n} points at a local database`);
    const dbName = url.match(/\/([^/?]+)(\?|$)/)?.[1] ?? '';
    if (/(^|[_-])(test|e2e|staging|demo)([_-]|$)/i.test(dbName)) errors.push(`${n} names a test/staging database`);
  }
  // Hosts: public site and admin console on different, consistent https origins.
  const app = hostOf(raw.APP_URL);
  const admin = hostOf(raw.ADMIN_APP_URL);
  const adminHost = (raw.ADMIN_HOST ?? '').toLowerCase();
  if (app && /(^|[.-])(staging|localhost)([.-]|$)/.test(app)) errors.push('APP_URL must be the production site, not a staging/local host');
  if (!adminHost) errors.push('ADMIN_HOST must be set explicitly in PRODUCTION');
  if (present('ADMIN_APP_URL') && !raw.ADMIN_APP_URL!.startsWith('https://')) errors.push('ADMIN_APP_URL must be https');
  if (admin && adminHost && admin !== adminHost) errors.push('ADMIN_APP_URL host must equal ADMIN_HOST');
  if (app && adminHost && app === adminHost) errors.push('ADMIN_HOST must differ from the public APP_URL host');
  // Email sender on the production domain (skipped while the site still runs on a platform preview domain).
  const from = raw.MAIL_FROM?.match(/<?([^<>\s]+@([^<>\s]+))>?\s*$/);
  if (raw.MAIL_FROM && !from) errors.push('MAIL_FROM must contain a sender address');
  if (from && app && !/\.vercel\.app$/.test(app) && baseDomain(from[2].toLowerCase()) !== baseDomain(app)) errors.push('MAIL_FROM must use the production domain');
  // Optional providers: when configured, configured safely.
  if (present('VAPID_PUBLIC_KEY') && !/^(mailto:[^@\s]+@[^@\s]+|https:\/\/)/.test(raw.VAPID_SUBJECT ?? '')) errors.push('VAPID_SUBJECT must be mailto:<official address> or an https URL');
  if (/example\.(com|org|net)|\.local\b/i.test(raw.VAPID_SUBJECT ?? '')) errors.push('VAPID_SUBJECT must be the real contact');
  for (const n of ['MALWARE_SCANNER_URL', 'ERROR_TRACKING_DSN']) if (present(n) && !raw[n]!.startsWith('https://')) errors.push(`${n} must be https in PRODUCTION`);
  if (present('MALWARE_SCANNER_URL') && !present('MALWARE_SCANNER_TOKEN')) errors.push('MALWARE_SCANNER_TOKEN is required with MALWARE_SCANNER_URL');
  if (present('EMAIL_WEBHOOK_SECRET') && raw.EMAIL_WEBHOOK_SECRET!.length < 24) errors.push('EMAIL_WEBHOOK_SECRET is too short');
  return errors;
}

/* ═══════════════ Readiness tiers (public website / controlled pilot / real money) ═══════════════ */

export type Tier = 'PUBLIC_WEBSITE' | 'CONTROLLED_PILOT' | 'REAL_MONEY';
export interface TierRequirement {
  tier: Tier;
  code: string;
  label: string;
  met: boolean;
}

/**
 * What each launch tier needs, from configuration + recorded provider evidence (never from configuration alone
 * where evidence exists). REAL_MONEY additionally requires the full go-live gate (financial controls) — reported
 * there; this list only covers infrastructure. Each tier includes the requirements of the tiers before it.
 */
export function readinessTiers(raw: Raw, providerStatus: Partial<Record<string, string>>): { tier: Tier; ready: boolean; requirements: TierRequirement[] }[] {
  const ok = (p: string) => providerStatus[p] === 'HEALTHY';
  const configured = (p: string) => !!providerStatus[p] && providerStatus[p] !== 'NOT_CONFIGURED';
  const req: TierRequirement[] = [
    { tier: 'PUBLIC_WEBSITE', code: 'CONFIG_POLICY', label: 'Environment policy has no errors', met: validateEnvironment(raw).errors.length === 0 },
    { tier: 'PUBLIC_WEBSITE', code: 'ADMIN_HOST', label: 'Admin console on its own host', met: raw.ENFORCE_ADMIN_HOST === 'true' || raw.ENFORCE_HOSTS === 'true' },
    { tier: 'PUBLIC_WEBSITE', code: 'SMTP', label: 'Transactional email configured', met: configured('SMTP') },
    { tier: 'PUBLIC_WEBSITE', code: 'SCHEDULER', label: 'Scheduler running (critical jobs current)', met: ok('SCHEDULER') },
    { tier: 'CONTROLLED_PILOT', code: 'SMTP_EVIDENCE', label: 'Email accepted by the provider (recorded)', met: ok('SMTP') },
    { tier: 'CONTROLLED_PILOT', code: 'MALWARE_SCANNER', label: 'Private malware scanner healthy (private files are unavailable without it)', met: ok('MALWARE_SCANNER') },
    { tier: 'CONTROLLED_PILOT', code: 'ERROR_TRACKING', label: 'External error tracking healthy', met: ok('ERROR_TRACKING') },
    { tier: 'REAL_MONEY', code: 'EMAIL_WEBHOOK', label: 'Email delivery webhook healthy (DELIVERED evidence)', met: ok('EMAIL_WEBHOOK') },
    { tier: 'REAL_MONEY', code: 'SMS', label: 'SMS provider configured', met: raw.SMS_DRIVER === 'http' },
    { tier: 'REAL_MONEY', code: 'PAYMENT_WEBHOOK', label: 'Payment provider signing secret configured', met: !!raw.PAYMENT_WEBHOOK_SECRET },
  ];
  const order: Tier[] = ['PUBLIC_WEBSITE', 'CONTROLLED_PILOT', 'REAL_MONEY'];
  return order.map((tier, i) => {
    const requirements = req.filter((r) => order.indexOf(r.tier) <= i);
    return { tier, ready: requirements.every((r) => r.met), requirements };
  });
}

/** SMS can really be delivered: an HTTP provider, or a non-production environment (log driver for testing). */
export function smsAvailable(raw: Record<string, string | undefined> = process.env): boolean {
  return raw.SMS_DRIVER === 'http' || runtimeEnvironment(raw) !== 'PRODUCTION';
}

/* ═══════════════ Database / storage fingerprint compatibility ═══════════════ */

export type DatabaseMarker = 'DEVELOPMENT' | 'TEST' | 'STAGING' | 'PRODUCTION' | null;

/**
 * Which database markers a runtime may use. PRODUCTION accepts only a PRODUCTION database (an unmarked or
 * staging/test database is refused). Nothing but PRODUCTION may use a PRODUCTION database. A local/test
 * runtime may never use a hosted (STAGING) database: no silent fallback to staging.
 */
export function databaseCompatible(runtime: RuntimeEnvironment, marker: DatabaseMarker): { ok: boolean; reason?: string } {
  if (runtime === 'PRODUCTION') return marker === 'PRODUCTION' ? { ok: true } : { ok: false, reason: `PRODUCTION runtime refuses a ${marker ?? 'UNMARKED'} database` };
  if (marker === 'PRODUCTION') return { ok: false, reason: `${runtime} runtime refuses a PRODUCTION database` };
  if (runtime === 'STAGING') return marker === 'DEVELOPMENT' || marker === 'TEST' ? { ok: false, reason: `STAGING runtime refuses a ${marker} database` } : { ok: true };
  if (marker === 'STAGING') return { ok: false, reason: `${runtime} runtime refuses a STAGING database` };
  return { ok: true };
}
