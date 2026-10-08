import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { safeInternalPath } from '@/app/_components/notification-center';
import { db } from '@/server/db/client';
import { notifications } from '@/server/db/schema';
import { getWebSession } from '@/server/web/session';

export const dynamic = 'force-dynamic';

/**
 * Open a notification: mark THAT notification read (only the owner's), then go to its internal link.
 * The destination page re-checks authorization; opening never marks messages read or changes money.
 */
export async function GET(req: Request, ctx: RouteContext<'/seller/notifications/open/[id]'>) {
  const { id } = await ctx.params;
  const back = '/seller/notifications';
  const s = await getWebSession();
  if (!s) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(back)}`, req.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(new URL(back, req.url));
  const [n] = await db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, s.user.id)));
  if (!n) return NextResponse.redirect(new URL(back, req.url));
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), isNull(notifications.readAt)));
  return NextResponse.redirect(new URL(safeInternalPath(n.link, back), req.url));
}
