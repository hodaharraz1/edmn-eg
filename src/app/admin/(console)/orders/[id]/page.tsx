import Link from '@/ui/link';
import { returnPolicySummary } from '@/domain/return-policy';
import { notFound } from 'next/navigation';
import { asc, eq, inArray } from 'drizzle-orm';
import { adminOrderAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { canViewConversations, conversationIdFor } from '@/server/modules/messaging/service';

import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { orders, shipmentDocuments, shipments, statusHistory, trackingEvents } from '@/server/db/schema';
import { loadOrderGraph } from '@/server/modules/commerce/orders';
import { loadSellerOrderGraph } from '@/server/modules/commerce/fulfilment';
import { CANCELLATION_REASON_CODES, SHIPMENT_EXCEPTION_CODES } from '@/domain/machines';
import { sellerOrderPosition } from '@/server/modules/finance/postings';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader, Timeline } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';
import { Input, Select } from '@/ui/form';

export default async function AdminOrder(props: PageProps<'/admin/orders/[id]'>) {
  const { actor, allowed } = await adminWith('orders.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o) notFound();
  const g = await loadOrderGraph(o);
  const soIds = g.sellerOrders.map((s) => s.so.id);
  const convBySo = canViewConversations(actor) ? new Map(await Promise.all(soIds.map(async (id) => [id, await conversationIdFor({ sellerOrderId: id })] as const))) : new Map<string, string | null>();
  const ships = soIds.length ? await db.select().from(shipments).where(inArray(shipments.sellerOrderId, soIds)) : [];
  const docs = ships.length ? await db.select().from(shipmentDocuments).where(inArray(shipmentDocuments.shipmentId, ships.map((s) => s.id))) : [];
  const events = ships.length ? await db.select().from(trackingEvents).where(inArray(trackingEvents.shipmentId, ships.map((s) => s.id))).orderBy(asc(trackingEvents.occurredAt)) : [];
  const history = await db.select().from(statusHistory).where(inArray(statusHistory.entityId, [o.id, ...soIds])).orderBy(asc(statusHistory.createdAt));
  const positions = await Promise.all(g.sellerOrders.map((s) => sellerOrderPosition(db, s.so)));
  const canManage = hasPermission(actor, 'orders.manage');
  const canVerify = hasPermission(actor, 'delivery.verify');
  const graphs = await Promise.all(g.sellerOrders.map((s) => loadSellerOrderGraph(s.so)));
  const soEvidence = new Map(graphs.map((x) => [x.so.id, x.deliveryEvidence]));
  const soCancellations = new Map(graphs.map((x) => [x.so.id, x.cancellations]));
  const soRefunds = new Map(graphs.map((x) => [x.so.id, x.refunds]));
  const addr = o.shippingAddress as Record<string, string | null>;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الطلبات', href: '/admin/orders' }, { label: `#${o.number}` }]} />} title={`طلب #${o.number}`} description={`${g.customer.fullName} · ${formatDate(o.placedAt, true)}`} actions={<StatusChip status={o.status} />} />
      <section className="card p-4"><DefinitionList items={[
        { label: 'العميل', value: <Link href={`/admin/customers/${g.customer.id}`} className="text-brand-700">{g.customer.fullName}</Link> },
        { label: 'الإجمالي', value: formatEGP(o.grandTotal) },
        { label: 'الدفع', value: g.payment ? <Link href={`/admin/payments/${g.payment.id}`} className="text-brand-700">{label('paymentMethod', g.payment.method)} · <StatusChip status={g.payment.status} /></Link> : '—' },
        { label: 'العنوان', value: `${addr.governorate}، ${addr.city}، ${addr.street}` },
      ]} /></section>
      {g.sellerOrders.map(({ so, storeName, items }, i) => {
        const ship = ships.find((s) => s.sellerOrderId === so.id);
        return (
          <section key={so.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{o.number}-{so.suffix} · <Link href={`/admin/sellers/${so.sellerId}`} className="text-brand-700">{storeName}</Link></h2>
              <span className="flex items-center gap-2"><StatusChip status={so.status} />{so.financialHold && <Badge tone="danger">تجميد</Badge>}{so.fundsReleasedAt && <Badge tone="success">أُتيحت الأموال</Badge>}{convBySo.get(so.id) && <Link href={`/admin/messages/${convBySo.get(so.id)}?via=order`} className="text-xs font-semibold text-brand-700 underline" data-testid="admin-conversation-link">محادثة المشتري والبائع</Link>}</span>
            </div>
            <ul className="text-sm">{items.map((it) => <li key={it.id}>{it.titleSnapshot} × {it.quantity} — {formatEGP(it.lineTotal)} · عمولة {(it.commissionBps / 100).toFixed(2)}% = {formatEGP(it.commissionAmount)}<span className="block text-xs text-muted">الاسترجاع (لقطة وقت الشراء): {it.returnPolicySnapshot ? `${returnPolicySummary(it.returnPolicySnapshot)}${it.returnPolicySnapshot.legalNoticeVersion ? ` · إشعار ${it.returnPolicySnapshot.legalNoticeVersion}` : ''}` : 'غير مسجلة (طلب قديم)'}</span></li>)}</ul>
            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
              {[['المنتجات', so.merchandiseSubtotal], ['الشحن', so.shippingFee], ['الإجمالي', so.grossTotal], ['العمولة', so.commissionTotal], ['صافي البائع', so.sellerNet], ['المسترد', so.refundedTotal]].map(([l, v]) => <div key={l as string} className="rounded bg-page p-2"><dt className="text-muted">{l}</dt><dd className="font-semibold">{formatEGP(v as number)}</dd></div>)}
            </dl>
            <p className="text-xs text-muted">موقف القيود: معلق للبائع {formatEGP(positions[i].pending)} · رسوم مؤجلة {formatEGP(positions[i].deferredCommission)} · رسوم الخدمة: على المشتري {formatEGP(so.buyerFeeTotal)} / على البائع {formatEGP(so.buyerFeeTotal + so.sellerFeeTotal === 0 ? so.commissionTotal : so.sellerFeeTotal)}</p>
            <DefinitionList
              items={[
                { label: 'حدث تسليم موثّق', value: so.deliveryEventAt ? `${formatDate(so.deliveryEventAt, true)} · ${so.deliveryEventSource} · ${so.deliveryEventRef ?? ''}` : 'لا يوجد' },
                { label: 'مهلة دليل البائع (24 ساعة)', value: so.deliveryReportDueAt ? formatDate(so.deliveryReportDueAt, true) : '—' },
                { label: 'دليل البائع', value: so.sellerDeliveryConfirmedAt ? `${formatDate(so.sellerDeliveryConfirmedAt, true)}${so.sellerDeliveryLate ? ' — متأخر' : ''}` : 'لم يُرسل' },
                { label: 'مهلة رد المشتري (24 ساعة)', value: so.buyerResponseDueAt ? formatDate(so.buyerResponseDueAt, true) : '—' },
                { label: 'أساس الاستحقاق', value: so.receiptBasis ? `${label('receiptBasis', so.receiptBasis)} · ${formatDate(so.entitledAt, true)}` : '—' },
                { label: 'الإتاحة', value: so.fundsReleasedAt ? `${formatDate(so.fundsReleasedAt, true)}${so.releaseApprovalId ? ' · بموافقة إدارة' : ' · تلقائية قديمة (قبل التحصين)'}` : 'لم تتم' },
                ...(so.deliveryExceptionCode ? [{ label: 'استثناء تسليم', value: <Badge tone="danger">{label('deliveryException', so.deliveryExceptionCode.replace(/^SHIPMENT_/, ''))}</Badge> }] : []),
                ...(so.cancelReasonCode ? [{ label: 'سبب الإلغاء', value: `${label('cancelReason', so.cancelReasonCode)} — ${so.cancelReason ?? ''}` }] : []),
              ]}
            />
            {ship && (
              <div className="rounded-lg bg-page p-3 text-sm">
                <p className="font-semibold">{ship.carrierName} {ship.trackingNumber && <span className="ltr">· {ship.trackingNumber}</span>} <StatusChip status={ship.status} /></p>
                <p className="text-xs">{docs.filter((d) => d.shipmentId === ship.id).map((d, j) => <a key={d.id} href={`/api/files/${d.fileId}`} target="_blank" className="me-2 text-brand-700 underline">بوليصة {j + 1}</a>)}</p>
                <Timeline items={events.filter((e) => e.shipmentId === ship.id).map((e) => ({ title: e.description ?? e.status, time: formatDate(e.occurredAt, true) }))} />
              </div>
            )}
            {(soCancellations.get(so.id) ?? []).filter((c) => c.status === 'PENDING').map((c) => (
              <div key={c.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="pending-cancellation">
                <p className="font-semibold">طلب إلغاء من المشتري قبل الشحن — الشحن موقوف لحد القرار</p>
                <p className="text-xs">{c.note} · {formatDate(c.createdAt, true)}</p>
                {canManage && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['acceptCancellation', 'rejectCancellation'] as const).map((op) => (
                      <ActionForm key={op} action={adminOrderAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="requestId" value={c.id} /><input type="hidden" name="op" value={op} /><input type="hidden" name="back" value={`/admin/orders/${o.id}`} />
                        <Input name="reason" required minLength={3} placeholder="السبب" className="w-48" aria-label="السبب" />
                        <SubmitButton size="sm" variant={op === 'acceptCancellation' ? 'primary' : 'outline'}>{op === 'acceptCancellation' ? 'قبول الإلغاء (+ طلب استرداد)' : 'رفض الإلغاء'}</SubmitButton>
                      </ActionForm>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(soEvidence.get(so.id) ?? []).length > 0 && (
              <p className="text-xs">أدلة التسليم من البائع (دليل مساعد — لا يثبت التسليم وحده): {(soEvidence.get(so.id) ?? []).map((e, j) => <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="me-2 text-brand-700 underline">ملف {j + 1}{e.carrierReference ? ` (${e.carrierReference})` : ''}</a>)}</p>
            )}
            {(soRefunds.get(so.id) ?? []).length > 0 && (
              <ul className="text-xs">{(soRefunds.get(so.id) ?? []).map((r) => <li key={r.id}>استرداد #{r.number} · {label('refundSource', r.sourceType)} · {formatEGP(r.amount)} <StatusChip status={r.status} /> <Link href="/admin/refunds" className="text-brand-700">قائمة الاستردادات</Link></li>)}</ul>
            )}
            {so.status === 'DELIVERED' && !so.fundsReleasedAt && (
              <p className="text-sm"><Link href={`/admin/releases/${so.id}`} className="font-semibold text-brand-700 underline" data-testid="release-link">مراجعة واعتماد إتاحة أرباح البائع</Link></p>
            )}
            {(canManage || canVerify) && (
              <ActionForm action={adminOrderAction} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="back" value={`/admin/orders/${o.id}`} />
                <Select name="op" className="w-auto" aria-label="الإجراء">
                  {canManage && ['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(so.status) && <option value="cancel">إلغاء قبل الشحن (يُنشئ طلب استرداد)</option>}
                  {canManage && !so.fundsReleasedAt && !so.financialHold && so.status !== 'CANCELLED' && <option value="hold">تجميد حماية (بدون موافقة مالية)</option>}
                  {canManage && so.financialHold && <option value="release">رفع التجميد (2FA)</option>}
                  {canVerify && so.status === 'SHIPPED' && !so.deliveryEventAt && <option value="deliveryEvent">تسجيل حدث تسليم موثّق من شركة الشحن</option>}
                  {canVerify && so.status === 'SHIPPED' && so.deliveryExceptionCode && <option value="establishDelivery">اعتماد التسليم بعد المراجعة (يفتح مهلة المشتري)</option>}
                  {canVerify && (so.status === 'SHIPPED' || so.status === 'AWAITING_BUYER_RESPONSE') && <option value="shipmentException">تسجيل مشكلة شحن</option>}
                  {canVerify && ship && ['EXCEPTION', 'FAILED', 'RETURNED_TO_SELLER'].includes(ship.status) && <option value="reship">إعادة الشحن</option>}
                  {canVerify && ship && ['EXCEPTION', 'FAILED', 'RETURNED_TO_SELLER'].includes(ship.status) && <option value="returnedToSeller">رجع للبائع — فشل التوصيل (+ طلب استرداد)</option>}
                  {canVerify && ship && ['EXCEPTION', 'FAILED'].includes(ship.status) && <option value="lost">مفقود — فشل التوصيل (+ طلب استرداد)</option>}
                </Select>
                <Select name="code" className="w-auto" aria-label="نوع المشكلة أو سبب الإلغاء">
                  <option value="">— النوع (للإلغاء / مشكلة الشحن) —</option>
                  {CANCELLATION_REASON_CODES.filter((c) => c !== 'BUYER_REQUEST').map((c) => <option key={c} value={c}>إلغاء: {label('cancelReason', c)}</option>)}
                  {SHIPMENT_EXCEPTION_CODES.map((c) => <option key={c} value={c}>شحن: {label('shipmentException', c)}</option>)}
                </Select>
                <Input name="reason" placeholder="السبب / مرجع شركة الشحن (إلزامي)" required className="w-64" aria-label="السبب" />
                <Input name="reference" placeholder="مرجع التحقق (لحدث التسليم)" className="w-48" aria-label="مرجع التحقق" />
                <SubmitButton size="sm" variant="outline">تنفيذ</SubmitButton>
              </ActionForm>
            )}
          </section>
        );
      })}
      <section className="card p-4">
        <h2 className="mb-2 font-bold">سجل الحالات</h2>
        <Timeline items={history.map((h) => ({ title: `${h.entityType}: ${h.fromStatus ?? '∅'} ← ${h.toStatus}`, time: `${formatDate(h.createdAt, true)} · ${h.actorType}`, body: h.reason }))} />
      </section>
    </div>
  );
}
