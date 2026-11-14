import { adminActor, customerActor, sellerActor, type RequestContext } from '@/server/auth/actors';
import { verifyAccessToken, type MobileScope } from '@/server/auth/mobile';
import { resolveSessionById } from '@/server/auth/service';
import type { Actor } from '@/server/core/actor';
import { ApiError } from './errors';

/**
 * Bearer authentication for the mobile API. The access token only locates the session; the session row is re-checked
 * on EVERY request with the same rules as the web (revoked, expired, user not ACTIVE, password changed, staff idle
 * timeout), then the SAME actor builders as the web produce the Actor the domain services authorize.
 *
 *   customer        Customer App session (scope MOBILE) → CUSTOMER actor
 *   seller          Customer App session + seller membership → SELLER actor (store-scoped permissions)
 *   admin           Admin App session (scope ADMIN_MOBILE), staff, MFA verified → ADMIN actor
 *   admin-pre-mfa   Admin App session before TOTP (only MFA enrolment/verification and logout accept it)
 * A Customer App token is never accepted by an admin route and vice versa (scope is part of the signed token and of
 * the session row).
 */
export type AuthMode = 'none' | 'optional-customer' | 'customer' | 'seller' | 'admin' | 'admin-pre-mfa';

export interface AuthResult {
  actor: Actor | null;
  userId: string | null;
  deviceId: string | null;
  mfaVerified: boolean;
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(\S{10,2048})$/i.exec(h.trim());
  return m ? m[1] : null;
}

export async function authenticate(req: Request, mode: AuthMode, ctx: RequestContext): Promise<AuthResult> {
  if (mode === 'none') return { actor: null, userId: null, deviceId: null, mfaVerified: false };
  const token = bearer(req);
  if (!token) {
    if (mode === 'optional-customer') return { actor: null, userId: null, deviceId: null, mfaVerified: false };
    throw new ApiError('unauthenticated');
  }
  const p = verifyAccessToken(token);
  const wantScope: MobileScope = mode === 'admin' || mode === 'admin-pre-mfa' ? 'ADMIN_MOBILE' : 'MOBILE';
  if (!p || p.sc !== wantScope) throw new ApiError('unauthenticated');
  const row = await resolveSessionById(p.sid, wantScope);
  if (!row || row.user.id !== p.uid) throw new ApiError('unauthenticated');
  const c: RequestContext = { ...ctx, sessionId: row.session.id, stepUpAt: row.session.stepUpAt, channel: wantScope, deviceId: p.did };
  if (wantScope === 'ADMIN_MOBILE') {
    if (!row.user.isStaff) throw new ApiError('unauthenticated');
    const mfaVerified = !!row.session.mfaVerifiedAt;
    if (mode === 'admin' && !mfaVerified) throw new ApiError('mfa_required');
    return { actor: await adminActor(row.user.id, c), userId: row.user.id, deviceId: p.did, mfaVerified };
  }
  if (mode === 'seller') {
    const a = await sellerActor(row.user.id, c);
    if (!a) throw new ApiError('seller_required');
    return { actor: a, userId: row.user.id, deviceId: p.did, mfaVerified: false };
  }
  return { actor: customerActor(row.user.id, c), userId: row.user.id, deviceId: p.did, mfaVerified: false };
}
