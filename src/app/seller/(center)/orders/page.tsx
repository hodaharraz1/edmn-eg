import Link from '@/ui/link';
import { SellerForbidden } from '@/app/_components/seller-forbidden';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ShoppingBag } from 'lucide-react';
import { db } from '@/server/db/client';
import { orders, sellerOrders } from '@/server/db/schema';
import { requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';
import type { SellerOrderStatus } from '@/domain/machines';

export const metadata = { title: 'الطلبات' };
const TABS: [string, string, SellerOrderStatus[]][] = [
  ['new', 'جديدة (بانتظار التأكيد)', ['PAID']],
  ['processing', 'قيد التجهيز', ['SELLER_CONFIRMED', 'PROCESSING']],
  ['ready', 'جاهزة للشحن', ['READY_TO_SHIP']],
  ['shipped', 'تم الشحن', ['SHIPPED']],
  ['delivered', 'تم الاستلام', ['DELIVERED', 'COMPLETED']],
  ['cancelled', 'ملغاة', ['CANCELLED']],
];

export default async function SellerOrders(props: PageProps<'/seller/orders'>) {
  const actor = await requireSellerActor('/seller/orders');
  // Customer names, phones and addresses are only for members who handle orders.
  if (!actor.sellerPermissions?.has('orders.manage')) return <SellerForbidden />;
  const sp = await props.searchParams;
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0];
  const rows = await db
    .select({ so: sellerOrders, number: orders.number, placedAt: orders.placedAt, address: orders.shippingAddress })
    .from(sellerOrders)
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .where(and(eq(sellerOrders.sellerId, actor.sellerId!), inArray(sellerOrders.status, tab[2])))
    .orderBy(desc(sellerOrders.paidAt))
    .limit(200);
  return (
    <div>
      <PageHeader title="الطلبات" description="تظهر هنا الطلبات بعد تأكيد الدفع من فريق اضمن فقط." />
      <Tabs active={tab[0]} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `/seller/orders?tab=${k}` }))} />
      <DataTable
        rows={rows}
        rowKey={(r) => r.so.id}
        empty={<EmptyState icon={ShoppingBag} title="لا توجد طلبات هنا" />}
        columns={[
          { key: 'n', header: 'الطلب', cell: (r) => <Link href={`/seller/orders/${r.so.id}`} className="font-semibold text-brand-700 hover:underline">#{r.number}-{r.so.suffix}</Link> },
          { key: 'd', header: 'تاريخ الدفع', cell: (r) => formatDate(r.so.paidAt, true) },
          { key: 'g', header: 'المحافظة', cell: (r) => (r.address as { governorate?: string }).governorate ?? '—' },
          { key: 't', header: 'الإجمالي', cell: (r) => formatEGP(r.so.grossTotal) },
          { key: 'net', header: 'صافيك', cell: (r) => formatEGP(r.so.sellerNet) },
          { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.so.status} /> },
        ]}
      />
    </div>
  );
}
