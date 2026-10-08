import Link from '@/ui/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { adminOrderAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { orders, sellerOrders, stores } from '@/server/db/schema';
import { loadSellerOrderGraph, releaseBlockers } from '@/server/modules/commerce/fulfilment';
import { sellerOrderPosition } from '@/server/modules/finance/postings';
import { killSwitchStates } from '@/server/modules/finance/controls';
import { soFeeSplit } from '@/server/modules/finance/refunds';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Input } from '@/ui/form';

export const metadata = { title: 'اعتماد إتاحة أرباح البائع' };

export default async function ReleaseReview(props: PageProps<'/admin/releases/[id]'>) {
  const { actor, allowed } = await adminWith(['finance.release', 'finance.view']);
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, id));
  if (!so) notFound();
  const g = await loadSellerOrderGraph(so);
  const [order] = await db.select().from(orders).where(eq(orders.id, so.orderId));
  const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.sellerId, so.sellerId));
  const pos = await sellerOrderPosition(db, so);
  const blockers = await releaseBlockers(db, so);
  const paused = (await killSwitchStates()).find((k) => k.key === 'killswitch.sellerRelease')?.paused;
  const fee = soFeeSplit(so);
  const canRelease = hasPermission(actor, 'finance.release');
  const ref = `${order.number}-${so.suffix}`;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'إتاحة الأرباح', href: '/admin/releases' }, { label: ref }]} />} title={`اعتماد إتاحة أرباح ${ref}`} description={store?.name} actions={<StatusChip status={so.status} />} />
      <section className="card p-4">
        <h2 className="mb-2 font-bold">أساس الاستحقاق والمهل</h2>
        <DefinitionList
          items={[
            { label: 'أساس الاستحقاق', value: so.receiptBasis ? label('receiptBasis', so.receiptBasis) : 'لا يوجد' },
            { label: 'وقت الاستحقاق', value: formatDate(so.entitledAt, true) },
            { label: 'حدث تسليم موثّق', value: so.deliveryEventAt ? `${formatDate(so.deliveryEventAt, true)} (${so.deliveryEventSource})` : 'لا يوجد' },
            { label: 'مهلة دليل البائع (24 س)', value: so.deliveryReportDueAt ? `${formatDate(so.deliveryReportDueAt, true)} — ${so.sellerDeliveryConfirmedAt ? (so.sellerDeliveryLate ? 'وصل متأخر' : 'وصل في الموعد') : 'لم يصل'}` : '—' },
            { label: 'مهلة رد المشتري (24 س)', value: so.buyerResponseDueAt ? formatDate(so.buyerResponseDueAt, true) : '—' },
            { label: 'أدلة التسليم', value: g.deliveryEvidence.length ? g.deliveryEvidence.map((e, j) => <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="me-2 text-brand-700 underline">ملف {j + 1}</a>) : '—' },
          ]}
        />
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">الأثر المالي (من اللقطة المحفوظة وقت الشراء)</h2>
        <DefinitionList
          items={[
            { label: 'إجمالي ما دفعه المشتري لهذا البائع', value: formatEGP(so.grossTotal) },
            { label: 'الشحن (يدفعه المشتري)', value: `${formatEGP(so.shippingFee)} → ${so.shippingPayee}` },
            { label: 'رسوم اضمن', value: `الإجمالي ${formatEGP(so.commissionTotal)} = على المشتري ${formatEGP(fee.buyer)} + على البائع ${formatEGP(fee.seller)}` },
            { label: 'المسترد سابقًا', value: formatEGP(so.refundedTotal) },
            { label: 'المعلق للبائع الآن (سيُتاح)', value: <b data-testid="release-amount">{formatEGP(pos.pending)}</b> },
            { label: 'الرسوم المؤجلة (ستُعترف كإيراد)', value: formatEGP(pos.deferredCommission) },
          ]}
        />
      </section>
      {blockers.length > 0 && <Alert tone="danger" title="الإتاحة متوقفة">{blockers.join('، ')}</Alert>}
      {paused && <Alert tone="danger">مفتاح إيقاف «إتاحة أرباح البائعين» مفعّل — لن يتم تنفيذ أي إتاحة.</Alert>}
      {so.fundsReleasedAt ? (
        <Alert tone="success">تمت الإتاحة في {formatDate(so.fundsReleasedAt, true)}.</Alert>
      ) : canRelease && so.status === 'DELIVERED' && !blockers.length ? (
        <ActionForm action={adminOrderAction} className="card space-y-3 p-4">
          <input type="hidden" name="op" value="releaseFunds" /><input type="hidden" name="sellerOrderId" value={so.id} /><input type="hidden" name="expectedAmount" value={pos.pending} /><input type="hidden" name="back" value={`/admin/releases/${so.id}`} />
          <p className="text-sm">الإجراء: نقل <b>{formatEGP(pos.pending)}</b> من «معلق» إلى «متاح» في رصيد البائع داخل اضمن، والاعتراف بـ {formatEGP(pos.deferredCommission)} رسوم كإيراد. لا يُنشئ سحبًا ولا تحويلًا خارجيًا. يتطلب تحققًا ثنائيًا حديثًا ويُسجّل باسمك.</p>
          <Input name="reason" required minLength={3} placeholder="سبب/ملاحظة الاعتماد" aria-label="سبب الاعتماد" />
          <SubmitButton>اعتماد إتاحة {formatEGP(pos.pending)} للبائع {store?.name}</SubmitButton>
        </ActionForm>
      ) : null}
      <p className="text-sm"><Link className="text-brand-700" href={`/admin/orders/${so.orderId}`}>صفحة الطلب الكاملة</Link></p>
    </div>
  );
}
