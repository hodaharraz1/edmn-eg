import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { DELETE as adminDeletePush, GET as adminGetPush, POST as adminPostPush } from '@/app/api/v1/admin/me/devices/push-token/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { DELETE as deletePush, GET as getPush, POST as postPush } from '@/app/api/v1/me/devices/push-token/route';
import { totpCode } from '@/server/auth/totp';
import { decrypt } from '@/server/core/crypto';
import { customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { devicePushTokens, mobileDevices, systemSettings } from '@/server/db/schema';
import { LogDevicePushSender, pushDeviceCounts, registerPushToken, sendPushToUser, setDevicePushSender } from '@/server/modules/notifications/device-push';
import { updateSetting } from '@/server/modules/settings';
import { makeAdmin, makeCustomer, makeUser } from '../helpers/factory';

/**
 * PKG-PUSH-01: push-token registration bound to the session's installation, idempotent upsert/removal, the log-only
 * sender that sends NOTHING while notifications.devicePushEnabled is OFF (default), the step-up-gated flag, and the
 * staff counts view that never exposes a token. Exercised through the real route handlers (customer + admin).
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = (installationId: string) => ({ installationId, platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });
const TOKEN = 'fcm-test-token-' + 'a'.repeat(140);

async function call(h: Handler, path: string, opts: { method?: string; body?: unknown; token?: string; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await h(new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), {
    params: Promise.resolve({}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function customerLogin(identifier: string) {
  const installationId = inst();
  const r = await call(loginRoute as Handler, '/auth/login', { body: { identifier, password: 'Test@12345', device: device(installationId) } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

async function staffLogin() {
  const u = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
  const login = await call(adminLoginRoute as Handler, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device(inst()) } });
  const token = login.body.tokens.accessToken as string;
  const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { method: 'POST', body: {}, token });
  expect((await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token })).status).toBe(200);
  return { token, user: u };
}

afterEach(async () => {
  setDevicePushSender(); // back to the log driver
  await db.delete(systemSettings).where(eq(systemSettings.key, 'notifications.devicePushEnabled'));
});

describe('device push tokens (PKG-PUSH-01)', () => {
  it('register → upsert → status → unregister through the real routes, bound to the session installation', async () => {
    const c = await makeCustomer();
    const token = await customerLogin(c.user.email!);

    // Idempotency-Key is mandatory on writes.
    expect((await call(postPush as Handler, '/me/devices/push-token', { token, body: { token: TOKEN } })).status).toBe(400);

    const reg = await call(postPush as Handler, '/me/devices/push-token', { token, body: { token: TOKEN }, idem: randomUUID() });
    expect(reg.status, reg.raw).toBe(200);
    expect(reg.body).toEqual({ registered: true, platform: 'ANDROID' });

    // One row per device: re-registering a new token updates the same row.
    const reg2 = await call(postPush as Handler, '/me/devices/push-token', { token, body: { token: TOKEN + 'b' }, idem: randomUUID() });
    expect(reg2.status).toBe(200);
    const rows = await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, c.user.id));
    expect(rows).toHaveLength(1);
    // Stored encrypted at rest (never the plaintext token), and it decrypts to the latest registration.
    expect(rows[0].tokenEnc).not.toContain(TOKEN);
    expect(decrypt(rows[0].tokenEnc)).toBe(TOKEN + 'b');

    // Status reflects registration; sending is OFF by default.
    const st = await call(getPush as Handler, '/me/devices/push-token', { token });
    expect(st.body).toEqual({ registered: true, enabled: false });

    // A short token is a validation error; another user's session cannot see or touch this registration.
    expect((await call(postPush as Handler, '/me/devices/push-token', { token, body: { token: 'short' }, idem: randomUUID() })).status).toBe(422);
    const other = await makeCustomer();
    const otherToken = await customerLogin(other.user.email!);
    const otherStatus = await call(getPush as Handler, '/me/devices/push-token', { token: otherToken });
    expect(otherStatus.body.registered).toBe(false);
    await call(deletePush as Handler, '/me/devices/push-token', { token: otherToken, idem: randomUUID() });
    expect(await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, c.user.id))).toHaveLength(1);

    // Unregister is idempotent.
    const del = await call(deletePush as Handler, '/me/devices/push-token', { token, idem: randomUUID() });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ registered: false });
    expect((await call(deletePush as Handler, '/me/devices/push-token', { token, idem: randomUUID() })).status).toBe(200);
    expect(await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, c.user.id))).toHaveLength(0);
  });

  it('registration is rejected without a mobile installation (web sessions carry no device)', async () => {
    const c = await makeCustomer();
    await expect(registerPushToken(customerActor(c.user.id), TOKEN)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('sender: log driver only, NOTHING sent while the flag is OFF; on sends with no token in the log entry', async () => {
    const c = await makeCustomer();
    const token = await customerLogin(c.user.email!);
    await call(postPush as Handler, '/me/devices/push-token', { token, body: { token: TOKEN }, idem: randomUUID() });

    const spy = new LogDevicePushSender();
    setDevicePushSender(spy);

    // Flag OFF (default): a no-op, nothing logged.
    const off = await sendPushToUser(db, c.user.id, { title: 'اختبار', body: 'جسم' });
    expect(off).toEqual({ sent: 0, failed: 0, disabled: true });
    expect(spy.sent).toHaveLength(0);

    // Flag ON requires the SENSITIVE_SETTINGS step-up; then the log driver records the intent WITHOUT the token.
    const adminNoStepUp = await makeAdmin();
    (adminNoStepUp as { stepUpAt?: Date }).stepUpAt = undefined;
    await expect(updateSetting(adminNoStepUp, 'notifications.devicePushEnabled', true, 'تشغيل تجريبي')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const admin = await makeAdmin();
    await updateSetting(admin, 'notifications.devicePushEnabled', true, 'تشغيل تجريبي');
    const on = await sendPushToUser(db, c.user.id, { title: 'اختبار', body: 'جسم' });
    expect(on).toEqual({ sent: 1, failed: 0, disabled: false });
    expect(spy.sent).toHaveLength(1);
    expect(JSON.stringify(spy.sent)).not.toContain(TOKEN);
    expect(spy.sent[0].platform).toBe('ANDROID');
  });

  it('admin app registration + staff counts per platform: no tokens anywhere in the output', async () => {
    const c = await makeCustomer();
    const custToken = await customerLogin(c.user.email!);
    await call(postPush as Handler, '/me/devices/push-token', { token: custToken, body: { token: TOKEN }, idem: randomUUID() });

    const staff = await staffLogin();
    const reg = await call(adminPostPush as Handler, '/admin/me/devices/push-token', { token: staff.token, body: { token: TOKEN + 's' }, idem: randomUUID() });
    expect(reg.status, reg.raw).toBe(200);
    const st = await call(adminGetPush as Handler, '/admin/me/devices/push-token', { token: staff.token });
    expect(st.body.registered).toBe(true);
    expect((await call(adminDeletePush as Handler, '/admin/me/devices/push-token', { token: staff.token, idem: randomUUID() })).status).toBe(200);

    // Re-register so the counts include the admin app row.
    await call(adminPostPush as Handler, '/admin/me/devices/push-token', { token: staff.token, body: { token: TOKEN + 's' }, idem: randomUUID() });

    const noPerm = await makeAdmin(['CATALOG_REVIEWER']);
    await expect(pushDeviceCounts(noPerm)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const notifAdmin = await makeAdmin();
    const counts = await pushDeviceCounts(notifAdmin);
    expect(counts.enabled).toBe(false);
    expect(counts.total).toBeGreaterThanOrEqual(2);
    const json = JSON.stringify(counts);
    expect(json).not.toContain(TOKEN);
    expect(counts.byPlatform.some((p) => p.app === 'CUSTOMER' && p.platform === 'ANDROID' && p.count >= 1)).toBe(true);
    expect(counts.byPlatform.some((p) => p.app === 'ADMIN' && p.count >= 1)).toBe(true);

    // A revoked device drops out of the counts.
    const [dev] = await db.select().from(mobileDevices).where(eq(mobileDevices.userId, c.user.id));
    await db.update(mobileDevices).set({ revokedAt: new Date() }).where(and(eq(mobileDevices.id, dev.id)));
    const after = await pushDeviceCounts(notifAdmin);
    expect(after.total).toBe(counts.total - 1);
  });
});
