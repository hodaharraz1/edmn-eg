import { z } from 'zod';
import { listMySessions, logoutCurrentSession, mobileLogin, mobileRegister, myProfile, refreshMobileSession, revokeMyOtherSessions, revokeMySession } from '@/server/auth/mobile';
import { registerSchema } from '@/server/auth/service';
import { pushTokenStatus, registerPushToken, unregisterPushToken } from '@/server/modules/notifications/device-push';
import { defineRoute } from '../http';
import { deviceInfo, ok, profile, revokedCount, sessionList, sessionResult, tokenPair } from '../schemas';

/**
 * Customer App authentication and device sessions. Login/register/refresh return credentials, so they are NEVER
 * idempotency-cached (a stored token would outlive the request); the session mutations below are.
 */

export const register = defineRoute({
  id: 'register',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/auth/register',
  summary: 'Create a customer account and sign this device in',
  tags: ['Auth'],
  auth: 'none',
  rate: 'auth',
  status: 201,
  errors: ['conflict', 'rate_limited'],
  body: registerSchema.extend({ device: deviceInfo }),
  response: sessionResult,
  handler: ({ body, meta }) => {
    const { device, ...input } = body;
    return mobileRegister(input, device, meta);
  },
});

export const login = defineRoute({
  id: 'login',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/auth/login',
  summary: 'Sign in with email or phone and password',
  tags: ['Auth'],
  auth: 'none',
  rate: 'auth',
  errors: ['unauthenticated', 'rate_limited'],
  body: z.object({ identifier: z.string().trim().min(3).max(200), password: z.string().min(1).max(200), device: deviceInfo }),
  response: sessionResult,
  handler: ({ body, meta }) => mobileLogin({ ...body, app: 'CUSTOMER' }, meta),
});

export const refresh = defineRoute({
  id: 'refreshToken',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/auth/token/refresh',
  summary: 'Rotate the refresh token (single use) and get a new access token',
  description: 'Presenting an already-used refresh token, or a refresh token from another installation, revokes the session.',
  tags: ['Auth'],
  auth: 'none',
  rate: 'auth',
  errors: ['unauthenticated'],
  body: z.object({ refreshToken: z.string().min(20).max(100), installationId: deviceInfo.shape.installationId }),
  response: tokenPair,
  handler: ({ body, meta }) => refreshMobileSession(body.refreshToken, body.installationId, 'MOBILE', meta),
});

export const logout = defineRoute({
  id: 'logout',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/auth/logout',
  summary: 'Sign out this device',
  tags: ['Auth'],
  auth: 'customer',
  rate: 'write',
  response: ok,
  handler: async ({ actor }) => {
    await logoutCurrentSession(actor!);
    return { ok: true as const };
  },
});

export const me = defineRoute({
  id: 'getMe',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/me',
  summary: 'The signed-in customer',
  tags: ['Account'],
  auth: 'customer',
  rate: 'read',
  response: profile,
  handler: ({ actor }) => myProfile(actor!),
});

export const mySessions = defineRoute({
  id: 'listMySessions',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/me/sessions',
  summary: 'My signed-in devices (web and app)',
  tags: ['Account'],
  auth: 'customer',
  rate: 'read',
  response: sessionList,
  handler: async ({ actor }) => ({ items: await listMySessions(actor!) }),
});

export const revokeSession = defineRoute({
  id: 'revokeMySession',
  api: 'mobile',
  method: 'DELETE',
  path: '/api/v1/me/sessions/{sessionId}',
  summary: 'Sign out one of my devices remotely',
  tags: ['Account'],
  auth: 'customer',
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

export const revokeOthers = defineRoute({
  id: 'revokeMyOtherSessions',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/me/sessions/revoke-others',
  summary: 'Sign out everywhere except this device',
  tags: ['Account'],
  auth: 'customer',
  rate: 'write',
  idempotency: 'required',
  response: revokedCount,
  handler: ({ actor }) => revokeMyOtherSessions(actor!),
});

/**
 * Device push-token registration (PKG-PUSH-01), bound to the session's own installation (actor.deviceId — a
 * client-supplied device id is never accepted). Registration stores the token only; sending stays off while
 * notifications.devicePushEnabled is false (default) and the only sender driver is the log driver.
 */
export const saveMyPushToken = defineRoute({
  id: 'saveMyPushToken',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/me/devices/push-token',
  summary: 'Register/refresh the push token of THIS installation (stores only; nothing is sent while the flag is off)',
  tags: ['Account'],
  auth: 'customer',
  rate: 'write',
  idempotency: 'required',
  errors: ['validation_failed'],
  body: z.object({ token: z.string().trim().min(16).max(512) }),
  response: z.object({ registered: z.literal(true), platform: z.string() }),
  handler: async ({ actor, body }) => registerPushToken(actor!, body.token),
});

export const deleteMyPushToken = defineRoute({
  id: 'deleteMyPushToken',
  api: 'mobile',
  method: 'DELETE',
  path: '/api/v1/me/devices/push-token',
  summary: 'Remove THIS installation\'s push token (idempotent)',
  tags: ['Account'],
  auth: 'customer',
  rate: 'write',
  idempotency: 'required',
  response: z.object({ registered: z.literal(false) }),
  handler: async ({ actor }) => unregisterPushToken(actor!),
});

export const myPushTokenStatus = defineRoute({
  id: 'myPushTokenStatus',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/me/devices/push-token',
  summary: 'Does THIS installation have a registered push token, and is sending enabled server-side',
  tags: ['Account'],
  auth: 'customer',
  rate: 'read',
  response: z.object({ registered: z.boolean(), enabled: z.boolean() }),
  handler: async ({ actor }) => pushTokenStatus(actor!),
});

export const customerRoutes = [register, login, refresh, logout, me, mySessions, revokeSession, revokeOthers, saveMyPushToken, deleteMyPushToken, myPushTokenStatus];
