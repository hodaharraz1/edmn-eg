import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { randomToken, sha256 } from '@/server/core/crypto';
import { DomainError, forbidden, validation } from '@/server/core/errors';
import { keyFor } from '@/server/core/keys';
import { db, type DbOrTx } from '@/server/db/client';
import { mobileDevices, mobileRefreshTokens, sessions, users } from '@/server/db/schema';
import { beginTotpEnrollment, isStaffScope, login, register, resolveSessionById, verifyTotpForUser, type RequestMeta, type Scope } from './service';
import { otpauthUri } from './totp';

/**
 * EDMN mobile apps — device-bound sessions (Phase 1).
 *
 * One session model, two transports: a mobile session is an ordinary `sessions` row (scope MOBILE for the Customer App,
 * ADMIN_MOBILE for the Admin App) created by the SAME login()/register() as the web, so lockout, enumeration safety,
 * password-change invalidation, staff-only admin scope, mandatory MFA and the staff idle timeout all apply unchanged.
 *
 * Tokens:
 *   access token   `em1.<payload>.<mac>` — HMAC-SHA256 under MOBILE_TOKEN_KEY (never SESSION_SECRET), 10 minutes,
 *                  carries only the session id, scope, user id and device id. Every request still re-checks the session
 *                  row, so revocation is immediate (the short lifetime only bounds a stolen token's replay window).
 *   refresh token  opaque 256-bit, only its SHA-256 stored, single use, rotated on every refresh. Re-presenting a rotated
 *                  token is treated as theft: the whole session is revoked.
 * The raw session token returned by login()/register() never leaves the server for mobile clients.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 600;
export type MobileApp = 'CUSTOMER' | 'ADMIN';
export type MobileScope = Extract<Scope, 'MOBILE' | 'ADMIN_MOBILE'>;
export const scopeForApp = (app: MobileApp): MobileScope => (app === 'ADMIN' ? 'ADMIN_MOBILE' : 'MOBILE');

export const deviceSchema = z.object({
  installationId: z.string().trim().regex(/^[A-Za-z0-9_-]{16,128}$/, 'invalid installation id'),
  platform: z.enum(['IOS', 'ANDROID']),
  deviceName: z.string().trim().max(80).optional(),
  appVersion: z.string().trim().regex(/^[0-9A-Za-z.+_-]{1,32}$/).optional(),
});
export type DeviceInput = z.infer<typeof deviceSchema>;

export interface AccessTokenPayload {
  sid: string;
  sc: MobileScope;
  uid: string;
  did: string;
  exp: number;
}

function mac(body: string) {
  return createHmac('sha256', keyFor('mobile-access-token')).update(`em1.${body}`).digest('base64url');
}

export function signAccessToken(p: Omit<AccessTokenPayload, 'exp'>, now = Date.now()): { token: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  const body = Buffer.from(JSON.stringify({ ...p, exp })).toString('base64url');
  return { token: `em1.${body}.${mac(body)}`, expiresAt: new Date(exp * 1000) };
}

/** Signature + expiry + shape only. The caller must still resolve the session row (revocation). */
export function verifyAccessToken(token: string, now = Date.now()): AccessTokenPayload | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'em1') return null;
  const [, body, sig] = parts;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let p: AccessTokenPayload;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!p || typeof p.exp !== 'number' || p.exp * 1000 <= now) return null;
  if (p.sc !== 'MOBILE' && p.sc !== 'ADMIN_MOBILE') return null;
  if (!/^[a-f0-9]{64}$/.test(p.sid ?? '') || typeof p.uid !== 'string' || typeof p.did !== 'string') return null;
  return p;
}

export interface MobileTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  sessionExpiresAt: string;
}

async function issueTokens(tx: DbOrTx, session: { id: string; scope: MobileScope; userId: string; expiresAt: Date }, deviceId: string): Promise<MobileTokens> {
  const refresh = randomToken(32);
  await tx.insert(mobileRefreshTokens).values({ sessionId: session.id, tokenHash: sha256(refresh), expiresAt: session.expiresAt });
  const access = signAccessToken({ sid: session.id, sc: session.scope, uid: session.userId, did: deviceId });
  return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh, sessionExpiresAt: session.expiresAt.toISOString() };
}

const sysActor = (meta: RequestMeta, userId: string, type: Actor['type'], deviceId?: string | null): Actor => ({
  type,
  userId,
  permissions: new Set(),
  ip: meta.ip ?? null,
  userAgent: meta.userAgent ?? null,
  channel: meta.channel ?? null,
  deviceId: deviceId ?? meta.deviceId ?? null,
});

