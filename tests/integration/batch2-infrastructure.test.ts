import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Client, Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminActor, customerActor } from '@/server/auth/actors';
import { adminIdleTimeoutMs, createSession, resolveSession } from '@/server/auth/service';
import { decrypt, encrypt, keyCheckValue, needsReencryption } from '@/server/core/crypto';
import { captureError, errorFingerprint } from '@/server/core/error-tracking';
import { databaseCompatible, runtimeEnvironment, validateEnvironment } from '@/server/core/runtime-env';
import { closeDb, db, getPool } from '@/server/db/client';
import { verifyRuntimeFingerprint } from '@/server/db/fingerprint';
import { destructiveStatements, MigrationLockTimeout, MIGRATION_LOCK_KEY, preflight, runMigrations } from '@/server/db/migrations';
import { errorEvents, files, jobLeases, jobRuns, journalEntries, ledgerHealthChecks, outboundMessages, sessions, systemSettings } from '@/server/db/schema';
import { acquireLease, markAbandonedRuns, runScheduled, scheduleHealth } from '@/server/jobs/scheduler';
import { assertNotPaused, goLiveGate, setKillSwitch } from '@/server/modules/finance/controls';
import { CRITICAL_INVARIANTS, runLedgerHealthCheck } from '@/server/modules/finance/ledger-health';
import { classifyReconciliation } from '@/server/modules/finance/reconciliation';
import { backoffMs, flushOutbound, protectOutboxRow, recordDeliveryEvent, REDACTED_BODY, requeueDeadLetter, SEALED_BODY } from '@/server/modules/notifications/outbox';
import { setProviderOverride, type OutboundProvider } from '@/server/modules/notifications/providers';
import { readiness } from '@/server/ops/health';
import { assertPilotAllowed } from '@/server/ops/pilot';
import { RETENTION_POLICY } from '@/server/ops/retention';
import { readPrivateFile } from '@/server/storage/access';
import { initialScanStatus, scanPendingFiles, servable, setScannerForTests, storageClass } from '@/server/storage/scanning';
import { storeUpload } from '@/server/storage/uploads';
import { makeAdmin, makeCustomer, pdf } from '../helpers/factory';

const TEST_URL = () => process.env.DATABASE_URL!;
async function setSetting(key: string, value: unknown) {
  await db.insert(systemSettings).values({ key, value: value as object }).onConflictDoUpdate({ target: systemSettings.key, set: { value: value as object } });
}
async function clearMarker() {
  await db.execute(sql`delete from deployment_environment`);
}

afterEach(() => {
  setProviderOverride(null);
  setScannerForTests(undefined);
});

/* ═══════════════ A. Environments & fingerprint ═══════════════ */

