import { randomInt } from 'node:crypto';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import type { Actor } from '@/server/core/actor';
import { decrypt, encrypt, randomToken, sha256 } from '@/server/core/crypto';
import { env } from '@/server/core/env';
import { DomainError, validation } from '@/server/core/errors';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db } from '@/server/db/client';
import { authTokens, sessions, users } from '@/server/db/schema';
import { sendDirect } from '@/server/modules/notifications/notify';
import { CUSTOMER_POLICY, STAFF_POLICY, dummyVerify, hashPassword, passwordProblems, verifyPassword } from './password';
import { enforce } from './rate-limit';
import { generateTotpSecret, matchTotpStep } from './totp';

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const anon = (meta: RequestMeta): Actor => ({ type: 'ANONYMOUS', userId: null, permissions: new Set(), ...meta });

export const registerSchema = z.object({
  fullName: z.string().trim().min(3, 'الاسم قصير جداً').max(120),
  email: z.string().trim().toLowerCase().email('البريد الإلكتروني غير صحيح').max(200),
  phone: z.string().trim().min(8, 'رقم الهاتف غير صحيح'),
  password: z.string().min(1),
});

export async function register(input: z.input<typeof registerSchema>, meta: RequestMeta) {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw validation('يرجى مراجعة البيانات', z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  const { fullName, email, password } = parsed.data;
  const phone = normalizeEgyptMobile(parsed.data.phone);
  if (!phone) throw validation('رقم الموبايل المصري غير صحيح', { phone: ['رقم الموبايل المصري غير صحيح'] });
  const pwProblem = passwordProblems(password, CUSTOMER_POLICY);
  if (pwProblem) throw validation(pwProblem, { password: [pwProblem] });
  await enforce(`register:${meta.ip ?? 'unknown'}`, 10, 3600);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.phone, phone)));
  if (existing.length) throw validation('البريد الإلكتروني أو رقم الهاتف مسجل بالفعل. جرّب تسجيل الدخول.');

  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ fullName, email, phone, passwordHash }).returning();
    await audit(tx, { ...anon(meta), userId: user.id, type: 'CUSTOMER' }, { action: 'auth.register', entityType: 'user', entityId: user.id });
    const token = await createSession(tx, user.id, 'WEB', meta);
    return { user, token };
  });
}

type Scope = 'WEB' | 'ADMIN';

export async function createSession(conn: Parameters<typeof audit>[0], userId: string, scope: Scope, meta: RequestMeta) {
  const token = randomToken(32);
  const ttlHours = scope === 'ADMIN' ? env().ADMIN_SESSION_TTL_HOURS : env().SESSION_TTL_HOURS;
  await conn.insert(sessions).values({
    id: sha256(token),
    // Application clock (not the DB transaction start) so it is always >= a passwordChangedAt set in the same flow.
    createdAt: new Date(),
    userId,
    scope,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + ttlHours * 3600_000),
  });
  return token;
}

/**
 * Credential login. Always issues a brand-new session id (prevents session fixation).
 * For ADMIN scope the session starts un-elevated (mfaVerifiedAt = null) until TOTP is verified.
 */
export async function login(identifier: string, password: string, scope: Scope, meta: RequestMeta) {
  const ident = identifier.trim().toLowerCase();
  await enforce(`login-ip:${meta.ip ?? 'unknown'}`, 30, 900);
  await enforce(`login-id:${ident}`, 10, 900);
  const phone = normalizeEgyptMobile(ident);
  const [user] = await db
    .select()
    .from(users)
    .where(phone ? or(eq(users.email, ident), eq(users.phone, phone)) : eq(users.email, ident));

  const generic = new DomainError('UNAUTHENTICATED', 'بيانات الدخول غير صحيحة');
  if (!user) {
    await dummyVerify(password);
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new DomainError('RATE_LIMITED', 'تم إيقاف تسجيل الدخول مؤقتاً بسبب محاولات متكررة. حاول بعد قليل');
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await audit(tx, { ...anon(meta), userId: user.id }, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, newValues: { scope } });
    });
    throw generic;
  }
  if (user.status !== 'ACTIVE') throw new DomainError('FORBIDDEN', 'هذا الحساب غير مفعّل. تواصل مع الدعم');
  if (scope === 'ADMIN' && !user.isStaff) {
    await dummyVerify(password);
    throw generic;
  }
  return db.transaction(async (tx) => {
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const token = await createSession(tx, user.id, scope, meta);
    await audit(tx, { ...anon(meta), userId: user.id, type: scope === 'ADMIN' ? 'ADMIN' : 'CUSTOMER' }, {
      action: scope === 'ADMIN' ? 'auth.admin_login_password' : 'auth.login',
      entityType: 'user',
      entityId: user.id,
    });
    return { user, token, totpEnrolled: !!user.totpEnabledAt };
  });
}

export async function resolveSession(token: string | undefined | null, scope: Scope) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = sha256(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), eq(sessions.scope, scope), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  if (!row || row.user.status !== 'ACTIVE') return null;
  if (row.user.passwordChangedAt && row.session.createdAt < row.user.passwordChangedAt) return null;
  // Touch at most once per 5 minutes.
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
  return row;
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sha256(token)));
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  const sess = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  for (const s of sess) {
    if (s.id !== exceptSessionId) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id));
  }
}

/* ───────── TOTP (mandatory for admin; optional for sellers) ───────── */

export async function beginTotpEnrollment(userId: string): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw validation('مستخدم غير موجود');
  if (user.totpEnabledAt) throw validation('المصادقة الثنائية مفعّلة بالفعل');
  const secret = generateTotpSecret();
  await db.update(users).set({ totpSecretEnc: encrypt(secret) }).where(eq(users.id, userId));
  return secret;
}

