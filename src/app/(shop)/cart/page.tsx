import type { Metadata } from 'next';
import Link from '@/ui/link';
import { BadgeCheck, ShieldCheck, ShoppingCart, Store, Trash2 } from 'lucide-react';
import { updateCartAction } from '@/app/_actions/shop';
import { QtySelect } from '@/app/_components/qty-select';
import { cartView } from '@/server/modules/commerce/cart';
import { deliveryGovernorate } from '@/server/web/context';
import { cartRef, currentUser } from '@/server/web/session';
import { formatEGP } from '@/lib/format';
import { LinkButton } from '@/ui/button';
import { DeliveryLine, mediaUrl } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { Alert, EmptyState } from '@/ui/feedback';
import { ProtectionNote } from '@/ui/protection';
import { SafeImg } from '@/ui/safe-img';

export const metadata: Metadata = { title: 'السلة', robots: { index: false } };

const ISSUE_TEXT: Record<string, string> = {
  UNAVAILABLE: 'المنتج ده مبقاش متاح — احذفه عشان تكمّل',
  SELLER_UNAVAILABLE: 'المتجر مش متاح دلوقتي',
  INSUFFICIENT_STOCK: 'الكمية المطلوبة أكبر من المتاح',
  PRICE_CHANGED: 'السعر اتغيّر من وقت ما ضفته للسلة',
  NO_SHIPPING: 'البائع لا يشحن إلى هذه المحافظة حالياً',
};

