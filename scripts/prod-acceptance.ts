/**
 * PRODUCTION ACCEPTANCE SUITE — READ-ONLY. Creates no orders, payments, users or ledger entries.
 *
 *   node --import tsx scripts/prod-acceptance.ts [--db-only | --http-only] [--local] [--drill] [--json]
 *        [--expect-environment=PRODUCTION] [--expect-pricing=none | MARKETPLACE:<n>,PROTECTED_DEAL:<n>]
 *
 *   HTTP checks   customer host, admin host, admin-host enforcement, /api/health, /api/ready, scheduler endpoint
 *                 hidden, security headers, apex → www. `--local` targets 127.0.0.1:${EDMN_WEB_PORT:-3000} with the
 *                 real Host headers (before DNS points at this server); otherwise the public https URLs.
 *   DB checks     inside ONE `BEGIN TRANSACTION READ ONLY` (any write is refused by PostgreSQL itself):
 *                 environment marker, migrations = journal, storage objects, worker heartbeat + critical schedules,
 *                 provider statuses (evidence only), no demo / E2E accounts or variables, Real Money OFF, active
 *                 Fee Engine versions = expectation, ledger balanced, every financial invariant = 0 (projection
 *                 drift, duplicate events, stranded balances, withdrawal allocation mismatch / missing, source
 *                 attribution mismatch, …).
 *   `--drill`     restore-drill mode: DB checks only, without live-process checks (heartbeat, providers, env vars)
 *                 and without the Fee Engine expectation (the drill compares the manifest's pricing snapshot hash).
 *
 * Exit 0 = every check PASS (WARN allowed); 1 = at least one FAIL; 2 = could not run. Never prints secrets or
 * record values — only counts, codes and statuses. Nothing is ever reported PASS without evidence: an expectation
 * that was not provided is a FAIL, not a skip.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Verdict = 'PASS' | 'WARN' | 'FAIL';
export interface CheckResult {
  id: string;
  title: string;
  verdict: Verdict;
  detail: string;
}

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name: string) => process.argv.includes(`--${name}`);

/* ═══════════════ pure evaluators (unit-tested) ═══════════════ */

export function evalMarker(marker: string | null, expected = 'PRODUCTION'): CheckResult {
  const ok = marker === expected;
  return { id: 'DB_MARKER', title: 'Database environment marker', verdict: ok ? 'PASS' : 'FAIL', detail: `marker=${marker ?? 'UNMARKED'} expected=${expected}` };
}

export function evalMigrations(applied: number, journal: number): CheckResult {
  const ok = applied === journal && journal > 0;
  return { id: 'MIGRATIONS', title: 'Migrations applied = repository journal', verdict: ok ? 'PASS' : 'FAIL', detail: `applied=${applied} journal=${journal}` };
}

/** Accounts that only demo / E2E / test fixtures use. Production must have none. */
export const DEMO_EMAIL_SQL_PATTERNS = ['%.local', '%.test', '%@example.com', '%@example.org', '%@example.net', '%.invalid', '%@e2e.%'];
export function isDemoEmail(email: string): boolean {
  const e = email.toLowerCase();
  return /\.(local|test|invalid)$/.test(e) || /@example\.(com|org|net)$/.test(e) || /@e2e\./.test(e);
}

export const FORBIDDEN_RUNTIME_VARS = ['STAGING_DEMO_PASSWORD', 'STAGING_ADMIN_PASSWORD', 'STAGING_TOTP_SECRET', 'SEED_DEMO', 'E2E_DATABASE_URL', 'E2E_BASE_URL', 'TEST_DATABASE_URL', 'PUSH_ALLOW_ANY_ENDPOINT'];
export function evalForbiddenVars(raw: Record<string, string | undefined>): CheckResult {
  const found = FORBIDDEN_RUNTIME_VARS.filter((n) => raw[n] !== undefined && raw[n] !== '');
  return { id: 'NO_E2E_CREDENTIALS', title: 'No demo / E2E / staging credentials in the environment', verdict: found.length ? 'FAIL' : 'PASS', detail: found.length ? `present: ${found.join(', ')}` : 'none present' };
}

