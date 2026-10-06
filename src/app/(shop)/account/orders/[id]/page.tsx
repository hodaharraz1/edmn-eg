import Link from 'next/link';
import { returnPolicySummary } from '@/domain/return-policy';
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { MapPin, PackageCheck, RotateCcw, Scale, Star, Truck } from 'lucide-react';
import { db } from '@/server/db/client';
import { cancellationRequests, disputes, productReviews, refunds, returns, sellerReviews, shipmentDocuments, shipments, trackingEvents } from '@/server/db/schema';
import { orderForCustomer } from '@/server/modules/commerce/orders';
import { cancelUnpaidOrderAction } from '@/app/_actions/checkout';
import { confirmReceiptAction, reportProblemAction, requestCancellationAction } from '@/app/_actions/account';
import { isDomainError } from '@/server/core/errors';
import { requireCustomer } from '@/server/web/session';
import { sellerOrderMessagingAvailable, unreadForContext } from '@/server/modules/messaging/service';
import { MessageCtaLink } from '@/app/_components/message-cta';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { mediaUrl } from '@/ui/commerce';
import { Breadcrumbs, PageHeader, Timeline } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';

const STEPS = ['PAID', 'SELLER_CONFIRMED', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'] as const;
const PRE_SHIP = ['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'];
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
  // One conversation per seller sub-order (never a shared multi-seller thread); opens once payment is confirmed.
  const unreadBySo = new Map(await Promise.all(g.sellerOrders.map(async ({ so }) => [so.id, sellerOrderMessagingAvailable(so) ? await unreadForContext(actor, { sellerOrderId: so.id }) : 0] as const)));
  const [ships, rets, disp, pReviews, sReviews] = await Promise.all([
    soIds.length ? db.select().from(shipments).where(inArray(shipments.sellerOrderId, soIds)) : [],
    soIds.length ? db.select().from(returns).where(inArray(returns.sellerOrderId, soIds)) : [],
    soIds.length ? db.select().from(disputes).where(inArray(disputes.sellerOrderId, soIds)) : [],
    soIds.length ? db.select({ itemId: productReviews.orderItemId }).from(productReviews).where(eq(productReviews.customerId, actor.userId!)) : [],
    soIds.length ? db.select({ soId: sellerReviews.sellerOrderId }).from(sellerReviews).where(and(eq(sellerReviews.customerId, actor.userId!), inArray(sellerReviews.sellerOrderId, soIds))) : [],
  ]);
  const events = ships.length ? await db.select().from(trackingEvents).where(inArray(trackingEvents.shipmentId, ships.map((s) => s.id))) : [];
  const refundRows = soIds.length ? await db.select().from(refunds).where(inArray(refunds.sellerOrderId, soIds)) : [];
  const refundsBySo = new Map<string, typeof refundRows>();
  for (const r of refundRows) refundsBySo.set(r.sellerOrderId!, [...(refundsBySo.get(r.sellerOrderId!) ?? []), r]);
  const cancelRows = soIds.length ? await db.select().from(cancellationRequests).where(and(inArray(cancellationRequests.sellerOrderId, soIds), eq(cancellationRequests.status, 'PENDING'))) : [];
  const cancelsBySo = new Map(cancelRows.map((c) => [c.sellerOrderId, c]));
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
        const stepIdx = so.status === 'PROCESSING' ? 1 : so.status === 'COMPLETED' ? STEPS.length - 1 : so.status === 'AWAITING_BUYER_RESPONSE' ? 3 : STEPS.indexOf(so.status as (typeof STEPS)[number]);
        const soRefunds = refundsBySo.get(so.id) ?? [];
        const pendingCancel = cancelsBySo.get(so.id);
        const delivered = so.status === 'DELIVERED' || so.status === 'COMPLETED';
        return (
          <section key={so.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-page/60 px-5 py-3">
              <div>
                <p className="font-bold">شحنة {order.number}-{so.suffix}</p>
                <p className="text-xs text-muted">من <Link href={`/store/${storeSlug}`} className="text-brand-700 hover:underline">{storeName}</Link></p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={so.status} />
                {sellerOrderMessagingAvailable(so) ? (
                  <MessageCtaLink href={`/account/messages/open?so=${so.id}`} label="تواصل مع البائع" unread={unreadBySo.get(so.id) ?? 0} />
                ) : (
                  so.status !== 'CANCELLED' && <span className="text-xs text-muted" data-testid="message-cta-pending">التواصل مع البائع بيتفتح بعد تأكيد الدفع</span>
                )}
              </div>
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
              {so.status === 'CANCELLED' && <Alert tone="danger" title="الشحنة دي اتلغت">السبب: {so.cancelReason ?? '—'}. لو كنت دفعت، طلب استرداد المبلغ اتسجل ومتابعته تحت.</Alert>}
              {so.status === 'DELIVERY_FAILED' && <Alert tone="danger" title="التوصيل فشل">الشحنة رجعت للبائع أو اتفقدت. طلب استرداد المبلغ اتسجل ومتابعته تحت.</Alert>}
              {so.status === 'AWAITING_BUYER_RESPONSE' && so.buyerResponseDueAt && (
                <Alert tone="info" title="الطلب اتسلّم حسب شركة الشحن — عندك 24 ساعة">لو وصلك تمام أكّد الاستلام. لو ماوصلكش أو فيه مشكلة بلّغنا قبل <b>{formatDate(so.buyerResponseDueAt, true)}</b>. بعد المهلة بدون اعتراض المبلغ يفضل محجوز لحد موافقة الإدارة، وحقك في الإرجاع/النزاع حسب السياسة لسه قائم.</Alert>
              )}
              {pendingCancel && <Alert tone="warning">طلب الإلغاء بتاعك مستني رد البائع أو فريق اضمن، والشحن موقوف.</Alert>}
              {soRefunds.map((r) => (
                <p key={r.id} className="rounded-lg bg-page p-2 text-sm" data-testid="refund-status">استرداد {formatEGP(r.amount)}: <StatusChip status={r.status} /> {['REQUESTED', 'UNDER_REVIEW'].includes(r.status) ? '— قيد مراجعة الإدارة' : ['APPROVED', 'PROCESSING', 'FAILED', 'PENDING'].includes(r.status) ? '— معتمد وجاري التحويل' : ['COMPLETED', 'PAID'].includes(r.status) ? `— اتحول${r.paidReference ? ` (مرجع ${r.paidReference})` : ''}` : ''}</p>
              ))}
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
                {(so.status === 'SHIPPED' || so.status === 'AWAITING_BUYER_RESPONSE') && (
                  <ActionForm action={confirmReceiptAction} className="w-full space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <input type="hidden" name="sellerOrderId" value={so.id} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <p className="text-sm text-emerald-900"><PackageCheck className="me-1 inline size-4" /> استلمت الطلب وفحصته؟ تأكيدك بيثبت إن البائع يستحق المبلغ، والإدارة بتراجع وتوافق على تحويله له. متأكّدش قبل ما المنتج يوصلك فعلاً.</p>
                    <SubmitButton variant="success">أكّد الاستلام</SubmitButton>
                  </ActionForm>
                )}
                {['SHIPPED', 'AWAITING_BUYER_RESPONSE', 'DELIVERED'].includes(so.status) && !so.fundsReleasedAt && !dsp && (
                  <ActionForm action={reportProblemAction} className="w-full space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="report-problem-form">
                    <input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="orderId" value={order.id} />
                    <p className="text-sm font-semibold">ماستلمتش الطلب أو فيه مشكلة؟</p>
                    <select name="kind" className="rounded-lg border border-line bg-white p-2 text-sm" aria-label="نوع المشكلة"><option value="NOT_RECEIVED">ماستلمتش الطلب</option><option value="PRODUCT_PROBLEM">استلمت بس فيه مشكلة</option></select>
                    <textarea name="description" required minLength={20} rows={2} className="block w-full rounded-lg border border-line bg-white p-2 text-sm" placeholder="اشرح المشكلة (20 حرف على الأقل)" aria-label="وصف المشكلة" />
                    <SubmitButton variant="outline" size="sm">بلّغ فريق اضمن (المبلغ يتجمد)</SubmitButton>
                  </ActionForm>
                )}
                {PRE_SHIP.includes(so.status) && !pendingCancel && (
                  <ActionForm action={requestCancellationAction} className="w-full space-y-2 rounded-xl border border-line p-4">
                    <input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="orderId" value={order.id} />
                    <p className="text-sm">ممكن تلغي الشحنة دي <b>قبل الشحن فقط</b>. {so.status === 'PAID' ? 'هتتلغي فورًا.' : 'البائع بيجهزها — هيتبعتله طلب إلغاء والشحن يتوقف لحد ما يتحسم.'} المبلغ المدفوع بيتسجل له طلب استرداد بيراجعه فريق اضمن.</p>
                    <input name="reason" required minLength={3} className="block w-full rounded-lg border border-line bg-white p-2 text-sm" placeholder="سبب الإلغاء" aria-label="سبب الإلغاء" />
                    <SubmitButton variant="outline" size="sm">إلغاء الشحنة</SubmitButton>
                  </ActionForm>
                )}
                {delivered && (
                  <>
                    <LinkButton href={`/account/returns/new?so=${so.id}`} variant="outline" size="sm"><RotateCcw className="size-4" /> طلب إرجاع</LinkButton>
                    {!reviewedSos.has(so.id) && <LinkButton href={`/account/reviews?so=${so.id}`} variant="outline" size="sm"><Star className="size-4" /> قيّم البائع</LinkButton>}
                  </>
                )}
                {['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'COMPLETED'].includes(so.status) && !dsp && (
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
                {so.buyerFeeTotal > 0 && <div><dt className="text-xs text-muted">رسوم خدمة اضمن</dt><dd>{formatEGP(so.buyerFeeTotal)}</dd></div>}
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
            <div className="flex justify-between"><dt className="text-muted">الشحن (على المشتري)</dt><dd>{formatEGP(order.shippingTotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">رسوم خدمة اضمن (حصتك)</dt><dd>{formatEGP(order.buyerFeeTotal)}</dd></div>
            <div className="flex justify-between text-xs"><dt className="text-muted">رسوم خدمة اضمن (حصة البائع — تُخصم منه)</dt><dd>{formatEGP(g.sellerOrders.reduce((a, { so }) => a + (so.buyerFeeTotal + so.sellerFeeTotal === 0 ? so.commissionTotal : so.sellerFeeTotal), 0))}</dd></div>
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
