import Link from '@/ui/link';
import { asc, eq, inArray } from 'drizzle-orm';
import { PackageSearch } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { categories, productRevisions, products, stores } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'مراجعة المنتجات' };
const TABS: [string, string, string[]][] = [['pending', 'بانتظار المراجعة', ['SUBMITTED', 'UNDER_REVIEW']], ['revisions', 'تعديلات على منشورة', []], ['rejected', 'مرفوضة', ['REJECTED']], ['suspended', 'موقوفة', ['SUSPENDED']], ['approved', 'منشورة', ['LIVE', 'APPROVED']]];

export default async function ModerationQueue(props: PageProps<'/admin/moderation'>) {
  const { allowed } = await adminWith('products.moderate');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0];
  if (tab[0] === 'revisions') {
    const revs = await db.select({ r: productRevisions, title: products.titleAr, store: stores.name }).from(productRevisions).innerJoin(products, eq(products.id, productRevisions.productId)).innerJoin(stores, eq(stores.sellerId, products.sellerId)).where(eq(productRevisions.status, 'SUBMITTED')).orderBy(asc(productRevisions.createdAt));
    return (
      <div>
        <PageHeader title="مركز مراجعة المنتجات" />
        <Tabs active={tab[0]} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `/admin/moderation?tab=${k}` }))} />
        <DataTable rows={revs} rowKey={(r) => r.r.id} empty={<EmptyState icon={PackageSearch} title="لا توجد تعديلات" />} columns={[
          { key: 't', header: 'المنتج', cell: (r) => <Link href={`/admin/products/${r.r.productId}`} className="text-brand-700">{r.title}</Link> },
          { key: 's', header: 'المتجر', cell: (r) => r.store },
          { key: 'f', header: 'الحقول', cell: (r) => r.r.changedFields.join('، ') },
          { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.r.createdAt, true) },
        ]} />
      </div>
    );
  }
  const rows = await db.select({ p: products, store: stores.name, cat: categories.nameAr }).from(products).innerJoin(stores, eq(stores.sellerId, products.sellerId)).leftJoin(categories, eq(categories.id, products.categoryId)).where(inArray(products.status, tab[2] as never)).orderBy(asc(products.submittedAt)).limit(200);
  return (
    <div>
      <PageHeader title="مركز مراجعة المنتجات" description="المنتجات المعروضة للمراجعة مرتبة من الأقدم. المراجعة المعززة تظهر أولاً بعلامة حمراء." />
      <Tabs active={tab[0]} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `/admin/moderation?tab=${k}` }))} />
      <DataTable rows={rows} rowKey={(r) => r.p.id} empty={<EmptyState icon={PackageSearch} title="لا توجد منتجات" />} columns={[
        { key: 't', header: 'المنتج', cell: (r) => <Link href={`/admin/products/${r.p.id}`} className="font-medium text-brand-700">{r.p.titleAr}</Link> },
        { key: 'f', header: '', cell: (r) => <>{r.p.needsEnhancedReview && <Badge tone="danger">معززة</Badge>} {r.p.condition === 'USED' && <Badge tone="warning">مستعمل</Badge>}</> },
        { key: 's', header: 'المتجر', cell: (r) => r.store },
        { key: 'c', header: 'التصنيف', cell: (r) => r.cat },
        { key: 'cond', header: 'الحالة', cell: (r) => label('condition', r.p.condition) },
        { key: 'd', header: 'أُرسل', cell: (r) => formatDate(r.p.submittedAt, true) },
        { key: 'st', header: 'الحالة', cell: (r) => <StatusChip status={r.p.status} /> },
      ]} />
    </div>
  );
}
