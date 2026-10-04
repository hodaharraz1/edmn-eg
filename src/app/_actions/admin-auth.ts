'use server';

import { redirect } from 'next/navigation';
import { beginTotpEnrollment, elevateSession, login, logout, stepUp, verifyTotpForUser } from '@/server/auth/service';
import { env } from '@/server/core/env';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { runAction, safeNext, str, type ActionState } from '@/server/web/action';
import { ADMIN_COOKIE, clearCookie, getAdminSession, requestMeta, setSessionCookie } from '@/server/web/session';

export async function adminLoginAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const { token } = await login(str(fd, 'email'), str(fd, 'password'), 'ADMIN', await requestMeta());
    await setSessionCookie(ADMIN_COOKIE, token, env().ADMIN_SESSION_TTL_HOURS);
  });
  if (res.ok) redirect('/admin/2fa');
  return res;
}

export async function adminTotpBeginAction(): Promise<ActionState> {
  const s = await getAdminSession();
  if (!s) redirect('/admin/login');
  return runAction(async () => {
    const secret = await beginTotpEnrollment(s.user.id);
    return { data: { secret, account: s.user.email } };
  });
}

export async function adminTotpVerifyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await getAdminSession();
  if (!s) redirect('/admin/login');
  const res = await runAction(async () => {
    const ok = await verifyTotpForUser(s.user.id, str(fd, 'code'), await requestMeta());
    if (!ok) return { ok: false, error: 'رمز التحقق غير صحيح' };
    await elevateSession(s.token);
  });
  if (res.ok) redirect('/admin');
  return res;
}

export async function adminStepUpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await getAdminSession();
  if (!s) redirect('/admin/login');
  const next = safeNext(str(fd, 'next'), '/admin');
  const res = await runAction(async () => stepUp(s.token, s.user.id, str(fd, 'code'), await requestMeta()));
  if (res.ok) redirect(next);
  return res;
}

export async function adminLogoutAction() {
  const s = await getAdminSession();
  if (s) await logout(s.token);
  await clearCookie(ADMIN_COOKIE);
  redirect('/admin/login');
}

export async function adminHasTotp() {
  const s = await getAdminSession();
  if (!s) return false;
  const [u] = await db.select({ t: users.totpEnabledAt }).from(users).where(eq(users.id, s.user.id));
  return !!u?.t;
}
