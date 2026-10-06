import Link from 'next/link';
import { returnPolicySummary } from '@/domain/return-policy';
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { MapPin, PackageCheck, RotateCcw, Scale, Star, Truck } from 'lucide-react';
import { db } from '@/server/db/client';
import { disputes, productReviews, returns, sellerReviews, shipmentDocuments, shipments, trackingEvents } from '@/server/db/schema';
import { orderForCustomer } from '@/server/modules/commerce/orders';
import { cancelUnpaidOrderAction } from '@/app/_actions/checkout';
import { confirmReceiptAction } from '@/app/_actions/account';
import { isDomainError } from '@/server/core/errors';
import { requireCustomer } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { mediaUrl } from '@/ui/commerce';
import { Breadcrumbs, PageHeader, Timeline } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';

const STEPS = ['PAID', 'SELLER_CONFIRMED', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'] as const;
const STEP_LABEL: Record<string, string> = { PAID: 'اتدفع', SELLER_CONFIRMED: 'البائع أكّده', READY_TO_SHIP: 'جاهز للشحن', SHIPPED: 'اتشحن', DELIVERED: 'اتسلّم' };

export default async function OrderDetail(props: PageProps<'/account/orders/[id]'>) {
  const actor = await requireCustomer('/account/orders');
  const { id } = await props.params;
  let g;
  try {
    g = await orderForCustomer(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound(); // also hides other customers' orders (no existence leak)
    throw e;
  }
  const soIds = g.sellerOrders.map((s) => s.so.id);
  const [ships, rets, disp, pReviews, sReviews] = await Promise.all([
    soIds.length ? db.select().from(shipments).where(inArray(shipments.sellerOrderId, soIds)) : [],
    soIds.length ? db.select().from(returns).where(inArray(returns.sellerOrderId, soIds)) : [],
    soIds.length ? db.select().from(disputes).where(inArray(disputes.sellerOrderId, soIds)) : [],
    soIds.length ? db.select({ itemId: productReviews.orderItemId }).from(productReviews).where(eq(productReviews.customerId, actor.userId!)) : [],
    soIds.length ? db.select({ soId: sellerReviews.sellerOrderId }).from(sellerReviews).where(and(eq(sellerReviews.customerId, actor.userId!), inArray(sellerReviews.sellerOrderId, soIds))) : [],
  ]);
  const events = ships.length ? await db.select().from(trackingEvents).where(inArray(trackingEvents.shipmentId, ships.map((s) => s.id))) : [];
  const docs = ships.length ? await db.select().from(shipmentDocuments).where(inArray(shipmentDocuments.shipmentId, ships.map((s) => s.id))) : [];
  const reviewedItems = new Set(pReviews.map((r) => r.itemId));
  const reviewedSos = new Set(sReviews.map((r) => r.soId));
  const addr = g.order.shippingAddress as Record<string, string | null>;
  const { order, payment } = g;

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'طلباتي', href: '/account/orders' }, { label: `#${order.number}` }]} />}
        title={`طلب #${order.number}`}
        description={`اتطلب في ${formatDate(order.placedAt, true)}`}
        actions={<StatusChip status={order.status} />}
      />

      {order.status === 'PENDING_PAYMENT' && payment && (
        <Alert tone="warning" title={payment.status === 'REJECTED' ? 'إثبات الدفع اترفض' : 'الطلب مستني الدفع'} action={<LinkButton href={`/account/orders/${order.id}/pay`} size="sm">{payment.status === 'REJECTED' ? 'ارفع إثبات جديد' : 'ادفع دلوقتي'}</LinkButton>}>
          المبلغ المطلوب {formatEGP(payment.amountDue)} — آخر موعد {formatDate(payment.dueAt, true)}. البائع مش هيجهّز الطلب غير بعد تأكيد الدفع.
        </Alert>
      )}
      {order.status === 'PAYMENT_UNDER_REVIEW' && <Alert tone="info" title="بنراجع الدفع">استلمنا إثبات الدفع وهنراجعه في أقرب وقت. هنبعتلك إشعار أول ما يتأكد.</Alert>}

      {g.sellerOrders.map(({ so, storeName, storeSlug, items }) => {
        const ship = ships.find((s) => s.sellerOrderId === so.id);
        const evs = ship ? events.filter((e) => e.shipmentId === ship.id).sort((a, b) => +a.occurredAt - +b.occurredAt) : [];
        const ret = rets.filter((r) => r.sellerOrderId === so.id);
        const dsp = disp.find((d) => d.sellerOrderId === so.id);
        // PROCESSING sits between "confirmed" and "ready to ship"; COMPLETED is past delivery.
        const stepIdx = so.status === 'PROCESSING' ? 1 : so.status === 'COMPLETED' ? STEPS.length - 1 : STEPS.indexOf(so.status as (typeof STEPS)[number]);
        const delivered = so.status === 'DELIVERED' || so.status === 'COMPLETED';
        return (
          <section key={so.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-page/60 px-5 py-3">
              <div>
                <p className="font-bold">شحنة {order.number}-{so.suffix}</p>
                <p className="text-xs text-muted">من <Link href={`/store/${storeSlug}`} className="text-brand-700 hover:underline">{storeName}</Link></p>
              </div>
              <StatusChip status={so.status} />
            </header>
            <div className="space-y-5 p-5">
              {so.status !== 'CANCELLED' && stepIdx >= 0 && (
                <ol className="grid grid-cols-5 gap-1 text-center text-[11px]">
                  {STEPS.map((s, i) => (
                    <li key={s} className="space-y-1">
                      <span className={`mx-auto block h-1.5 rounded-full ${i <= stepIdx || (so.status === 'PROCESSING' && i <= 1) ? 'bg-brand-600' : 'bg-line'}`} />
                      <span className={i <= stepIdx ? 'font-semibold text-brand-800' : 'text-muted'}>{STEP_LABEL[s]}</span>
                    </li>
                  ))}
                </ol>
              )}
              {so.status === 'CANCELLED' && <Alert tone="danger" title="الشحنة دي اتلغت">السبب: {so.cancelReason ?? '—'}. أي مبلغ دفعته هيرجعلك.</Alert>}
              <ul className="divide-y divide-line">
                {items.map((it) => (
                  <li key={it.id} className="flex gap-3 py-3">
                    <span className="size-16 shrink-0 overflow-hidden rounded-lg border border-line bg-white">
                      {it.imageFileId && <ItemImage fileId={it.imageFileId} />}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">{it.titleSnapshot}</p>
                      <p className="text-xs text-muted">{it.variantLabel} · {label('condition', it.conditionSnapshot)} · الكمية {it.quantity}{it.returnedQuantity ? ` · اترجع ${it.returnedQuantity}` : ''}</p>
                      <p className="text-xs text-muted" data-testid="order-item-return-policy">سياسة الإرجاع وقت الشراء: {it.returnPolicySnapshot ? returnPolicySummary(it.returnPolicySnapshot) : 'حسب سياسة المتجر'}</p>
                      {delivered && !reviewedItems.has(it.id) && (
                        <Link href={`/account/reviews?item=${it.id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"><Star className="size-3.5" /> قيّم المنتج</Link>
                      )}
                    </div>
                    <p className="text-sm font-semibold">{formatEGP(it.lineTotal)}</p>
                  </li>
                ))}
              </ul>
              {ship && (
                <div className="rounded-xl bg-page p-4 text-sm">
                  <p className="mb-2 flex items-center gap-2 font-semibold"><Truck className="size-4 text-brand-600" /> {ship.carrierName} {ship.trackingNumber && <span className="ltr text-xs text-muted">· {ship.trackingNumber}</span>}</p>
                  {ship.expectedDeliveryAt && <p className="mb-3 text-xs text-muted">التوصيل المتوقع: {formatDate(ship.expectedDeliveryAt)}</p>}
                  <Timeline items={evs.map((e) => ({ title: e.description ?? e.status, time: formatDate(e.occurredAt, true) }))} />
                  {docs.filter((d) => d.shipmentId === ship.id).length > 0 && <p className="mt-2 text-xs text-muted">البائع رفع بوليصة الشحن.</p>}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {so.status === 'SHIPPED' && (
                  <ActionForm action={confirmReceiptAction} className="w-full space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <input type="hidden" name="sellerOrderId" value={so.id} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <p className="text-sm text-emerald-900"><PackageCheck className="me-1 inline size-4" /> استلمت الطلب وفحصته؟ لما تأكّد الاستلام، المبلغ بيتحوّل للبائع. متأكّدش قبل ما المنتج يوصلك فعلاً.</p>
                    <SubmitButton variant="success">أكّد الاستلام</SubmitButton>
                  </ActionForm>
                )}
                {delivered && (
                  <>
                    <LinkButton href={`/account/returns/new?so=${so.id}`} variant="outline" size="sm"><RotateCcw className="size-4" /> طلب إرجاع</LinkButton>
                    {!reviewedSos.has(so.id) && <LinkButton href={`/account/reviews?so=${so.id}`} variant="outline" size="sm"><Star className="size-4" /> قيّم البائع</LinkButton>}
                  </>
                )}
                {['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(so.status) && !dsp && (
                  <LinkButton href={`/account/disputes/new?so=${so.id}`} variant="ghost" size="sm"><Scale className="size-4" /> عندك مشكلة في الطلب؟</LinkButton>
                )}
                {dsp && <LinkButton href={`/account/disputes/${dsp.id}`} variant="secondary" size="sm">تابع النزاع #{dsp.number}</LinkButton>}
                {ret.map((r) => (
                  <LinkButton key={r.id} href={`/account/returns/${r.id}`} variant="secondary" size="sm">طلب إرجاع #{r.number} · <StatusChip status={r.status} /></LinkButton>
                ))}
              </div>
              <dl className="grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted">المنتجات</dt><dd>{formatEGP(so.merchandiseSubtotal)}</dd></div>
                <div><dt className="text-xs text-muted">الشحن</dt><dd>{formatEGP(so.shippingFee)}</dd></div>
                <div><dt className="text-xs text-muted">الإجمالي</dt><dd className="font-semibold">{formatEGP(so.grossTotal)}</dd></div>
                {so.refundedTotal > 0 && <div><dt className="text-xs text-muted">المسترد</dt><dd className="text-emerald-700">{formatEGP(so.refundedTotal)}</dd></div>}
              </dl>
            </div>
          </section>
        );
      })}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-5 text-sm">
          <h2 className="mb-2 flex items-center gap-2 font-bold"><MapPin className="size-4 text-brand-600" /> عنوان التوصيل</h2>
          <p>{addr.recipientName} · <span className="ltr">{addr.phone}</span></p>
          <p className="text-muted">{addr.governorate}، {addr.city}، {addr.street} {addr.building ?? ''} {addr.floor ? `الدور ${addr.floor}` : ''} {addr.apartment ? `شقة ${addr.apartment}` : ''}</p>
        </section>
        <section className="card p-5 text-sm">
          <h2 className="mb-2 font-bold">ملخص الفاتورة</h2>
          <dl className="space-y-1">
            <div className="flex justify-between"><dt className="text-muted">المنتجات</dt><dd>{formatEGP(order.merchandiseTotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">الشحن</dt><dd>{formatEGP(order.shippingTotal)}</dd></div>
            <div className="flex justify-between font-bold"><dt>الإجمالي</dt><dd>{formatEGP(order.grandTotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">طريقة الدفع</dt><dd>{label('paymentMethod', order.paymentMethod)} · <StatusChip status={payment?.status} /></dd></div>
          </dl>
          {order.status === 'PENDING_PAYMENT' && (
            <form action={cancelUnpaidOrderAction} className="mt-3">
              <input type="hidden" name="orderId" value={order.id} />
              <ConfirmSubmit confirm="عايز تلغي الطلب ده؟" variant="outline" size="sm">إلغاء الطلب</ConfirmSubmit>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

async function ItemImage({ fileId }: { fileId: string }) {
  const { files } = await import('@/server/db/schema');
  const [f] = await db.select({ key: files.storageKey }).from(files).where(eq(files.id, fileId));
  return f ? <img src={mediaUrl(f.key, 'thumb')!} alt="" className="size-full object-contain" /> : null;
}
