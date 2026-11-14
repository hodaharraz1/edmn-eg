import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { POST as adminStepUpRoute } from '@/app/api/v1/admin/auth/step-up/route';
import { POST as adminRefreshRoute } from '@/app/api/v1/admin/auth/token/refresh/route';
import { GET as adminMeRoute } from '@/app/api/v1/admin/me/route';
import { POST as adminRevokeUserRoute } from '@/app/api/v1/admin/users/[userId]/sessions/revoke/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { POST as logoutRoute } from '@/app/api/v1/auth/logout/route';
import { POST as registerRoute } from '@/app/api/v1/auth/register/route';
import { POST as refreshRoute } from '@/app/api/v1/auth/token/refresh/route';
import { GET as meRoute } from '@/app/api/v1/me/route';
import { DELETE as revokeSessionRoute } from '@/app/api/v1/me/sessions/[sessionId]/route';
import { POST as revokeOthersRoute } from '@/app/api/v1/me/sessions/revoke-others/route';
import { GET as sessionsRoute } from '@/app/api/v1/me/sessions/route';
import { signAccessToken, verifyAccessToken } from '@/server/auth/mobile';
import { changePassword } from '@/server/auth/service';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import { auditLogs, mobileDevices, sessions, users } from '@/server/db/schema';
import { makeUser } from '../helpers/factory';

