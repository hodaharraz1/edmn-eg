import { ShoppingCart, User, UserPlus } from 'lucide-react';
import Link from '@/ui/link';
import { CategoryMenu } from '@/app/_components/category-menu';
import { DeliveryLocationPicker } from '@/app/_components/delivery-location';
import { LiveIconLink } from '@/app/_components/live/live-provider';
import { ShopMenuDrawer } from '@/app/_components/shop-menu';
import { NAV_LINK } from '@/app/_components/nav-styles';
import { SiteNav } from '@/app/_components/site-nav';
import { SiteSearch } from '@/app/_components/site-search';
import { t } from '@/lib/i18n';
import { LOGO_HEIGHT, LOGO_SRC, LOGO_WIDTH } from '@/ui/logo';
import { allGovernorates, deliveryGovernorate, headerState, navCategories } from '@/server/web/context';

const ICON_BTN = 'grid size-11 place-items-center rounded-xl text-white hover:bg-white/10 aria-[current=page]:bg-white/15';

/**
 * Public-site header (approved homepage design, used on every marketplace page). Deep navy, one grid:
 *  desktop  logo · primary navigation · delivery governorate · messages / notifications / cart / account
 *           then the long marketplace search
 *  mobile   menu · logo · «التوصيل إلى» · messages / cart   →   near-full-width search (notifications from sm up;
 *           on the smallest phones they are one tap away in the account page)
 * Same data and features as before: category mega menu (under «المنتجات», with deals / best sellers / used /
 * all products quick links), live badges, cart count, mobile drawer. Each control exists once in the DOM.
 * The official logo is never altered: it sits on a white plate because the artwork is made for light surfaces.
 */
export async function SiteHeader() {
  const [{ user, cartCount, unread, unreadMessages }, cats, gov, govs] = await Promise.all([headerState(), navCategories(), deliveryGovernorate(), allGovernorates()]);
  return (
    <header className="sticky top-0 z-40 bg-brand-950 pt-[env(safe-area-inset-top)] text-white shadow-[0_8px_24px_-16px_rgb(0_0_0/0.6)]">
      <div className="container-page grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-1 gap-y-2 pb-3 pt-2 [grid-template-areas:'menu_logo_loc_actions''search_search_search_search'] sm:gap-x-2 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto] lg:gap-x-4 lg:pb-4 lg:pt-3 lg:[grid-template-areas:'logo_nav_loc_actions''search_search_search_search']">
        <div className="[grid-area:menu] lg:hidden">
          <ShopMenuDrawer cats={cats} triggerClassName="size-11 text-white hover:bg-white/10" />
        </div>
        <Link href="/" aria-label="اضمن — الرئيسية" className="flex shrink-0 items-center gap-2.5 [grid-area:logo]">
          <span className="grid h-10 place-items-center rounded-xl bg-white px-1.5 shadow-[0_6px_20px_-8px_rgb(59_130_246/0.7)] lg:h-12 lg:px-2">
            <img src={LOGO_SRC} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" draggable={false} fetchPriority="high" className="h-8 w-auto select-none object-contain lg:h-10" />
          </span>
          <span className="hidden text-[11px] font-medium leading-4 text-brand-100 xl:block">
            سوق آمن
            <br />
            لكل صفقاتك
          </span>
        </Link>

        <SiteNav
          productsMenu={
            <CategoryMenu
              label="المنتجات"
              triggerClassName={`cursor-pointer gap-1 ${NAV_LINK}`}
              quickLinks={[
                { href: '/search', label: 'كل المنتجات' },
                { href: '/deals', label: t('nav.deals') },
                { href: '/best-sellers', label: t('nav.bestSellers') },
                { href: '/search?condition=USED', label: 'المستعمل' },
                { href: '/categories', label: 'كل التصنيفات' },
              ]}
              categories={cats.map((c) => ({ id: c.id, slug: c.slug, nameAr: c.nameAr, children: c.children.slice(0, 6).map((ch) => ({ id: ch.id, slug: ch.slug, nameAr: ch.nameAr })) }))}
            />
          }
        />

        {gov && (
          <div className="min-w-0 justify-self-end [grid-area:loc]">
            <DeliveryLocationPicker tone="dark" governorates={govs.map((g) => ({ id: g.id, nameAr: g.nameAr }))} current={{ id: gov.id, nameAr: gov.nameAr }} className="min-h-11 max-w-[5.5rem] sm:max-w-32" />
          </div>
        )}

        <div className="flex items-center justify-self-end gap-0.5 [grid-area:actions] sm:gap-1">
          {user && <LiveIconLink href="/account/messages" kind="messages" fallback={unreadMessages} testId="header-messages" className={ICON_BTN} />}
          {user && <LiveIconLink href="/account/notifications" kind="notifications" fallback={unread} testId="header-notifications" className={`hidden sm:grid ${ICON_BTN}`} />}
          <Link href="/cart" className={`relative ${ICON_BTN}`} aria-label={`السلة (${cartCount})`}>
            <ShoppingCart className="size-6" />
            <span className="absolute -top-0.5 end-0 grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white ring-2 ring-brand-950">{cartCount}</span>
          </Link>
          {user ? (
            <Link href="/account" className="ms-1 hidden h-11 items-center gap-1.5 rounded-xl border border-white/25 px-3 text-sm font-semibold hover:bg-white/10 sm:flex">
              <User className="size-4" aria-hidden /> {t('nav.account')}
            </Link>
          ) : (
            <>
              <Link href="/login" className="ms-1 hidden h-11 items-center gap-1.5 rounded-xl border border-white/25 px-3 text-sm font-semibold hover:bg-white/10 sm:flex">
                <User className="size-4" aria-hidden /> {t('action.login')}
              </Link>
              <Link href="/register" className="hidden h-11 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 text-sm font-bold hover:bg-brand-500 md:flex">
                <UserPlus className="size-4" aria-hidden /> إنشاء حساب
              </Link>
            </>
          )}
        </div>

        <div className="[grid-area:search]">
          <SiteSearch categories={cats.map((c) => ({ slug: c.slug, nameAr: c.nameAr }))} />
        </div>
      </div>
    </header>
  );
}
