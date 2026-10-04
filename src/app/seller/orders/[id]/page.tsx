import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { sellerOrderAction, sellerDisputeMessageAction, shipmentAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { disputes, returns } from '@/server/db/schema';
import { sellerOrderForSeller } from '@/server/modules/commerce/fulfilment';
import { isDomainError } from '@/server/core/errors';
import { requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Breadcrumbs, PageHeader, Timeline } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/form';

export default async function SellerOrderDetail(props: PageProps<'/seller/orders/[id]'>) {
  const actor = await requireSellerActor('/seller/orders');
  const { id } = await props.params;
  let g;
  try {
    g = await sellerOrderForSeller(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const { so, order, items, shipment, documents, tracking } = g;
  const addr = order.shippingAddress as Record<string, string | null>;
  const [dispute] = await db.select().from(disputes).where(eq(disputes.sellerOrderId, so.id));
  const rets = await db.select().from(returns).where(eq(returns.sellerOrderId, so.id));
  const canShipEdit = ['SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED'].includes(so.status);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الطلبات', href: '/seller/orders' }, { label: `#${order.number}-${so.suffix}` }]} />} title={`طلب #${order.number}-${so.suffix}`} description={`مدفوع في ${formatDate(so.paidAt, true)}`} actions={<StatusChip status={so.status} />} />
      {so.status === 'PAID' && <Alert tone="warning" title="طلب جديد بانتظار تأكيدك">أكّد الطلب ثم جهّزه للشحن خلال {so.processingDays ?? 2} يوم عمل.</Alert>}
      {so.financialHold && <Alert tone="danger">يوجد تجميد إداري على مستحقات هذا الطلب: {so.holdReason}</Alert>}
      {dispute && <Alert tone="danger" title={`نزاع مفتوح #${dispute.number}`}>{dispute.description}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="card p-5">
          <h2 className="mb-3 font-bold">المنتجات</h2>
          <ul className="divide-y divide-line text-sm">
            {items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3 py-2">
                <span>{it.titleSnapshot} <span className="text-xs text-muted">{it.variantLabel} · SKU {it.skuSnapshot} · {label('condition', it.conditionSnapshot)}</span></span>
                <span className="shrink-0">{it.quantity} × {formatEGP(it.unitPrice)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted">المنتجات</dt><dd>{formatEGP(so.merchandiseSubtotal)}</dd></div>
            <div><dt className="text-xs text-muted">الشحن المحصّل</dt><dd>{formatEGP(so.shippingFee)}</dd></div>
            <div><dt className="text-xs text-muted">عمولة اضمن</dt><dd>-{formatEGP(so.commissionTotal)}</dd></div>
            <div><dt className="text-xs text-muted">صافيك</dt><dd className="font-bold">{formatEGP(so.sellerNet)}</dd></div>
          </dl>
          {order.customerNote && <p className="mt-3 rounded-lg bg-page p-3 text-sm">ملاحظة العميل: {order.customerNote}</p>}
        </section>
        <section className="card space-y-1 p-5 text-sm">
          <h2 className="mb-2 font-bold">الشحن إلى</h2>
          <p className="font-semibold">{addr.recipientName}</p>
          <p className="ltr text-end">{addr.phone}</p>
          <p className="text-muted">{addr.governorate}، {addr.city}، {addr.district ?? ''} {addr.street} {addr.building ?? ''} {addr.floor ? `دور ${addr.floor}` : ''} {addr.apartment ? `شقة ${addr.apartment}` : ''}</p>
          {addr.landmark && <p className="text-xs text-muted">علامة مميزة: {addr.landmark}</p>}
        </section>
      </div>

      <div className="flex flex-wrap gap-2">
        {so.status === 'PAID' && <OpForm id={so.id} op="confirm" label="تأكيد الطلب" primary />}
        {so.status === 'SELLER_CONFIRMED' && <OpForm id={so.id} op="processing" label="بدء التجهيز" />}
        {['SELLER_CONFIRMED', 'PROCESSING'].includes(so.status) && <OpForm id={so.id} op="ready" label="جاهز للشحن" />}
      </div>

      {canShipEdit && (
        <ActionForm action={shipmentAction} className="card space-y-4 p-5" encType="multipart/form-data">
          <input type="hidden" name="sellerOrderId" value={so.id} />
          <h2 className="font-bold">بيانات الشحن وبوليصة الشحن</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="شركة الشحن" htmlFor="carrierName" required><Input id="carrierName" name="carrierName" defaultValue={shipment?.carrierName ?? ''} required list="carriers" /></Field>
            <datalist id="carriers">{['بوسطة', 'أرامكس', 'J&T Express', 'بريد مصر', 'مندوب خاص'].map((c) => <option key={c} value={c} />)}</datalist>
            <Field label="رقم التتبع (إن وجد)" htmlFor="trackingNumber"><Input id="trackingNumber" name="trackingNumber" defaultValue={shipment?.trackingNumber ?? ''} dir="ltr" /></Field>
            <Field label="تاريخ الشحن" htmlFor="shippedAt" required><Input id="shippedAt" name="shippedAt" type="date" defaultValue={shipment?.shippedAt?.toISOString().slice(0, 10) ?? today} required /></Field>
            <Field label="تاريخ التسليم المتوقع" htmlFor="expectedDeliveryAt"><Input id="expectedDeliveryAt" name="expectedDeliveryAt" type="date" defaultValue={shipment?.expectedDeliveryAt?.toISOString().slice(0, 10) ?? ''} /></Field>
          </div>
          <Field label="ملاحظة" htmlFor="note"><Textarea id="note" name="note" defaultValue={shipment?.note ?? ''} rows={2} /></Field>
          <FileInput name="waybill" label="رفع بوليصة الشحن (Waybill)" hint="PDF أو صورة — مطلوبة لتحديد الطلب كمشحون. الملف خاص ولا يظهر للعامة." accept="application/pdf,image/jpeg,image/png,image/webp" maxMb={10} />
          {documents.length > 0 && <p className="text-xs text-emerald-700">تم رفع {documents.length} مستند: {documents.map((d, i) => <a key={d.id} href={`/api/files/${d.fileId}`} target="_blank" className="underline">بوليصة {i + 1}</a>)}</p>}
          {so.status !== 'SHIPPED' && <Checkbox name="markShipped" label="تحديد الطلب كـ «تم الشحن» وإبلاغ العميل الآن" />}
          <SubmitButton>حفظ</SubmitButton>
          <p className="text-xs text-muted">ملاحظة: رفع البوليصة لا يُتيح أرباحك؛ تصبح أرباحك متاحة بعد تأكيد العميل الاستلام.</p>
        </ActionForm>
      )}

      {shipment && (
        <section className="card p-5">
          <h2 className="mb-3 font-bold">تتبع الشحنة</h2>
          <Timeline items={tracking.map((t) => ({ title: t.description ?? t.status, time: formatDate(t.occurredAt, true) }))} />
          {so.status === 'SHIPPED' && (
            <ActionForm action={sellerOrderAction} className="mt-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="op" value="tracking" />
              <Field label="تحديث الحالة" htmlFor="status"><Select id="status" name="status"><option value="IN_TRANSIT">في الطريق</option><option value="FAILED">تعذر التسليم</option></Select></Field>
              <Field label="الوصف" htmlFor="description"><Input id="description" name="description" required /></Field>
              <SubmitButton size="sm" variant="outline">إضافة</SubmitButton>
            </ActionForm>
          )}
        </section>
      )}

      {rets.length > 0 && <section className="card p-5 text-sm"><h2 className="mb-2 font-bold">المرتجعات</h2>{rets.map((r) => <Link key={r.id} href={`/seller/returns/${r.id}`} className="block text-brand-700 hover:underline">مرتجع #{r.number} — <StatusChip status={r.status} /></Link>)}</section>}

      {dispute && ['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'].includes(dispute.status) && (
        <ActionForm action={sellerDisputeMessageAction} className="card space-y-2 p-5" resetOnSuccess encType="multipart/form-data">
          <h2 className="font-bold">ردك على النزاع</h2>
          <input type="hidden" name="disputeId" value={dispute.id} />
          <Textarea name="body" required rows={3} aria-label="الرد" />
          <input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-xs" aria-label="مرفق" />
          <SubmitButton size="sm">إرسال لفريق اضمن</SubmitButton>
        </ActionForm>
      )}

      {['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(so.status) && (
        <ActionForm action={sellerOrderAction} className="card space-y-2 border-red-200 p-5">
          <input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="op" value="cancel" />
          <h2 className="font-bold text-red-700">إلغاء الطلب</h2>
          <p className="text-xs text-muted">الإلغاء يؤثر على مؤشر صحة حسابك. سيتم رد المبلغ للعميل وإعادة الكمية للمخزون.</p>
          <Field label="سبب الإلغاء" htmlFor="reason" required><Input id="reason" name="reason" required minLength={3} /></Field>
          <ConfirmSubmit confirm="تأكيد إلغاء الطلب؟">إلغاء الطلب</ConfirmSubmit>
        </ActionForm>
      )}
    </div>
  );
}

function OpForm({ id, op, label: l, primary }: { id: string; op: string; label: string; primary?: boolean }) {
  return (
    <ActionForm action={sellerOrderAction}>
      <input type="hidden" name="sellerOrderId" value={id} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={primary ? 'primary' : 'outline'}>{l}</SubmitButton>
    </ActionForm>
  );
}
