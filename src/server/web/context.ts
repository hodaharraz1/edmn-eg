import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { db } from '@/server/db/client';
import { addresses, governorates } from '@/server/db/schema';
import { unreadGeneralNotifications } from '@/server/modules/messaging/live';
import { unreadForUser } from '@/server/modules/messaging/service';
import { prefsFor } from '@/server/modules/notifications/message-alerts';
import { vapidPublicKey } from '@/server/modules/notifications/push';
import { categoryTree } from '@/server/modules/catalog/taxonomy';
import { cartCount } from '@/server/modules/commerce/cart';
import { cartRef, getWebSession } from './session';
import { sql } from 'drizzle-orm';

export const GOV_COOKIE = 'edmn_gov';

export const allGovernorates = cache(async () => db.select().from(governorates).where(eq(governorates.isActive, true)).orderBy(asc(governorates.sortOrder)));

/** Delivery context: default address governorate for signed-in users, else the chosen cookie, else Cairo. */
export const deliveryGovernorate = cache(async () => {
  const govs = await allGovernorates();
  const s = await getWebSession();
  const cookieGov = Number((await cookies()).get(GOV_COOKIE)?.value);
  if (cookieGov && govs.some((g) => g.id === cookieGov)) return govs.find((g) => g.id === cookieGov)!;
  if (s) {
    const [a] = await db
      .select({ g: addresses.governorateId })
      .from(addresses)
      .where(and(eq(addresses.userId, s.user.id), isNull(addresses.archivedAt)))
      .orderBy(sql`${addresses.isDefault} desc`)
      .limit(1);
    if (a) return govs.find((g) => g.id === a.g) ?? govs[0];
  }
  return govs[0];
});

export const navCategories = cache(async () => categoryTree(db, { activeOnly: true }));

export const headerState = cache(async () => {
  const s = await getWebSession();
  const ref = await cartRef(false);
  const count = ref ? await cartCount(ref) : 0;
  // Bell = unread GENERAL notifications; Messages = unread messages. Two concepts, never double-counted.
  let unread = 0;
  let unreadMessages = 0;
  if (s) [unread, unreadMessages] = await Promise.all([unreadGeneralNotifications(s.user.id), unreadForUser(s.user.id)]);
  return { user: s?.user ?? null, cartCount: count, unread, unreadMessages };
});

/** Live-layer bootstrap for the signed-in user: preferences and push availability. */
export const liveBootstrap = cache(async () => {
  const s = await getWebSession();
  if (!s) return null;
  const prefs = await prefsFor(db, s.user.id);
  return { userId: s.user.id, prefs, pushKey: vapidPublicKey() };
});