/** Binds a freshly created session to this app installation (a re-login on the same installation ends its old session). */
async function bindDevice(sessionToken: string, userId: string, app: MobileApp, device: DeviceInput, meta: RequestMeta) {
  const sid = sha256(sessionToken);
  const scope = scopeForApp(app);
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sid));
    if (!session || session.scope !== scope || session.userId !== userId) throw new Error('session/device binding mismatch');
    const [existing] = await tx
      .select()
      .from(mobileDevices)
      .where(and(eq(mobileDevices.userId, userId), eq(mobileDevices.app, app), eq(mobileDevices.installationId, device.installationId)))
      .for('update');
    let deviceId: string;
    if (existing) {
      if (existing.sessionId && existing.sessionId !== sid) {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, existing.sessionId), isNull(sessions.revokedAt)));
      }
      await tx
        .update(mobileDevices)
        .set({ sessionId: sid, platform: device.platform, deviceName: device.deviceName ?? existing.deviceName, appVersion: device.appVersion ?? existing.appVersion, lastSeenAt: new Date(), revokedAt: null })
        .where(eq(mobileDevices.id, existing.id));
      deviceId = existing.id;
    } else {
      const [d] = await tx
        .insert(mobileDevices)
        .values({ userId, app, installationId: device.installationId, platform: device.platform, deviceName: device.deviceName ?? null, appVersion: device.appVersion ?? null, sessionId: sid })
        .returning({ id: mobileDevices.id });
      deviceId = d.id;
    }
    const tokens = await issueTokens(tx, { id: sid, scope, userId, expiresAt: session.expiresAt }, deviceId);
    await audit(tx, sysActor(meta, userId, app === 'ADMIN' ? 'ADMIN' : 'CUSTOMER', deviceId), {
      action: 'auth.mobile_session_started',
      entityType: 'user',
      entityId: userId,
      newValues: { app, platform: device.platform, deviceId, rebound: !!existing },
    });
    return { tokens, deviceId };
  });
}

export interface MobileSessionResult {
  user: { id: string; fullName: string; isStaff: boolean };
  tokens: MobileTokens;
  deviceId: string;
  /** ADMIN app only: the session is not usable for admin APIs until TOTP is verified (and enrolled if missing). */
  mfa: { required: boolean; enrolled: boolean };
}

export async function mobileLogin(
  input: { identifier: string; password: string; app: MobileApp; device: DeviceInput },
  meta: RequestMeta,
): Promise<MobileSessionResult> {
  const device = deviceSchema.parse(input.device);
  const scope = scopeForApp(input.app);
  const res = await login(input.identifier, input.password, scope, { ...meta, channel: scope }, { ipLimit: 300 });
  const bound = await bindDevice(res.token, res.user.id, input.app, device, { ...meta, channel: scope });
  return {
    user: { id: res.user.id, fullName: res.user.fullName, isStaff: res.user.isStaff },
    tokens: bound.tokens,
    deviceId: bound.deviceId,
    mfa: { required: input.app === 'ADMIN', enrolled: res.totpEnrolled },
  };
}

export async function mobileRegister(input: Parameters<typeof register>[0], device: DeviceInput, meta: RequestMeta): Promise<MobileSessionResult> {
  const d = deviceSchema.parse(device);
  const res = await register(input, { ...meta, channel: 'MOBILE' }, 'MOBILE');
  const bound = await bindDevice(res.token, res.user.id, 'CUSTOMER', d, { ...meta, channel: 'MOBILE' });
  return { user: { id: res.user.id, fullName: res.user.fullName, isStaff: res.user.isStaff }, tokens: bound.tokens, deviceId: bound.deviceId, mfa: { required: false, enrolled: false } };
}

const unauthenticatedErr = () => new DomainError('UNAUTHENTICATED', 'انتهت الجلسة. سجّل الدخول مرة أخرى');

/**
 * Rotate a refresh token. Single use; the installation must match the device the session is bound to. A rotated token
 * presented again revokes the session (both the thief and the victim must sign in again).
 */
