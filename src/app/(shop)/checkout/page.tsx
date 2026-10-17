import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import Link from '@/ui/link';
import { Check, CheckCircle2, MapPin, ShieldCheck, StickyNote, Truck, Wallet, type LucideIcon } from 'lucide-react';
import { placeOrderAction } from '@/app/_actions/checkout';
import { AddressForm } from '@/app/_components/address-form';
import { cartView } from '@/server/modules/commerce/cart';
import { myAddresses } from '@/server/modules/customers/addresses';
import { enabledPaymentMethods } from '@/server/modules/payments/service';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';
import { allGovernorates, deliveryGovernorate } from '@/server/web/context';
import { requireUser, requireCustomer } from '@/server/web/session';
import { formatEGP } from '@/lib/format';
import { returnPolicySummary } from '@/domain/return-policy';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { mediaUrl } from '@/ui/commerce';
import { PageHeader } from '@/ui/data';
import { Alert, EmptyState } from '@/ui/feedback';
import { TestMoneyNotice } from '@/app/_components/test-money';
import { Radio, Textarea } from '@/ui/form';
import { ProtectionPanel } from '@/ui/protection';
import { SafeImg } from '@/ui/safe-img';
import { cn } from '@/lib/cn';

export const metadata: Metadata = { title: 'إتمام الشراء', robots: { index: false } };