/**
 * Phase 1 mobile auth, exercised through the REAL route handlers (Request in, Response out): device-bound sessions,
 * refresh rotation and theft detection, audience separation, remote revocation, admin MFA and step-up.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');

async function call(h: Handler, path: string, opts: { method?: string; body?: unknown; token?: string; params?: Record<string, string>; installation?: string; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': opts.installation ?? inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await h(new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), {
    params: Promise.resolve(opts.params ?? {}),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const device = (installationId = inst()) => ({ installationId, platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function customerLogin(identifier: string, installationId = inst()) {
  const r = await call(loginRoute as Handler, '/auth/login', { body: { identifier, password: 'Test@12345', device: device(installationId) }, installation: installationId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { ...r.body, installationId } as { tokens: { accessToken: string; refreshToken: string }; deviceId: string; installationId: string; user: { id: string } };
}

describe('customer app sessions', () => {
  it('login returns device-bound tokens; the session never exposes the raw session secret', async () => {
    const u = await makeUser();
    const s = await customerLogin(u.email!);
    expect(s.tokens.accessToken).toMatch(/^em1\./);
    expect(s.tokens.refreshToken.length).toBeGreaterThanOrEqual(40);
    const p = verifyAccessToken(s.tokens.accessToken)!;
    expect(p.sc).toBe('MOBILE');
    expect(p.uid).toBe(u.id);
    expect(p.did).toBe(s.deviceId);
    const [d] = await db.select().from(mobileDevices).where(eq(mobileDevices.id, s.deviceId));
    expect(d.installationId).toBe(s.installationId);
    const me = await call(meRoute as Handler, '/me', { token: s.tokens.accessToken });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: u.id, isStaff: false, permissions: [] });
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|totpSecret|failedLogin/);
    const [a] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'auth.mobile_session_started')));
    expect(a.channel).toBe('MOBILE');
    expect(a.deviceId).toBe(s.deviceId);
  });

  it('wrong password and unknown accounts get the same stable error code', async () => {
    const u = await makeUser();
    const a = await call(loginRoute as Handler, '/auth/login', { body: { identifier: u.email, password: 'nope-nope', device: device() } });
    const b = await call(loginRoute as Handler, '/auth/login', { body: { identifier: `missing-${inst()}@test.local`, password: 'nope-nope', device: device() } });
    expect(a.status).toBe(401);
    expect(a.body.code).toBe('unauthenticated');
    expect(b.body.code).toBe(a.body.code);
    expect(a.headers.get('content-type')).toMatch(/application\/problem\+json/);
  });

  it('register creates a customer and signs the device in; validation errors carry stable issue codes', async () => {
    const id = inst().slice(0, 10).toLowerCase();
    const ok = await call(registerRoute as Handler, '/auth/register', { body: { fullName: 'عميل موبايل', email: `m-${id}@test.local`, phone: `+2011${String(Date.now()).slice(-8)}`, password: 'Strong@Pass2026', device: device() } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.user.isStaff).toBe(false);
    const bad = await call(registerRoute as Handler, '/auth/register', { body: { fullName: 'x', email: 'not-an-email', phone: '1', password: 'x', device: device() } });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('validation_failed');
    expect(bad.body.issues.length).toBeGreaterThan(0);
  });

  it('refresh rotates (single use); re-presenting a used refresh token revokes the session', async () => {
    const u = await makeUser();
    const s = await customerLogin(u.email!);
    const r1 = await call(refreshRoute as Handler, '/auth/token/refresh', { body: { refreshToken: s.tokens.refreshToken, installationId: s.installationId } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.tokens.refreshToken);
    expect((await call(meRoute as Handler, '/me', { token: r1.body.accessToken })).status).toBe(200);
    // Theft: the old refresh token is replayed.
    const replay = await call(refreshRoute as Handler, '/auth/token/refresh', { body: { refreshToken: s.tokens.refreshToken, installationId: s.installationId } });
    expect(replay.status).toBe(401);
    // The whole session is dead — including the legitimate new access + refresh tokens.
    expect((await call(meRoute as Handler, '/me', { token: r1.body.accessToken })).status).toBe(401);
    expect((await call(refreshRoute as Handler, '/auth/token/refresh', { body: { refreshToken: r1.body.refreshToken, installationId: s.installationId } })).status).toBe(401);
    const [a] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'auth.mobile_refresh_reuse_detected')));
    expect(a).toBeTruthy();
  });

  it('a refresh token presented from another installation revokes the session', async () => {
    const u = await makeUser();
    const s = await customerLogin(u.email!);
    const r = await call(refreshRoute as Handler, '/auth/token/refresh', { body: { refreshToken: s.tokens.refreshToken, installationId: inst() } });
    expect(r.status).toBe(401);
    expect((await call(meRoute as Handler, '/me', { token: s.tokens.accessToken })).status).toBe(401);
  });

  it('access tokens: forged, expired, or signed with SESSION_SECRET are refused', async () => {
    const u = await makeUser();
    const s = await customerLogin(u.email!);
    const [h, body, sig] = s.tokens.accessToken.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), uid: (await makeUser()).id })).toString('base64url')}.${sig}`;
    expect((await call(meRoute as Handler, '/me', { token: forged })).status).toBe(401);
    const p = verifyAccessToken(s.tokens.accessToken)!;
    const expired = signAccessToken({ sid: p.sid, sc: p.sc, uid: p.uid, did: p.did }, Date.now() - 3600_000).token;
    expect((await call(meRoute as Handler, '/me', { token: expired })).status).toBe(401);
    const { createHmac } = await import('node:crypto');
    const withSession = `em1.${body}.${createHmac('sha256', process.env.SESSION_SECRET!).update(`em1.${body}`).digest('base64url')}`;
    expect((await call(meRoute as Handler, '/me', { token: withSession })).status).toBe(401);
    const missing = await call(meRoute as Handler, '/me');
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('a password change ends every mobile session', async () => {
    const u = await makeUser();
    const s = await customerLogin(u.email!);
    await changePassword(u.id, 'Test@12345', 'Another@Pass2026', {});
    expect((await call(meRoute as Handler, '/me', { token: s.tokens.accessToken })).status).toBe(401);
    expect((await call(refreshRoute as Handler, '/auth/token/refresh', { body: { refreshToken: s.tokens.refreshToken, installationId: s.installationId } })).status).toBe(401);
  });

  it('a disabled account loses access immediately', async () => {
    const u = await makeUser();
    const s = await customerLogin(u.email!);
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, u.id));
    expect((await call(meRoute as Handler, '/me', { token: s.tokens.accessToken })).status).toBe(401);
  });

  it('remote revocation: list my devices, revoke one, revoke all others, logout', async () => {
    const u = await makeUser();
    const phone = await customerLogin(u.email!);
    const tablet = await customerLogin(u.email!);
    const lost = await customerLogin(u.email!);
    const list = await call(sessionsRoute as Handler, '/me/sessions', { token: phone.tokens.accessToken });
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(3);
    expect(list.body.items.filter((i: { current: boolean }) => i.current)).toHaveLength(1);
    for (const i of list.body.items) expect(i.id).toMatch(/^[a-f0-9]{32}$/);
    const lostSid = verifyAccessToken(lost.tokens.accessToken)!.sid;
    expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(lostSid);
    // Find the lost device's handle and revoke it (idempotency key required).
    const handles = list.body.items.filter((i: { current: boolean }) => !i.current).map((i: { id: string }) => i.id);
    const noKey = await call(revokeSessionRoute as Handler, `/me/sessions/${handles[0]}`, { method: 'DELETE', token: phone.tokens.accessToken, params: { sessionId: handles[0] } });
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe('idempotency_key_required');
    let revokedLost = false;
    for (const h of handles) {
      const key = inst();
      const r = await call(revokeSessionRoute as Handler, `/me/sessions/${h}`, { method: 'DELETE', token: phone.tokens.accessToken, params: { sessionId: h }, idem: key });
      expect(r.status).toBe(200);
      if ((await call(meRoute as Handler, '/me', { token: lost.tokens.accessToken })).status === 401) {
        revokedLost = true;
        break;
      }
    }
    expect(revokedLost).toBe(true);
    const others = await call(revokeOthersRoute as Handler, '/me/sessions/revoke-others', { method: 'POST', body: {}, token: phone.tokens.accessToken, idem: inst() });
    expect(others.status).toBe(200);
    expect((await call(meRoute as Handler, '/me', { token: tablet.tokens.accessToken })).status).toBe(401);
    expect((await call(meRoute as Handler, '/me', { token: phone.tokens.accessToken })).status).toBe(200);
    expect((await call(logoutRoute as Handler, '/auth/logout', { method: 'POST', body: {}, token: phone.tokens.accessToken })).status).toBe(200);
    expect((await call(meRoute as Handler, '/me', { token: phone.tokens.accessToken })).status).toBe(401);
  });

  it('a user can never revoke another user’s session by handle', async () => {
    const a = await customerLogin((await makeUser()).email!);
    const b = await customerLogin((await makeUser()).email!);
    const bList = await call(sessionsRoute as Handler, '/me/sessions', { token: b.tokens.accessToken });
    const h = bList.body.items[0].id;
    const r = await call(revokeSessionRoute as Handler, `/me/sessions/${h}`, { method: 'DELETE', token: a.tokens.accessToken, params: { sessionId: h }, idem: inst() });
    expect(r.status).toBe(404);
    expect((await call(meRoute as Handler, '/me', { token: b.tokens.accessToken })).status).toBe(200);
  });

  it('re-login on the same installation replaces that installation’s previous session', async () => {
    const u = await makeUser();
    const installation = inst();
    const first = await customerLogin(u.email!, installation);
    const second = await customerLogin(u.email!, installation);
    expect(second.deviceId).toBe(first.deviceId);
    expect((await call(meRoute as Handler, '/me', { token: first.tokens.accessToken })).status).toBe(401);
    expect((await call(meRoute as Handler, '/me', { token: second.tokens.accessToken })).status).toBe(200);
  });
});

describe('audience separation', () => {
  it('a customer cannot obtain an Admin App session; a staff member’s Customer App token is not an admin token', async () => {
    const customer = await makeUser();
    const r = await call(adminLoginRoute as Handler, '/admin/auth/login', { body: { identifier: customer.email, password: 'Test@12345', device: device() } });
    expect(r.status).toBe(401);
    const staff = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
    const s = await customerLogin(staff.email!);
    expect((await call(adminMeRoute as Handler, '/admin/me', { token: s.tokens.accessToken })).status).toBe(401);
  });

  it('refresh tokens are bound to their app: a Customer App refresh token is refused by the Admin refresh endpoint', async () => {
    const u = await makeUser();
    const s = await customerLogin(u.email!);
    const r = await call(adminRefreshRoute as Handler, '/admin/auth/token/refresh', { body: { refreshToken: s.tokens.refreshToken, installationId: s.installationId } });
    expect(r.status).toBe(401);
  });
});

describe('admin app: MFA and step-up', () => {
  async function adminSession(roles = ['SUPER_ADMIN']) {
    const u = await makeUser({ staff: true, roles });
    const installationId = inst();
    const login = await call(adminLoginRoute as Handler, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device(installationId) } });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.mfa).toEqual({ required: true, enrolled: false });
    return { user: u, token: login.body.tokens.accessToken as string, refresh: login.body.tokens.refreshToken as string, installationId };
  }

  it('every admin API is refused until TOTP is verified on this session', async () => {
    const a = await adminSession();
    const pre = await call(adminMeRoute as Handler, '/admin/me', { token: a.token });
    expect(pre.status).toBe(401);
    expect(pre.body.code).toBe('mfa_required');
    const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { method: 'POST', body: {}, token: a.token });
    expect(enroll.status).toBe(200);
    expect(enroll.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const wrong = await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: '000000' }, token: a.token });
    expect(wrong.status).toBe(401);
    const ok = await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token: a.token });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const me = await call(adminMeRoute as Handler, '/admin/me', { token: a.token });
    expect(me.status).toBe(200);
    expect(me.body.isStaff).toBe(true);
    expect(me.body.permissions.length).toBeGreaterThan(5);
    // The same TOTP code can never be replayed (step-up needs a NEW code).
    const replay = await call(adminStepUpRoute as Handler, '/admin/auth/step-up', { body: { code: totpCode(enroll.body.secret) }, token: a.token });
    expect(replay.status).toBe(401);
  });

  it('revoking another account’s sessions needs the permission, a reason and fresh 2FA; never yourself; audited', async () => {
    const a = await adminSession();
    const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { method: 'POST', body: {}, token: a.token });
    await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token: a.token });
    const victim = await makeUser();
    const vs = await customerLogin(victim.email!);
    // Step-up from MFA verification is fresh; make it stale to prove the check.
    const sid = verifyAccessToken(a.token)!.sid;
    await db.update(sessions).set({ stepUpAt: new Date(Date.now() - 3600_000) }).where(eq(sessions.id, sid));
    const stale = await call(adminRevokeUserRoute as Handler, `/admin/users/${victim.id}/sessions/revoke`, { body: { reason: 'هاتف مسروق' }, token: a.token, params: { userId: victim.id }, idem: inst() });
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('step_up_required');
    const up = await call(adminStepUpRoute as Handler, '/admin/auth/step-up', { body: { code: totpCode(enroll.body.secret, Date.now() + 30_000) }, token: a.token });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const self = await call(adminRevokeUserRoute as Handler, `/admin/users/${a.user.id}/sessions/revoke`, { body: { reason: 'اختبار ذاتي' }, token: a.token, params: { userId: a.user.id }, idem: inst() });
    expect(self.status).toBe(403);
    const ok = await call(adminRevokeUserRoute as Handler, `/admin/users/${victim.id}/sessions/revoke`, { body: { reason: 'هاتف مسروق' }, token: a.token, params: { userId: victim.id }, idem: inst() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await call(meRoute as Handler, '/me', { token: vs.tokens.accessToken })).status).toBe(401);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, victim.id), eq(auditLogs.action, 'auth.user_sessions_revoked_by_staff'))).orderBy(desc(auditLogs.createdAt));
    expect(audit.actorUserId).toBe(a.user.id);
    expect(audit.channel).toBe('ADMIN_MOBILE');
  });

  it('a staff member without customers.manage cannot revoke a customer’s sessions', async () => {
    const a = await adminSession(['CATALOG_REVIEWER']);
    const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { method: 'POST', body: {}, token: a.token });
    await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token: a.token });
    const victim = await makeUser();
    const r = await call(adminRevokeUserRoute as Handler, `/admin/users/${victim.id}/sessions/revoke`, { body: { reason: 'محاولة غير مصرح بها' }, token: a.token, params: { userId: victim.id }, idem: inst() });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('forbidden');
  });
});
