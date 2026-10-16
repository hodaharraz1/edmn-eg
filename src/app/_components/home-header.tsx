import { ShoppingCart, User, UserPlus } from 'lucide-react';
import Link from '@/ui/link';
import { CategoryMenu } from '@/app/_components/category-menu';
import { DeliveryLocationPicker } from '@/app/_components/delivery-location';
import { HomeSearch } from '@/app/_components/home-search';
import { LiveIconLink } from '@/app/_components/live/live-provider';
import { ShopMenuDrawer } from '@/app/_components/shop-menu';
import { t } from '@/lib/i18n';
import { LOGO_HEIGHT, LOGO_SRC, LOGO_WIDTH } from '@/ui/logo';
import { allGovernorates, deliveryGovernorate, headerState, navCategories } from '@/server/web/context';

const NAV_LINK = 'inline-flex min-h-11 items-center rounded-lg px-3 text-white/80 transition-colors hover:bg-white/10 hover:text-white';

/**
 * Homepage header (approved homepage design): dark navy, continuous with the hero. Logo · primary navigation ·
 * account and cart, then the long marketplace search. Same data and features as the standard header: category
 * mega menu (under «المنتجات»), delivery governorate, messages/notifications badges, cart count, mobile drawer.
 * The official logo is never altered: it sits on a white plate because the artwork is made for light surfaces.
 */
export async function HomeHeader() {
  const [{ user, cartCount, unread, unreadMessages }, cats, gov, govs] = await Promise.all([headerState(), navCategories(), deliveryGovernorate(), allGovernorates()]);
  return (
    <header className="sticky top-0 z-40 bg-brand-950 pt-[env(safe-area-inset-top)] text-white shadow-[0_8px_24px_-16px_rgb(0_0_0/0.6)]">
      <div className="container-page flex h-16 items-center gap-2 lg:h-[4.5rem] lg:gap-4">
        <ShopMenuDrawer cats={cats} triggerClassName="size-11 text-white hover:bg-white/10" />
        <Link href="/" aria-label="اضمن — الرئيسية" className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-10 place-items-center rounded-xl bg-white px-1.5 shadow-[0_6px_20px_-8px_rgb(59_130_246/0.7)] lg:h-12 lg:px-2">
            <img src={LOGO_SRC} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" draggable={false} fetchPriority="high" className="h-8 w-auto select-none object-contain lg:h-10" />
          </span>
          <span className="hidden text-[11px] font-medium leading-4 text-brand-100 xl:block">
            سوق آمن
            <br />
            لكل صفقاتك
          </span>
        </Link>

        <nav aria-label="التنقل الرئيسي" className="mx-auto hidden items-center gap-0.5 text-sm font-semibold lg:flex">
          <Link href="/" aria-current="page" className="relative inline-flex min-h-11 items-center rounded-lg px-3 text-white after:absolute after:inset-x-3 after:-bottom-[0.85rem] after:h-0.5 after:rounded-full after:bg-brand-400">
            الرئيسية
          </Link>
          <CategoryMenu
            label="المنتجات"
            triggerClassName={`cursor-pointer gap-1 ${NAV_LINK}`}
            categories={cats.map((c) => ({ id: c.id, slug: c.slug, nameAr: c.nameAr, children: c.children.slice(0, 6).map((ch) => ({ id: ch.id, slug: ch.slug, nameAr: ch.nameAr })) }))}
          />
          <Link href="/stores" className={NAV_LINK}>
            المتاجر
          </Link>
          <Link href="/#escrow" className={NAV_LINK}>
            كيف يعمل الضمان؟
          </Link>
          <Link href="/sell" className={NAV_LINK}>
            مركز البائع
          </Link>
          <Link href="/contact" className={NAV_LINK}>
            المساعدة
          </Link>
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 lg:ms-0">
          {gov && <DeliveryLocationPicker tone="dark" governorates={govs.map((g) => ({ id: g.id, nameAr: g.nameAr }))} current={{ id: gov.id, nameAr: gov.nameAr }} className="min-h-11 max-w-24 xl:max-w-32" />}
          {user && (
            <LiveIconLink
              href="/account/messages"
              kind="messages"
              fallback={unreadMessages}
              testId="header-messages"
              className="hidden size-10 place-items-center rounded-lg text-white hover:bg-white/10 aria-[current=page]:bg-white/15 md:grid"
            />
          )}
          {user && (
            <LiveIconLink href="/account/notifications" kind="notifications" fallback={unread} testId="header-notifications" className="grid size-11 place-items-center rounded-lg text-white hover:bg-white/10 aria-[current=page]:bg-white/15" />
          )}
          <Link href="/cart" className="relative grid size-11 place-items-center rounded-lg hover:bg-white/10" aria-label={`السلة (${cartCount})`}>
            <ShoppingCart className="size-6" />
            <span className="absolute -top-0.5 end-0 grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white ring-2 ring-brand-950">{cartCount}</span>
          </Link>
          {user ? (
            <Link href="/account" className="hidden h-10 items-center gap-1.5 rounded-xl border border-white/25 px-3 text-sm font-semibold hover:bg-white/10 sm:flex">
              <User className="size-4" aria-hidden /> {t('nav.account')}
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden h-10 items-center gap-1.5 rounded-xl border border-white/25 px-3 text-sm font-semibold hover:bg-white/10 sm:flex">
                <User className="size-4" aria-hidden /> {t('action.login')}
              </Link>
              <Link href="/register" className="hidden h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 text-sm font-bold hover:bg-brand-500 md:flex">
                <UserPlus className="size-4" aria-hidden /> إنشاء حساب
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="container-page pb-3 lg:pb-4">
        <HomeSearch categories={cats.map((c) => ({ slug: c.slug, nameAr: c.nameAr }))} />
      </div>
    </header>
  );
}