export default async function CheckoutPage(props: PageProps<'/checkout'>) {
  await requireCustomer('/checkout');
  const user = await requireUser('/account');
  const sp = await props.searchParams;
  const addrs = await myAddresses(user.id);
  const chosen = addrs.find((a) => a.id === sp.address) ?? addrs.find((a) => a.isDefault) ?? addrs[0];
  const govs = await allGovernorates();
  // The checkout address is authoritative for shipping; the header governorate is only browsing context.
  const browsingGov = await deliveryGovernorate();
  const chosenGov = chosen ? govs.find((g) => g.id === chosen.governorateId) : undefined;
  const cart = await cartView({ userId: user.id }, chosen?.governorateId ?? null);
  const methods = await enabledPaymentMethods();
  const windowHours = await getSetting('payments.paymentWindowHours');
  const live = await realMoneyEnabled();
  const mandatoryNotice = await getSetting('returns.mandatoryRightsNotice');

  if (!cart.groups.length) {
    return (
      <div className="container-page py-10">
        <EmptyState title="السلة فاضية" action={<LinkButton href="/">ارجع للتسوق</LinkButton>} />
      </div>
    );
  }
  const problems = cart.groups.flatMap((g) => g.lines.filter((l) => l.issues.some((i) => i !== 'PRICE_CHANGED')).map((l) => ({ g, l })));
  const priceChanged = cart.groups.some((g) => g.lines.some((l) => l.issues.includes('PRICE_CHANGED')));
  const step = !chosen ? 1 : 2;
  const noShipping = cart.groups.some((g) => g.lines.some((l) => l.issues.includes('NO_SHIPPING')));

  return (
    <div className="container-page py-6">
      <PageHeader title="إتمام الشراء" description="خطوات واضحة، والمبلغ محمي لدى اضمن لحد ما تستلم وتأكد." />
      <CheckoutSteps current={step} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="card p-5">
            <StepTitle n={1} icon={MapPin}>عنوان التوصيل</StepTitle>
            {addrs.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {addrs.map((a) => (
                  <Link key={a.id} href={`/checkout?address=${a.id}`} aria-current={a.id === chosen?.id ? 'true' : undefined} className={`relative rounded-xl border p-3.5 text-sm transition-colors ${a.id === chosen?.id ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-line hover:border-brand-300'}`}>
                    {a.id === chosen?.id && <CheckCircle2 className="absolute end-3 top-3 size-5 text-brand-600" aria-hidden />}
                    <p className="pe-7 font-semibold">{a.recipientName} {a.label && <span className="text-xs text-muted">({a.label})</span>}</p>
                    <p className="text-muted">{govs.find((g) => g.id === a.governorateId)?.nameAr}، {a.city}، {a.street} {a.building ?? ''}</p>
                    <p className="text-xs text-muted ltr">{a.phone}</p>
                  </Link>
                ))}
              </div>
            )}
            <details className="mt-3" open={addrs.length === 0}>
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-600">+ ضيف عنوان جديد</summary>
              <div className="mt-3">
                <AddressForm back="checkout" defaultName={user.fullName} defaultPhone={user.phone ?? ''} />
              </div>
            </details>
          </section>

          {step >= 2 && (
            <>
              <section className="card p-5">
                <StepTitle n={2} icon={Truck}>التوصيل ({cart.groups.length} شحنة)</StepTitle>
                <p className="mb-3 rounded-xl bg-brand-50 p-3 text-xs leading-6 text-brand-900" data-testid="checkout-shipping-basis">
                  مصاريف الشحن محسوبة على عنوان التوصيل اللي اخترته في <span className="font-bold" data-testid="checkout-governorate">{chosenGov?.nameAr}</span>
                  {browsingGov && chosenGov && browsingGov.id !== chosenGov.id && <> (المحافظة اللي في أعلى الصفحة «{browsingGov.nameAr}» مش بتأثر على الطلب ده)</>}.
                </p>
                <ul className="space-y-3">
                  {cart.groups.map((g) => (
                    <li key={g.sellerId} className="rounded-xl border border-line p-3">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="font-semibold">من {g.storeName}</span>
                        <span>{g.shippingFee === null ? <span className="text-red-700">البائع لا يشحن إلى هذه المحافظة حالياً</span> : g.shippingFee === 0 ? 'شحن مجاني' : formatEGP(g.shippingFee)}</span>
                      </div>
                      {g.etaMinDays !== null && <p className="text-xs text-muted">التوصيل المتوقع خلال {g.etaMinDays + g.processingDays}–{(g.etaMaxDays ?? 0) + g.processingDays} أيام عمل بعد تأكيد الدفع</p>}
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {g.lines.map((l) => (
                          <span key={l.variantId} className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-slate-100" title={l.title}>
                            <SafeImg src={l.imageKey ? mediaUrl(l.imageKey, 'thumb') : null} alt={l.title} className="size-full p-1" />
                            <span className="absolute bottom-0 end-0 rounded-tl bg-ink px-1 text-[10px] text-white">×{l.quantity}</span>
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 space-y-1 border-t border-line pt-2 text-xs" data-testid="checkout-return-policy">
                        {g.lines.map((l) => (
                          <p key={l.variantId}><span className="font-semibold">سياسة الإرجاع — {l.title}:</span> {returnPolicySummary(l.returnPolicy)}</p>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">{mandatoryNotice}</p>
              </section>

              {problems.length > 0 && (
                <Alert tone="danger" title="فيه منتجات محتاجة مراجعة">
                  <ul className="list-inside list-disc">
                    {problems.map(({ l }) => (
                      <li key={l.variantId}>{l.title}</li>
                    ))}
                  </ul>
                  <Link href="/cart" className="font-semibold underline">ارجع للسلة</Link>
                </Alert>
              )}
              {priceChanged && <Alert tone="warning">أسعار بعض المنتجات اتغيّرت من وقت ما ضفتها. الأسعار اللي قدامك هنا هي اللي هتدفعها.</Alert>}

              <ActionForm action={placeOrderAction} className="space-y-4">
                <input type="hidden" name="addressId" value={chosen!.id} />
                <input type="hidden" name="checkoutKey" value={randomUUID()} />
                <input type="hidden" name="expectedTotal" value={cart.grandTotal} />
                <input type="hidden" name="expectedPricingVersionId" value={cart.pricingVersionId ?? ''} />
                <section className="card p-5">
                  <StepTitle n={3} icon={Wallet}>طريقة الدفع</StepTitle>
                  {!live && <TestMoneyNotice className="mb-3" />}
                  {methods.length === 0 ? (
                    <Alert tone="warning">مفيش طرق دفع متاحة دلوقتي. جرّب تاني بعد شوية.</Alert>
                  ) : (
                    <div className="grid gap-2">
                      {methods.map((m, i) => (
                        <Radio key={m.code} name="paymentMethod" value={m.code} defaultChecked={i === 0} required label={m.nameAr} description={m.instructionsAr ?? undefined} />
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted">
                    الدفع دلوقتي بالتحويل اليدوي: بعد ما تأكّد الطلب هتظهرلك بيانات التحويل، وبعدها ترفع إثبات الدفع خلال {windowHours} ساعة عشان فريق اضمن يراجعه. الكميات محجوزة لك طول المدة دي.
                  </p>
                </section>
                <section className="card p-5">
                  <StepTitle n={4} icon={StickyNote}>ملاحظات للبائع (اختياري)</StepTitle>
                  <Textarea name="note" rows={2} maxLength={500} placeholder="مثال: كلّمني قبل التوصيل" />
                </section>
                {cart.pricingUnavailable ? (
                  <button type="button" disabled className="h-12 w-full rounded-xl bg-slate-300 text-sm font-semibold text-slate-600" data-testid="checkout-blocked">مينفعش تكمّل: {cart.pricingUnavailable}</button>
                ) : problems.length > 0 ? (
                  <button type="button" disabled className="h-12 w-full rounded-xl bg-slate-300 text-sm font-semibold text-slate-600" data-testid="checkout-blocked">
                    {noShipping ? 'مينفعش تكمّل: فيه بائع مش بيشحن لمحافظة عنوان التوصيل' : 'مينفعش تكمّل قبل ما تراجع المنتجات'}
                  </button>
                ) : (
                  <>
                  <div className="lg:hidden">
                    <SubmitButton size="lg" className="w-full" pendingText="بنأكّد طلبك…">أكّد الطلب · {formatEGP(cart.grandTotal)}</SubmitButton>
                  </div>
                  <div className="hidden lg:block">
                    <SubmitButton size="lg" className="w-full" pendingText="بنأكّد طلبك…">أكّد الطلب وكمّل للدفع</SubmitButton>
                  </div>
                  </>
                )}
              </ActionForm>
            </>
          )}
        </div>
        <aside>
          <div className="sticky top-44 space-y-3">
          <div className="card overflow-hidden text-sm">
            <h2 className="bg-brand-950 px-5 py-3.5 font-bold text-white">مراجعة الطلب</h2>
            <div className="space-y-3 p-5">
            <dl className="space-y-2">
              <div className="flex justify-between"><dt className="text-muted">المنتجات ({cart.itemCount})</dt><dd>{formatEGP(cart.merchandiseTotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">الشحن</dt><dd data-testid="checkout-shipping-total">{!chosen ? '—' : cart.shippingResolved ? formatEGP(cart.shippingTotal) : 'غير متاح'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">رسوم خدمة وحماية اضمن</dt><dd data-testid="checkout-buyer-fee">{cart.pricingUnavailable ? '—' : formatEGP(cart.buyerFeeTotal)}</dd></div>
              <p className="text-[11px] text-muted">رسوم خدمة وحماية اضمن تُحسب على قيمة المنتجات فقط (من غير الشحن) حسب نوع المنتج وقيمة الطلب، وتظهر لك قبل التأكيد. الشحن على المشتري. الرسوم المثبتة في طلبك لا تتغير بعد التأكيد.</p>
              {cart.pricingUnavailable && <Alert tone="danger">{cart.pricingUnavailable}</Alert>}
              <div className="flex items-baseline justify-between border-t border-line pt-3"><dt className="text-base font-bold">الإجمالي المطلوب</dt><dd className="text-2xl font-bold text-brand-950">{formatEGP(cart.grandTotal)}</dd></div>
            </dl>
            <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-emerald-600" /> بتأكيد الطلب أنت توافق على <Link href="/legal/buyer-terms" className="underline">شروط الشراء</Link>. الطلب بيتقسم تلقائياً على حسب كل بائع.</p>
            </div>
          </div>
          <ProtectionPanel title="دفعك محمي مع اضمن" compact>
            بتحوّل لحسابات اضمن المعلنة بس، وفريقنا يراجع التحويل. المبلغ ما بيتاحش للبائع غير بعد الاستلام وتأكيدك أو انتهاء مهلة الاعتراض، وموافقة الإدارة.
          </ProtectionPanel>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StepTitle({ n, icon: Icon, children }: { n: number; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="mb-4 flex items-center gap-3 font-bold text-brand-950">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-950 text-sm text-white" aria-hidden>
        {n}
      </span>
      <Icon className="size-5 text-brand-600" aria-hidden />
      {children}
    </h2>
  );
}

/** Visual progress: address → delivery → payment → review (the page itself is one calm form). */
function CheckoutSteps({ current }: { current: number }) {
  const steps = ['العنوان', 'التوصيل', 'الدفع', 'المراجعة'];
  return (
    <ol aria-label="خطوات إتمام الشراء" className="mb-6 grid grid-cols-4 gap-2">
      {steps.map((t, i) => {
        const n = i + 1;
        const done = n < current || (current === 2 && n === 1);
        const active = n === current || (current === 2 && n > 1);
        return (
          <li key={t} aria-current={n === current ? 'step' : undefined} className="space-y-1.5">
            <span className={cn('block h-1.5 rounded-full', done ? 'bg-emerald-500' : active ? 'bg-brand-600' : 'bg-line')} />
            <span className={cn('flex items-center gap-1 text-xs font-semibold', done ? 'text-emerald-700' : active ? 'text-brand-800' : 'text-muted')}>
              {done && <Check className="size-3.5" aria-hidden />} {t}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