describe('B2-A environment model and policy', () => {
  it('A1: the runtime kind is explicit and never falls back to staging', () => {
    expect(runtimeEnvironment({ EDMN_ENVIRONMENT: 'production' })).toBe('PRODUCTION');
    expect(runtimeEnvironment({ EDMN_ENVIRONMENT: 'staging' })).toBe('STAGING');
    expect(runtimeEnvironment({ NODE_ENV: 'test' })).toBe('TEST');
    expect(runtimeEnvironment({ NODE_ENV: 'production' })).toBe('LOCAL');
    expect(runtimeEnvironment({})).toBe('LOCAL');
  });

  it('A2: production refuses staging-only / test variables, public secrets and log drivers (names only, never values)', () => {
    const secret = 'S3cr3t-value-that-must-never-be-printed-xx';
    const r = validateEnvironment({
      EDMN_ENVIRONMENT: 'production', NODE_ENV: 'production', DATABASE_URL: 'postgres://x', SESSION_SECRET: secret, DATA_ENCRYPTION_KEY: secret,
      APP_URL: 'http://x', STAGING_DEMO_PASSWORD: secret, SEED_DEMO: 'true', E2E_DATABASE_URL: 'postgres://e2e', MAIL_DRIVER: 'log', SMS_DRIVER: 'log', VERCEL: '1',
    });
    const all = r.errors.join('\n');
    for (const want of ['STAGING_DEMO_PASSWORD', 'SEED_DEMO', 'E2E_DATABASE_URL', 'MAIL_DRIVER=smtp', 'SMS_DRIVER=http', 'CRON_SECRET', 'must be different', 'APP_URL must be https', 'STORAGE_DRIVER=local is ephemeral']) expect(all).toContain(want);
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(r.variables.find((v) => v.name === 'SESSION_SECRET')).toMatchObject({ secret: true, present: true });
  });

  it('A3: staging keeps running on rules it predates (warnings), but a public/placeholder secret is fatal everywhere hosted', () => {
    const ok = validateEnvironment({ EDMN_ENVIRONMENT: 'staging', DATABASE_URL: 'p', SESSION_SECRET: 'a'.repeat(44), DATA_ENCRYPTION_KEY: 'b'.repeat(44), APP_URL: 'https://s' });
    expect(ok.errors).toEqual([]);
    expect(ok.warnings.join()).toContain('CRON_SECRET');
    const bad = validateEnvironment({ EDMN_ENVIRONMENT: 'staging', DATABASE_URL: 'p', SESSION_SECRET: 'replace-with-openssl-rand-base64-32', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
    expect(bad.errors.join()).toMatch(/SESSION_SECRET is a public\/placeholder value/);
    expect(bad.errors.join()).toMatch(/DATA_ENCRYPTION_KEY is a public\/placeholder value/);
  });

  it('A4: database marker compatibility matrix (production only on PRODUCTION; nothing else on PRODUCTION; local never on STAGING)', () => {
    expect(databaseCompatible('PRODUCTION', 'PRODUCTION').ok).toBe(true);
    for (const m of [null, 'STAGING', 'TEST', 'DEVELOPMENT'] as const) expect(databaseCompatible('PRODUCTION', m).ok).toBe(false);
    for (const r of ['STAGING', 'LOCAL', 'TEST'] as const) expect(databaseCompatible(r, 'PRODUCTION').ok).toBe(false);
    expect(databaseCompatible('STAGING', 'STAGING').ok).toBe(true);
    expect(databaseCompatible('STAGING', 'DEVELOPMENT').ok).toBe(false);
    expect(databaseCompatible('LOCAL', 'STAGING').ok).toBe(false);
    expect(databaseCompatible('TEST', null).ok).toBe(true);
  });

  it('A5: runtime fingerprint — database mismatch, storage namespace mismatch and an in-place key change are violations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'edmn-fp-'));
    try {
      await clearMarker();
      const base = { ...process.env, STORAGE_DRIVER: 'local', STORAGE_LOCAL_ROOT: root };
      // Unmarked DB, TEST runtime: OK; local tooling never claims the storage root.
      const ok = await verifyRuntimeFingerprint(db, { ...base, NODE_ENV: 'test', EDMN_ENVIRONMENT: '' });
      expect(ok).toMatchObject({ status: 'OK', storage: 'local:UNCLAIMED' });
      await expect(readFile(path.join(root, '.edmn-environment'), 'utf8')).rejects.toThrow();
      // A hosted runtime claims it; afterwards a TEST runtime on that root is refused.
      expect((await verifyRuntimeFingerprint(db, { ...base, EDMN_ENVIRONMENT: 'staging' })).status).toBe('OK');
      expect((await readFile(path.join(root, '.edmn-environment'), 'utf8')).trim()).toBe('STAGING');
      const st = await verifyRuntimeFingerprint(db, { ...base, NODE_ENV: 'test', EDMN_ENVIRONMENT: '' });
      expect(st.status).toBe('VIOLATION');
      expect(st.reasons.join()).toMatch(/storage root is marked STAGING, runtime is TEST/);
      await db.execute(sql`delete from secret_fingerprints`);
      // A DB marked STAGING is refused by a LOCAL/TEST runtime.
      await db.execute(sql`insert into deployment_environment (id, environment) values (true, 'STAGING')`);
      const lc = await verifyRuntimeFingerprint(db, { ...base, NODE_ENV: 'test' });
      expect(lc.status).toBe('VIOLATION');
      expect(lc.reasons.join()).toMatch(/refuses a STAGING database/);
      // STAGING runtime on a STAGING DB with its own storage root: the key check value is recorded, then must match.
      const root2 = await mkdtemp(path.join(os.tmpdir(), 'edmn-fp2-'));
      const s1 = await verifyRuntimeFingerprint(db, { ...base, STORAGE_LOCAL_ROOT: root2, EDMN_ENVIRONMENT: 'staging' });
      expect(s1).toMatchObject({ status: 'OK', key: 'MATCH' });
      await db.execute(sql`delete from secret_fingerprints`);
      await db.execute(sql`insert into secret_fingerprints (name, kcv, environment) values ('DATA_ENCRYPTION_KEY:default', 'deadbeef', 'STAGING')`);
      const s2 = await verifyRuntimeFingerprint(db, { ...base, STORAGE_LOCAL_ROOT: root2, EDMN_ENVIRONMENT: 'staging' });
      expect(s2).toMatchObject({ status: 'VIOLATION', key: 'MISMATCH' });
      // The recorded fingerprint is never edited in place.
      await expect(db.execute(sql`update secret_fingerprints set kcv = 'x'`)).rejects.toThrow();
      await rm(root2, { recursive: true, force: true });
      expect(keyCheckValue()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      await db.execute(sql`delete from secret_fingerprints`);
      await clearMarker();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A6: a fingerprint violation blocks money movements but the check itself writes nothing financial', async () => {
    const before = (await db.select({ n: sql<number>`count(*)::int` }).from(journalEntries))[0].n;
    const { ensureFingerprint, resetFingerprintForTests } = await import('@/server/db/fingerprint');
    resetFingerprintForTests();
    await db.execute(sql`insert into deployment_environment (id, environment) values (true, 'STAGING')`);
    try {
      expect((await ensureFingerprint()).status).toBe('VIOLATION');
      await expect(assertNotPaused(db, 'killswitch.withdrawals')).rejects.toThrow(/إعدادات البيئة/);
      expect((await readiness()).checks.environment).toBe('error');
    } finally {
      await clearMarker();
      resetFingerprintForTests();
    }
    expect((await ensureFingerprint()).status).toBe('OK');
    await expect(assertNotPaused(db, 'killswitch.withdrawals')).resolves.toBeUndefined();
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(journalEntries))[0].n).toBe(before);
  });
});

/* ═══════════════ B. Database safety ═══════════════ */

describe('B2-B database safety', () => {
  it('B1: migration preflight flags destructive statements; additive ones (incl. trigger bodies) pass', () => {
    expect(destructiveStatements('ALTER TABLE "x" ADD COLUMN "y" text;--> statement-breakpoint\nCREATE TABLE "z" ("id" uuid);')).toEqual([]);
    expect(destructiveStatements(`CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$ BEGIN IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'x'; END IF; END; $$ LANGUAGE plpgsql;--> statement-breakpoint\nCREATE TRIGGER t BEFORE TRUNCATE ON a FOR EACH STATEMENT EXECUTE FUNCTION f();`)).toEqual([]);
    expect(destructiveStatements('DROP TABLE "orders";')).toHaveLength(1);
    expect(destructiveStatements('ALTER TABLE "journal_lines" DROP COLUMN "debit";')).toHaveLength(1);
    expect(destructiveStatements('TRUNCATE journal_entries;')).toHaveLength(1);
    expect(destructiveStatements('DELETE FROM payments;')).toHaveLength(1);
    expect(destructiveStatements('ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;')).toHaveLength(1);
    expect(destructiveStatements('ALTER TABLE "a" RENAME COLUMN "b" TO "c";')).toHaveLength(1);
    expect(destructiveStatements('-- edmn:allow-destructive: contract step after backfill (reviewed)\nALTER TABLE "a" DROP COLUMN "old";')).toEqual([]);
  });

  it('B2: migration lock — a concurrent migrator waits, then fails without touching the schema; sequential runs are no-ops', async () => {
    const holder = new Client({ connectionString: TEST_URL() });
    await holder.connect();
    try {
      await holder.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      const t = Date.now();
      await expect(runMigrations({ lockTimeoutMs: 1200 })).rejects.toBeInstanceOf(MigrationLockTimeout);
      expect(Date.now() - t).toBeGreaterThanOrEqual(1000);
      await holder.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      const [a, b] = await Promise.all([runMigrations({ lockTimeoutMs: 20_000 }), runMigrations({ lockTimeoutMs: 20_000 })]);
      expect(a.applied).toEqual([]);
      expect(b.applied).toEqual([]);
    } finally {
      await holder.end();
      await clearMarker();
    }
  });

  it('B3: preflight refuses a database whose marker does not match the deployment, before any DDL', async () => {
    await db.execute(sql`insert into deployment_environment (id, environment) values (true, 'STAGING')`);
    try {
      const pf = await preflight();
      expect(pf.problems.join()).toMatch(/TEST runtime refuses a STAGING database/);
      await expect(runMigrations({ lockTimeoutMs: 5000 })).rejects.toThrow(/preflight refused/);
    } finally {
      await clearMarker();
    }
  });

  it('B4: a statement timeout aborts the whole transaction — nothing partial is committed', async () => {
    const prev = process.env.DATABASE_STATEMENT_TIMEOUT_MS;
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = '300';
    const key = `b2-timeout-${randomUUID()}`;
    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`insert into rate_limits (key, window_start, count) values (${key}, now(), 1)`);
          await tx.execute(sql`select pg_sleep(2)`);
        }),
      ).rejects.toThrow();
    } finally {
      if (prev === undefined) delete process.env.DATABASE_STATEMENT_TIMEOUT_MS;
      else process.env.DATABASE_STATEMENT_TIMEOUT_MS = prev;
    }
    expect((await db.execute(sql`select 1 from rate_limits where key = ${key}`)).rows).toHaveLength(0);
  });

  it('B5: a lock wait beyond lock_timeout fails fast instead of hanging a money path', async () => {
    const key = `b2-lock-${randomUUID()}`;
    await db.execute(sql`insert into rate_limits (key, window_start, count) values (${key}, '2020-01-01', 1)`);
    const other = new Client({ connectionString: TEST_URL() });
    await other.connect();
    const prev = process.env.DATABASE_LOCK_TIMEOUT_MS;
    process.env.DATABASE_LOCK_TIMEOUT_MS = '300';
    try {
      await other.query('begin');
      await other.query('select * from rate_limits where key = $1 for update', [key]);
      const t = Date.now();
      await expect(db.transaction(async (tx) => tx.execute(sql`update rate_limits set count = 2 where key = ${key}`))).rejects.toThrow();
      expect(Date.now() - t).toBeLessThan(5000);
    } finally {
      await other.query('rollback');
      await other.end();
      if (prev === undefined) delete process.env.DATABASE_LOCK_TIMEOUT_MS;
      else process.env.DATABASE_LOCK_TIMEOUT_MS = prev;
    }
  });

  it('B6: pool exhaustion surfaces as a fast connection timeout (no hang)', async () => {
    const pool = new Pool({ connectionString: TEST_URL(), max: 1, connectionTimeoutMillis: 300 });
    const held = await pool.connect();
    try {
      await expect(pool.connect()).rejects.toThrow(/timeout/i);
    } finally {
      held.release();
      await pool.end();
    }
  });

  it('B7: database unavailable → readiness is not ready (fails closed), and recovers when the database is back', async () => {
    const good = TEST_URL();
    const { resetFingerprintForTests } = await import('@/server/db/fingerprint');
    try {
      process.env.DATABASE_URL = good.replace(/:\d+\//, ':1/');
      resetFingerprintForTests();
      getPool();
      const r = await readiness();
      expect(r.ready).toBe(false);
      expect(r.checks.database).toBe('error');
    } finally {
      await closeDb();
      process.env.DATABASE_URL = good;
      resetFingerprintForTests();
    }
    const ok = await readiness();
    expect(ok.checks.database).toBe('ok');
    expect(ok.checks.migrations).toBe('ok');
  });
});

