import { Bell, ChevronDown, Heart, LayoutGrid, Menu, Package, Search, ShieldCheck, ShoppingCart, Store, User } from 'lucide-react';
import Link from 'next/link';
import { DeliveryLocationPicker } from '@/app/_components/delivery-location';
import { t } from '@/lib/i18n';
import { Logo } from '@/ui/logo';
import { Drawer } from '@/ui/client';
import { allGovernorates, deliveryGovernorate, headerState, navCategories } from '@/server/web/context';

export async function ShopHeader({ q }: { q?: string }) {
  const [{ user, cartCount, unread }, cats, gov, govs] = await Promise.all([headerState(), navCategories(), deliveryGovernorate(), allGovernorates()]);
  return (
    <header className="sticky top-0 z-40 shadow-md">
      {/* Light brand bar: the official logo is transparent and must sit on a light surface. */}
      <div className="border-b border-line bg-white text-ink">
      <div className="container-page flex flex-wrap items-center gap-x-3 gap-y-2 py-2 lg:h-16 lg:flex-nowrap lg:py-0">
        <Drawer
          title="القائمة"
          trigger={
            <button type="button" className="grid size-10 place-items-center rounded-lg text-brand-900 hover:bg-page lg:hidden" aria-label="القائمة">
              <Menu className="size-6" />
            </button>
          }
        >
          <nav className="space-y-1 text-ink">
            <Link href="/protected-deal" className="flex items-center gap-2 rounded-lg bg-accent-50 p-3 font-semibold text-accent-700">
              <ShieldCheck className="size-5" /> {t('nav.protectedDeal')}
            </Link>
            {[
              ['/deals', t('nav.deals')],
              ['/best-sellers', t('nav.bestSellers')],
              ['/search?condition=USED', 'المستعمل'],
              ['/account/wishlist', 'المفضلة'],
              ['/stores', t('nav.stores')],
              ['/sell', t('nav.sell')],
            ].map(([href, l]) => (
              <Link key={href} href={href} className="block rounded-lg p-3 hover:bg-page">
                {l}
              </Link>
            ))}
            <p className="px-3 pt-4 text-xs font-semibold text-muted">{t('nav.categories')}</p>
            {cats.map((c) => (
              <Link key={c.id} href={`/category/${c.slug}`} className="block rounded-lg p-3 hover:bg-page">
                {c.nameAr}
              </Link>
            ))}
          </nav>
        </Drawer>
        <Logo variant="header" priority />

        {gov && (
          <DeliveryLocationPicker
            governorates={govs.map((g) => ({ id: g.id, nameAr: g.nameAr }))}
            current={{ id: gov.id, nameAr: gov.nameAr }}
            className="max-w-28 lg:max-w-36"
          />
        )}

        <form action="/search" role="search" className="order-last flex min-w-0 basis-full lg:order-none lg:basis-auto lg:flex-1">
          <label htmlFor="site-search" className="sr-only">
            بحث
          </label>
          <input
            id="site-search"
            name="q"
            defaultValue={q}
            placeholder={t('search.placeholder')}
            className="h-11 min-w-0 flex-1 rounded-s-xl border border-e-0 border-line bg-white px-4 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-300"
            autoComplete="off"
            enterKeyHint="search"
          />
          <button className="grid h-11 w-12 place-items-center rounded-e-xl bg-amber-400 text-brand-950 hover:bg-amber-300" aria-label="بحث">
            <Search className="size-5" />
          </button>
        </form>

        <nav className="ms-auto flex shrink-0 items-center gap-1 lg:ms-0" aria-label="الحساب">
          {user ? (
            <Link href="/account" className="hidden items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-page sm:flex">
              <User className="size-5" aria-hidden />
              <span className="text-xs leading-tight">
                <span className="block opacity-75">أهلاً، {user.fullName.split(' ')[0]}</span>
                <span className="font-semibold">{t('nav.account')}</span>
              </span>
            </Link>
          ) : (
            <Link href="/login" className="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold hover:bg-page sm:flex">
              <User className="size-5" aria-hidden /> {t('action.login')}
            </Link>
          )}
          <Link href="/account/orders" className="hidden items-center gap-1.5 rounded-lg px-2 py-2 text-sm hover:bg-page md:flex">
            <Package className="size-5" aria-hidden /> {t('nav.orders')}
          </Link>
          {user && (
            <Link href="/account/notifications" className="relative hidden rounded-lg p-2 hover:bg-page sm:block" aria-label={`الإشعارات${unread ? ` (${unread} غير مقروءة)` : ''}`}>
              <Bell className="size-5" />
              {unread > 0 && <span className="absolute top-1 end-1 grid min-w-4 place-items-center rounded-full bg-accent-600 px-1 text-[10px] font-bold text-white">{unread}</span>}
            </Link>
          )}
          <Link href="/cart" className="relative flex items-center gap-1 rounded-lg p-2 hover:bg-page" aria-label={`السلة (${cartCount})`}>
            <ShoppingCart className="size-6" />
            <span className="absolute -top-0.5 end-0 grid min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-brand-950">{cartCount}</span>
            <span className="hidden text-sm font-semibold xl:inline">{t('nav.cart')}</span>
          </Link>
        </nav>
      </div>
      </div>

      <nav className="hidden bg-brand-800 text-white lg:block" aria-label="التنقل الرئيسي">
        <div className="container-page flex h-11 items-center gap-1 text-sm">
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold hover:bg-white/10">
              <LayoutGrid className="size-4" /> {t('nav.categories')} <ChevronDown className="size-3.5" />
            </summary>
            <div className="absolute top-10 start-0 z-50 grid w-[760px] grid-cols-3 gap-4 rounded-xl bg-white p-5 text-ink shadow-[var(--shadow-pop)]">
              {cats.map((c) => (
                <div key={c.id}>
                  <Link href={`/category/${c.slug}`} className="font-bold hover:text-brand-700">
                    {c.nameAr}
                  </Link>
                  <ul className="mt-1 space-y-0.5">
                    {c.children.slice(0, 6).map((ch) => (
                      <li key={ch.id}>
                        <Link href={`/category/${ch.slug}`} className="text-sm text-muted hover:text-brand-700">
                          {ch.nameAr}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
          {[
            ['/deals', t('nav.deals')],
            ['/best-sellers', t('nav.bestSellers')],
            ['/search?condition=USED', 'المستعمل'],
            ['/stores', t('nav.stores')],
          ].map(([href, l]) => (
            <Link key={href} href={href} className="rounded-md px-3 py-1.5 hover:bg-white/10">
              {l}
            </Link>
          ))}
          <span className="flex-1" />
          <Link href="/protected-deal" className="flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-1.5 font-semibold hover:bg-accent-700">
            <ShieldCheck className="size-4" /> {t('nav.protectedDeal')}
          </Link>
          <Link href="/sell" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 hover:bg-white/10">
            <Store className="size-4" /> {t('nav.sell')}
          </Link>
          {user && (
            <Link href="/account/wishlist" className="rounded-md p-1.5 hover:bg-white/10" aria-label="المفضلة">
              <Heart className="size-4" />
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