/** `none` = no PUBLISHED version may be active yet; otherwise MODEL:versionNo pairs. */
export function parsePricingExpectation(s: string | undefined): Record<string, number> | 'none' | null {
  if (!s) return null;
  if (s === 'none') return 'none';
  const out: Record<string, number> = {};
  for (const part of s.split(',')) {
    const m = part.trim().match(/^([A-Z_]+):(\d+)$/);
    if (!m) return null;
    out[m[1]] = Number(m[2]);
  }
  return out;
}
export function evalPricing(active: Record<string, number>, expected: Record<string, number> | 'none' | null): CheckResult {
  const actual = Object.entries(active).map(([m, v]) => `${m}:${v}`).sort().join(',') || 'none';
  if (expected === null) return { id: 'FEE_ENGINE_VERSION', title: 'Active Fee Engine versions = expected', verdict: 'FAIL', detail: `no expectation given (--expect-pricing / EDMN_EXPECT_PRICING); actual=${actual}` };
  const want = expected === 'none' ? 'none' : Object.entries(expected).map(([m, v]) => `${m}:${v}`).sort().join(',');
  return { id: 'FEE_ENGINE_VERSION', title: 'Active Fee Engine versions = expected', verdict: actual === want ? 'PASS' : 'FAIL', detail: `actual=${actual} expected=${want}` };
}

export function evalHeartbeat(ageSec: number | null, maxAge = 180): CheckResult {
  const ok = ageSec !== null && ageSec <= maxAge;
  return { id: 'WORKER_HEARTBEAT', title: 'Worker heartbeat (outbound.flush)', verdict: ok ? 'PASS' : 'FAIL', detail: ageSec === null ? 'no successful run recorded' : `last success ${ageSec}s ago (max ${maxAge}s)` };
}

export function evalProviders(rows: { provider: string; status: string }[]): CheckResult {
  const failed = rows.filter((r) => r.status === 'FAILED');
  const degraded = rows.filter((r) => r.status === 'DEGRADED');
  const verdict: Verdict = failed.length ? 'FAIL' : degraded.length ? 'WARN' : 'PASS';
  return { id: 'PROVIDERS', title: 'Provider statuses (evidence-based; NOT_CONFIGURED/UNVERIFIED are reported, never upgraded)', verdict, detail: rows.map((r) => `${r.provider}=${r.status}`).join(' ') };
}

export function evalInvariants(totals: { debits: number; credits: number; difference: number }, checks: { code: string; count: number }[]): CheckResult[] {
  const out: CheckResult[] = [];
  out.push({ id: 'LEDGER_BALANCED', title: 'Ledger balanced (Σ debits = Σ credits)', verdict: totals.difference === 0 && totals.debits === totals.credits ? 'PASS' : 'FAIL', detail: `debits=${totals.debits} credits=${totals.credits} difference=${totals.difference}` });
  const named: [string, string[]][] = [
    ['DRIFT', ['PROJECTION_DRIFT', 'RESERVATION_DRIFT']],
    ['DUPLICATE', ['DUPLICATE_BUSINESS_EVENT']],
    ['STRANDED', ['STRANDED_BALANCE']],
    ['ALLOCATION_MISMATCH', ['WITHDRAWAL_ALLOCATION_SUM', 'WITHDRAWAL_ALLOCATION_MISSING']],
    ['SOURCE_MISMATCH', ['DEAL_PAYABLE_ATTRIBUTION', 'DEAL_RESERVED_ATTRIBUTION']],
  ];
  const byCode = new Map(checks.map((c) => [c.code, c.count]));
  for (const [id, codes] of named) {
    const missing = codes.filter((c) => !byCode.has(c));
    const n = codes.reduce((s, c) => s + (byCode.get(c) ?? 0), 0);
    out.push({ id: `INV_${id}`, title: `${id.replace('_', ' ').toLowerCase()} = 0`, verdict: missing.length ? 'FAIL' : n === 0 ? 'PASS' : 'FAIL', detail: missing.length ? `invariant not evaluated: ${missing.join(', ')}` : `${codes.join('+')}=${n}` });
  }
  const failing = checks.filter((c) => c.count > 0);
  out.push({ id: 'INV_ALL', title: `All ${checks.length} financial invariants = 0`, verdict: failing.length ? 'FAIL' : 'PASS', detail: failing.length ? failing.map((c) => `${c.code}=${c.count}`).join(' ') : 'all zero' });
  return out;
}

/* ═══════════════ HTTP ═══════════════ */