/* ═══════════════ D. Reliable jobs ═══════════════ */

describe('B2-D scheduled jobs', () => {
  it('D1: three workers racing the same schedule → exactly one run, with telemetry', async () => {
    const name = `test.singleton.${randomUUID()}`;
    let runs = 0;
    const job = { name, everyMs: 60_000, run: async () => { runs++; await new Promise((r) => setTimeout(r, 200)); return { processed: 3 }; } };
    const out = await Promise.all(['w1', 'w2', 'w3'].map((owner) => runScheduled(job, { owner })));
    expect(out.filter((o) => o === 'SUCCEEDED')).toHaveLength(1);
    expect(out.filter((o) => o === 'SKIPPED')).toHaveLength(2);
    expect(runs).toBe(1);
    const [r] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, name));
    expect(r).toMatchObject({ status: 'SUCCEEDED', itemsProcessed: 3, attempt: 1 });
    expect(r.finishedAt).not.toBeNull();
    expect(r.nextExpectedAt).not.toBeNull();
    // Not due again inside its period (cadence is decided by the database, not process memory).
    expect(await runScheduled(job, { owner: 'w4' })).toBe('SKIPPED');
    // A forced run (cron) ignores cadence but never a live lease.
    expect(await runScheduled(job, { owner: 'w5', force: true })).toBe('SUCCEEDED');
  });

  it('D2: a failing job records a sanitized error, counts consecutive failures, and is retried on the next due tick', async () => {
    const name = `test.failing.${randomUUID()}`;
    let n = 0;
    const job = { name, everyMs: 1000, run: async () => { n++; if (n < 3) throw new Error('provider down for user someone@example.com code 123456'); return 1; } };
    expect(await runScheduled(job, { owner: 'a' })).toBe('FAILED');
    const [l1] = await db.select().from(jobLeases).where(eq(jobLeases.jobName, name));
    expect(l1.consecutiveFailures).toBe(1);
    const [run] = await db.select().from(jobRuns).where(and(eq(jobRuns.jobName, name), eq(jobRuns.status, 'FAILED')));
    expect(run.errorSafe).not.toMatch(/someone@example\.com|123456/);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await runScheduled(job, { owner: 'a' })).toBe('FAILED');
    await new Promise((r) => setTimeout(r, 1100));
    expect(await runScheduled(job, { owner: 'a' })).toBe('SUCCEEDED');
    const [l2] = await db.select().from(jobLeases).where(eq(jobLeases.jobName, name));
    expect(l2.consecutiveFailures).toBe(0);
    const attempts = (await db.select().from(jobRuns).where(eq(jobRuns.jobName, name))).map((r) => r.attempt).sort();
    expect(attempts).toEqual([1, 2, 3]);
    // The failure was grouped into error tracking without the values.
    const ev = await db.select().from(errorEvents).where(eq(errorEvents.route, name));
    expect(ev[0].occurrences).toBe(2);
    expect(ev[0].message).not.toMatch(/someone@example\.com|123456/);
  });

  it('D3: stuck detection — a run whose lease expired while RUNNING becomes ABANDONED and the job is free again', async () => {
    const name = `test.stuck.${randomUUID()}`;
    await db.insert(jobLeases).values({ jobName: name, owner: 'dead-worker', leaseUntil: new Date(Date.now() - 60_000), lastStartedAt: new Date(Date.now() - 10 * 60_000), everySeconds: 60 });
    const runId = randomUUID();
    await db.insert(jobRuns).values({ jobName: name, runId, status: 'RUNNING', worker: 'dead-worker', startedAt: new Date(Date.now() - 10 * 60_000) });
    expect(await markAbandonedRuns()).toBeGreaterThanOrEqual(1);
    const [r] = await db.select().from(jobRuns).where(eq(jobRuns.runId, runId));
    expect(r.status).toBe('ABANDONED');
    expect(await acquireLease({ name, everyMs: 60_000 }, 'new-worker')).toBe(true);
  });

  it('D4: schedule health reports NEVER_RAN / OK / FAILING without inventing values', async () => {
    const ok = `test.health.ok.${randomUUID()}`;
    const bad = `test.health.bad.${randomUUID()}`;
    await runScheduled({ name: ok, everyMs: 60_000, run: async () => 0 });
    await runScheduled({ name: bad, everyMs: 60_000, run: async () => { throw new Error('x'); } });
    const h = await scheduleHealth([{ name: ok, everyMs: 60_000 }, { name: bad, everyMs: 60_000 }, { name: `never.${randomUUID()}`, everyMs: 60_000 }]);
    expect(h.map((x) => x.health)).toEqual(['OK', 'FAILING', 'NEVER_RAN']);
  });

  it('D5: the 37 alert rules run through the scheduler — three workers produce one sweep, no alert storm', async () => {
    const { SCHEDULE } = await import('@/server/jobs/worker');
    const sweep = SCHEDULE.find((s) => s.name === 'alerts.sweep')!;
    await db.delete(jobLeases).where(eq(jobLeases.jobName, 'alerts.sweep'));
    const before = (await db.execute<{ n: string }>(sql`select count(*)::text n from alert_states`)).rows[0].n;
    const out = await Promise.all(['w1', 'w2', 'w3'].map((owner) => runScheduled(sweep, { owner, force: true })));
    expect(out.filter((o) => o === 'SUCCEEDED')).toHaveLength(1);
    const after1 = (await db.execute<{ n: string }>(sql`select count(*)::text n from alert_states`)).rows[0].n;
    // A second forced sweep right after creates no new alert states (dedupe/cooldown hold).
    await runScheduled(sweep, { owner: 'w9', force: true });
    const after2 = (await db.execute<{ n: string }>(sql`select count(*)::text n from alert_states`)).rows[0].n;
    expect(Number(after2)).toBe(Number(after1));
    expect(Number(after1)).toBeGreaterThanOrEqual(Number(before));
  });
});