export async function refreshMobileSession(refreshToken: string, installationId: string, expectedScope: MobileScope, meta: RequestMeta): Promise<MobileTokens> {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 100) throw unauthenticatedErr();
  const outcome = await db.transaction(async (tx) => {
    const [rt] = await tx.select().from(mobileRefreshTokens).where(eq(mobileRefreshTokens.tokenHash, sha256(refreshToken))).for('update');
    if (!rt) return { error: true as const };
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, rt.sessionId)).for('update');
    // A Customer App refresh token is never accepted by the Admin App endpoint and vice versa.
    if (!session || session.scope !== expectedScope) return { error: true as const };
    const [device] = await tx.select().from(mobileDevices).where(eq(mobileDevices.sessionId, session.id));
    const actor = sysActor({ ...meta, channel: session.scope }, session.userId, session.scope === 'ADMIN_MOBILE' ? 'ADMIN' : 'CUSTOMER', device?.id);
    if (rt.usedAt) {
      if (!session.revokedAt) {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
        await audit(tx, actor, { action: 'auth.mobile_refresh_reuse_detected', entityType: 'user', entityId: session.userId, newValues: { sessionRevoked: true } });
      }
      return { error: true as const };
    }
    if (!device || device.installationId !== installationId) {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));
      await audit(tx, actor, { action: 'auth.mobile_refresh_device_mismatch', entityType: 'user', entityId: session.userId, newValues: { sessionRevoked: true } });
      return { error: true as const };
    }
    if (rt.expiresAt <= new Date()) return { error: true as const };
    await tx.update(mobileRefreshTokens).set({ usedAt: new Date() }).where(eq(mobileRefreshTokens.id, rt.id));
    return { session, device };
  });
  if ('error' in outcome) throw unauthenticatedErr();
  // Re-validate with the shared rules (revoked, expired, user disabled, password changed, staff idle timeout).
  const live = await resolveSessionById(outcome.session.id, outcome.session.scope as MobileScope);
  if (!live) throw unauthenticatedErr();
  return db.transaction(async (tx) => {
    await tx.update(mobileDevices).set({ lastSeenAt: new Date() }).where(eq(mobileDevices.id, outcome.device.id));
    return issueTokens(tx, { id: live.session.id, scope: live.session.scope as MobileScope, userId: live.user.id, expiresAt: live.session.expiresAt }, outcome.device.id);
  });
}

async function revokeSessionsTx(tx: DbOrTx, ids: string[]) {
  if (!ids.length) return 0;
  const r = await tx.update(sessions).set({ revokedAt: new Date() }).where(and(inArray(sessions.id, ids), isNull(sessions.revokedAt))).returning({ id: sessions.id });
  await tx.update(mobileDevices).set({ revokedAt: new Date(), sessionId: null }).where(inArray(mobileDevices.sessionId, ids));
  return r.length;
}

/** Sign out of THIS session (any transport). */
export async function logoutCurrentSession(actor: Actor) {
  const userId = requireUser(actor);
  if (!actor.sessionId) throw forbidden();
  await db.transaction(async (tx) => {
    await revokeSessionsTx(tx, [actor.sessionId!]);
    await audit(tx, actor, { action: 'auth.logout', entityType: 'user', entityId: userId });
  });
}

const CUSTOMER_SCOPES: Scope[] = ['WEB', 'MOBILE'];
const STAFF_SCOPES: Scope[] = ['ADMIN', 'ADMIN_MOBILE'];
const scopesOf = (actor: Actor) => (actor.type === 'ADMIN' ? STAFF_SCOPES : CUSTOMER_SCOPES);

/** The signed-in user's live sessions on every device of this audience (customer: web + app; staff: admin web + admin app). */
export async function listMySessions(actor: Actor) {
  const userId = requireUser(actor);
  const rows = await db
    .select({ s: sessions, d: mobileDevices })
    .from(sessions)
    .leftJoin(mobileDevices, eq(mobileDevices.sessionId, sessions.id))
    .where(and(eq(sessions.userId, userId), inArray(sessions.scope, scopesOf(actor)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map(({ s, d }) => ({
    // The public handle is a hash of the session id: the session id itself (sha256 of the bearer secret) is never returned.
    id: sha256(`session-handle:${s.id}`).slice(0, 32),
    scope: s.scope,
    current: s.id === actor.sessionId,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    device: d ? { platform: d.platform, name: d.deviceName, appVersion: d.appVersion, app: d.app } : null,
    userAgent: d ? null : (s.userAgent?.slice(0, 120) ?? null),
  }));
}

async function sessionIdByHandle(userId: string, handle: string, scopes: Scope[]) {
  if (!/^[a-f0-9]{32}$/.test(handle)) return null;
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), inArray(sessions.scope, scopes), isNull(sessions.revokedAt)));
  return rows.find((r) => sha256(`session-handle:${r.id}`).slice(0, 32) === handle)?.id ?? null;
}

/** Remote revocation of one of MY sessions (e.g. a lost phone). Revoking the current session is a logout. */
export async function revokeMySession(actor: Actor, handle: string) {
  const userId = requireUser(actor);
  const sid = await sessionIdByHandle(userId, handle, scopesOf(actor));
  if (!sid) throw new DomainError('NOT_FOUND', 'الجلسة غير موجودة');
  await db.transaction(async (tx) => {
    await revokeSessionsTx(tx, [sid]);
    await audit(tx, actor, { action: 'auth.session_revoked', entityType: 'user', entityId: userId, newValues: { current: sid === actor.sessionId } });
  });
}

