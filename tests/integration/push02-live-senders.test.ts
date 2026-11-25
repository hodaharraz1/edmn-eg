import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID, createPublicKey, createVerify } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { POST as postPush } from '@/app/api/v1/me/devices/push-token/route';
import { decryptJson } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import { devicePushCredentials, devicePushTokens, systemSettings } from '@/server/db/schema';
import { devicePushCredentialsView, saveDevicePushCredentials, sendPushToUser, setLiveSenderDeps } from '@/server/modules/notifications/device-push';
import { generateTestKeys } from '@/server/modules/notifications/device-push-senders';
import { updateSetting } from '@/server/modules/settings';
import { makeAdmin, makeCustomer } from '../helpers/factory';

/**
 * PKG-PUSH-02: real Firebase/Apple senders that stay OFF (driver 'log' is the default; 'live' needs the encrypted
 * credentials saved from server settings). Exercised with generated keys + injected fetch/http2 doubles — NO network.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const TOKEN = 'fcm-test-token-' + 'a'.repeat(140);

async function call(h: Handler, path: string, opts: { method?: string; body?: unknown; token?: string; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': randomBytes(18).toString('base64url') };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await h(new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), {
    params: Promise.resolve({}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function customerLogin(identifier: string, platform: 'ANDROID' | 'IOS' = 'ANDROID') {
  const installationId = randomBytes(18).toString('base64url');
  const r = await call(loginRoute as Handler, '/auth/login', {
    body: { identifier, password: 'Test@12345', device: { installationId, platform, deviceName: 'Pixel', appVersion: '1.0.0' } },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

async function liveMode() {
  const admin = await makeAdmin();
  await updateSetting(admin, 'notifications.devicePushEnabled', true, 'تشغيل تجريبي');
  await updateSetting(admin, 'notifications.devicePushDriver', 'live', 'وضع الإرسال الحقيقي');
  return admin;
}

type FetchCall = { url: string | URL; init?: RequestInit };
const fetchOk = (calls: FetchCall[], status = 200, statusText = 'OK') =>
  async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === 'https://oauth2.googleapis.com/token') return new Response('{"access_token":"test-access-token","expires_in":3600}', { status: 200 });
    return new Response(status === 200 ? '{}' : '{"error":{"message":"gone"}}', { status, statusText });
  };

const decodeJwt = (jwt: string) => {
  const [h, p, sig] = jwt.split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url').toString()), claims: JSON.parse(Buffer.from(p, 'base64url').toString()), signature: sig, signed: `${h}.${p}` };
};

afterEach(async () => {
  setLiveSenderDeps();
  await db.delete(devicePushCredentials);
  for (const key of ['notifications.devicePushEnabled', 'notifications.devicePushDriver']) await db.delete(systemSettings).where(eq(systemSettings.key, key));
});

describe('live device push senders (PKG-PUSH-02)', () => {
  it('credentials: step-up-gated, encrypted at rest, view shows metadata only — never the key', async () => {
    const keys = generateTestKeys();
    const fcm = { projectId: 'edmn-test', clientEmail: 'sa@edmn-test.iam.gserviceaccount.com', privateKeyPem: keys.rsaPrivatePem };
    const admin = await makeAdmin();
    const noStepUp = await makeAdmin();
    (noStepUp as { stepUpAt?: Date }).stepUpAt = undefined;
    await expect(
      saveDevicePushCredentials(noStepUp, 'FCM', fcm),
    ).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });

    await saveDevicePushCredentials(admin, 'FCM', fcm);
    const [row] = await db.select().from(devicePushCredentials).where(eq(devicePushCredentials.provider, 'FCM'));
    expect(row.secretEnc).not.toContain(keys.rsaPrivatePem.slice(40, 80));
    expect(decryptJson<{ privateKeyPem: string }>(row.secretEnc).privateKeyPem).toBe(keys.rsaPrivatePem);

    const view = await devicePushCredentialsView(admin);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ provider: 'FCM', meta: { projectId: fcm.projectId, clientEmail: fcm.clientEmail } });
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');

    await expect(saveDevicePushCredentials(admin, 'FCM', { ...fcm, projectId: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('driver stays log by default: flag ON but driver log → no network, sender still records intent only', async () => {
    const c = await makeCustomer();
    const token = await customerLogin(c.user.email!);
    await call(postPush as Handler, '/me/devices/push-token', { token, body: { token: TOKEN }, idem: randomUUID() });
    const admin = await makeAdmin();
    await updateSetting(admin, 'notifications.devicePushEnabled', true, 'تشغيل');
    const calls: FetchCall[] = [];
    setLiveSenderDeps({ fetchImpl: fetchOk(calls) });
    const r = await sendPushToUser(db, c.user.id, { title: 'ت', body: 'ب' });
    expect(r).toEqual({ sent: 1, failed: 0, disabled: false }); // log driver
    expect(calls).toHaveLength(0);
  });

  it('FCM live: OAuth exchange (cached) + send with a verifiable RS256 assertion; master flag OFF → no-op', async () => {
    const keys = generateTestKeys();
    const fcm = { projectId: 'edmn-test', clientEmail: 'sa@edmn-test.iam.gserviceaccount.com', privateKeyPem: keys.rsaPrivatePem };
    const admin = await makeAdmin();
    await saveDevicePushCredentials(admin, 'FCM', fcm);

    // Master flag OFF → nothing happens even in live mode.
    const offCalls: FetchCall[] = [];
    setLiveSenderDeps({ fetchImpl: fetchOk(offCalls) });
    await updateSetting(admin, 'notifications.devicePushDriver', 'live', 'live');
    const c0 = await makeCustomer();
    const r0 = await sendPushToUser(db, c0.user.id, { title: 'ت', body: 'ب' });
    expect(r0.disabled).toBe(true);
    expect(offCalls).toHaveLength(0);

    // Flag ON: two registered devices on ONE user → ONE token exchange (cached within the call) and two sends.
    await updateSetting(admin, 'notifications.devicePushEnabled', true, 'تشغيل');
    const c1 = await makeCustomer();
    const t1 = await customerLogin(c1.user.email!);
    await call(postPush as Handler, '/me/devices/push-token', { token: t1, body: { token: TOKEN }, idem: randomUUID() });
    const t2 = await customerLogin(c1.user.email!); // second installation, same user
    await call(postPush as Handler, '/me/devices/push-token', { token: t2, body: { token: TOKEN + 'b' }, idem: randomUUID() });

    const calls: FetchCall[] = [];
    setLiveSenderDeps({ fetchImpl: fetchOk(calls) });
    const r = await sendPushToUser(db, c1.user.id, { title: 'عنوان', body: 'جسم' });
    expect(r).toEqual({ sent: 2, failed: 0, disabled: false });

    const exchanges = calls.filter((x) => String(x.url) === 'https://oauth2.googleapis.com/token');
    expect(exchanges).toHaveLength(1); // cached
    const assertion = decodeJwt(new URLSearchParams(exchanges[0].init?.body as string).get('assertion')!);
    expect(assertion.header.alg).toBe('RS256');
    expect(assertion.claims.iss).toBe(fcm.clientEmail);
    expect(assertion.claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    const v = createVerify('RSA-SHA256');
    v.update(assertion.signed);
    expect(v.verify(createPublicKey(keys.rsaPublicPem), Buffer.from(assertion.signature, 'base64url'))).toBe(true);

    const sends = calls.filter((x) => String(x.url).includes('/messages:send'));
    expect(sends).toHaveLength(2);
    expect(String(sends[0].url)).toContain(`projects/${fcm.projectId}`);
    expect((sends[0].init?.headers as Record<string, string>).authorization).toBe('Bearer test-access-token');
    const payload = JSON.parse(sends[0].init?.body as string);
    expect(payload.message.token).toBe(TOKEN);
    expect(payload.message.notification).toEqual({ title: 'عنوان', body: 'جسم' });
  });

  it('FCM 404 (invalid token) prunes the stored registration', async () => {
    const keys = generateTestKeys();
    const fcm = { projectId: 'edmn-test', clientEmail: 'sa@edmn-test.iam.gserviceaccount.com', privateKeyPem: keys.rsaPrivatePem };
    const admin = await liveMode();
    await saveDevicePushCredentials(admin, 'FCM', fcm);
    const c = await makeCustomer();
    const t = await customerLogin(c.user.email!);
    await call(postPush as Handler, '/me/devices/push-token', { token: t, body: { token: TOKEN }, idem: randomUUID() });

    const calls: FetchCall[] = [];
    let n = 0;
    setLiveSenderDeps({
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        n += 1;
        return n === 1 ? new Response('{"access_token":"t","expires_in":3600}', { status: 200 }) : new Response('{}', { status: 404 });
      },
    });
    const r = await sendPushToUser(db, c.user.id, { title: 'ت', body: 'ب' });
    expect(r).toEqual({ sent: 0, failed: 1, disabled: false });
    expect(await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, c.user.id))).toHaveLength(0);
  });

  it('live without credentials fails CLOSED: failed=1, no network, nothing thrown', async () => {
    await liveMode();
    const c = await makeCustomer();
    const t = await customerLogin(c.user.email!);
    await call(postPush as Handler, '/me/devices/push-token', { token: t, body: { token: TOKEN }, idem: randomUUID() });
    const calls: FetchCall[] = [];
    setLiveSenderDeps({ fetchImpl: fetchOk(calls) });
    const r = await sendPushToUser(db, c.user.id, { title: 'ت', body: 'ب' });
    expect(r).toEqual({ sent: 0, failed: 1, disabled: false });
    expect(calls).toHaveLength(0);
  });

  it('APNs: provider column routes the send; ES256 JWT verifies; 410 prunes', async () => {
    const keys = generateTestKeys();
    const admin = await liveMode();
    await saveDevicePushCredentials(admin, 'APNS', { teamId: 'TEAM123456', keyId: 'KEY1234567', bundleId: 'com.edmn.customer', privateKeyP8: keys.ecPrivatePem, sandbox: true });

    const c = await makeCustomer();
    const t = await customerLogin(c.user.email!, 'IOS');
    const reg = await call(postPush as Handler, '/me/devices/push-token', { token: t, body: { token: TOKEN + 'apns', provider: 'APNS' }, idem: randomUUID() });
    expect(reg.status).toBe(200);
    const [stored] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, c.user.id));
    expect(stored.provider).toBe('APNS');

    const http2Calls: Array<{ authority: string; headers: Record<string, string> }> = [];
    let status = 200;
    setLiveSenderDeps({
      http2Connect: (authority: string | URL) => {
        const client = new EventEmitter() as EventEmitter & { request: (h: Record<string, string>) => EventEmitter & { end: (body?: string) => void }; close: () => void };
        client.close = () => undefined;
        queueMicrotask(() => client.emit('connect'));
        client.request = (headers: Record<string, string>) => {
          http2Calls.push({ authority: String(authority), headers });
          const req = new EventEmitter() as EventEmitter & { end: (body?: string) => void; setTimeout: (ms: number, cb: () => void) => void };
          req.setTimeout = () => undefined;
          req.end = () => {
            req.emit('response', { ':status': status });
            req.emit('end');
          };
          return req;
        };
        return client as never;
      },
    });

    const r = await sendPushToUser(db, c.user.id, { title: 'عنوان', body: 'جسم' });
    expect(r).toEqual({ sent: 1, failed: 0, disabled: false });
    expect(http2Calls).toHaveLength(1);
    expect(http2Calls[0].authority).toBe('https://api.sandbox.push.apple.com');
    expect(http2Calls[0].headers[':path']).toBe(`/3/device/${TOKEN}apns`);
    expect(http2Calls[0].headers['apns-topic']).toBe('com.edmn.customer');
    const jwt = decodeJwt(http2Calls[0].headers.authorization!.replace('bearer ', ''));
    expect(jwt.header).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(jwt.claims.iss).toBe('TEAM123456');
    const v = createVerify('SHA256');
    v.update(jwt.signed);
    expect(v.verify({ key: createPublicKey(keys.ecPublicPem), dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt.signature, 'base64url'))).toBe(true);

    // 410 → the registration is pruned.
    status = 410;
    const r2 = await sendPushToUser(db, c.user.id, { title: 'ت', body: 'ب' });
    expect(r2).toEqual({ sent: 0, failed: 1, disabled: false });
    expect(await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, c.user.id))).toHaveLength(0);
  });
});