/* ═══════════════ E. Outbox ═══════════════ */

function captureProvider(sent: { body: string; reference?: string }[], fail = false): (channel: string) => OutboundProvider {
  return (channel) => ({
    name: `test-${channel.toLowerCase()}`,
    async send(msg) {
      if (fail) throw new Error('SMTP 421 try later for someone@example.com');
      sent.push({ body: msg.body, reference: msg.reference });
      return { providerMessageId: `pm-${msg.reference}` };
    },
  });
}

describe('B2-E outbox', () => {
  beforeAll(async () => {
    // Isolate from rows other suites left behind.
    await db.execute(sql`update outbound_messages set status = 'SENT' where status in ('PENDING','SENDING')`);
  });

  it('E1: two concurrent flushers never send the same message twice; provider ids are kept', async () => {
    const sent: { body: string; reference?: string }[] = [];
    setProviderOverride(captureProvider(sent));
    const rows = await db.insert(outboundMessages).values(Array.from({ length: 8 }, (_, i) => ({ channel: 'EMAIL', recipient: `r${i}@x.test`, subject: 's', body: `b${i}`, event: 'ORDER_PLACED' }))).returning();
    await Promise.all([flushOutbound(50), flushOutbound(50)]);
    const refs = sent.map((s) => s.reference).filter((r) => rows.some((x) => x.id === r));
    expect(refs).toHaveLength(8);
    expect(new Set(refs).size).toBe(8);
    const after = await db.select().from(outboundMessages).where(sql`${outboundMessages.id} in (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)})`);
    expect(after.every((m) => m.status === 'SENT' && m.attempts === 1 && m.providerMessageId === `pm-${m.id}`)).toBe(true);
  });

  it('E2: retry with exponential backoff, then dead letter; a secret body is destroyed at dead-lettering', async () => {
    setProviderOverride(captureProvider([], true));
    const [m] = await db.insert(outboundMessages).values({ channel: 'EMAIL', recipient: 'x@x.test', body: 'رابط تغيير كلمة المرور: https://x/reset?t=abc', event: 'ACCOUNT_SECURITY', maxAttempts: 3 }).returning();
    await flushOutbound();
    let [r] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, m.id));
    expect(r).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(r.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(r.lastError).not.toMatch(/someone@example\.com/);
    // Not due yet → untouched by the next flush.
    await flushOutbound();
    [r] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, m.id));
    expect(r.attempts).toBe(1);
    for (let i = 0; i < 2; i++) {
      await db.update(outboundMessages).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(outboundMessages.id, m.id));
      await flushOutbound();
    }
    [r] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, m.id));
    expect(r.status).toBe('FAILED');
    expect(r.deadLetteredAt).not.toBeNull();
    expect(r.body).toBe(REDACTED_BODY);
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });

  it('E3: sealed secrets — stored encrypted (placeholder body), the provider gets the real text, the ciphertext is destroyed after hand-off', async () => {
    process.env.OUTBOX_ENCRYPT_SECRETS = 'true';
    const sent: { body: string; reference?: string }[] = [];
    setProviderOverride(captureProvider(sent));
    try {
      const row = protectOutboxRow({ channel: 'SMS', recipient: '+201000000001', body: 'رمز التحقق: 654321', event: 'ACCOUNT_SECURITY' });
      expect(row.body).toBe(SEALED_BODY);
      expect(row.bodyEnc).toBeTruthy();
      expect(row.bodyEnc).not.toContain('654321');
      const [m] = await db.insert(outboundMessages).values(row).returning();
      const raw = (await db.execute<{ body: string; body_enc: string }>(sql`select body, body_enc from outbound_messages where id = ${m.id}`)).rows[0];
      expect(raw.body + raw.body_enc).not.toContain('654321');
      await flushOutbound();
      expect(sent.find((s) => s.reference === m.id)?.body).toBe('رمز التحقق: 654321');
      const [after] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, m.id));
      expect(after.bodyEnc).toBeNull();
      expect(after.body).toBe(REDACTED_BODY);
      // Non-secret events are never sealed.
      expect(protectOutboxRow({ body: 'x', event: 'ORDER_PLACED' }).body).toBe('x');
    } finally {
      delete process.env.OUTBOX_ENCRYPT_SECRETS;
    }
  });

  it('E4: DELIVERED / BOUNCED only from a provider event, never backwards; dead-letter requeue refuses secrets and is audited', async () => {
    const sent: { body: string; reference?: string }[] = [];
    setProviderOverride(captureProvider(sent));
    const [m] = await db.insert(outboundMessages).values({ channel: 'EMAIL', recipient: 'd@x.test', body: 'b', event: 'ORDER_PLACED' }).returning();
    await flushOutbound();
    expect(await recordDeliveryEvent(`pm-${m.id}`, 'DELIVERED')).toBe(true);
    expect(await recordDeliveryEvent(`pm-${m.id}`, 'BOUNCED')).toBe(false);
    expect(await recordDeliveryEvent('unknown', 'DELIVERED')).toBe(false);
    const admin = await makeAdmin();
    const [dead] = await db.insert(outboundMessages).values({ channel: 'EMAIL', recipient: 'q@x.test', body: REDACTED_BODY, event: 'ACCOUNT_SECURITY', status: 'FAILED', deadLetteredAt: new Date() }).returning();
    await expect(requeueDeadLetter(admin, dead.id, 'retry')).rejects.toThrow(/رسالة أمنية/);
    const [dead2] = await db.insert(outboundMessages).values({ channel: 'EMAIL', recipient: 'q@x.test', body: 'x', event: 'ORDER_PLACED', status: 'FAILED', attempts: 5, deadLetteredAt: new Date() }).returning();
    await requeueDeadLetter(admin, dead2.id, 'provider fixed');
    const [re] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, dead2.id));
    expect(re).toMatchObject({ status: 'PENDING', attempts: 0 });
    const c = await makeCustomer();
    await expect(requeueDeadLetter(c.actor, dead2.id, 'x')).rejects.toThrow();
  });
});

