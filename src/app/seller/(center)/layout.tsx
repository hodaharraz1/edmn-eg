import type { Metadata } from 'next';
import { label } from '@/lib/i18n/labels';
import Link from 'next/link';
import { ExternalLink, LogOut, Menu } from 'lucide-react';
import { logoutAction } from '@/app/_actions/shop';
import { SellerNav } from '@/app/_components/seller-nav';
import { Drawer } from '@/ui/client';
import { Logo } from '@/ui/logo';
import { StatusChip } from '@/ui/feedback';
import { requireSellerActor, requireUser } from '@/server/web/session';
import { sellerContextForUser } from '@/server/modules/sellers/service';
import { unreadForSeller } from '@/server/modules/messaging/service';
import { unreadGeneralNotifications } from '@/server/modules/messaging/live';
import { prefsFor } from '@/server/modules/notifications/message-alerts';
import { vapidPublicKey } from '@/server/modules/notifications/push';
import { LiveIconLink, LiveProvider } from '@/app/_components/live/live-provider';
import { db } from '@/server/db/client';
import { stores } from '@/server/db/schema';
import { marketHref } from '@/lib/market-url';
import { eq } from 'drizzle-orm';

export const metadata: Metadata = { title: { default: 'مركز البائع', template: '%s | مركز البائع — اضمن' }, robots: { index: false, follow: false } };

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireSellerActor('/seller');
  const user = await requireUser('/seller');
  const ctx = (await sellerContextForUser(user.id))!;
  const [store] = await db.select({ name: stores.name, slug: stores.slug }).from(stores).where(eq(stores.sellerId, actor.sellerId!));
  const canMessage = !!actor.sellerPermissions?.has('orders.communicate');
  const [unread, unreadNotifs, prefs] = await Promise.all([unreadForSeller(actor), unreadGeneralNotifications(user.id), prefsFor(db, user.id)]);
  return (
    <LiveProvider surface="seller" initialUnreadMessages={unread} initialUnreadNotifications={unreadNotifs} inApp={prefs.messagesInApp} sound={prefs.messagesSound} pushKey={vapidPublicKey()}>
    <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden bg-brand-950 p-4 lg:flex lg:flex-col lg:gap-4">
        <div className="-mx-4 -mt-4 flex flex-col items-center gap-1 bg-white px-4 py-4"><Logo href="/seller" variant="sidebar" label="مركز بائعي اضمن" /><p className="text-[11px] font-bold tracking-wide text-brand-800" dir="ltr">EDMN Seller Center</p></div>
        <div className="rounded-lg bg-white/10 p-3 text-xs text-white">
          <p className="truncate font-semibold">{store?.name ?? 'متجري'}</p>
          <div className="mt-1 flex items-center justify-between"><StatusChip status={ctx.seller.status} /><span className="text-white/60">{ctx.role === 'STORE_OWNER' ? 'المالك' : label('sellerRole', ctx.role)}</span></div>
        </div>
        <div className="flex-1 overflow-y-auto"><SellerNav unreadMessages={unread} canMessage={canMessage} /></div>
        <form action={logoutAction}><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10"><LogOut className="size-4" /> خروج</button></form>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-4">
          <Drawer title="مركز البائع" trigger={<button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-page lg:hidden" aria-label="القائمة"><Menu className="size-5" /></button>}>
            <div className="rounded-xl bg-brand-950 p-2"><SellerNav unreadMessages={unread} canMessage={canMessage} /></div>
          </Drawer>
          <Logo href="/seller" variant="mobile" label="مركز بائعي اضمن" className="lg:hidden" />
          <span className="font-bold lg:hidden">مركز البائع</span>
          <span className="flex-1" />
          {store && ctx.seller.status === 'APPROVED' && (
            <Link href={marketHref(`/store/${store.slug}`)} target="_blank" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ExternalLink className="size-4" /> عرض المتجر</Link>
          )}
          {canMessage && (
            <LiveIconLink
              href="/seller/messages"
              kind="messages"
              fallback={unread}
              showLabel
              testId="seller-header-messages"
              className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-page aria-[current=page]:bg-brand-50 aria-[current=page]:font-semibold aria-[current=page]:text-brand-800 [&>span:last-child]:hidden sm:[&>span:last-child]:inline"
            />
          )}
          <LiveIconLink href="/seller/notifications" kind="notifications" fallback={unreadNotifs} testId="seller-header-notifications" className="grid size-10 place-items-center rounded-lg hover:bg-page aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-800" />
          <span className="hidden text-sm text-muted sm:inline">{user.fullName}</span>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
    </LiveProvider>
  );
}
