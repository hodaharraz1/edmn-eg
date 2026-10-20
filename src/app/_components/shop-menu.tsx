import { Menu, ShieldCheck } from 'lucide-react';
import Link from '@/ui/link';
import { t } from '@/lib/i18n';
import { Drawer } from '@/ui/client';
import { cn } from '@/lib/cn';

/** Mobile navigation drawer shared by the marketplace headers (same links on every page). */
export function ShopMenuDrawer({ cats, triggerClassName }: { cats: { id: string; slug: string; nameAr: string }[]; triggerClassName?: string }) {
  return (
    <Drawer
      title="القائمة"
      trigger={
        <button type="button" className={cn('grid size-10 place-items-center rounded-xl text-brand-900 hover:bg-page lg:hidden', triggerClassName)} aria-label="القائمة">
          <Menu className="size-6" />
        </button>
      }
    >
      <nav className="space-y-1 text-ink">
        <Link href="/protected-deal" className="flex items-center gap-2 rounded-xl bg-brand-950 p-3 font-semibold text-white">
          <ShieldCheck className="size-5" /> {t('nav.protectedDeal')}
        </Link>
        {[
          ['/deals', t('nav.deals')],
          ['/best-sellers', t('nav.bestSellers')],
          ['/used', 'سوق المستعمل المضمون'],
          ['/account/wishlist', 'المفضلة'],
          ['/stores', t('nav.stores')],
          ['/sell', t('nav.sell')],
        ].map(([href, l]) => (
          <Link key={href} href={href} className="block rounded-xl p-3 hover:bg-page">
            {l}
          </Link>
        ))}
        <p className="px-3 pt-4 text-xs font-semibold text-muted">{t('nav.categories')}</p>
        {cats.map((c) => (
          <Link key={c.id} href={`/category/${c.slug}`} className="block rounded-xl p-3 hover:bg-page">
            {c.nameAr}
          </Link>
        ))}
      </nav>
    </Drawer>
  );
}
