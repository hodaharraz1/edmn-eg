import Link from 'next/link';
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
            <p className="text-xs text-muted">موقف القيود: معلق للبائع {formatEGP(positions[i].pending)} · عمولة مؤجلة {formatEGP(positions[i].deferredCommission)} {so.receiptConfirmationSource && `· تأكيد الاستلام: ${so.receiptConfirmationSource}`}</p>
            {ship && (
              <div className="rounded-lg bg-page p-3 text-sm">
                <p className="font-semibold">{ship.carrierName} {ship.trackingNumber && <span className="ltr">· {ship.trackingNumber}</span>} <StatusChip status={ship.status} /></p>
                <p className="text-xs">{docs.filter((d) => d.shipmentId === ship.id).map((d, j) => <a key={d.id} href={`/api/files/${d.fileId}`} target="_blank" className="me-2 text-brand-700 underline">بوليصة {j + 1}</a>)}</p>
                <Timeline items={events.filter((e) => e.shipmentId === ship.id).map((e) => ({ title: e.description ?? e.status, time: formatDate(e.occurredAt, true) }))} />
              </div>
            )}
            {canManage && (
              <ActionForm action={adminOrderAction} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="back" value={`/admin/orders/${o.id}`} />
                <Select name="op" className="w-auto" aria-label="الإجراء">
                  {['PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(so.status) && <option value="cancel">إلغاء الطلب الفرعي وإنشاء استرداد</option>}
                  {!so.fundsReleasedAt && !so.financialHold && so.status !== 'CANCELLED' && <option value="hold">تجميد المستحقات</option>}
                  {so.financialHold && <option value="release">رفع التجميد</option>}
                  {so.status === 'SHIPPED' && hasPermission(actor, 'orders.confirm_receipt_on_behalf') && <option value="confirmReceipt">تأكيد الاستلام نيابة عن العميل (بدليل)</option>}
                </Select>
                <Input name="reason" placeholder="السبب (إلزامي)" required className="w-64" aria-label="السبب" />
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
