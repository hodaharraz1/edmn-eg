import { BottomNav } from '@/app/_components/bottom-nav';
import { LiveProvider } from '@/app/_components/live/live-provider';
import { ShopFooter } from '@/app/_components/shop-footer';
import { ShopHeader } from '@/app/_components/shop-header';
import { headerState, liveBootstrap } from '@/server/web/context';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [boot, hs] = await Promise.all([liveBootstrap(), headerState()]);
  const page = (
    <>
      <ShopHeader />
      <main id="main" className="min-h-[60vh] pb-20 lg:pb-0">
        {children}
      </main>
      <ShopFooter />
      <BottomNav signedIn={!!boot} unreadMessages={hs.unreadMessages} />
    </>
  );
  if (!boot) return page;
  // Signed-in: live badges, incoming-message toasts and conversation updates on every marketplace page.
  return (
    <LiveProvider surface="account" initialUnreadMessages={hs.unreadMessages} initialUnreadNotifications={hs.unread} inApp={boot.prefs.messagesInApp} sound={boot.prefs.messagesSound} pushKey={boot.pushKey} userKey={boot.userKey}>
      {page}
    </LiveProvider>
  );
}
