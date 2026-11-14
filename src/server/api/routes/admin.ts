import { z } from 'zod';
import {
  adminMobileStepUp,
  adminMobileTotpEnrollment,
  adminMobileVerifyMfa,
  adminRevokeUserSessions,
  listMySessions,
  logoutCurrentSession,
  mobileLogin,
  myProfile,
  refreshMobileSession,
  revokeMyOtherSessions,
  revokeMySession,
} from '@/server/auth/mobile';
import { defineRoute } from '../http';
import { deviceInfo, isoDateTime, ok, profile, revokedCount, sessionList, sessionResult, tokenPair } from '../schemas';

/**
 * Admin App (separate binary, separate audience). Sessions are ADMIN_MOBILE: staff only, mandatory TOTP before any
 * admin API, staff idle timeout, fresh 2FA (step-up) for sensitive actions — the same rules as the web console.
 * Phase 1 deliberately exposes NO financial mutation (no withdrawal approval, settlement, refund or ledger action).
 */
const totp = z.object({ code: z.string().regex(/^\d{6}$/) });

export const adminLogin = defineRoute({
  id: 'adminLogin',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/auth/login',
  summary: 'Staff sign-in (returns a pre-MFA session)',
  tags: ['Admin Auth'],
  auth: 'none',
  rate: 'auth',
  errors: ['unauthenticated', 'rate_limited'],
  body: z.object({ identifier: z.string().trim().min(3).max(200), password: z.string().min(1).max(200), device: deviceInfo }),
  response: sessionResult,
  handler: ({ body, meta }) => mobileLogin({ ...body, app: 'ADMIN' }, meta),
});

export const adminRefresh = defineRoute({
  id: 'adminRefreshToken',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/auth/token/refresh',
  summary: 'Rotate the Admin App refresh token',
  tags: ['Admin Auth'],
  auth: 'none',
  rate: 'auth',
  errors: ['unauthenticated'],
  body: z.object({ refreshToken: z.string().min(20).max(100), installationId: deviceInfo.shape.installationId }),
  response: tokenPair,
  handler: ({ body, meta }) => refreshMobileSession(body.refreshToken, body.installationId, 'ADMIN_MOBILE', meta),
});

export const adminMfaEnroll = defineRoute({
  id: 'adminMfaEnroll',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/auth/mfa/enroll',
  summary: 'Start TOTP enrolment (staff without an authenticator yet)',
  tags: ['Admin Auth'],
  auth: 'admin-pre-mfa',
  rate: 'sensitive',
  response: z.object({ secret: z.string(), otpauthUri: z.string() }),
  handler: ({ actor }) => adminMobileTotpEnrollment(actor!),
});

export const adminMfaVerify = defineRoute({
  id: 'adminMfaVerify',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/auth/mfa/verify',
  summary: 'Verify TOTP for this session (required before any admin API)',
  tags: ['Admin Auth'],
  auth: 'admin-pre-mfa',
  rate: 'sensitive',
  errors: ['unauthenticated', 'rate_limited'],
  body: totp,
  response: z.object({ mfaVerifiedAt: isoDateTime }),
  handler: ({ actor, body, meta }) => adminMobileVerifyMfa(actor!, body.code, meta),
});

export const adminStepUp = defineRoute({
  id: 'adminStepUp',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/auth/step-up',
  summary: 'Fresh 2FA for sensitive actions (valid 10 minutes)',
  tags: ['Admin Auth'],
  auth: 'admin',
  rate: 'sensitive',
  errors: ['unauthenticated', 'rate_limited'],
  body: totp,
  response: z.object({ stepUpAt: isoDateTime }),
  handler: ({ actor, body, meta }) => adminMobileStepUp(actor!, body.code, meta),
});

export const adminLogout = defineRoute({
  id: 'adminLogout',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/auth/logout',
  summary: 'Sign out this device',
  tags: ['Admin Auth'],
  auth: 'admin-pre-mfa',
  rate: 'write',
  response: ok,
  handler: async ({ actor }) => {
    await logoutCurrentSession(actor!);
    return { ok: true as const };
  },
});

export const adminMe = defineRoute({
  id: 'adminGetMe',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/me',
  summary: 'The signed-in staff member and effective permissions',
  tags: ['Admin Account'],
  auth: 'admin',
  rate: 'read',
  response: profile,
  handler: ({ actor }) => myProfile(actor!),
});

export const adminMySessions = defineRoute({
  id: 'adminListMySessions',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/me/sessions',
  summary: 'My staff sessions (admin web and Admin App)',
  tags: ['Admin Account'],
  auth: 'admin',
  rate: 'read',
  response: sessionList,
  handler: async ({ actor }) => ({ items: await listMySessions(actor!) }),
});

export const adminRevokeMySession = defineRoute({
  id: 'adminRevokeMySession',
  api: 'admin',
  method: 'DELETE',
  path: '/api/v1/admin/me/sessions/{sessionId}',
  summary: 'Sign out one of my staff sessions remotely',
  tags: ['Admin Account'],
  auth: 'admin',
  rate: 'write',
  idempotency: 'required',
  errors: ['not_found'],
  params: z.object({ sessionId: z.string().regex(/^[a-f0-9]{32}$/) }),
  response: ok,
  handler: async ({ actor, params }) => {
    await revokeMySession(actor!, params.sessionId);
    return { ok: true as const };
  },
});

export const adminRevokeMyOthers = defineRoute({
  id: 'adminRevokeMyOtherSessions',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/me/sessions/revoke-others',
  summary: 'Sign out all my other staff sessions',
  tags: ['Admin Account'],
  auth: 'admin',
  rate: 'write',
  idempotency: 'required',
  response: revokedCount,
  handler: ({ actor }) => revokeMyOtherSessions(actor!),
});

export const adminRevokeUser = defineRoute({
  id: 'adminRevokeUserSessions',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/users/{userId}/sessions/revoke',
  summary: "Revoke every session of another account (lost device, compromise, offboarding)",
  description: 'Requires customers.manage (customer accounts) or roles.manage (staff accounts), fresh 2FA and a reason. Audited.',
  tags: ['Admin Security'],
  auth: 'admin',
  rate: 'sensitive',
  idempotency: 'required',
  errors: ['forbidden', 'step_up_required', 'not_found'],
  params: z.object({ userId: z.uuid() }),
  body: z.object({ reason: z.string().trim().min(5).max(500) }),
  response: revokedCount,
  handler: ({ actor, params, body }) => adminRevokeUserSessions(actor!, params.userId, body.reason),
});

export const adminRoutes = [adminLogin, adminRefresh, adminMfaEnroll, adminMfaVerify, adminStepUp, adminLogout, adminMe, adminMySessions, adminRevokeMySession, adminRevokeMyOthers, adminRevokeUser];