/* ═══════════════ I/J. Storage & malware ═══════════════ */

describe('B2-I/J storage classification and malware quarantine', () => {
  it('J1: classification of purposes', () => {
    expect(storageClass('PRODUCT_IMAGE')).toBe('PUBLIC');
    expect(storageClass('IDENTITY_DOCUMENT')).toBe('HIGHLY_SENSITIVE');
    expect(storageClass('PAYMENT_PROOF')).toBe('HIGHLY_SENSITIVE');
    expect(storageClass('DISPUTE_EVIDENCE')).toBe('PRIVATE');
  });

  it('J2: no scanner → files are honestly UNSCANNED (never CLEAN); where scanning is required they are QUARANTINED and never served', async () => {
    setScannerForTests(null);
    expect(initialScanStatus('PRIVATE')).toBe('UNSCANNED');
    expect(await scanPendingFiles()).toMatchObject({ processed: 0, scanner: 'NONE' });
    process.env.MALWARE_SCAN_REQUIRED = 'true';
    try {
      expect(initialScanStatus('PRIVATE')).toBe('QUARANTINED');
      expect(servable({ visibility: 'PRIVATE', scanStatus: 'UNSCANNED' })).toBe(false);
      const admin = await makeAdmin();
      const f = await db.transaction((tx) => storeUpload(tx, admin, { purpose: 'PAYMENT_PROOF', data: pdf(), originalName: 'p.pdf' }));
      const [row] = await db.select().from(files).where(eq(files.id, f.id));
      expect(row.scanStatus).toBe('QUARANTINED');
      expect(await readPrivateFile(admin, f.id)).toBeNull();
    } finally {
      delete process.env.MALWARE_SCAN_REQUIRED;
    }
    expect(servable({ visibility: 'PRIVATE', scanStatus: 'UNSCANNED' })).toBe(true);
    expect(servable({ visibility: 'PRIVATE', scanStatus: 'INFECTED' })).toBe(false);
    expect(servable({ visibility: 'PRIVATE', scanStatus: 'SCAN_FAILED' })).toBe(false);
  });

  it('J3: with a scanner adapter: QUARANTINED → SCANNING → CLEAN / INFECTED / SCAN_FAILED; infected files are never served', async () => {
    const admin = await makeAdmin();
    const verdictOf = new Map<string, string>();
    setScannerForTests({
      name: 'test-double',
      async scan(_data, meta) {
        const v = verdictOf.get(meta.fileId) ?? 'THROW';
        if (v === 'THROW') throw new Error('scanner timeout');
        return { verdict: v as 'CLEAN' | 'INFECTED', engine: 'test-double', detail: v === 'INFECTED' ? 'EICAR' : undefined };
      },
    });
    await db.execute(sql`update files set scan_status = 'UNSCANNED' where scan_status = 'QUARANTINED'`);
    const ids: string[] = [];
    for (let k = 0; k < 3; k++) ids.push((await db.transaction((tx) => storeUpload(tx, admin, { purpose: 'PAYMENT_PROOF', data: pdf(), originalName: `p${k}.pdf` }))).id);
    verdictOf.set(ids[0], 'CLEAN');
    verdictOf.set(ids[1], 'INFECTED');
    expect((await db.select().from(files).where(eq(files.id, ids[0])))[0].scanStatus).toBe('QUARANTINED');
    expect(await readPrivateFile(admin, ids[0])).toBeNull();
    const res = await scanPendingFiles();
    expect(res).toMatchObject({ processed: 2, failed: 1 });
    const st = await Promise.all(ids.map(async (id) => (await db.select().from(files).where(eq(files.id, id)))[0].scanStatus));
    expect(st).toEqual(['CLEAN', 'INFECTED', 'SCAN_FAILED']);
    expect(await readPrivateFile(admin, ids[0])).not.toBeNull();
    expect(await readPrivateFile(admin, ids[1])).toBeNull();
    expect(await readPrivateFile(admin, ids[2])).toBeNull();
  });
});

