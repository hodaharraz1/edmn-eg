import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureError, lastForwardPromise, parseSentryDsn, redactForTracking, setErrorTrackingForTests } from '@/server/core/error-tracking';
import { dataKeyCheckValue, databaseEndpointHash, secretCheckValue } from '@/server/core/known-nonprod';
import { productionIsolationErrors, readinessTiers, validateEnvironment } from '@/server/core/runtime-env';
import { db } from '@/server/db/client';
import { auditLogs, files, outboundMessages, providerEvents } from '@/server/db/schema';
import { runScheduled } from '@/server/jobs/scheduler';
import { genericSign, handleDeliveryWebhook, svixSign } from '@/server/modules/notifications/delivery-events';
import { deriveStatus, providerHealthReport, recordProviderResult } from '@/server/ops/provider-health';
import { httpScanner, parseScannerResponse, scanPendingFiles, servable, setScannerForTests } from '@/server/storage/scanning';
import { readPrivateFile } from '@/server/storage/access';
import { storeUpload } from '@/server/storage/uploads';
// @ts-expect-error — plain ESM ops script (no type declarations)
import { createScannerServer, parseClamdReply, scanWithClamd } from '../../ops/scanner/clamd-http.mjs';
import { makeAdmin, pdf } from '../helpers/factory';

/** Production infrastructure adapter batch: everything here runs against mocks / local fakes only. */

const ENV_KEYS = ['ERROR_TRACKING_DSN', 'ERROR_TRACKING_PROVIDER', 'ERROR_TRACKING_TOKEN', 'VERCEL_GIT_COMMIT_SHA', 'EMAIL_WEBHOOK_SECRET', 'MALWARE_SCAN_REQUIRED', 'CRON_SECRET'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setErrorTrackingForTests();
  setScannerForTests(undefined);
});

/* ═══════════════ Provider health ═══════════════ */
describe('provider health is derived from evidence only', () => {
  it('status rules: never HEALTHY from configuration alone', () => {
    const now = Date.now();
    expect(deriveStatus('SMTP', false, null)).toBe('NOT_CONFIGURED');
    expect(deriveStatus('SMTP', true, null)).toBe('CONFIGURED_UNVERIFIED');
    expect(deriveStatus('SMTP', true, { lastSuccessAt: new Date(now - 1000), lastFailureAt: null, consecutiveFailures: 0 }, now)).toBe('HEALTHY');
    expect(deriveStatus('SMTP', true, { lastSuccessAt: new Date(now - 1000), lastFailureAt: new Date(), consecutiveFailures: 1 }, now)).toBe('DEGRADED');
    expect(deriveStatus('SMTP', true, { lastSuccessAt: new Date(now - 1000), lastFailureAt: new Date(), consecutiveFailures: 3 }, now)).toBe('FAILED');
    expect(deriveStatus('SMTP', true, { lastSuccessAt: new Date(now - 3 * 86400_000), lastFailureAt: null, consecutiveFailures: 0 }, now)).toBe('DEGRADED');
  });

  it('records outcomes and reports them; an unconfigured provider stays NOT_CONFIGURED whatever was recorded', async () => {
    await db.execute(sql`delete from provider_health`);
    await recordProviderResult('MALWARE_SCANNER', true);
    const rep1 = await providerHealthReport({ MALWARE_SCANNER_URL: 'https://scanner.internal/scan' });
    expect(rep1.find((r) => r.provider === 'MALWARE_SCANNER')!.status).toBe('HEALTHY');
    expect(rep1.find((r) => r.provider === 'ERROR_TRACKING')!.status).toBe('NOT_CONFIGURED');
    for (let i = 0; i < 3; i++) await recordProviderResult('MALWARE_SCANNER', false, new Error('scanner responded 503 token=abc123secret'));
    const row = (await providerHealthReport({ MALWARE_SCANNER_URL: 'https://scanner.internal/scan' })).find((r) => r.provider === 'MALWARE_SCANNER')!;
    expect(row.status).toBe('FAILED');
    expect(row.lastErrorSafe).not.toContain('abc123secret');
    expect((await providerHealthReport({})).find((r) => r.provider === 'MALWARE_SCANNER')!.status).toBe('NOT_CONFIGURED');
  });
});

