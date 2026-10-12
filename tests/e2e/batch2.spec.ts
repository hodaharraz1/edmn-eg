import { expect, test } from '@playwright/test';
import { adminLogin, q } from './helpers';

/**
 * Production Readiness Batch 2 — targeted deployment checks. READ-ONLY on staging: liveness/readiness, the
 * environment fingerprint, migration 0016 objects, the admin nonce CSP and the Ops health view. Nothing here
 * writes business or financial data (A-100016 is never touched).
 */
test.describe.configure({ mode: 'serial' });

test('B2-P: liveness and readiness — readiness reports status words only and is ready', async ({ request }) => {
  const live = await request.get('/api/health');
  expect(live.status()).toBe(200);
  const ready = await request.get('/api/ready');
  const body = await ready.json();
  expect(ready.status(), JSON.stringify(body)).toBe(200);
  expect(body.status).toBe('ready');
  expect(body.checks).toEqual({ database: 'ok', migrations: 'ok', environment: 'ok', configuration: 'ok', storage: 'ok' });
  // Public readiness leaks no counts, names or values.
  expect(JSON.stringify(body)).not.toMatch(/\d{2,}|postgres|secret/i);
});

test('B2-B: migration 0016 objects exist; append-only ledger health and key fingerprint protections are installed', async () => {
  const [m] = await q<{ n: number }>(`select count(*)::int n from drizzle.__drizzle_migrations`);
  expect(m.n).toBeGreaterThanOrEqual(17);
  const [t] = await q<{ n: number }>(`select count(*)::int n from information_schema.tables where table_name in ('job_leases','job_runs','ledger_health_checks','error_events','secret_fingerprints')`);
  expect(t.n).toBe(5);
  const [g] = await q<{ n: number }>(`select count(*)::int n from pg_trigger where tgname in ('ledger_health_checks_append_only','secret_fingerprints_no_update')`);
  expect(g.n).toBe(2);
  if (process.env.E2E_BASE_URL) {
    // The staging runtime recorded its encryption key fingerprint (a check value — never the key).
    const [k] = await q<{ environment: string; len: number }>(`select environment, length(kcv)::int len from secret_fingerprints where name like 'DATA_ENCRYPTION_KEY:%' limit 1`);
    expect(k).toMatchObject({ environment: 'STAGING', len: 32 });
  }
});

test('B2-N: the admin surface runs under a per-request nonce CSP; public pages keep their policy; request ids are sanitized', async ({ request }) => {
  const admin = await request.get('/admin/login');
  const csp = admin.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("'unsafe-inline' 'nonce");
  const again = (await request.get('/admin/login')).headers()['content-security-policy'] ?? '';
  expect(again.match(/nonce-([^']+)/)?.[1]).not.toBe(csp.match(/nonce-([^']+)/)?.[1]);
  const home = await request.get('/');
  expect(home.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(home.headers()['content-security-policy']).not.toContain('nonce-');
  expect(home.headers()['cross-origin-opener-policy']).toBe('same-origin');
  const bad = await request.get('/api/health', { headers: { 'x-request-id': '<script>x</script>' } });
  expect(bad.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
});

test('B2-P: the Ops deep-health page shows environment, fingerprint, jobs and provider truth (read-only)', async ({ browser }) => {
  const page = await adminLogin(browser);
  await page.goto('/admin/ops');
  const envCard = page.getByTestId('ops-environment');
  await expect(envCard).toContainText('STAGING');
  await expect(envCard).toContainText('OK');
  await expect(page.getByTestId('ops-jobs')).toContainText('ledger.health');
  await expect(page.getByTestId('ops-jobs')).toContainText('alerts.sweep');
  // Provider truth: never claims delivery or scanning that does not exist.
  await expect(page.getByText('MALWARE SCANNER ACTIVE: NO')).toBeVisible();
  await expect(page.getByText('EMAIL CODE READY / PROVIDER NOT CONFIGURED')).toBeVisible();
  // Hydrated admin page still works under the strict CSP (client components interactive).
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && /Content Security Policy|CSP/.test(m.text()) && errors.push(m.text()));
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});