/* ═══════════════ K. Secrets / key versioning ═══════════════ */

describe('B2-K encryption key versioning', () => {
  const k1 = Buffer.alloc(32, 1).toString('base64');
  const k2 = Buffer.alloc(32, 2).toString('base64');
  it('K1: historical v1 ciphertexts stay readable after rotation; v2 carries the key id; unknown ids fail closed', async () => {
    const { env } = await import('@/server/core/env');
    const e = env() as { DATA_ENCRYPTION_KEY: string };
    const original = e.DATA_ENCRYPTION_KEY;
    try {
      e.DATA_ENCRYPTION_KEY = k1;
      const legacy = encrypt('29001011234567');
      expect(legacy.startsWith('v1.')).toBe(true);
      // Rotate: k2 becomes primary (id "k2"), k1 is kept decrypt-only.
      e.DATA_ENCRYPTION_KEY = k2;
      process.env.DATA_ENCRYPTION_KEY_ID = 'k2';
      process.env.DATA_ENCRYPTION_KEYS_PREVIOUS = `k1:${k1}`;
      expect(decrypt(legacy)).toBe('29001011234567');
      expect(needsReencryption(legacy)).toBe(true);
      const fresh = encrypt('29001011234567');
      expect(fresh.startsWith('v2.k2.')).toBe(true);
      expect(needsReencryption(fresh)).toBe(false);
      expect(decrypt(fresh)).toBe('29001011234567');
      expect(() => decrypt(fresh.replace('v2.k2.', 'v2.k9.'))).toThrow(/Unknown encryption key id/);
      delete process.env.DATA_ENCRYPTION_KEYS_PREVIOUS;
      expect(() => decrypt(legacy)).toThrow();
    } finally {
      e.DATA_ENCRYPTION_KEY = original;
      delete process.env.DATA_ENCRYPTION_KEY_ID;
      delete process.env.DATA_ENCRYPTION_KEYS_PREVIOUS;
    }
  });
});

