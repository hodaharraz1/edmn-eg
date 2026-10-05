import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Package, PackagePlus } from 'lucide-react';
import { productControlAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { products, productRevisions } from '@/server/db/schema';
import { requireSellerActor } from '@/server/web/session';
import { formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { LinkButton } from '@/ui/button';
import { mediaUrl } from '@/ui/commerce';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المنتجات' };
const TABS: [string, string, string[]][] = [
  ['all', 'الكل', []],
  ['live', 'منشور', ['LIVE']],
  ['inactive', 'غير نشط', ['APPROVED']],
  ['review', 'قيد المراجعة', ['SUBMITTED', 'UNDER_REVIEW']],
  ['action', 'يحتاج تعديل', ['REJECTED', 'DRAFT']],
  ['suspended', 'موقوف', ['SUSPENDED']],
  ['archived', 'مؤرشف', ['ARCHIVED']],
];

export default async function SellerProducts(props: PageProps<'/seller/products'>) {
  const actor = await requireSellerActor('/seller/products');
  const sp = await props.searchParams;
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0];
  const where = tab[2].length ? and(eq(products.sellerId, actor.sellerId!), inArray(products.status, tab[2] as never)) : and(eq(products.sellerId, actor.sellerId!), sql`${products.status} <> 'ARCHIVED'`);
  const rows = await db
    // Fully-qualified: in a single-table select Drizzle renders columns unqualified, which is ambiguous inside the subqueries.
    .select({
      p: products,
      imageKey: sql<string | null>`(select f.storage_key from product_images pi join files f on f.id = pi.file_id where pi.product_id = "products"."id" order by pi.sort_order limit 1)`,
      pendingRevision: sql<boolean>`exists (select 1 from product_revisions r where r.product_id = "products"."id" and r.status = 'SUBMITTED')`,
    })
    .from(products)
    .where(where)
    .orderBy(desc(products.updatedAt))
    .limit(200);
  void productRevisions;
  return (
    <div>
      <PageHeader title="المنتجات" actions={<LinkButton href="/seller/products/new"><PackagePlus className="size-4" /> إضافة منتج</LinkButton>} />
      <Tabs active={tab[0]} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `/seller/products?tab=${k}` }))} />
      <DataTable
        rows={rows}
        rowKey={(r) => r.p.id}
        empty={<EmptyState icon={Package} title="لا توجد منتجات هنا" action={<LinkButton href="/seller/products/new">أضف أول منتج</LinkButton>} />}
        columns={[
          {
            key: 'p',
            header: 'المنتج',
            cell: (r) => (
              <Link href={`/seller/products/${r.p.id}`} className="flex items-center gap-3 hover:text-brand-700">
                <span className="size-12 shrink-0 overflow-hidden rounded-lg border border-line bg-white">{r.imageKey && <img src={mediaUrl(r.imageKey, 'thumb')!} alt="" className="size-full object-contain" />}</span>
                <span className="min-w-0">
                  <span className="line-clamp-1 font-medium">{r.p.titleAr}</span>
                  <span className="text-xs text-muted">{label('condition', r.p.condition)}{r.pendingRevision ? ' · ' : ''}{r.pendingRevision && <Badge tone="warning">تعديل قيد المراجعة</Badge>}</span>
                </span>
              </Link>
            ),
          },
          { key: 'price', header: 'السعر', cell: (r) => formatEGP(r.p.minPrice) },
          { key: 'stock', header: 'المتاح', cell: (r) => <span className={r.p.totalAvailable <= 0 ? 'font-semibold text-red-700' : ''}>{r.p.totalAvailable}</span> },
          { key: 'sold', header: 'المبيعات', cell: (r) => r.p.salesCount },
          { key: 'status', header: 'الحالة', cell: (r) => <div className="space-y-1"><StatusChip status={r.p.status} />{r.p.statusReason && ['REJECTED', 'SUSPENDED'].includes(r.p.status) && <p className="max-w-48 text-xs text-red-700">{r.p.statusReason}</p>}</div> },
          {
            key: 'actions',
            header: '',
            cell: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.p.status === 'LIVE' && <ControlButton id={r.p.id} op="deactivate" label="إيقاف مؤقت" />}
                {r.p.status === 'APPROVED' && <ControlButton id={r.p.id} op="activate" label="تفعيل" />}
                {['LIVE', 'APPROVED'].includes(r.p.status) && <ControlButton id={r.p.id} op="outofstock" label="نفدت الكمية" />}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function ControlButton({ id, op, label: l }: { id: string; op: string; label: string }) {
  return (
    <form action={productControlAction}>
      <input type="hidden" name="productId" value={id} />
      <input type="hidden" name="op" value={op} />
      <button className="rounded-md border border-line bg-white px-2 py-1 text-xs hover:bg-page">{l}</button>
    </form>
  );
}
