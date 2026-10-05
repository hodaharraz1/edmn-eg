'use server';

import { redirect } from 'next/navigation';
import { login, register } from '@/server/auth/service';
import { startApplication } from '@/server/modules/sellers/service';
import { runAction, safeNext, str, type ActionState } from '@/server/web/action';
import { customerActor } from '@/server/auth/actors';
import { env } from '@/server/core/env';
import { mergeGuestCart } from '@/server/modules/commerce/cart';
import { CART_COOKIE, clearCookie, guestCartToken, requestMeta, setSessionCookie, WEB_COOKIE } from '@/server/web/session';

async function afterLogin(token: string, userId: string) {
  await setSessionCookie(WEB_COOKIE, token, env().SESSION_TTL_HOURS);
  const guest = await guestCartToken(false);
  if (guest) {
    await mergeGuestCart(guest, userId);
    await clearCookie(CART_COOKIE);
  }
}

/** Seller Center sign-in: same account system as the marketplace, seller-specific landing. */
export async function sellerLoginAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const next = safeNext(str(fd, 'next'), '/seller');
  const res = await runAction(async () => {
    const { token, user } = await login(str(fd, 'identifier'), str(fd, 'password'), 'WEB', await requestMeta());
    await afterLogin(token, user.id);
  });
  if (res.ok) redirect(next.startsWith('/seller') ? next : '/seller');
  return res;
}

/** Self-service seller sign-up: creates the account and opens a DRAFT seller application. */
export async function sellerRegisterAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  if (str(fd, 'terms') !== 'on') return { ok: false, error: 'يجب الموافقة على شروط الاستخدام وسياسة الخصوصية', at: Date.now() };
  const type = str(fd, 'type') === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';
  const res = await runAction(async () => {
    const { token, user } = await register({ fullName: str(fd, 'fullName'), email: str(fd, 'email'), phone: str(fd, 'phone'), password: str(fd, 'password') }, await requestMeta());
    await afterLogin(token, user.id);
    await startApplication(customerActor(user.id, await requestMeta()), type);
  });
  if (res.ok) redirect('/seller/onboarding?step=1');
  return res;
}
