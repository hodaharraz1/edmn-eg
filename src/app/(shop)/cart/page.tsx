import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, ShieldCheck, ShoppingCart, Trash2 } from 'lucide-react';
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

export const metadata: Metadata = { title: 'سلة التسوق', robots: { index: false } };

const ISSUE_TEXT: Record<string, string> = {
  UNAVAILABLE: 'لم يعد هذا المنتج متاحاً — احذفه للمتابعة',
  SELLER_UNAVAILABLE: 'المتجر غير متاح حالياً',
  INSUFFICIENT_STOCK: 'الكمية المطلوبة أكبر من المتوفر',
  PRICE_CHANGED: 'تغيّر السعر منذ أضفته للسلة',
  NO_SHIPPING: 'البائع لا يشحن لمحافظتك',
};

export default async function CartPage() {
  const ref = await cartRef(false);
  const gov = await deliveryGovernorate();
  const cart = ref ? await cartView(ref, gov?.id ?? null) : null;
  const user = await currentUser();
  if (!cart || cart.groups.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState icon={ShoppingCart} title="سلة التسوق فارغة" description="تصفح آلاف المنتجات من بائعين موثّقين وأضف ما يعجبك." action={<LinkButton href="/">ابدأ التسوق</LinkButton>} />
      </div>
    );
  }
  const blocking = cart.groups.some((g) => g.lines.some((l) => l.issues.some((i) => i !== 'PRICE_CHANGED')));
  return (
    <div className="container-page py-6">
      <PageHeader title={`سلة التسوق (${cart.itemCount})`} description={`التوصيل إلى ${gov?.nameAr} · الطلبات من أكثر من متجر تُشحن بشكل منفصل من كل بائع.`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {cart.groups.map((g) => (
            <section key={g.sellerId} className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-page/60 px-4 py-3">
                <Link href={`/store/${g.storeSlug}`} className="flex items-center gap-1.5 font-semibold hover:text-brand-700">
                  يُباع بواسطة {g.storeName} {g.storeVerified && <BadgeCheck className="size-4 text-brand-600" />}
                </Link>
                <DeliveryLine fee={g.shippingFee} min={g.etaMinDays !== null ? g.etaMinDays + g.processingDays : null} max={g.etaMaxDays !== null ? g.etaMaxDays + g.processingDays : null} />
              </header>
              <ul className="divide-y divide-line">
                {g.lines.map((l) => (
                  <li key={l.variantId} className="flex gap-3 p-4">
                    <Link href={`/product/${l.productSlug}`} className="size-20 shrink-0 overflow-hidden rounded-lg border border-line bg-white sm:size-24">
                      {l.imageKey && <img src={mediaUrl(l.imageKey, 'thumb')!} alt="" className="size-full object-contain" />}
                    </Link>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link href={`/product/${l.productSlug}`} className="line-clamp-2 text-sm font-medium hover:text-brand-700">{l.title}</Link>
                      {l.variantLabel && <p className="text-xs text-muted">{l.variantLabel}</p>}
                      {l.condition === 'USED' && <p className="text-xs font-semibold text-amber-700">مستعمل</p>}
                      <p className="text-sm font-bold">{formatEGP(l.unitPrice)}{l.priceSeen !== undefined && l.priceSeen !== l.unitPrice && <span className="ms-2 text-xs font-normal text-muted line-through">{formatEGP(l.priceSeen)}</span>}</p>
                      {l.issues.map((i) => (
                        <p key={i} className={`text-xs ${i === 'PRICE_CHANGED' ? 'text-amber-700' : 'text-red-600'}`}>{ISSUE_TEXT[i]}{i === 'INSUFFICIENT_STOCK' ? ` (المتاح ${l.available})` : ''}</p>
                      ))}
                      <div className="flex items-center gap-3 pt-1">
                        <form action={updateCartAction} className="flex items-center gap-2">
                          <input type="hidden" name="variantId" value={l.variantId} />
                          <QtySelect value={l.quantity} max={Math.max(l.available, l.quantity)} />
                          <noscript><button className="text-xs underline">تحديث</button></noscript>
                        </form>
                        <form action={updateCartAction}>
                          <input type="hidden" name="variantId" value={l.variantId} />
                          <input type="hidden" name="quantity" value="0" />
                          <button className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 className="size-3.5" /> حذف</button>
                        </form>
                      </div>
                    </div>
                    <p className="hidden shrink-0 text-sm font-bold sm:block">{formatEGP(l.lineTotal)}</p>
                  </li>
                ))}
              </ul>
              <footer className="flex justify-between border-t border-line px-4 py-2 text-sm">
                <span className="text-muted">إجمالي هذا المتجر</span>
                <span className="font-semibold">{formatEGP(g.total)}</span>
              </footer>
            </section>
          ))}
        </div>
        <aside className="space-y-3">
          <div className="card sticky top-32 space-y-3 p-5">
            <h2 className="font-bold">ملخص الطلب</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">المنتجات</dt><dd>{formatEGP(cart.merchandiseTotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">الشحن ({cart.groups.length} متجر)</dt><dd>{cart.shippingResolved ? formatEGP(cart.shippingTotal) : 'يُحدد عند الدفع'}</dd></div>
              {cart.discountTotal > 0 && <div className="flex justify-between text-emerald-700"><dt>الخصم</dt><dd>-{formatEGP(cart.discountTotal)}</dd></div>}
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>الإجمالي</dt><dd>{formatEGP(cart.grandTotal)}</dd></div>
            </dl>
            {blocking && <Alert tone="warning">يرجى معالجة المنتجات غير المتاحة قبل إتمام الشراء.</Alert>}
            <LinkButton href={user ? '/checkout' : '/login?next=/checkout'} size="lg" className={`w-full ${blocking ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={blocking}>
              إتمام الشراء
            </LinkButton>
            <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-emerald-600" /> مدفوعاتك محمية: البائع لا يحصل على أرباحه إلا بعد تأكيدك الاستلام.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
