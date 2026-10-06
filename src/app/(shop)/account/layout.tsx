import { LogOut, Store } from 'lucide-react';
import Link from 'next/link';
import { logoutAction } from '@/app/_actions/shop';
import { AccountNav } from '@/app/_components/account-nav';
import { requireCustomer, requireUser } from '@/server/web/session';
import { sellerContextForUser } from '@/server/modules/sellers/service';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireCustomer('/account');
  const user = await requireUser('/account');
  const seller = await sellerContextForUser(user.id);
  return (
    <div className="container-page grid grid-cols-1 gap-6 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-3">
        <div className="hidden rounded-xl bg-white p-4 shadow-sm ring-1 ring-line lg:block">
          <p className="text-xs text-muted">أهلاً</p>
          <p className="font-bold">{user.fullName}</p>
        </div>
        <AccountNav />
        <div className="hidden space-y-1 lg:block">
          <Link href={seller ? '/seller' : '/sell'} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-700 hover:bg-white">
            <Store className="size-4" /> {seller ? 'مركز البائع' : 'ابدأ بيع على اضمن'}
          </Link>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-white">
              <LogOut className="size-4" /> تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
