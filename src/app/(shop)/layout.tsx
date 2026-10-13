import { BottomNav } from '@/app/_components/bottom-nav';
import { LiveProvider } from '@/app/_components/live/live-provider';
import { ShopFooter } from '@/app/_components/shop-footer';
import { ShopHeader } from '@/app/_components/shop-header';
import { headerState, liveBootstrap } from '@/server/web/context';
import { TRANSACTIONS_CLOSED_MESSAGE, transactionsState } from '@/server/ops/commerce-gate';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const [boot, hs, tx] = await Promise.all([liveBootstrap(), headerState(), transactionsState()]);
  const page = (
    <>
      <ShopHeader />
      {!tx.open && (
        <div role="status" data-testid="transactions-closed" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {TRANSACTIONS_CLOSED_MESSAGE[tx.reason]}
        </div>
      )}
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