/* ═══════════════ L. Monitoring ═══════════════ */

describe('B2-L error tracking', () => {
  it('L1: errors are grouped by fingerprint and stored redacted', async () => {
    const e1 = new Error('Failed query: select 1\nparams: 29001011234567,someone@example.com');
    const e2 = new Error('Failed query: select 1\nparams: 29112233445566,other@example.com');
    expect(errorFingerprint(e1, 'action').fingerprint).toBe(errorFingerprint(e2, 'action').fingerprint);
    const fp = await captureError(e1, { source: 'action', requestId: 'req-abc12345' });
    await captureError(e2, { source: 'action' });
    const [row] = await db.select().from(errorEvents).where(eq(errorEvents.fingerprint, fp!));
    expect(row.occurrences).toBe(2);
    expect(JSON.stringify(row)).not.toMatch(/29001011234567|someone@example\.com/);
  });
});

/* ═══════════════ M. Financial safety ═══════════════ */

describe('B2-M ledger health, emergency kill switch, real-money gate', () => {
  it('M1: the ledger health check is read-only and records a snapshot; a CRITICAL snapshot blocks new money movements until a clean one', async () => {
    const before = (await db.execute<{ n: string }>(sql`select count(*)::text n from journal_lines`)).rows[0].n;
    const row = await runLedgerHealthCheck('test');
    expect(row.difference).toBe(0);
    expect(row.status).not.toBe('CRITICAL');
    expect((await db.execute<{ n: string }>(sql`select count(*)::text n from journal_lines`)).rows[0].n).toBe(before);
    expect(CRITICAL_INVARIANTS.has('TRIAL_BALANCE')).toBe(true);
    await db.insert(ledgerHealthChecks).values({ status: 'CRITICAL', debits: 1, credits: 0, difference: 1, criticalChecks: [{ code: 'TRIAL_BALANCE', count: 1 }], trigger: 'test-injected', checkedAt: new Date(Date.now() + 1000) });
    await expect(assertNotPaused(db, 'killswitch.refunds')).rejects.toThrow(/سلامة دفتر الأستاذ/);
    // History of health checks is append-only evidence.
    await expect(db.execute(sql`delete from ledger_health_checks where trigger = 'test-injected'`)).rejects.toThrow();
    await db.insert(ledgerHealthChecks).values({ ...(await runLedgerHealthCheck('test-reset').then((r) => ({ status: r.status, debits: r.debits, credits: r.credits, difference: r.difference }))), trigger: 'test-clean', checkedAt: new Date(Date.now() + 5000) });
    await expect(assertNotPaused(db, 'killswitch.refunds')).resolves.toBeUndefined();
  });

  it('M2: emergency global kill switch — engage with 2FA + reason, blocks every money path, release needs a second person', async () => {
    const a = await makeAdmin();
    const b = await makeAdmin();
    await expect(setKillSwitch(await adminActor(a.userId!, { stepUpAt: null }), 'killswitch.global', true, 'incident')).rejects.toThrow();
    await expect(setKillSwitch(a, 'killswitch.global', true, '')).rejects.toThrow();
    expect(await setKillSwitch(a, 'killswitch.global', true, 'SEV-1 drift investigation')).toBe('ENGAGED');
    for (const k of ['killswitch.withdrawals', 'killswitch.payouts', 'killswitch.refunds', 'killswitch.sellerRelease', 'killswitch.dealRelease', 'killswitch.paymentConfirmation'] as const) {
      await expect(assertNotPaused(db, k)).rejects.toThrow(/إيقاف طوارئ/);
    }
    expect(await setKillSwitch(a, 'killswitch.global', false, 'resolved')).toBe('RELEASE_REQUESTED');
    await expect(setKillSwitch(a, 'killswitch.global', false, 'resolved')).rejects.toThrow(/شخص تاني/);
    await expect(assertNotPaused(db, 'killswitch.withdrawals')).rejects.toThrow();
    expect(await setKillSwitch(b, 'killswitch.global', false, 'verified fix')).toBe('RELEASED');
    await expect(assertNotPaused(db, 'killswitch.withdrawals')).resolves.toBeUndefined();
    const logs = await db.execute<{ action: string }>(sql`select action from audit_logs where entity_id = 'killswitch.global' order by created_at`);
    expect(logs.rows.map((r) => r.action).slice(-3)).toEqual(['killswitch.global_engaged', 'killswitch.global_release_requested', 'killswitch.global_released']);
    // The generic settings screen can never flip it.
    const { updateSetting } = await import('@/server/modules/settings');
    await expect(updateSetting(a, 'killswitch.global', false, 'x'.repeat(5))).rejects.toThrow(/شاشته المخصصة/);
  });

  it('M3: the real-money master gate lists the infrastructure gates and stays closed', async () => {
    const g = await goLiveGate();
    expect(g.pass).toBe(false);
    const codes = g.blockers.map((b) => b.code);
    for (const c of ['RESTORE_DRILL', 'BACKUP_VERIFIED', 'MALWARE_SCANNER_INACTIVE', 'ERROR_TRACKING', 'SCHEDULER', 'MONITORING_ALERT_TEST', 'LEGAL_APPROVAL', 'ENVIRONMENT', 'PUSH_DEVICE_TEST']) expect(codes).toContain(c);
    // Email delivery evidence is computed from provider-confirmed DELIVERED rows (E4 recorded one in this DB).
    const delivered = Number((await db.execute<{ n: string }>(sql`select count(*)::text n from outbound_messages where status = 'DELIVERED' and channel = 'EMAIL'`)).rows[0].n);
    expect(codes.includes('EMAIL_DELIVERY_EVIDENCE')).toBe(delivered === 0);
  });
});

