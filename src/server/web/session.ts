import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { adminActor, customerActor, sellerActor, type RequestContext } from '@/server/auth/actors';
import { resolveSession } from '@/server/auth/service';
import type { Actor } from '@/server/core/actor';
import { cookieSecure } from '@/server/core/env';
import { clientIp } from './client-ip';
import { safeNext } from './safe-next';
import { sha256 } from '@/server/core/crypto';

export const WEB_COOKIE = 'edmn_sid';
export const ADMIN_COOKIE = 'edmn_admin_sid';
export const CART_COOKIE = 'edmn_cart';

/**
 * SEC-04 L5: on any secure deployment the session and cart cookies are written with the `__Host-` prefix.
 * Browsers refuse a `__Host-` cookie that carries a Domain, is not Secure, or has a Path other than '/', so a
 * sibling subdomain (seller./admin.) can neither overwrite nor shadow the session cookie. Plain names stay on
 * http for local development, and are still read during the transition so nobody is logged out by the rename.
 */
export function hostCookieName(base: string): string {
  return cookieSecure() ? `__Host-${base}` : base;
}

/** Read a cookie under both its current and its pre-L5 name (one-time transition, no session loss). */
async function readCookie(base: string): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(hostCookieName(base))?.value ?? jar.get(base)?.value;
}

export async function requestMeta(): Promise<RequestContext> {
  const h = await headers();
  const rid = h.get('x-request-id');
  return {
    ip: clientIp(h),
    userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
    requestId: rid && /^[\w-]{1,64}$/.test(rid) ? rid : randomUUID(),
  };
}



export async function setSessionCookie(name: string, token: string, maxAgeHours: number) {
  (await cookies()).set(hostCookieName(name), token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeHours * 3600,
  });
}

/**
 * Re-login hygiene: before a new session cookie replaces an old one, the old server-side session is revoked, so a
 * previously issued (possibly leaked) token cannot outlive the user's new sign-in. (New sessions always get a fresh
 * random id — fixation of a client-chosen id is impossible regardless.)
 */
export async function revokePresentedSession(name: string) {
  const { logout } = await import('@/server/auth/service');
  await logout(await readCookie(name));
}

export async function clearCookie(name: string) {
  const jar = await cookies();
  jar.delete(name);
  jar.delete(hostCookieName(name));
}

/** Current customer/seller web session (cached per request). */
export const getWebSession = cache(async () => {
  const token = await readCookie(WEB_COOKIE);
  const row = await resolveSession(token, 'WEB');
  if (!row) return null;
  return { user: row.user, session: row.session, token: token! };
});

export async function currentUser() {
  return (await getWebSession())?.user ?? null;
}

/**
 * Signed-in user for pages. Layout guards and pages render concurrently in the App Router, so a
 * page must never assume its layout already redirected an anonymous visitor.
 */
export async function requireUser(next = '/account') {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(await returnTarget(next))}`);
  return user;
}

/**
 * Where to come back after signing in: the page actually requested (set by src/proxy.ts, internal paths only via
 * safeNext), falling back to the caller's default. Layouts and pages guard concurrently, so whichever redirects
 * first still preserves the real destination.
 */
async function returnTarget(fallback: string): Promise<string> {
  const requested = (await headers()).get('x-edmn-path');
  return safeNext(requested, safeNext(fallback, '/account'));
}

export async function customerActorOrNull(): Promise<Actor | null> {
  const s = await getWebSession();
  if (!s) return null;
  return customerActor(s.user.id, { ...(await requestMeta()), sessionId: s.session.id });
}

/** For pages/actions that need a signed-in user. Redirects to login preserving the target. */
export async function requireCustomer(next = '/account'): Promise<Actor> {
  const a = await customerActorOrNull();
  if (!a) redirect(`/login?next=${encodeURIComponent(await returnTarget(next))}`);
  return a;
}

/** Seller Center access: signed in AND associated with a seller account (any status). */
export async function requireSellerActor(next = '/seller'): Promise<Actor> {
  const s = await getWebSession();
  if (!s) redirect(`/seller/login?next=${encodeURIComponent(await returnTarget(next))}`);
  const a = await sellerActor(s.user.id, { ...(await requestMeta()), sessionId: s.session.id });
  if (!a) redirect('/seller/register');
  return a;
}

export const getAdminSession = cache(async () => {
  // With host routing on, admin sessions are only honoured on the admin host — never on www./seller.
  if (process.env.ENFORCE_HOSTS === 'true' || process.env.ENFORCE_ADMIN_HOST === 'true') {
    const host = ((await headers()).get('host') ?? '').split(':')[0].toLowerCase();
    if (host !== (process.env.ADMIN_HOST ?? 'admin.edmneg.com').toLowerCase()) return null;
  }
  const token = await readCookie(ADMIN_COOKIE);
  const row = await resolveSession(token, 'ADMIN');
  if (!row || !row.user.isStaff) return null;
  return { user: row.user, session: row.session, token: token! };
});

/** Admin access requires a staff account AND a completed TOTP challenge on this session. */
export async function requireAdmin(): Promise<Actor> {
  const s = await getAdminSession();
  if (!s) redirect('/admin/login');
  if (!s.session.mfaVerifiedAt) redirect('/admin/2fa');
  return adminActor(s.user.id, { ...(await requestMeta()), sessionId: s.session.id, stepUpAt: s.session.stepUpAt });
}

/** Admin actor for route handlers (returns null instead of redirecting). */
export async function getAdminActor(): Promise<Actor | null> {
  const s = await getAdminSession();
  if (!s || !s.session.mfaVerifiedAt) return null;
  return adminActor(s.user.id, { ...(await requestMeta()), sessionId: s.session.id, stepUpAt: s.session.stepUpAt });
}

/** Guest cart token (random, HttpOnly). Only its hash is stored server-side. */
export async function guestCartToken(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(hostCookieName(CART_COOKIE))?.value ?? jar.get(CART_COOKIE)?.value;
  if (existing && existing.length >= 30) return existing;
  if (!create) return null;
  const token = randomUUID() + randomUUID();
  jar.set(hostCookieName(CART_COOKIE), token, { httpOnly: true, secure: cookieSecure(), sameSite: 'lax', path: '/', maxAge: 60 * 86400 });
  return token;
}

export async function cartRef(create = false) {
  const s = await getWebSession();
  if (s) return { userId: s.user.id } as const;
  const t = await guestCartToken(create);
  return t ? ({ guestToken: t } as const) : null;
}

export { sha256 };
