import 'server-only';
import { headers } from 'next/headers';
import { sellerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { customerActorOrNull, getWebSession, requestMeta } from './session';

/** Non-redirecting actor for JSON route handlers. `seller` = Seller Center identity (store member). */
export async function liveActor(surface: 'account' | 'seller'): Promise<Actor | null> {
  if (surface === 'seller') {
    const s = await getWebSession();
    if (!s) return null;
    return sellerActor(s.user.id, { ...(await requestMeta()), sessionId: s.session.id });
  }
  return customerActorOrNull();
}

/** State-changing JSON endpoints: same-origin only (in addition to SameSite=Lax session cookies). */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get('origin');
  if (!origin) return h.get('sec-fetch-site') === 'same-origin';
  try {
    return new URL(origin).host === (h.get('x-forwarded-host') ?? h.get('host'));
  } catch {
    return false;
  }
}

export const noStore = { 'cache-control': 'no-store, private' };