interface Resp {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}
/** One request, no redirect following. In --local mode the Host header is set explicitly (pre-DNS checks). */
function request(url: string, host?: string): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'GET', headers: { ...(host ? { host, 'x-forwarded-proto': 'https' } : {}), 'user-agent': 'edmn-acceptance/1' }, timeout: 15_000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body.length < 200_000 ? (body += c) : undefined));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export async function httpChecks(opts: { local: boolean; appUrl: string; adminHost: string; port: string }): Promise<CheckResult[]> {
  const www = new URL(opts.appUrl).host;
  const base = (host: string) => (opts.local ? `http://127.0.0.1:${opts.port}` : `https://${host}`);
  const get = (host: string, p: string) => request(base(host) + p, opts.local ? host : undefined);
  const out: CheckResult[] = [];
  const run = async (id: string, title: string, fn: () => Promise<[boolean, string] | [Verdict, string]>) => {
    try {
      const [ok, detail] = await fn();
      out.push({ id, title, verdict: typeof ok === 'boolean' ? (ok ? 'PASS' : 'FAIL') : ok, detail });
    } catch (e) {
      out.push({ id, title, verdict: 'FAIL', detail: `request failed: ${(e as Error).message}` });
    }
  };
  await run('HTTP_CUSTOMER', `Customer host ${www} serves the storefront`, async () => {
    const r = await get(www, '/');
    return [r.status === 200 && /<html[^>]*lang="ar"/i.test(r.body), `GET / → ${r.status}`];
  });
  await run('HTTP_ADMIN_HOST', `Admin host ${opts.adminHost} serves the console (login)`, async () => {
    const r = await get(opts.adminHost, '/');
    const loc = String(r.headers.location ?? '');
    const ok = r.status === 200 || ([302, 303, 307, 308].includes(r.status) && (!/^https?:/.test(loc) || new URL(loc).host === opts.adminHost));
    return [ok, `GET / → ${r.status}${loc ? ` → ${loc.replace(/\?.*$/, '')}` : ''}`];
  });
  await run('HTTP_ADMIN_ENFORCED', `/admin on ${www} redirects to https://${opts.adminHost}`, async () => {
    const r = await get(www, '/admin');
    const loc = String(r.headers.location ?? '');
    let ok = false;
    try {
      const u = new URL(loc);
      ok = [307, 308].includes(r.status) && u.host === opts.adminHost && u.protocol === 'https:';
    } catch {
      ok = false;
    }
    return [ok, `GET /admin → ${r.status} → ${loc || '(no location)'}`];
  });
  await run('HTTP_HEALTH', '/api/health', async () => {
    const r = await get(www, '/api/health');
    return [r.status === 200 && /"status":"ok"/.test(r.body), `→ ${r.status}`];
  });
  await run('HTTP_READY', '/api/ready', async () => {
    const r = await get(www, '/api/ready');
    const failing = (() => {
      try {
        return Object.entries((JSON.parse(r.body) as { checks: Record<string, unknown> }).checks ?? {}).filter(([, v]) => v !== 'ok' && v !== true).map(([k]) => k);
      } catch {
        return [];
      }
    })();
    return [r.status === 200 && /"status":"ready"/.test(r.body), `→ ${r.status}${failing.length ? ` not ok: ${failing.join(',')}` : ''}`];
  });
  await run('HTTP_CRON_HIDDEN', 'Scheduler endpoint is 404 without the secret', async () => {
    const r = await get(www, '/api/cron/tick');
    return [r.status === 404, `→ ${r.status}`];
  });
  await run('HTTP_SECURITY_HEADERS', 'Security headers present on the storefront', async () => {
    const r = await get(www, '/');
    const need = ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options'];
    const missing = need.filter((h) => !r.headers[h]);
    return [missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'present'];
  });
  if (!opts.local) {
    await run('HTTP_APEX', 'Apex redirects to www (answered by the proxy, no HSTS includeSubDomains from the apex)', async () => {
      const apex = www.replace(/^www\./, '');
      const r = await request(`https://${apex}/`);
      const hsts = String(r.headers['strict-transport-security'] ?? '');
      return [[301, 308].includes(r.status) && String(r.headers.location ?? '').startsWith(`https://${www}`) && !/includesubdomains/i.test(hsts), `→ ${r.status}${hsts ? ` HSTS: ${hsts}` : ''}`];
    });
  }
  return out;
}

