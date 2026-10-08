import Link from '@/ui/link';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { Truck } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { orders, sellerOrders, sellers, stores, shipmentDocuments, shipments, users } from '@/server/db/schema';
import { SHIPMENT_STATUSES } from '@/domain/machines';
import { formatDate } from '@/lib/format';
import { DataTable, PageHeader } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';
import { Input, Select } from '@/ui/form';
import { buttonClass } from '@/ui/button';

export const metadata = { title: 'مركز أدلة الشحن' };

export default async function ShippingEvidence(props: PageProps<'/admin/shipping'>) {
  const { allowed } = await adminWith('shipping.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const q = String(sp.q ?? '').trim();
  const status = String(sp.status ?? '');
  const from = String(sp.from ?? '');
  const to = String(sp.to ?? '');
  const conds: SQL[] = [];
  if (q) {
    const like = `%${q}%`;
    const num = /^\d+$/.test(q) ? Number(q) : null;
    conds.push(or(ilike(shipments.trackingNumber, like), ilike(shipments.carrierName, like), ilike(stores.name, like), ilike(users.fullName, like), ilike(users.phone, like), ...(num ? [eq(orders.number, num)] : []))!);
  }
  if ((SHIPMENT_STATUSES as readonly string[]).includes(status)) conds.push(eq(shipments.status, status as 'SHIPPED'));
  if (from) conds.push(gte(shipments.createdAt, new Date(from)));
  if (to) conds.push(lte(shipments.createdAt, new Date(`${to}T23:59:59`)));
  const rows = await db
    .select({ s: shipments, orderId: orders.id, orderNumber: orders.number, suffix: sellerOrders.suffix, soStatus: sellerOrders.status, store: stores.name, sellerId: sellers.id, customer: users.fullName })
    .from(shipments)
    .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .innerJoin(sellers, eq(sellers.id, sellerOrders.sellerId))
    .innerJoin(stores, eq(stores.sellerId, sellers.id))
    .innerJoin(users, eq(users.id, orders.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(shipments.createdAt))
    .limit(150);
  const docs = rows.length ? await db.select({ shipmentId: shipmentDocuments.shipmentId, fileId: shipmentDocuments.fileId }).from(shipmentDocuments).where(inArray(shipmentDocuments.shipmentId, rows.map((r) => r.s.id))) : [];
  const [{ missing }] = await db.select({ missing: sql<number>`count(*)::int` }).from(shipments).where(and(inArray(shipments.status, ['SHIPPED', 'IN_TRANSIT', 'DELIVERED']), sql`not exists (select 1 from shipment_documents d where d.shipment_id = ${shipments.id})`));
  return (
    <div className="space-y-4">
      <PageHeader title="مركز أدلة الشحن" description="كل بوالص الشحن المرفوعة من البائعين، مع إمكانية البحث برقم الطلب أو البائع أو العميل أو شركة الشحن أو رقم التتبع." />
      {missing > 0 && <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">تنبيه: {missing} شحنة بدون بوليصة مرفوعة — يجب مراجعتها.</p>}
      <form className="card grid gap-2 p-3 sm:grid-cols-5" role="search">
        <Input name="q" defaultValue={q} placeholder="رقم الطلب / البائع / العميل / الشركة / التتبع" aria-label="بحث" className="sm:col-span-2" />
        <Select name="status" defaultValue={status} aria-label="الحالة"><option value="">كل الحالات</option>{SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <div className="flex flex-wrap gap-2 sm:col-span-2 sm:flex-nowrap"><Input type="date" name="from" defaultValue={from} aria-label="من" /><Input type="date" name="to" defaultValue={to} aria-label="إلى" /><button className={buttonClass('primary', 'md')}>بحث</button></div>
      </form>
      <DataTable rows={rows} rowKey={(r) => r.s.id} empty={<EmptyState icon={Truck} title="لا توجد شحنات مطابقة" />} columns={[
        { key: 'o', header: 'الطلب', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/orders/${r.orderId}`}>#{r.orderNumber}-{r.suffix}</Link> },
        { key: 'st', header: 'البائع', cell: (r) => <Link href={`/admin/sellers/${r.sellerId}`}>{r.store}</Link> },
        { key: 'c', header: 'العميل', cell: (r) => r.customer },
        { key: 'carrier', header: 'الشحن', cell: (r) => <span>{r.s.carrierName} <span className="ltr text-xs text-muted">{r.s.trackingNumber ?? ''}</span></span> },
        { key: 'd', header: 'تاريخ الشحن', cell: (r) => formatDate(r.s.shippedAt ?? r.s.createdAt, true) },
        { key: 'docs', header: 'البوليصة', cell: (r) => { const ds = docs.filter((d) => d.shipmentId === r.s.id); return ds.length ? ds.map((d, i) => <a key={d.fileId} href={`/api/files/${d.fileId}`} target="_blank" className="me-2 text-brand-700 underline">عرض {i + 1}</a>) : <span className="text-danger-700">مفقودة</span>; } },
        { key: 's', header: 'الحالة', cell: (r) => <span className="flex gap-1"><StatusChip status={r.s.status} /><StatusChip status={r.soStatus} /></span> },
      ]} />
    </div>
  );
}