/** Sign out everywhere else (keeps the current session). */
export async function revokeMyOtherSessions(actor: Actor) {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), inArray(sessions.scope, scopesOf(actor)), isNull(sessions.revokedAt), actor.sessionId ? ne(sessions.id, actor.sessionId) : undefined));
    const n = await revokeSessionsTx(tx, rows.map((r) => r.id));
    await audit(tx, actor, { action: 'auth.other_sessions_revoked', entityType: 'user', entityId: userId, newValues: { revoked: n } });
    return { revoked: n };
  });
}

/**
 * Staff: revoke EVERY session (web + app, any device) of another account — lost/stolen device, compromise, offboarding.
 * Customer accounts need customers.manage; staff accounts need roles.manage. Fresh 2FA, reason, never yourself (use
 * the self-service endpoints), audited in the same transaction.
 */
export async function adminRevokeUserSessions(actor: Actor, targetUserId: string, reason: string) {
  const why = (reason ?? '').trim();
  if (why.length < 5) throw validation('اكتب سبب الإجراء (5 أحرف على الأقل)');
  if (!z.uuid().safeParse(targetUserId).success) throw new DomainError('NOT_FOUND', 'المستخدم غير موجود');
  const [target] = await db.select({ id: users.id, isStaff: users.isStaff }).from(users).where(eq(users.id, targetUserId));
  if (!target) throw new DomainError('NOT_FOUND', 'المستخدم غير موجود');
  requirePermission(actor, target.isStaff ? 'roles.manage' : 'customers.manage');
  requireStepUp(actor);
  if (target.id === actor.userId) throw forbidden('استخدم إدارة جلساتك لإنهاء جلساتك');
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt)));
    const n = await revokeSessionsTx(tx, rows.map((r) => r.id));
    await audit(tx, actor, { action: 'auth.user_sessions_revoked_by_staff', entityType: 'user', entityId: target.id, newValues: { revoked: n, targetIsStaff: target.isStaff }, reason: why });
    return { revoked: n };
  });
}

/* ───────── Admin App MFA (same TOTP rules as the web console) ───────── */

export async function adminMobileTotpEnrollment(actor: Actor) {
  const userId = requireUser(actor);
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const secret = await beginTotpEnrollment(userId);
  await audit(db, actor, { action: 'auth.totp_enrollment_started', entityType: 'user', entityId: userId });
  return { secret, otpauthUri: otpauthUri(secret, u?.email ?? userId) };
}

/** Verify TOTP for a pre-MFA ADMIN_MOBILE session: marks it MFA-verified and freshly stepped-up. */
export async function adminMobileVerifyMfa(actor: Actor, code: string, meta: RequestMeta) {
  const userId = requireUser(actor);
  if (!actor.sessionId) throw forbidden();
  const ok = await verifyTotpForUser(userId, String(code ?? ''), { ...meta, channel: 'ADMIN_MOBILE' });
  if (!ok) throw new DomainError('UNAUTHENTICATED', 'رمز التحقق غير صحيح');
  const now = new Date();
  await db.update(sessions).set({ mfaVerifiedAt: now, stepUpAt: now }).where(and(eq(sessions.id, actor.sessionId), eq(sessions.scope, 'ADMIN_MOBILE')));
  return { mfaVerifiedAt: now.toISOString() };
}

/** Fresh 2FA for sensitive admin actions (same 10-minute window enforced by requireStepUp in every service). */
export async function adminMobileStepUp(actor: Actor, code: string, meta: RequestMeta) {
  const userId = requireUser(actor);
  if (!actor.sessionId) throw forbidden();
  const ok = await verifyTotpForUser(userId, String(code ?? ''), { ...meta, channel: 'ADMIN_MOBILE' });
  if (!ok) throw new DomainError('UNAUTHENTICATED', 'رمز التحقق غير صحيح');
  const now = new Date();
  await db.update(sessions).set({ stepUpAt: now }).where(and(eq(sessions.id, actor.sessionId), eq(sessions.scope, 'ADMIN_MOBILE')));
  return { stepUpAt: now.toISOString() };
}

export { isStaffScope };

/** The signed-in account as the apps need it (allow-list: never hashes, TOTP material or lockout counters). */
export async function myProfile(actor: Actor) {
  const userId = requireUser(actor);
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw unauthenticatedErr();
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email ?? null,
    phone: u.phone ?? null,
    locale: u.locale === 'en' ? ('en' as const) : ('ar' as const),
    emailVerified: !!u.emailVerifiedAt,
    phoneVerified: !!u.phoneVerifiedAt,
    isStaff: u.isStaff,
    totpEnrolled: !!u.totpEnabledAt,
    // Staff only: the effective permission codes, so the Admin App can hide what the server would refuse anyway.
    permissions: actor.type === 'ADMIN' ? [...actor.permissions].sort() : [],
  };
}