/* ═══════════════ DB (one READ ONLY transaction) ═══════════════ */

export async function dbChecks(opts: { url: string; expectEnvironment: string; expectPricing: Record<string, number> | 'none' | null; drill: boolean; raw: Record<string, string | undefined> }): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const client = new pg.Client({ connectionString: opts.url, connectionTimeoutMillis: 10_000, statement_timeout: 120_000 });
  await client.connect();
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    const ro = await client.query<{ v: string }>("select current_setting('transaction_read_only') v");
    out.push({ id: 'READ_ONLY', title: 'Suite runs in a READ ONLY transaction', verdict: ro.rows[0].v === 'on' ? 'PASS' : 'FAIL', detail: `transaction_read_only=${ro.rows[0].v}` });
    const q = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => (await client.query<T>(text, params)).rows;
    // A query allowed to fail (fresh / unmarked database) must not abort the whole transaction: use a savepoint.
    const qOr = async <T extends Record<string, unknown>>(text: string, fallback: T[]) => {
      await client.query('savepoint opt');
      try {
        const rows = await q<T>(text);
        await client.query('release savepoint opt');
        return rows;
      } catch {
        await client.query('rollback to savepoint opt');
        return fallback;
      }
    };

    const marker = await qOr<{ e: string | null }>('select (select environment from deployment_environment where id) e', [{ e: null }]);
    out.push(evalMarker(marker[0]?.e ?? null, opts.expectEnvironment));

    const journal = (JSON.parse(readFileSync(path.resolve('drizzle/meta/_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;
    const applied = await qOr<{ n: number }>('select count(*)::int n from drizzle.__drizzle_migrations', [{ n: 0 }]);
    out.push(evalMigrations(applied[0].n, journal));

    const orphanFiles = await q<{ n: number; total: number }>(`select count(*) filter (where not exists (select 1 from stored_objects o where o.key = f.storage_key))::int n, count(*)::int total from files f where f.deleted_at is null`);
    const driver = opts.raw.STORAGE_DRIVER ?? 'local';
    out.push(
      driver === 'database'
        ? { id: 'STORAGE', title: 'Every live file has its stored object (STORAGE_DRIVER=database)', verdict: orphanFiles[0].n === 0 ? 'PASS' : 'FAIL', detail: `files=${orphanFiles[0].total} missing objects=${orphanFiles[0].n}` }
        : { id: 'STORAGE', title: 'Storage driver', verdict: opts.drill ? 'PASS' : 'WARN', detail: `driver=${driver}: file bytes are outside the database — verify the volume and its separate backup` },
    );

    const demo = await q<{ n: number }>(`select count(*)::int n from users where ${DEMO_EMAIL_SQL_PATTERNS.map((_, i) => `lower(email) like $${i + 1}`).join(' or ')}`, DEMO_EMAIL_SQL_PATTERNS);
    out.push({ id: 'NO_DEMO_ACCOUNTS', title: 'No demo / E2E / test accounts', verdict: demo[0].n === 0 ? 'PASS' : 'FAIL', detail: `matching accounts=${demo[0].n}` });

    const rm = await q<{ v: unknown }>(`select value v from system_settings where key = 'payments.realMoneyEnabled'`);
    const realMoney = rm[0]?.v === true || rm[0]?.v === 'true';
    out.push({ id: 'REAL_MONEY_OFF', title: 'Real Money OFF', verdict: realMoney ? 'FAIL' : 'PASS', detail: `payments.realMoneyEnabled=${rm.length ? String(rm[0].v) : 'unset (default false)'}` });

    // (A restore drill proves pricing integrity by the manifest's snapshot hash instead of an expectation.)
    if (!opts.drill) {
      const pricing = await q<{ model: string; version_no: number }>(`select distinct on (model) model, version_no from pricing_versions where status = 'PUBLISHED' and effective_from <= now() order by model, effective_from desc`);
      out.push(evalPricing(Object.fromEntries(pricing.map((p) => [p.model, p.version_no])), opts.expectPricing));
    }

    // Financial invariants: the application's own definitions, executed on this read-only connection.
    const { financialInvariants } = await import('../src/server/modules/finance/controls');
    const schema = await import('../src/server/db/schema');
    const rdb = drizzle(client, { schema, casing: 'snake_case' });
    const inv = await financialInvariants(rdb as never);
    out.push(...evalInvariants(inv.totals, inv.checks));

    if (!opts.drill) {
      const hb = await q<{ age: number | null }>(`select extract(epoch from now() - last_succeeded_at)::int age from job_leases where job_name = 'outbound.flush'`);
      out.push(evalHeartbeat(hb[0]?.age ?? null, Number(opts.raw.HEARTBEAT_MAX_AGE_SEC ?? 180)));
      const sched = await q<{ job_name: string; current: boolean; failures: number }>(`select job_name, coalesce(last_succeeded_at > now() - make_interval(secs => greatest(every_seconds * 3, 600)), false) current, consecutive_failures failures from job_leases where job_name in ('ledger.health', 'outbound.flush', 'alerts.sweep') order by job_name`);
      const bad = ['alerts.sweep', 'ledger.health', 'outbound.flush'].filter((j) => !sched.find((s) => s.job_name === j && s.current && s.failures === 0));
      out.push({ id: 'CRITICAL_SCHEDULES', title: 'Critical schedules current (ledger.health, outbound.flush, alerts.sweep)', verdict: bad.length ? 'FAIL' : 'PASS', detail: bad.length ? `not current: ${bad.join(', ')}` : 'all current' });

      const { deriveStatus, providerConfigured, PROVIDERS } = await import('../src/server/ops/provider-health');
      const rows = await q<{ provider: string; last_success_at: Date | null; last_failure_at: Date | null; consecutive_failures: number }>('select provider, last_success_at, last_failure_at, consecutive_failures from provider_health');
      const configured = providerConfigured(opts.raw);
      out.push(
        evalProviders(
          PROVIDERS.filter((p) => p !== 'SCHEDULER').map((p) => {
            const r = rows.find((x) => x.provider === p);
            return { provider: p, status: deriveStatus(p, configured[p], r ? { lastSuccessAt: r.last_success_at, lastFailureAt: r.last_failure_at, consecutiveFailures: r.consecutive_failures } : null) };
          }),
        ),
      );
      out.push(evalForbiddenVars(opts.raw));
    }
    await client.query('rollback');
  } finally {
    await client.end().catch(() => {});
  }
  return out;
}

/* ═══════════════ main ═══════════════ */

export function summarize(results: CheckResult[]): { overall: Verdict; pass: number; warn: number; fail: number } {
  const fail = results.filter((r) => r.verdict === 'FAIL').length;
  const warn = results.filter((r) => r.verdict === 'WARN').length;
  return { overall: fail ? 'FAIL' : warn ? 'WARN' : 'PASS', pass: results.length - fail - warn, warn, fail };
}

async function main() {
  const raw = process.env;
  const results: CheckResult[] = [];
  if (!flag('db-only')) {
    results.push(
      ...(await httpChecks({ local: flag('local'), appUrl: raw.APP_URL ?? 'https://www.edmneg.com', adminHost: (raw.ADMIN_HOST ?? 'admin.edmneg.com').toLowerCase(), port: raw.EDMN_WEB_PORT ?? '3000' })),
    );
  }
  if (!flag('http-only')) {
    if (!raw.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    results.push(
      ...(await dbChecks({
        url: raw.DATABASE_URL,
        expectEnvironment: (arg('expect-environment') ?? 'PRODUCTION').toUpperCase(),
        expectPricing: parsePricingExpectation(arg('expect-pricing') ?? raw.EDMN_EXPECT_PRICING),
        drill: flag('drill'),
        raw,
      })),
    );
  }
  const s = summarize(results);
  if (flag('json')) console.log(JSON.stringify({ ...s, results }));
  else {
    for (const r of results) console.log(`${r.verdict.padEnd(4)}  ${r.id.padEnd(22)} ${r.title} — ${r.detail}`);
    console.log(`\nACCEPTANCE: ${s.overall}  (pass ${s.pass}, warn ${s.warn}, fail ${s.fail})`);
  }
  process.exit(s.fail ? 1 : 0);
}

if (process.argv[1]?.endsWith('prod-acceptance.ts')) {
  main().catch((e) => {
    console.error(`✗ acceptance could not run: ${(e as Error).message}`);
    process.exit(2);
  });
}