export async function verifyTotpForUser(userId: string, code: string, meta: RequestMeta): Promise<boolean> {
  await enforce(`totp:${userId}`, 8, 300);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.totpSecretEnc) return false;
  const step = matchTotpStep(decrypt(user.totpSecretEnc), code);
  let ok = step !== null;
  await db.transaction(async (tx) => {
    if (ok) {
      // Each code is single-use: atomically advance the last accepted step; a replayed/older code updates nothing.
      const advanced = await tx
        .update(users)
        .set({ totpLastStep: step, ...(user.totpEnabledAt ? {} : { totpEnabledAt: new Date() }) })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step!))))
        .returning({ id: users.id });
      ok = advanced.length === 1;
    }
    await audit(tx, { ...anon(meta), userId }, { action: ok ? 'auth.totp_verified' : 'auth.totp_failed', entityType: 'user', entityId: userId });
  });
  return ok;
}

/** Mark the admin session as MFA-verified (and as a fresh step-up). */
export async function elevateSession(token: string) {
  const now = new Date();
  await db.update(sessions).set({ mfaVerifiedAt: now, stepUpAt: now }).where(eq(sessions.id, sha256(token)));
}

export async function stepUp(token: string, userId: string, code: string, meta: RequestMeta) {
  const ok = await verifyTotpForUser(userId, code, meta);
  if (!ok) throw new DomainError('UNAUTHENTICATED', 'رمز التحقق غير صحيح');
  await db.update(sessions).set({ stepUpAt: new Date() }).where(eq(sessions.id, sha256(token)));
}

/* ───────── Password reset & verification codes ───────── */

export async function requestPasswordReset(identifier: string, meta: RequestMeta): Promise<void> {
  await enforce(`pwreset:${meta.ip ?? 'unknown'}`, 5, 900);
  const ident = identifier.trim().toLowerCase();
  const phone = normalizeEgyptMobile(ident);
  const [user] = await db
    .select()
    .from(users)
    .where(phone ? or(eq(users.email, ident), eq(users.phone, phone)) : eq(users.email, ident));
  // Always behave identically whether or not the account exists (no enumeration).
  if (!user) return;
  const token = randomToken(32);
  await db.transaction(async (tx) => {
    await tx.insert(authTokens).values({
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const link = `${env().APP_URL}/reset-password?token=${token}`;
    await sendDirect(tx, 'ACCOUNT_SECURITY', { email: user.email }, { message: `لإعادة تعيين كلمة المرور استخدم الرابط التالي خلال 30 دقيقة: ${link}` });
  });
}

export async function resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, 'PASSWORD_RESET'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())));
  if (!row) throw validation('رابط إعادة التعيين غير صالح أو منتهي الصلاحية');
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  const problem = passwordProblems(newPassword, user.isStaff ? STAFF_POLICY : CUSTOMER_POLICY);
  if (problem) throw validation(problem);
  const hash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    const used = await tx
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.id, row.id), isNull(authTokens.usedAt)))
      .returning();
    if (!used.length) throw validation('تم استخدام هذا الرابط بالفعل');
    await tx.update(users).set({ passwordHash: hash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, row.userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
    await audit(tx, { ...anon(meta), userId: row.userId }, { action: 'auth.password_reset', entityType: 'user', entityId: row.userId });
  });
}

export async function changePassword(userId: string, current: string, next: string, meta: RequestMeta & { sessionId?: string }) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw validation('كلمة المرور الحالية غير صحيحة');
  const problem = passwordProblems(next, user.isStaff ? STAFF_POLICY : CUSTOMER_POLICY);
  if (problem) throw validation(problem);
  const hash = await hashPassword(next);
  /** Every existing session (all devices) is invalidated; the current device gets a fresh session. */
  return db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, passwordChangedAt: new Date() }).where(eq(users.id, userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await audit(tx, { ...anon(meta), userId }, { action: 'auth.password_changed', entityType: 'user', entityId: userId });
    return { token: await createSession(tx, userId, 'WEB', meta) };
  });
}

/** 6-digit verification code for email/phone (delivered through the notification adapters). */
export async function sendVerificationCode(userId: string, channel: 'EMAIL' | 'PHONE'): Promise<void> {
  await enforce(`verify-send:${userId}:${channel}`, 5, 3600);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  const code = String(randomInt(100000, 1000000));
  const purpose = channel === 'EMAIL' ? 'EMAIL_VERIFY' : 'PHONE_VERIFY';
  await db.transaction(async (tx) => {
    await tx.insert(authTokens).values({ userId, purpose, tokenHash: sha256(`${userId}:${purpose}:${code}`), expiresAt: new Date(Date.now() + 15 * 60_000) });
    await sendDirect(tx, 'ACCOUNT_SECURITY', channel === 'EMAIL' ? { email: user.email } : { phone: user.phone }, {
      message: `رمز التحقق الخاص بك في اضمن: ${code} (صالح لمدة 15 دقيقة)`,
    });
  });
}

export async function confirmVerificationCode(userId: string, channel: 'EMAIL' | 'PHONE', code: string): Promise<boolean> {
  await enforce(`verify-check:${userId}`, 10, 900);
  const purpose = channel === 'EMAIL' ? 'EMAIL_VERIFY' : 'PHONE_VERIFY';
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(`${userId}:${purpose}:${code.trim()}`)), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())));
  if (!row) return false;
  await db.transaction(async (tx) => {
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    await tx.update(users).set(channel === 'EMAIL' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() }).where(eq(users.id, userId));
  });
  return true;
}
