import Link from 'next/link';
import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { categories, products, stores } from '@/server/db/schema';
import { PRODUCT_STATUSES } from '@/domain/machines';
import { formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader, Pagination } from '@/ui/data';
import { StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المنتجات' };

export default async function AdminProducts(props: PageProps<'/admin/products'>) {
  const { allowed } = await adminWith('products.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const status = typeof sp.status === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(sp.status) ? sp.status : '';
  const seller = typeof sp.seller === 'string' && /^[0-9a-f-]{36}$/.test(sp.seller) ? sp.seller : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const conds: SQL[] = [];
  if (q) conds.push(ilike(products.titleAr, `%${q}%`));
  if (status) conds.push(eq(products.status, status as 'LIVE'));
  if (seller) conds.push(eq(products.sellerId, seller));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ p: products, store: stores.name, cat: categories.nameAr }).from(products).innerJoin(stores, eq(stores.sellerId, products.sellerId)).leftJoin(categories, eq(categories.id, products.categoryId)).where(where).orderBy(desc(products.updatedAt)).limit(30).offset((page - 1) * 30),
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(where),
  ]);
  return (
    <div>
      <PageHeader title="كل المنتجات" />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="اسم المنتج" className="h-9 flex-1 rounded-lg border border-line bg-white px-3 text-sm" />
        <select name="status" defaultValue={status} className="h-9 rounded-lg border border-line bg-white px-2 text-sm"><option value="">كل الحالات</option>{PRODUCT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        {seller && <input type="hidden" name="seller" value={seller} />}
        <button className="h-9 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">بحث</button>
      </form>
      <DataTable rows={rows} rowKey={(r) => r.p.id} columns={[
        { key: 't', header: 'المنتج', cell: (r) => <Link href={`/admin/products/${r.p.id}`} className="line-clamp-1 font-medium text-brand-700">{r.p.titleAr}</Link> },
        { key: 's', header: 'المتجر', cell: (r) => r.store },
        { key: 'c', header: 'التصنيف', cell: (r) => r.cat },
        { key: 'cond', header: 'الحالة', cell: (r) => label('condition', r.p.condition) },
        { key: 'pr', header: 'السعر', cell: (r) => formatEGP(r.p.minPrice) },
        { key: 'av', header: 'المتاح', cell: (r) => r.p.totalAvailable },
        { key: 'st', header: 'الحالة', cell: (r) => <StatusChip status={r.p.status} /> },
      ]} />
      <Pagination page={page} pages={Math.ceil(n / 30)} hrefFor={(p) => `/admin/products?page=${p}&q=${encodeURIComponent(q)}&status=${status}&seller=${seller}`} />
    </div>
  );
}
