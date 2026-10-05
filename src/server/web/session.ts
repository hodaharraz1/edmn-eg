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
import { sha256 } from '@/server/core/crypto';

export const WEB_COOKIE = 'edmn_sid';
export const ADMIN_COOKIE = 'edmn_admin_sid';
export const CART_COOKIE = 'edmn_cart';

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
  (await cookies()).set(name, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeHours * 3600,
  });
}

export async function clearCookie(name: string) {
  (await cookies()).delete(name);
}

/** Current customer/seller web session (cached per request). */
export const getWebSession = cache(async () => {
  const token = (await cookies()).get(WEB_COOKIE)?.value;
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
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function customerActorOrNull(): Promise<Actor | null> {
  const s = await getWebSession();
  if (!s) return null;
  return customerActor(s.user.id, { ...(await requestMeta()), sessionId: s.session.id });
}

/** For pages/actions that need a signed-in user. Redirects to login preserving the target. */
export async function requireCustomer(next = '/account'): Promise<Actor> {
  const a = await customerActorOrNull();
  if (!a) redirect(`/login?next=${encodeURIComponent(next)}`);
  return a;
}

/** Seller Center access: signed in AND associated with a seller account (any status). */
export async function requireSellerActor(next = '/seller'): Promise<Actor> {
  const s = await getWebSession();
  if (!s) redirect(`/seller/login?next=${encodeURIComponent(next)}`);
  const a = await sellerActor(s.user.id, { ...(await requestMeta()), sessionId: s.session.id });
  if (!a) redirect('/seller/register');
  return a;
}

export const getAdminSession = cache(async () => {
  // With host routing on, admin sessions are only honoured on the admin host — never on www./seller.
  if (process.env.ENFORCE_HOSTS === 'true') {
    const host = ((await headers()).get('host') ?? '').split(':')[0].toLowerCase();
    if (host !== (process.env.ADMIN_HOST ?? 'admin.edmneg.com').toLowerCase()) return null;
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
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
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing && existing.length >= 30) return existing;
  if (!create) return null;
  const token = randomUUID() + randomUUID();
  jar.set(CART_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: 'lax', path: '/', maxAge: 60 * 86400 });
  return token;
}

export async function cartRef(create = false) {
  const s = await getWebSession();
  if (s) return { userId: s.user.id } as const;
  const t = await guestCartToken(create);
  return t ? ({ guestToken: t } as const) : null;
}

export { sha256 };