/* ═══════════════ N/O. Sessions, pilot ═══════════════ */

describe('B2-N/O admin idle timeout and pilot controls', () => {
  it('N1: an idle staff session is revoked; an active one survives; customer sessions are unaffected', async () => {
    const admin = await makeAdmin();
    const token = await createSession(db, admin.userId!, 'ADMIN', {});
    expect(await resolveSession(token, 'ADMIN')).not.toBeNull();
    const id = (await import('@/server/core/crypto')).sha256(token);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - adminIdleTimeoutMs() - 60_000) }).where(eq(sessions.id, id));
    expect(await resolveSession(token, 'ADMIN')).toBeNull();
    const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
    expect(s.revokedAt).not.toBeNull();
    const c = await makeCustomer();
    const ct = await createSession(db, c.user.id, 'WEB', {});
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 24 * 3600_000) }).where(eq(sessions.id, (await import('@/server/core/crypto')).sha256(ct)));
    expect(await resolveSession(ct, 'WEB')).not.toBeNull();
    expect(adminIdleTimeoutMs({ ADMIN_IDLE_TIMEOUT_MINUTES: '1' })).toBe(5 * 60_000);
    expect(adminIdleTimeoutMs({ ADMIN_IDLE_TIMEOUT_MINUTES: '9999' })).toBe(240 * 60_000);
  });

  it('O1: pilot mode — off by default; when on, only allow-listed users start new commerce; caps only when configured', async () => {
    const c = await makeCustomer();
    await expect(assertPilotAllowed(db, c.user.id, 'ORDER', 10_000_000)).resolves.toBeUndefined();
    await setSetting('pilot.enabled', true);
    try {
      await expect(assertPilotAllowed(db, c.user.id, 'ORDER')).rejects.toThrow(/مرحلة تجريبية/);
      await setSetting('pilot.allowedUserIds', [c.user.id]);
      await expect(assertPilotAllowed(db, c.user.id, 'ORDER', 10_000_000)).resolves.toBeUndefined();
      await setSetting('pilot.maxOrderAmount', 500_000);
      await expect(assertPilotAllowed(db, c.user.id, 'ORDER', 500_001)).rejects.toThrow(/الحد المسموح/);
      await expect(assertPilotAllowed(db, c.user.id, 'DEAL', 9_999_999)).resolves.toBeUndefined();
    } finally {
      await db.execute(sql`delete from system_settings where key like 'pilot.%'`);
    }
  });
});

/* ═══════════════ Q/R. Retention & reconciliation ═══════════════ */

describe('B2-Q/R retention and reconciliation vocabulary', () => {
  it('Q1: financial, audit and commerce records are never automatically deleted; undecided periods are flagged for the owner', () => {
    for (const code of ['FINANCIAL_LEDGER', 'AUDIT_TRAIL', 'COMMERCE_RECORDS', 'PAYOUT_DESTINATIONS']) {
      expect(RETENTION_POLICY.find((r) => r.code === code)).toMatchObject({ deletionAllowed: 'NEVER_AUTOMATIC', decision: 'LEGAL_POLICY_OWNER_INPUT_REQUIRED' });
    }
  });

  it('R1: statement lines are classified without any provider and without matching anything', () => {
    const cand = (strength: 'REFERENCE_AND_AMOUNT' | 'AMOUNT_ONLY') => ({ type: 'payment', id: randomUUID(), amount: 1, reference: null, strength });
    expect(classifyReconciliation({ state: 'MATCHED', suggestion: null }, { possibleDuplicates: 0 })).toBe('MATCHED');
    expect(classifyReconciliation({ state: 'MISMATCH', suggestion: null }, { possibleDuplicates: 0 })).toBe('AMOUNT_MISMATCH');
    expect(classifyReconciliation({ state: 'UNMATCHED', suggestion: null }, { possibleDuplicates: 0 })).toBe('UNMATCHED');
    expect(classifyReconciliation({ state: 'UNMATCHED', suggestion: null }, { possibleDuplicates: 1 })).toBe('DUPLICATE_SUSPECTED');
    expect(classifyReconciliation({ state: 'SUGGESTED_MATCH', suggestion: { candidates: [cand('AMOUNT_ONLY')] } }, { possibleDuplicates: 0 })).toBe('REFERENCE_MISMATCH');
    expect(classifyReconciliation({ state: 'SUGGESTED_MATCH', suggestion: { candidates: [cand('REFERENCE_AND_AMOUNT'), cand('AMOUNT_ONLY')] } }, { possibleDuplicates: 0 })).toBe('REVIEW_REQUIRED');
  });
});

afterAll(async () => {
  await clearMarker();
  void customerActor;
});
