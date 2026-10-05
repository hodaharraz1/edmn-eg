'use server';

import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { logout } from '@/server/auth/service';
import { db } from '@/server/db/client';
import { wishlistItems } from '@/server/db/schema';
import { addToCart, updateCartItem } from '@/server/modules/commerce/cart';
import { runAction, int, str, type ActionState, safeNext } from '@/server/web/action';
import { GOV_COOKIE } from '@/server/web/context';
import { cartRef, clearCookie, getWebSession, WEB_COOKIE } from '@/server/web/session';
import { cookieSecure } from '@/server/core/env';

export async function setGovernorateAction(fd: FormData) {
  const id = int(fd, 'governorateId');
  if (id && id > 0 && id < 100) {
    (await cookies()).set(GOV_COOKIE, String(id), { path: '/', maxAge: 365 * 86400, sameSite: 'lax', secure: cookieSecure() });
  }
  revalidatePath('/', 'layout');
}

export async function addToCartAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const buyNow = str(fd, 'intent') === 'buy';
  const res = await runAction(async () => {
    const ref = await cartRef(true);
    const variantId = str(fd, 'variantId');
    const qty = int(fd, 'quantity') ?? 1;
    await addToCart(ref!, variantId, qty);
    return { message: 'تمت الإضافة إلى السلة' };
  });
  if (res.ok && buyNow) redirect('/cart');
  revalidatePath('/', 'layout');
  return res;
}

export async function updateCartAction(fd: FormData) {
  const ref = await cartRef(false);
  if (!ref) return;
  await runAction(async () => updateCartItem(ref, str(fd, 'variantId'), int(fd, 'quantity') ?? 0));
  revalidatePath('/cart');
}

export async function toggleWishlistAction(fd: FormData) {
  const s = await getWebSession();
  const productId = str(fd, 'productId');
  if (!s) redirect(`/login?next=${encodeURIComponent(str(fd, 'back') || '/')}`);
  if (!/^[0-9a-f-]{36}$/.test(productId)) return;
  const [ex] = await db.select().from(wishlistItems).where(and(eq(wishlistItems.userId, s.user.id), eq(wishlistItems.productId, productId)));
  if (ex) await db.delete(wishlistItems).where(and(eq(wishlistItems.userId, s.user.id), eq(wishlistItems.productId, productId)));
  else await db.insert(wishlistItems).values({ userId: s.user.id, productId }).onConflictDoNothing();
  revalidatePath('/account/wishlist');
  revalidatePath(safeNext(str(fd, 'back'), '/'));
}

export async function logoutAction() {
  const s = await getWebSession();
  if (s) await logout(s.token);
  await clearCookie(WEB_COOKIE);
  redirect('/');
}
