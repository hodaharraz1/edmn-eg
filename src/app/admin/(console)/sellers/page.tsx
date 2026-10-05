import Link from 'next/link';
import { desc, eq, ilike, or, sql, and, type SQL } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { sellers, stores, users } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { SELLER_STATUSES } from '@/domain/machines';
import { DataTable, PageHeader, Pagination } from '@/ui/data';
import { StatusChip } from '@/ui/feedback';
import { Stars } from '@/ui/commerce';

export const metadata = { title: 'البائعون' };

export default async function AdminSellers(props: PageProps<'/admin/sellers'>) {
  const { allowed } = await adminWith('sellers.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const status = typeof sp.status === 'string' && (SELLER_STATUSES as readonly string[]).includes(sp.status) ? sp.status : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const conds: SQL[] = [];
  if (q) conds.push(or(ilike(stores.name, `%${q}%`), ilike(sellers.legalName, `%${q}%`), ilike(users.email, `%${q}%`), ilike(users.phone, `%${q}%`))!);
  if (status) conds.push(eq(sellers.status, status as 'APPROVED'));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ s: sellers, store: stores.name, email: users.email, products: sql<number>`(select count(*)::int from products p where p.seller_id = ${sellers.id} and p.status = 'LIVE')` }).from(sellers).innerJoin(users, eq(users.id, sellers.ownerUserId)).leftJoin(stores, eq(stores.sellerId, sellers.id)).where(where).orderBy(desc(sellers.createdAt)).limit(25).offset((page - 1) * 25),
    db.select({ n: sql<number>`count(*)::int` }).from(sellers).innerJoin(users, eq(users.id, sellers.ownerUserId)).leftJoin(stores, eq(stores.sellerId, sellers.id)).where(where),
  ]);
  return (
    <div>
      <PageHeader title="البائعون" />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="بحث بالاسم، المتجر، البريد، الهاتف" className="h-9 min-w-60 flex-1 rounded-lg border border-line bg-white px-3 text-sm" />
        <select name="status" aria-label="تصفية حسب الحالة" defaultValue={status} className="h-9 rounded-lg border border-line bg-white px-2 text-sm"><option value="">كل الحالات</option>{SELLER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button className="h-9 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">بحث</button>
      </form>
      <DataTable rows={rows} rowKey={(r) => r.s.id} columns={[
        { key: 'n', header: 'المتجر', cell: (r) => <Link href={`/admin/sellers/${r.s.id}`} className="font-semibold text-brand-700 hover:underline">{r.store ?? r.s.legalName ?? '—'}</Link> },
        { key: 'l', header: 'الاسم القانوني', cell: (r) => r.s.legalName },
        { key: 'e', header: 'البريد', cell: (r) => <span className="ltr text-xs">{r.email}</span> },
        { key: 't', header: 'النوع', cell: (r) => label('sellerType', r.s.type) },
        { key: 'p', header: 'منتجات منشورة', cell: (r) => r.products },
        { key: 'r', header: 'التقييم', cell: (r) => <Stars value={r.s.ratingAvg} count={r.s.ratingCount} /> },
        { key: 'd', header: 'انضم', cell: (r) => formatDate(r.s.createdAt) },
        { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.s.status} /> },
      ]} />
      <Pagination page={page} pages={Math.ceil(n / 25)} hrefFor={(p) => `/admin/sellers?page=${p}&q=${encodeURIComponent(q)}&status=${status}`} />
    </div>
  );
}
