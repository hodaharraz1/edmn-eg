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
  return (
    <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden bg-brand-950 p-4 lg:flex lg:flex-col lg:gap-4">
        <div className="space-y-1"><Logo href="/seller" className="text-white" label="مركز بائعي اضمن" /><p className="text-[11px] font-semibold tracking-wide text-amber-300" dir="ltr">EDMN Seller Center</p></div>
        <div className="rounded-lg bg-white/10 p-3 text-xs text-white">
          <p className="truncate font-semibold">{store?.name ?? 'متجري'}</p>
          <div className="mt-1 flex items-center justify-between"><StatusChip status={ctx.seller.status} /><span className="text-white/60">{ctx.role === 'STORE_OWNER' ? 'المالك' : label('sellerRole', ctx.role)}</span></div>
        </div>
        <div className="flex-1 overflow-y-auto"><SellerNav /></div>
        <form action={logoutAction}><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10"><LogOut className="size-4" /> خروج</button></form>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-4">
          <Drawer title="مركز البائع" trigger={<button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-page lg:hidden" aria-label="القائمة"><Menu className="size-5" /></button>}>
            <div className="rounded-xl bg-brand-950 p-2"><SellerNav /></div>
          </Drawer>
          <span className="font-bold lg:hidden">مركز البائع</span>
          <span className="flex-1" />
          {store && ctx.seller.status === 'APPROVED' && (
            <Link href={marketHref(`/store/${store.slug}`)} target="_blank" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ExternalLink className="size-4" /> عرض المتجر</Link>
          )}
          <span className="hidden text-sm text-muted sm:inline">{user.fullName}</span>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
