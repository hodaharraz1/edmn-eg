import Link from '@/ui/link';
import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { orders, sellerOrders, users } from '@/server/db/schema';
import { ORDER_STATUSES } from '@/domain/machines';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader, Pagination, Tabs } from '@/ui/data';
import { StatusChip } from '@/ui/feedback';

export const metadata = { title: 'الطلبات' };

export default async function AdminOrders(props: PageProps<'/admin/orders'>) {
  const { allowed } = await adminWith('orders.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const tab = typeof sp.tab === 'string' ? sp.tab : 'all';
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const page = Math.max(1, Number(sp.page) || 1);
  if (tab === 'followup') {
    const rows = await db.select({ so: sellerOrders, number: orders.number, customer: users.fullName }).from(sellerOrders).innerJoin(orders, eq(orders.id, sellerOrders.orderId)).innerJoin(users, eq(users.id, orders.customerId)).where(and(eq(sellerOrders.status, 'SHIPPED'), isNotNull(sellerOrders.deliveryFollowUpFlaggedAt)));
    return (
      <div>
        <PageHeader title="الطلبات" />
        <Tabs active={tab} tabs={[{ key: 'all', label: 'كل الطلبات', href: '/admin/orders' }, { key: 'followup', label: 'شحنات بلا تأكيد استلام', href: '/admin/orders?tab=followup' }]} />
        <DataTable rows={rows} rowKey={(r) => r.so.id} columns={[{ key: 'n', header: 'الطلب', cell: (r) => <Link href={`/admin/orders/${r.so.orderId}`} className="text-brand-700">#{r.number}-{r.so.suffix}</Link> }, { key: 'c', header: 'العميل', cell: (r) => r.customer }, { key: 'd', header: 'شُحن في', cell: (r) => formatDate(r.so.shippedAt) }, { key: 'f', header: 'تم التنبيه', cell: (r) => formatDate(r.so.deliveryFollowUpFlaggedAt) }]} />
      </div>
    );
  }
  const conds: SQL[] = [];
  if (q) conds.push(/^\d+$/.test(q) ? eq(orders.number, Number(q)) : sql`${users.fullName} ilike ${'%' + q + '%'}`);
  if (typeof sp.status === 'string' && (ORDER_STATUSES as readonly string[]).includes(sp.status)) conds.push(eq(orders.status, sp.status as 'PAID'));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ o: orders, customer: users.fullName, subs: sql<number>`(select count(*)::int from seller_orders so where so.order_id = ${orders.id})` }).from(orders).innerJoin(users, eq(users.id, orders.customerId)).where(where).orderBy(desc(orders.placedAt)).limit(30).offset((page - 1) * 30),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).innerJoin(users, eq(users.id, orders.customerId)).where(where),
  ]);
  return (
    <div>
      <PageHeader title="الطلبات" />
      <Tabs active={tab} tabs={[{ key: 'all', label: 'كل الطلبات', href: '/admin/orders' }, { key: 'followup', label: 'شحنات بلا تأكيد استلام', href: '/admin/orders?tab=followup' }]} />
      <form className="mb-4 flex flex-wrap gap-2"><input name="q" aria-label="بحث في الطلبات" defaultValue={q} placeholder="رقم الطلب أو اسم العميل" className="h-9 flex-1 rounded-lg border border-line bg-white px-3 text-sm" /><select name="status" aria-label="تصفية حسب الحالة" defaultValue={typeof sp.status === 'string' ? sp.status : ''} className="h-9 rounded-lg border border-line bg-white px-2 text-sm"><option value="">كل الحالات</option>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}</select><button className="h-9 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">بحث</button></form>
      <DataTable rows={rows} rowKey={(r) => r.o.id} columns={[
        { key: 'n', header: 'الطلب', cell: (r) => <Link href={`/admin/orders/${r.o.id}`} className="font-semibold text-brand-700">#{r.o.number}</Link> },
        { key: 'c', header: 'العميل', cell: (r) => r.customer },
        { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.o.placedAt, true) },
        { key: 's', header: 'البائعون', cell: (r) => r.subs },
        { key: 'm', header: 'الدفع', cell: (r) => label('paymentMethod', r.o.paymentMethod) },
        { key: 't', header: 'الإجمالي', cell: (r) => formatEGP(r.o.grandTotal) },
        { key: 'st', header: 'الحالة', cell: (r) => <StatusChip status={r.o.status} /> },
      ]} />
      <Pagination page={page} pages={Math.ceil(n / 30)} hrefFor={(p) => `/admin/orders?page=${p}&q=${encodeURIComponent(q)}`} />
    </div>
  );
}
