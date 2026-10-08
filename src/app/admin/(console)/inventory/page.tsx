import Link from '@/ui/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { productVariants, products, stores } from '@/server/db/schema';
import { DataTable, PageHeader, Tabs } from '@/ui/data';

export const metadata = { title: 'المخزون' };

export default async function AdminInventory(props: PageProps<'/admin/inventory'>) {
  const { allowed } = await adminWith('products.view');
  if (!allowed) return <Forbidden />;
  const tab = (await props.searchParams).tab === 'reserved' ? 'reserved' : 'out';
  const cond = tab === 'reserved' ? sql`${productVariants.reserved} > 0` : sql`${productVariants.stockOnHand} - ${productVariants.reserved} <= 0`;
  const rows = await db.select({ v: productVariants, title: products.titleAr, pid: products.id, store: stores.name }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).innerJoin(stores, eq(stores.sellerId, products.sellerId)).where(and(eq(products.status, 'LIVE'), cond)).orderBy(asc(stores.name)).limit(300);
  return (
    <div>
      <PageHeader title="رؤية المخزون" description="قراءة فقط — المخزون يديره البائع. المحجوز = وحدات مرتبطة بطلبات لم يُؤكد دفعها." />
      <Tabs active={tab} tabs={[{ key: 'out', label: 'منشور ونفد', href: '/admin/inventory' }, { key: 'reserved', label: 'وحدات محجوزة', href: '/admin/inventory?tab=reserved' }]} />
      <DataTable rows={rows} rowKey={(r) => r.v.id} columns={[
        { key: 't', header: 'المنتج', cell: (r) => <Link href={`/admin/products/${r.pid}`} className="text-brand-700">{r.title} <span className="text-xs text-muted">{r.v.label}</span></Link> },
        { key: 's', header: 'المتجر', cell: (r) => r.store },
        { key: 'h', header: 'الفعلي', cell: (r) => r.v.stockOnHand },
        { key: 'r', header: 'محجوز', cell: (r) => r.v.reserved },
        { key: 'a', header: 'متاح', cell: (r) => r.v.stockOnHand - r.v.reserved },
      ]} />
    </div>
  );
}