/* ═══════════════ Error tracking ═══════════════ */
describe('error tracking adapter', () => {
  const SECRET_ERROR = () =>
    new Error(
      'boom password=Hunter2pass otp: 482913 user ali@example.org national id 29001011234567 iban EG380019000500000000263180002 ' +
        'postgres://edmn:SuperSecretPw@ep-x.neon.tech/db Bearer abcdefghijklmnopqrstuvwx cookie edmn_session=deadbeefcafe0123456789abcdef0123456789 ' +
        'key=whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw at /deal/invite/9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e?token=xyz',
    );

  it('no DSN → internal only (error_events), nothing leaves the platform', async () => {
    delete process.env.ERROR_TRACKING_DSN;
    const f = vi.fn();
    setErrorTrackingForTests({ fetch: f as unknown as typeof fetch });
    const fp = await captureError(new Error('internal-only'), { source: 'other' });
    expect(fp).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
    expect((await db.select().from(sql`error_events` as never).where(sql`fingerprint = ${fp}`)).length).toBe(1);
  });

  it('Sentry envelope: auth header, environment + release tags, and full redaction of secrets / PII', async () => {
    process.env.ERROR_TRACKING_DSN = 'https://pubKey123@o123.ingest.sentry.io/4507';
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234def5678';
    expect(parseSentryDsn(process.env.ERROR_TRACKING_DSN)).toEqual({ endpoint: 'https://o123.ingest.sentry.io/api/4507/envelope/', publicKey: 'pubKey123' });
    const calls: { url: string; init: RequestInit }[] = [];
    setErrorTrackingForTests({ fetch: (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response('{}', { status: 200 }))) as unknown as typeof fetch });
    await captureError(SECRET_ERROR(), { source: 'action', route: '/account/orders/0b1c2d3e-4f5a-4b7c-8d9e-0f1a2b3c4d5e?x=1', requestId: 'req-1' });
    expect(await lastForwardPromise).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://o123.ingest.sentry.io/api/4507/envelope/');
    expect((calls[0].init.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=pubKey123');
    const body = String(calls[0].init.body);
    const event = JSON.parse(body.trim().split('\n')[2]);
    expect(event.environment).toBe('test');
    expect(event.release).toBe('abc1234def5678');
    expect(event.tags).toMatchObject({ source: 'action', request_id: 'req-1' });
    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
    for (const leak of ['Hunter2pass', '482913', 'ali@example.org', '29001011234567', 'EG380019000500000000263180002', 'SuperSecretPw', 'abcdefghijklmnopqrstuvwx', 'deadbeefcafe0123456789abcdef', 'whsec_MfKQ9', '9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e', 'token=xyz', '0b1c2d3e-4f5a'])
      expect(body).not.toContain(leak);
  });

  it('provider failure never breaks the caller: one retry on 5xx, no retry on 4xx, health becomes DEGRADED/FAILED', async () => {
    process.env.ERROR_TRACKING_DSN = 'https://hooks.example-tracker.test/ingest';
    process.env.ERROR_TRACKING_TOKEN = 'tok';
    await db.execute(sql`delete from provider_health where provider = 'ERROR_TRACKING'`);
    let n = 0;
    setErrorTrackingForTests({ fetch: (async () => (n++, new Response('down', { status: 503 }))) as unknown as typeof fetch });
    await expect(captureError(new Error('first failure'), { source: 'job' })).resolves.toBeTruthy();
    expect(await lastForwardPromise).toBe(false);
    expect(n).toBe(2);
    n = 0;
    setErrorTrackingForTests({ fetch: (async () => (n++, new Response('bad', { status: 400 }))) as unknown as typeof fetch });
    await captureError(new Error('second failure'), { source: 'job' });
    expect(await lastForwardPromise).toBe(false);
    expect(n).toBe(1);
    setErrorTrackingForTests({ fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await expect(captureError(new Error('third failure'), { source: 'job' })).resolves.toBeTruthy();
    await lastForwardPromise;
    const st = (await providerHealthReport(process.env)).find((r) => r.provider === 'ERROR_TRACKING')!;
    expect(st.status).toBe('FAILED');
  });

  it('an error storm is forwarded once per fingerprint (10-minute throttle)', async () => {
    process.env.ERROR_TRACKING_DSN = 'https://pubKey123@o123.ingest.sentry.io/4507';
    let n = 0;
    setErrorTrackingForTests({ fetch: (async () => (n++, new Response('{}', { status: 200 }))) as unknown as typeof fetch });
    for (let i = 0; i < 5; i++) {
      await captureError(new Error('same bug'), { source: 'request' });
      await lastForwardPromise;
    }
    expect(n).toBe(1);
  });

  it('redaction helper covers OTP / TOTP codes, tokens and secret path segments', () => {
    const out = redactForTracking('totp 123456 code=998877 /reset-password/abc?token=t sk_live_abcdefgh1234 napi_abcdefghij1234567890');
    for (const leak of ['123456', '998877', 'abc?token', 'sk_live_abcdefgh1234', 'napi_abcdefghij']) expect(out).not.toContain(leak);
  });
});

/* ═══════════════ Email delivery webhook ═══════════════ */
describe('email delivery webhook (signed, replay-protected, idempotent)', () => {
  const SECRET = `whsec_${randomBytes(24).toString('base64')}`;
  async function sentEmail(providerMessageId: string | null = null) {
    const id = randomUUID();
    await db.insert(outboundMessages).values({ id, channel: 'EMAIL', recipient: `u-${id.slice(0, 6)}@test.local`, subject: 's', body: 'b', status: 'SENT', sentAt: new Date(), provider: 'smtp', providerMessageId: providerMessageId ?? `<${id}@edmneg.com>` });
    return id;
  }
  function resendRequest(payload: object, opts: { id?: string; ts?: number; secret?: string; badSig?: boolean } = {}) {
    const body = JSON.stringify(payload);
    const id = opts.id ?? `msg_${randomUUID()}`;
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = opts.badSig ? 'v1,AAAA' : `v1,${svixSign(opts.secret ?? SECRET, id, ts, body)}`;
    return { headers: new Headers({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig }), body };
  }
  const statusOf = async (id: string) => (await db.select().from(outboundMessages).where(eq(outboundMessages.id, id)))[0];

  it('not configured → 503 and nothing recorded; unknown provider → 404', async () => {
    delete process.env.EMAIL_WEBHOOK_SECRET;
    const r = resendRequest({ type: 'email.delivered', data: { email_id: 'x' } });
    expect((await handleDeliveryWebhook('resend', r.headers, r.body)).httpStatus).toBe(503);
    expect((await handleDeliveryWebhook('postmark', r.headers, r.body, new Date(), SECRET)).httpStatus).toBe(404);
  });

  it('valid Svix signature → DELIVERED (correlated by provider message id); bad signature 401; stale 400; malformed 400', async () => {
    const id = await sentEmail('re_123abc');
    const ok = resendRequest({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_123abc' } });
    const res = await handleDeliveryWebhook('resend', ok.headers, ok.body, new Date(), SECRET);
    expect(res).toMatchObject({ httpStatus: 200, status: 'PROCESSED', results: [{ outcome: 'APPLIED' }] });
    expect((await statusOf(id)).status).toBe('DELIVERED');
    const bad = resendRequest({ type: 'email.bounced', data: { email_id: 're_123abc' } }, { badSig: true });
    expect((await handleDeliveryWebhook('resend', bad.headers, bad.body, new Date(), SECRET)).httpStatus).toBe(401);
    const wrongSecret = resendRequest({ type: 'email.bounced', data: { email_id: 're_123abc' } }, { secret: `whsec_${randomBytes(24).toString('base64')}` });
    expect((await handleDeliveryWebhook('resend', wrongSecret.headers, wrongSecret.body, new Date(), SECRET)).httpStatus).toBe(401);
    const stale = resendRequest({ type: 'email.bounced', data: { email_id: 're_123abc' } }, { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(await handleDeliveryWebhook('resend', stale.headers, stale.body, new Date(), SECRET)).toMatchObject({ httpStatus: 400, status: 'REJECTED_STALE' });
    const malformed = resendRequest({ nope: true });
    expect(await handleDeliveryWebhook('resend', malformed.headers, malformed.body, new Date(), SECRET)).toMatchObject({ httpStatus: 400, status: 'BAD_REQUEST' });
    expect((await statusOf(id)).status).toBe('DELIVERED'); // nothing moved backwards
  });

  it('replay / duplicate delivery of the same event is acknowledged and never re-applied', async () => {
    const id = await sentEmail('re_dup1');
    const r = resendRequest({ type: 'email.bounced', data: { email_id: 're_dup1' } }, { id: 'msg_fixed_dup_1' });
    expect((await handleDeliveryWebhook('resend', r.headers, r.body, new Date(), SECRET)).results![0].outcome).toBe('APPLIED');
    expect((await statusOf(id)).status).toBe('BOUNCED');
    const again = await handleDeliveryWebhook('resend', r.headers, r.body, new Date(), SECRET);
    expect(again.results![0].outcome).toBe('DUPLICATE');
    expect((await db.select().from(providerEvents).where(eq(providerEvents.eventId, 'msg_fixed_dup_1'))).length).toBe(1);
  });

  it('unknown message id is recorded and acknowledged (no retry loop); deferred is evidence only; complaint is audited', async () => {
    const u = resendRequest({ type: 'email.delivered', data: { email_id: 're_does_not_exist' } });
    expect((await handleDeliveryWebhook('resend', u.headers, u.body, new Date(), SECRET)).results![0].outcome).toBe('UNKNOWN_MESSAGE');
    const id = await sentEmail('re_def1');
    const d = resendRequest({ type: 'email.delivery_delayed', data: { email_id: 're_def1' } });
    expect((await handleDeliveryWebhook('resend', d.headers, d.body, new Date(), SECRET)).results![0].outcome).toBe('RECORDED');
    expect((await statusOf(id)).status).toBe('SENT');
    const c = resendRequest({ type: 'email.complained', data: { email_id: 're_def1' } });
    expect((await handleDeliveryWebhook('resend', c.headers, c.body, new Date(), SECRET)).results![0].outcome).toBe('RECORDED');
    expect((await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).map((a) => a.action)).toContain('email.complaint_received');
    const ignored = resendRequest({ type: 'email.opened', data: { email_id: 're_def1' } });
    expect((await handleDeliveryWebhook('resend', ignored.headers, ignored.body, new Date(), SECRET)).results![0].outcome).toBe('IGNORED_TYPE');
  });

  it('generic EDMN-signed relay: correlates through our Message-ID (outbox id), HMAC verified, timestamp checked', async () => {
    const secret = 'generic-relay-secret-0123456789abcdef';
    const id = await sentEmail();
    const body = JSON.stringify({ events: [{ id: `evt-${id}`, type: 'delivered', messageId: `<${id}@edmneg.com>` }] });
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = new Headers({ 'x-edmn-timestamp': ts, 'x-edmn-signature': genericSign(secret, ts, body) });
    expect((await handleDeliveryWebhook('generic', headers, body, new Date(), secret)).results![0].outcome).toBe('APPLIED');
    expect((await statusOf(id)).status).toBe('DELIVERED');
    const forged = new Headers({ 'x-edmn-timestamp': ts, 'x-edmn-signature': genericSign('other', ts, body) });
    expect((await handleDeliveryWebhook('generic', forged, body, new Date(), secret)).httpStatus).toBe(401);
  });
});

/* ═══════════════ Malware scanner ═══════════════ */
describe('malware scanner adapter (fail closed)', () => {
  it('parses only explicit verdicts; malformed / non-200 / unknown results are failures, never CLEAN', () => {
    expect(parseScannerResponse(200, '{"result":"CLEAN"}').verdict).toBe('CLEAN');
    expect(parseScannerResponse(200, '{"result":"INFECTED","signature":"Eicar-Test-Signature"}')).toMatchObject({ verdict: 'INFECTED', detail: 'Eicar-Test-Signature' });
    expect(parseScannerResponse(200, '{"result":"REJECTED","reason":"size limit exceeded"}').verdict).toBe('REJECTED');
    for (const [st, body] of [[200, 'not json'], [200, '{"result":"OK"}'], [200, 'null'], [200, '{}'], [500, '{"result":"CLEAN"}'], [401, '{"result":"CLEAN"}']] as const)
      expect(() => parseScannerResponse(st, body)).toThrow();
  });

  let srv: Server | null = null;
  async function fakeScanner(handler: (body: Buffer) => { status: number; body: string; delayMs?: number }) {
    srv = createHttpServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const out = handler(Buffer.concat(chunks));
      if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(out.body);
    });
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(srv!.address() as AddressInfo).port}/scan`;
  }
  afterEach(async () => {
    if (srv) await new Promise((r) => srv!.close(r));
    srv = null;
  });

  it('timeout and unreachable scanner are failures (SCAN_FAILED), never CLEAN', async () => {
    const slow = await fakeScanner(() => ({ status: 200, body: '{"result":"CLEAN"}', delayMs: 500 }));
    await expect(httpScanner(slow, 't', 100).scan(Buffer.from('x'), { fileId: 'f', mimeType: 'application/pdf' })).rejects.toThrow();
    await expect(httpScanner('http://127.0.0.1:1/scan', 't', 1000).scan(Buffer.from('x'), { fileId: 'f', mimeType: 'application/pdf' })).rejects.toThrow();
  });

  it('end to end: CLEAN serves, INFECTED / REJECTED / malformed / timeout never serve; failed scans are retried later; only CLEAN private files are readable', async () => {
    const admin = await makeAdmin();
    const verdicts = new Map<string, { status: number; body: string; delayMs?: number }>();
    const url = await fakeScanner((b) => verdicts.get(b.toString('utf8').slice(-36)) ?? { status: 500, body: '' });
    process.env.MALWARE_SCAN_REQUIRED = 'true';
    await db.execute(sql`update files set scan_status = 'UNSCANNED' where scan_status in ('QUARANTINED', 'SCAN_FAILED')`);
    const mk = async (tag: string) => {
      const id = (await db.transaction((tx) => storeUpload(tx, admin, { purpose: 'PAYMENT_PROOF', data: Buffer.concat([pdf(), Buffer.from(tag)]), originalName: 'p.pdf' }))).id;
      return id;
    };
    const tags = ['clean', 'infected', 'rejected', 'malformed', 'timeout'].map((t) => `${t}-${randomUUID()}`.slice(-36));
    const ids = await Promise.all(tags.map(mk));
    verdicts.set(tags[0], { status: 200, body: '{"result":"CLEAN"}' });
    verdicts.set(tags[1], { status: 200, body: '{"result":"INFECTED","signature":"Eicar-Test-Signature"}' });
    verdicts.set(tags[2], { status: 200, body: '{"result":"REJECTED","reason":"encrypted archive"}' });
    verdicts.set(tags[3], { status: 200, body: '<html>proxy error</html>' });
    verdicts.set(tags[4], { status: 200, body: '{"result":"CLEAN"}', delayMs: 400 });
    setScannerForTests(httpScanner(url, 'token', 200));
    for (const id of ids) expect(await readPrivateFile(admin, id)).toBeNull(); // QUARANTINED
    await scanPendingFiles(50);
    const st = await Promise.all(ids.map(async (id) => (await db.select().from(files).where(eq(files.id, id)))[0].scanStatus));
    expect(st).toEqual(['CLEAN', 'INFECTED', 'REJECTED', 'SCAN_FAILED', 'SCAN_FAILED']);
    expect(await readPrivateFile(admin, ids[0])).not.toBeNull();
    for (const id of ids.slice(1)) expect(await readPrivateFile(admin, id)).toBeNull();
    for (const s of ['QUARANTINED', 'SCANNING', 'INFECTED', 'REJECTED', 'SCAN_FAILED']) expect(servable({ visibility: 'PRIVATE', scanStatus: s })).toBe(false);
    // A failed scan is retried after 15 minutes (the file stays unavailable meanwhile) — and can then pass.
    verdicts.set(tags[3], { status: 200, body: '{"result":"CLEAN"}' });
    await db.update(files).set({ scannedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(files.id, ids[3]));
    await scanPendingFiles(50);
    expect((await db.select().from(files).where(eq(files.id, ids[3])))[0].scanStatus).toBe('CLEAN');
    expect((await db.select().from(files).where(eq(files.id, ids[1])))[0].scanStatus).toBe('INFECTED'); // terminal
  });

  let clamd: TcpServer | null = null;
  async function fakeClamd(reply: string) {
    clamd = createTcpServer((sock) => {
      let got = Buffer.alloc(0);
      sock.on('data', (d) => {
        got = Buffer.concat([got, d]);
        if (got.length >= 4 && got.subarray(-4).equals(Buffer.alloc(4))) sock.end(reply);
      });
    });
    await new Promise<void>((r) => clamd!.listen(0, '127.0.0.1', () => r()));
    return (clamd!.address() as AddressInfo).port;
  }
  afterEach(async () => {
    if (clamd) await new Promise((r) => clamd!.close(r));
    clamd = null;
  });

  it('private ClamAV wrapper: INSTREAM protocol, verdict mapping, bearer auth, and EDMN adapter compatibility', async () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ result: 'CLEAN' });
    expect(parseClamdReply('stream: Eicar-Test-Signature FOUND\0')).toEqual({ result: 'INFECTED', signature: 'Eicar-Test-Signature' });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR\0')).toMatchObject({ result: 'REJECTED' });
    expect(() => parseClamdReply('garbage')).toThrow();
    const port = await fakeClamd('stream: Eicar-Test-Signature FOUND\0');
    expect(await scanWithClamd(Buffer.from('X5O!P%@AP'), { host: '127.0.0.1', port, timeoutMs: 2000 })).toMatchObject({ result: 'INFECTED' });
    const token = 't'.repeat(40);
    const wrapper = createScannerServer({ token, host: '127.0.0.1', port, timeoutMs: 2000, maxBytes: 1024 * 1024 });
    await new Promise<void>((r) => wrapper.listen(0, '127.0.0.1', () => r()));
    const wurl = `http://127.0.0.1:${(wrapper.address() as AddressInfo).port}/scan`;
    try {
      expect((await fetch(wurl, { method: 'POST', body: 'x' })).status).toBe(401);
      expect((await fetch(wurl, { method: 'POST', body: 'x', headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
      expect(await httpScanner(wurl, token, 3000).scan(Buffer.from('EICAR'), { fileId: 'f', mimeType: 'application/pdf' })).toMatchObject({ verdict: 'INFECTED' });
    } finally {
      await new Promise((r) => wrapper.close(r));
    }
    // clamd down → wrapper answers 502 → EDMN records a failure (never CLEAN).
    const down = createScannerServer({ token, host: '127.0.0.1', port: 1, timeoutMs: 500, maxBytes: 1024 });
    await new Promise<void>((r) => down.listen(0, '127.0.0.1', () => r()));
    try {
      await expect(httpScanner(`http://127.0.0.1:${(down.address() as AddressInfo).port}/scan`, token, 3000).scan(Buffer.from('x'), { fileId: 'f', mimeType: 'application/pdf' })).rejects.toThrow(/502/);
    } finally {
      await new Promise((r) => down.close(r));
    }
  });
});

/* ═══════════════ Production environment validation ═══════════════ */
describe('production environment isolation', () => {
  const KEY = randomBytes(32).toString('base64');
  const good = () => ({
    EDMN_ENVIRONMENT: 'production', NODE_ENV: 'production', VERCEL: '1',
    DATABASE_URL: 'postgresql://app:pw@ep-prod-123-pooler.eu-central-1.aws.neon.tech/edmn?sslmode=require',
    DATABASE_URL_UNPOOLED: 'postgresql://app:pw@ep-prod-123.eu-central-1.aws.neon.tech/edmn?sslmode=require',
    SESSION_SECRET: randomBytes(32).toString('base64'), DATA_ENCRYPTION_KEY: KEY, DATA_ENCRYPTION_KEY_ID: 'prod2026a', CRON_SECRET: randomBytes(32).toString('hex'),
    APP_URL: 'https://www.edmneg.com', ADMIN_APP_URL: 'https://admin.edmneg.com', ADMIN_HOST: 'admin.edmneg.com', ENFORCE_ADMIN_HOST: 'true',
    STORAGE_DRIVER: 'database', MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.provider.example', MAIL_FROM: 'اضمن إي جي <info@edmneg.com>',
    VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:info@edmneg.com', INLINE_WORKER: 'true',
  });

  it('a correct production configuration (official sender and VAPID contact) has no errors; SMS / scanner / error tracking stay optional', () => {
    const r = validateEnvironment(good());
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/SMS not configured/);
  });

  it('refuses staging key / secrets / database, local or test databases, default key id and shared secrets', () => {
    const g = good();
    const deny = {
      dataKeys: [dataKeyCheckValue(g.DATA_ENCRYPTION_KEY)],
      secrets: [secretCheckValue('SESSION_SECRET', g.SESSION_SECRET), secretCheckValue('CRON_SECRET', g.CRON_SECRET)],
      dbEndpoints: [databaseEndpointHash(g.DATABASE_URL)!],
    };
    const all = productionIsolationErrors(g, deny).join('\n');
    for (const want of ['DATA_ENCRYPTION_KEY is a known staging/test key', 'SESSION_SECRET is a known staging/test secret', 'CRON_SECRET is a known staging/test secret', 'DATABASE_URL points at the staging database', 'DATABASE_URL_UNPOOLED points at the staging database'])
      expect(all).toContain(want);
    expect(databaseEndpointHash(g.DATABASE_URL)).toBe(databaseEndpointHash(g.DATABASE_URL_UNPOOLED)); // pooled = direct endpoint
    const more = validateEnvironment({ ...g, DATABASE_URL: 'postgresql://u:p@localhost:5432/edmn_test', DATA_ENCRYPTION_KEY_ID: 'default', CRON_SECRET: g.SESSION_SECRET }).errors.join('\n');
    for (const want of ['local database', 'test/staging database', 'DATA_ENCRYPTION_KEY_ID must be set', 'must all be different']) expect(more).toContain(want);
  });

  it('refuses inconsistent hosts, a foreign sender domain, a fake VAPID contact and insecure provider URLs', () => {
    const g = good();
    expect(validateEnvironment({ ...g, ADMIN_APP_URL: 'https://www.edmneg.com', ADMIN_HOST: 'www.edmneg.com' }).errors.join()).toContain('ADMIN_HOST must differ');
    expect(validateEnvironment({ ...g, ADMIN_APP_URL: 'https://admin2.edmneg.com' }).errors.join()).toContain('ADMIN_APP_URL host must equal ADMIN_HOST');
    const e = validateEnvironment({ ...g, VAPID_SUBJECT: 'mailto:x@example.com', MALWARE_SCANNER_URL: 'http://scanner', ERROR_TRACKING_DSN: 'http://t', APP_URL: 'https://edmn-staging.vercel.app' }).errors.join('\n');
    for (const want of ['APP_URL must be the production site', 'VAPID_SUBJECT must be the real contact', 'MALWARE_SCANNER_URL must be https', 'ERROR_TRACKING_DSN must be https', 'MALWARE_SCANNER_TOKEN is required']) expect(e).toContain(want);
    expect(validateEnvironment({ ...g, MAIL_FROM: 'EDMN <noreply@gmail.com>' }).errors.join()).toContain('MAIL_FROM must use the production domain');
    const missing = validateEnvironment({ ...g, ADMIN_APP_URL: undefined, ADMIN_HOST: undefined }).errors.join('\n');
    expect(missing).toContain('ADMIN_APP_URL is required');
    expect(missing).toContain('ADMIN_HOST must be set explicitly');
    expect(validateEnvironment({ ...g, PUSH_ALLOW_ANY_ENDPOINT: 'true' }).errors.join()).toContain('PUSH_ALLOW_ANY_ENDPOINT must not be set');
  });

  it('the denylist uses exactly the key check value staging records (same derivation as the runtime)', async () => {
    const { keyCheckValue } = await import('@/server/core/crypto');
    expect(dataKeyCheckValue(process.env.DATA_ENCRYPTION_KEY!)).toBe(keyCheckValue());
  });

  it('secret check values are recorded once and re-recording never touches the append-only table (fingerprint stays verifiable)', async () => {
    const { recordSecretCheckValues } = await import('@/server/db/fingerprint');
    const names = ['SESSION_SECRET', 'CRON_SECRET'];
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from secret_fingerprints where name in ('SESSION_SECRET', 'CRON_SECRET')`).catch(() => {});
    }).catch(() => {});
    const raw = { SESSION_SECRET: 's'.repeat(44), CRON_SECRET: 'c'.repeat(32) };
    await recordSecretCheckValues(db, 'STAGING', raw);
    await expect(recordSecretCheckValues(db, 'STAGING', raw)).resolves.toBeUndefined(); // second boot: no UPDATE attempted
    await expect(recordSecretCheckValues(db, 'STAGING', { SESSION_SECRET: 'x'.repeat(44) })).resolves.toBeUndefined();
    const rows = await db.execute<{ name: string; kcv: string }>(sql`select name, kcv from secret_fingerprints where name in ('SESSION_SECRET', 'CRON_SECRET') order by name`);
    expect(rows.rows.map((r) => r.name).sort()).toEqual(names.sort());
    expect(rows.rows.find((r) => r.name === 'SESSION_SECRET')!.kcv).toBe(secretCheckValue('SESSION_SECRET', 's'.repeat(44)));
  });

  it('staging is unaffected: the production isolation rules never apply to STAGING', () => {
    const r = validateEnvironment({ EDMN_ENVIRONMENT: 'staging', DATABASE_URL: 'postgresql://u:p@localhost/x_test', SESSION_SECRET: 'a'.repeat(44), DATA_ENCRYPTION_KEY: 'b'.repeat(44), APP_URL: 'https://edmn-staging.vercel.app' });
    expect(r.errors).toEqual([]);
  });

  it('readiness tiers: public website needs config + email + scheduler; pilot adds scanner / error tracking evidence; real money adds delivery evidence, SMS, payment provider', () => {
    const g = good();
    const healthy = { SMTP: 'HEALTHY', SCHEDULER: 'HEALTHY', MALWARE_SCANNER: 'HEALTHY', ERROR_TRACKING: 'HEALTHY', EMAIL_WEBHOOK: 'HEALTHY' };
    const t = readinessTiers(g, { SMTP: 'CONFIGURED_UNVERIFIED', SCHEDULER: 'HEALTHY', MALWARE_SCANNER: 'NOT_CONFIGURED' });
    expect(t.map((x) => [x.tier, x.ready])).toEqual([['PUBLIC_WEBSITE', true], ['CONTROLLED_PILOT', false], ['REAL_MONEY', false]]);
    expect(readinessTiers(g, healthy).map((x) => x.ready)).toEqual([true, true, false]);
    expect(readinessTiers({ ...g, SMS_DRIVER: 'http', SMS_HTTP_URL: 'https://sms', SMS_HTTP_TOKEN: 't', PAYMENT_WEBHOOK_SECRET: 's' }, healthy).map((x) => x.ready)).toEqual([true, true, true]);
  });
});

/* ═══════════════ Cron ═══════════════ */
describe('cron endpoint', () => {
  it('requires CRON_SECRET (GET and POST); without a configured secret the endpoint does not exist', async () => {
    vi.resetModules();
    const runTick = vi.fn(async () => ({ jobs: 0, schedules: {} }));
    vi.doMock('@/server/jobs/tick', () => ({ runTick }));
    vi.doMock('@/server/jobs/worker', () => ({ recoverStuckJobs: async () => 0 }));
    const { GET, POST } = await import('@/app/api/cron/tick/route');
    delete process.env.CRON_SECRET;
    expect((await GET(new Request('http://x/api/cron/tick', { headers: { authorization: 'Bearer anything' } }))).status).toBe(404);
    process.env.CRON_SECRET = 'c'.repeat(32);
    expect((await GET(new Request('http://x/api/cron/tick'))).status).toBe(404);
    expect((await POST(new Request('http://x/api/cron/tick', { method: 'POST', headers: { authorization: 'Bearer wrong' } }))).status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
    expect((await GET(new Request('http://x/api/cron/tick', { headers: { authorization: `Bearer ${'c'.repeat(32)}` } }))).status).toBe(200);
    expect((await POST(new Request('http://x/api/cron/tick', { method: 'POST', headers: { authorization: `Bearer ${'c'.repeat(32)}` } }))).status).toBe(200);
    // Due-based (never forced): a per-minute scheduler keeps each job on its own cadence.
    expect(runTick).toHaveBeenCalledWith(expect.objectContaining({ dueRatio: 0.9 }));
    expect(runTick.mock.calls.every((c) => !(c as unknown as [{ force?: boolean }])[0].force)).toBe(true);
    vi.doUnmock('@/server/jobs/tick');
    vi.doUnmock('@/server/jobs/worker');
    vi.resetModules();
  });

  it('duplicate / overlapping invocations run a job once; an early second call is skipped; a missed period is recovered', async () => {
    const name = `test.cron_dup_${randomUUID().slice(0, 8)}`;
    let runs = 0;
    const job = { name, everyMs: 60_000, run: async () => { runs++; await new Promise((r) => setTimeout(r, 100)); } };
    const out = await Promise.all(['a', 'b', 'c'].map((owner) => runScheduled(job, { owner, dueRatio: 0.9 })));
    expect(out.filter((o) => o === 'SUCCEEDED')).toHaveLength(1);
    expect(runs).toBe(1);
    expect(await runScheduled(job, { owner: 'd', dueRatio: 0.9 })).toBe('SKIPPED'); // not due yet
    // Jitter tolerance: 56 s after the last start a 60 s job is due for an external 1-minute scheduler.
    await db.execute(sql`update job_leases set last_started_at = now() - interval '56 seconds' where job_name = ${name}`);
    expect(await runScheduled(job, { owner: 'e', dueRatio: 0.9 })).toBe('SUCCEEDED');
    // A missed invocation (scheduler down for an hour) is simply overdue → runs on the next call, once.
    await db.execute(sql`update job_leases set last_started_at = now() - interval '1 hour' where job_name = ${name}`);
    expect(await runScheduled(job, { owner: 'f', dueRatio: 0.9 })).toBe('SUCCEEDED');
    expect(runs).toBe(3);
    await db.execute(sql`delete from job_leases where job_name = ${name}`);
  });
});
