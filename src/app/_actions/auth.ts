'use server';

import { redirect } from 'next/navigation';
import { login, register, requestPasswordReset, resetPassword } from '@/server/auth/service';
import { env } from '@/server/core/env';
import { mergeGuestCart } from '@/server/modules/commerce/cart';
import { runAction, safeNext, str, type ActionState } from '@/server/web/action';
import { CART_COOKIE, clearCookie, guestCartToken, requestMeta, setSessionCookie, WEB_COOKIE } from '@/server/web/session';

async function afterLogin(token: string, userId: string) {
  await setSessionCookie(WEB_COOKIE, token, env().SESSION_TTL_HOURS);
  const guest = await guestCartToken(false);
  if (guest) {
    await mergeGuestCart(guest, userId);
    await clearCookie(CART_COOKIE);
  }
}

export async function loginAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const next = safeNext(str(fd, 'next'), '/');
  const res = await runAction(async () => {
    const { token, user } = await login(str(fd, 'identifier'), str(fd, 'password'), 'WEB', await requestMeta());
    await afterLogin(token, user.id);
  });
  if (res.ok) redirect(next);
  return res;
}

export async function registerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const next = safeNext(str(fd, 'next'), '/');
  if (str(fd, 'terms') !== 'on') return { ok: false, error: 'يجب الموافقة على شروط الاستخدام وسياسة الخصوصية', at: Date.now() };
  const res = await runAction(async () => {
    const { token, user } = await register({ fullName: str(fd, 'fullName'), email: str(fd, 'email'), phone: str(fd, 'phone'), password: str(fd, 'password') }, await requestMeta());
    await afterLogin(token, user.id);
  });
  if (res.ok) redirect(next);
  return res;
}

export async function forgotPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requestPasswordReset(str(fd, 'identifier'), await requestMeta());
    return { message: 'إذا كان الحساب موجوداً فسيصلك رابط إعادة تعيين كلمة المرور خلال دقائق.' };
  });
}

export async function resetPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  if (str(fd, 'password') !== str(fd, 'confirm')) return { ok: false, error: 'كلمتا المرور غير متطابقتين', at: Date.now() };
  const res = await runAction(async () => resetPassword(str(fd, 'token'), str(fd, 'password'), await requestMeta()));
  if (res.ok) redirect('/login?reset=1');
  return res;
}
