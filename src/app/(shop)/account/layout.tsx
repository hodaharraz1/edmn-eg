import { LogOut, ShieldCheck, Store } from 'lucide-react';
import Link from '@/ui/link';
import { logoutAction } from '@/app/_actions/shop';
import { AccountNav } from '@/app/_components/account-nav';
import { requireCustomer, requireUser } from '@/server/web/session';
import { sellerContextForUser, splitInvitations, staffInvitationsForUser } from '@/server/modules/sellers/service';
import { unreadForUser } from '@/server/modules/messaging/service';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireCustomer('/account');
  const user = await requireUser('/account');
  const [seller, unread, invitations] = await Promise.all([sellerContextForUser(user.id), unreadForUser(user.id), staffInvitationsForUser(user.id)]);
  const pendingInvitations = splitInvitations(invitations).open.length;
  return (
    <div className="container-page grid grid-cols-1 gap-6 py-6 lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-3">
        <div className="relative isolate hidden overflow-hidden rounded-2xl bg-brand-950 p-4 text-white shadow-[var(--shadow-card)] lg:block">
          <div aria-hidden className="absolute -left-10 -top-10 -z-10 size-32 rounded-full bg-brand-500/40 blur-2xl" />
          <p className="text-xs text-brand-100/80">أهلاً</p>
          <p className="truncate font-bold">{user.fullName}</p>
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300"><ShieldCheck className="size-3.5" aria-hidden /> مشترياتك محمية مع اضمن</p>
        </div>
        <AccountNav unreadMessages={unread} />
        {pendingInvitations > 0 && (
          <Link href="/account/store-invitations" data-testid="store-invitations-link" className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
            <Store className="size-4" /> دعوات متاجر مستنية ردك ({pendingInvitations})
          </Link>
        )}
        <div className="hidden space-y-1 lg:block">
          <Link href={seller ? '/seller' : '/sell'} className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-brand-700 hover:bg-white">
            <Store className="size-4" /> {seller ? 'مركز البائع' : 'ابدأ بيع على اضمن'}
          </Link>
          <form action={logoutAction}>
            <button className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-sm text-red-700 hover:bg-white">
              <LogOut className="size-4" /> تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
