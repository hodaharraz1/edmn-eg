import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { MapPin, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { placeOrderAction } from '@/app/_actions/checkout';
import { AddressForm } from '@/app/_components/address-form';
import { cartView } from '@/server/modules/commerce/cart';
import { myAddresses } from '@/server/modules/customers/addresses';
import { enabledPaymentMethods } from '@/server/modules/payments/service';
import { getSetting } from '@/server/modules/settings';
import { allGovernorates } from '@/server/web/context';
import { requireUser, requireCustomer } from '@/server/web/session';
import { formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { mediaUrl } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { Alert, EmptyState } from '@/ui/feedback';
import { Radio, Textarea } from '@/ui/form';

export const metadata: Metadata = { title: 'إتمام الشراء', robots: { index: false } };

export default async function CheckoutPage(props: PageProps<'/checkout'>) {
  await requireCustomer('/checkout');
  const user = await requireUser('/account');
  const sp = await props.searchParams;
  const addrs = await myAddresses(user.id);
  const chosen = addrs.find((a) => a.id === sp.address) ?? addrs.find((a) => a.isDefault) ?? addrs[0];
  const govs = await allGovernorates();
  const cart = await cartView({ userId: user.id }, chosen?.governorateId ?? null);
  const methods = await enabledPaymentMethods();
  const windowHours = await getSetting('payments.paymentWindowHours');

  if (!cart.groups.length) {
    return (
      <div className="container-page py-10">
        <EmptyState title="سلة التسوق فارغة" action={<LinkButton href="/">العودة للتسوق</LinkButton>} />
      </div>
    );
  }
  const problems = cart.groups.flatMap((g) => g.lines.filter((l) => l.issues.some((i) => i !== 'PRICE_CHANGED')).map((l) => ({ g, l })));
  const priceChanged = cart.groups.some((g) => g.lines.some((l) => l.issues.includes('PRICE_CHANGED')));
  const step = !chosen ? 1 : 2;

  return (
    <div className="container-page py-6">
      <PageHeader title="إتمام الشراء" description="العنوان ← التوصيل ← طريقة الدفع ← المراجعة" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-bold"><MapPin className="size-5 text-brand-600" /> 1. عنوان التوصيل</h2>
            {addrs.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {addrs.map((a) => (
                  <Link key={a.id} href={`/checkout?address=${a.id}`} className={`rounded-xl border p-3 text-sm ${a.id === chosen?.id ? 'border-brand-600 bg-brand-50' : 'border-line hover:border-brand-300'}`}>
                    <p className="font-semibold">{a.recipientName} {a.label && <span className="text-xs text-muted">({a.label})</span>}</p>
                    <p className="text-muted">{govs.find((g) => g.id === a.governorateId)?.nameAr}، {a.city}، {a.street} {a.building ?? ''}</p>
                    <p className="text-xs text-muted ltr">{a.phone}</p>
                  </Link>
                ))}
              </div>
            )}
            <details className="mt-3" open={addrs.length === 0}>
              <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ إضافة عنوان جديد</summary>
              <div className="mt-3">
                <AddressForm back="checkout" defaultName={user.fullName} defaultPhone={user.phone ?? ''} />
              </div>
            </details>
          </section>

          {step >= 2 && (
            <>
              <section className="card p-5">
                <h2 className="mb-3 flex items-center gap-2 font-bold"><Truck className="size-5 text-brand-600" /> 2. التوصيل ({cart.groups.length} شحنة)</h2>
                <ul className="space-y-3">
                  {cart.groups.map((g) => (
                    <li key={g.sellerId} className="rounded-xl border border-line p-3">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="font-semibold">من {g.storeName}</span>
                        <span>{g.shippingFee === null ? <span className="text-red-600">لا يشحن لهذه المحافظة</span> : g.shippingFee === 0 ? 'شحن مجاني' : formatEGP(g.shippingFee)}</span>
                      </div>
                      {g.etaMinDays !== null && <p className="text-xs text-muted">التوصيل المتوقع خلال {g.etaMinDays + g.processingDays}–{(g.etaMaxDays ?? 0) + g.processingDays} أيام عمل بعد تأكيد الدفع</p>}
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {g.lines.map((l) => (
                          <span key={l.variantId} className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-white" title={l.title}>
                            {l.imageKey && <img src={mediaUrl(l.imageKey, 'thumb')!} alt={l.title} className="size-full object-contain" />}
                            <span className="absolute bottom-0 end-0 rounded-tl bg-ink px-1 text-[10px] text-white">×{l.quantity}</span>
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {problems.length > 0 && (
                <Alert tone="danger" title="بعض المنتجات تحتاج مراجعة">
                  <ul className="list-inside list-disc">
                    {problems.map(({ l }) => (
                      <li key={l.variantId}>{l.title}</li>
                    ))}
                  </ul>
                  <Link href="/cart" className="font-semibold underline">العودة للسلة</Link>
                </Alert>
              )}
              {priceChanged && <Alert tone="warning">تغيّرت أسعار بعض المنتجات منذ إضافتها. الأسعار المعروضة هنا هي الأسعار الحالية التي ستدفعها.</Alert>}

              <ActionForm action={placeOrderAction} className="space-y-4">
                <input type="hidden" name="addressId" value={chosen!.id} />
                <input type="hidden" name="checkoutKey" value={randomUUID()} />
                <input type="hidden" name="expectedTotal" value={cart.grandTotal} />
                <section className="card p-5">
                  <h2 className="mb-3 flex items-center gap-2 font-bold"><Wallet className="size-5 text-brand-600" /> 3. طريقة الدفع</h2>
                  {methods.length === 0 ? (
                    <Alert tone="warning">لا توجد طرق دفع مفعّلة حالياً. يرجى المحاولة لاحقاً.</Alert>
                  ) : (
                    <div className="grid gap-2">
                      {methods.map((m, i) => (
                        <Radio key={m.code} name="paymentMethod" value={m.code} defaultChecked={i === 0} required label={m.nameAr} description={m.instructionsAr ?? undefined} />
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted">
                    الدفع حالياً بالتحويل اليدوي: بعد تأكيد الطلب ستظهر لك بيانات التحويل، ثم ترفع إثبات الدفع خلال {windowHours} ساعة ليتحقق منه فريق اضمن. الكميات محجوزة لك خلال هذه المدة.
                  </p>
                </section>
                <section className="card p-5">
                  <h2 className="mb-3 font-bold">4. ملاحظات للبائع (اختياري)</h2>
                  <Textarea name="note" rows={2} maxLength={500} placeholder="مثال: الاتصال قبل التوصيل" />
                </section>
                <div className="lg:hidden">
                  <SubmitButton size="lg" className="w-full" pendingText="جارٍ تأكيد الطلب…">تأكيد الطلب · {formatEGP(cart.grandTotal)}</SubmitButton>
                </div>
                <div className="hidden lg:block">
                  <SubmitButton size="lg" className="w-full" pendingText="جارٍ تأكيد الطلب…">تأكيد الطلب والانتقال للدفع</SubmitButton>
                </div>
              </ActionForm>
            </>
          )}
        </div>
        <aside>
          <div className="card sticky top-32 space-y-3 p-5 text-sm">
            <h2 className="font-bold">5. مراجعة الطلب</h2>
            <dl className="space-y-2">
              <div className="flex justify-between"><dt className="text-muted">المنتجات ({cart.itemCount})</dt><dd>{formatEGP(cart.merchandiseTotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">الشحن</dt><dd>{chosen ? formatEGP(cart.shippingTotal) : '—'}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>الإجمالي المطلوب</dt><dd>{formatEGP(cart.grandTotal)}</dd></div>
            </dl>
            <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-emerald-600" /> بتأكيد الطلب أنت توافق على <Link href="/legal/buyer-terms" className="underline">شروط الشراء</Link>. يتم تقسيم الطلب تلقائياً حسب كل بائع.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