export default async function CartPage() {
  const ref = await cartRef(false);
  const gov = await deliveryGovernorate();
  const cart = ref ? await cartView(ref, gov?.id ?? null) : null;
  const user = await currentUser();
  if (!cart || cart.groups.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState icon={ShoppingCart} title="السلة فاضية" description="تصفّح منتجات البائعين الموثّقين وضيف اللي يعجبك." action={<LinkButton href="/">ابدأ التسوق</LinkButton>} />
      </div>
    );
  }
  // Shipping is re-checked at checkout against the chosen delivery address, so a mismatch with the
  // browsing governorate warns here but does not block checkout.
  const blocking = cart.groups.some((g) => g.lines.some((l) => l.issues.some((i) => i !== 'PRICE_CHANGED' && i !== 'NO_SHIPPING')));
  const shippingWarning = cart.groups.some((g) => g.lines.some((l) => l.issues.includes('NO_SHIPPING')));
  const checkoutHref = user ? '/checkout' : '/login?next=/checkout';
  return (
    <div className="container-page pb-28 pt-6 lg:pb-6">
      <PageHeader title={`السلة (${cart.itemCount})`} description={`التوصيل إلى ${gov?.nameAr} · لو طلبت من أكتر من متجر، كل بائع بيشحن منتجاته لوحده.`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <ProtectionNote className="text-sm">
            <span className="font-bold">مشترياتك محمية مع اضمن</span> — بتدفع لاضمن، والبائع ما بياخدش فلوسه غير بعد الاستلام وتأكيدك (أو انتهاء مهلة الاعتراض) وموافقة الإدارة.
          </ProtectionNote>
          {cart.groups.map((g) => (
            <section key={g.sellerId} className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-soft/50 px-4 py-3">
                <Link href={`/store/${g.storeSlug}`} className="flex min-h-10 items-center gap-2 font-bold text-brand-950 hover:text-brand-700">
                  <span className="grid size-8 place-items-center rounded-xl bg-white text-brand-700 ring-1 ring-line"><Store className="size-4" aria-hidden /></span>
                  من متجر {g.storeName} {g.storeVerified && <BadgeCheck className="size-4 text-brand-600" aria-label="متجر موثّق" />}
                </Link>
                <DeliveryLine fee={g.shippingFee} min={g.etaMinDays !== null ? g.etaMinDays + g.processingDays : null} max={g.etaMaxDays !== null ? g.etaMaxDays + g.processingDays : null} />
              </header>
              <ul className="divide-y divide-line">
                {g.lines.map((l) => (
                  <li key={l.variantId} className="flex gap-3 p-4 sm:gap-4">
                    <Link href={`/product/${l.productSlug}`} className="size-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-slate-100 sm:size-24" aria-hidden tabIndex={-1}>
                      <SafeImg src={l.imageKey ? mediaUrl(l.imageKey, 'thumb') : null} className="size-full p-1.5" />
                    </Link>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link href={`/product/${l.productSlug}`} className="line-clamp-2 text-sm font-semibold hover:text-brand-700">{l.title}</Link>
                      {l.variantLabel && <p className="text-xs text-muted">{l.variantLabel}</p>}
                      {l.condition === 'USED' && <p className="text-xs font-semibold text-amber-700">مستعمل</p>}
                      <p className="text-base font-bold text-brand-950">{formatEGP(l.unitPrice)}{l.priceSeen !== undefined && l.priceSeen !== l.unitPrice && <span className="ms-2 text-xs font-normal text-muted line-through">{formatEGP(l.priceSeen)}</span>}</p>
                      {l.issues.map((i) => (
                        <p key={i} className={`text-xs font-semibold ${i === 'PRICE_CHANGED' ? 'text-amber-700' : 'text-red-700'}`}>{ISSUE_TEXT[i]}{i === 'INSUFFICIENT_STOCK' ? ` (المتاح ${l.available})` : ''}</p>
                      ))}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <form action={updateCartAction} className="flex items-center gap-2">
                          <input type="hidden" name="variantId" value={l.variantId} />
                          <QtySelect value={l.quantity} max={Math.max(l.available, l.quantity)} />
                          <noscript><button className="text-xs underline">تحديث</button></noscript>
                        </form>
                        <form action={updateCartAction}>
                          <input type="hidden" name="variantId" value={l.variantId} />
                          <input type="hidden" name="quantity" value="0" />
                          <button className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-red-700 hover:bg-red-50"><Trash2 className="size-4" aria-hidden /> حذف</button>
                        </form>
                        <p className="ms-auto text-sm font-bold sm:hidden">{formatEGP(l.lineTotal)}</p>
                      </div>
                    </div>
                    <p className="hidden shrink-0 text-base font-bold text-brand-950 sm:block">{formatEGP(l.lineTotal)}</p>
                  </li>
                ))}
              </ul>
              <footer className="flex justify-between border-t border-line bg-soft/30 px-4 py-3 text-sm">
                <span className="text-muted">إجمالي المتجر ده</span>
                <span className="font-bold">{formatEGP(g.total)}</span>
              </footer>
            </section>
          ))}
        </div>
        <aside className="space-y-3">
          <div className="card sticky top-44 overflow-hidden">
            <h2 className="bg-brand-950 px-5 py-3.5 font-bold text-white">ملخص الطلب</h2>
            <div className="space-y-3 p-5">
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted">المنتجات</dt><dd className="font-semibold">{formatEGP(cart.merchandiseTotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">الشحن ({cart.groups.length} متجر)</dt><dd className="font-semibold">{cart.shippingResolved ? formatEGP(cart.shippingTotal) : 'بيتحدد عند الدفع'}</dd></div>
                {cart.discountTotal > 0 && <div className="flex justify-between text-emerald-700"><dt>الخصم</dt><dd className="font-semibold">-{formatEGP(cart.discountTotal)}</dd></div>}
                <div className="flex justify-between"><dt className="flex items-center gap-1 text-muted"><ShieldCheck className="size-4 text-emerald-600" aria-hidden /> رسوم خدمة وحماية اضمن</dt><dd className="font-semibold">{formatEGP(cart.buyerFeeTotal)}</dd></div>
                <div className="flex items-baseline justify-between border-t border-line pt-3"><dt className="text-base font-bold">الإجمالي</dt><dd className="text-2xl font-bold text-brand-950">{formatEGP(cart.grandTotal)}</dd></div>
              </dl>
              {blocking && <Alert tone="warning">راجع المنتجات غير المتاحة الأول عشان تكمّل الشراء.</Alert>}
              {shippingWarning && !blocking && <Alert tone="info">بعض البائعين مش بيشحنوا لـ{gov?.nameAr}. هنراجع الشحن على عنوان التوصيل اللي هتختاره وانت بتكمّل الشراء.</Alert>}
              <LinkButton href={checkoutHref} size="lg" className={`w-full ${blocking ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={blocking}>
                كمّل الشراء
              </LinkButton>
              <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-emerald-600" /> البائع ما بياخدش فلوسه قبل ما الطلب يتسلّم، وتأكد الاستلام أو تعدّي مهلة الاعتراض، وتوافق الإدارة.</p>
            </div>
          </div>
        </aside>
      </div>
      {/* Phones: the total and the next step stay reachable above the bottom navigation. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-white/95 px-4 py-2.5 shadow-[0_-10px_24px_-18px_rgb(6_26_61/0.5)] backdrop-blur lg:hidden" aria-hidden={blocking || undefined}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 leading-tight">
            <span className="block text-xs text-muted">الإجمالي</span>
            <span className="block text-lg font-bold text-brand-950">{formatEGP(cart.grandTotal)}</span>
          </div>
          <a href={checkoutHref} tabIndex={-1} className={`inline-flex h-12 items-center rounded-xl bg-brand-600 px-6 text-sm font-bold text-white shadow-[var(--shadow-cta)] ${blocking ? 'pointer-events-none opacity-50' : ''}`}>
            متابعة للدفع
          </a>
        </div>
      </div>
    </div>
  );
}
