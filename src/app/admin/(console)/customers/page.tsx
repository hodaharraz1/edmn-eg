import Link from 'next/link';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { DataTable, PageHeader, Pagination } from '@/ui/data';
import { Badge } from '@/ui/feedback';

export const metadata = { title: 'العملاء' };

export default async function Customers(props: PageProps<'/admin/customers'>) {
  const { allowed } = await adminWith('customers.view');
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const where = and(eq(users.isStaff, false), q ? or(ilike(users.fullName, `%${q}%`), ilike(users.email, `%${q}%`), ilike(users.phone, `%${q}%`)) : undefined);
  const [rows, [{ n }]] = await Promise.all([
    db.select({ u: users, orders: sql<number>`(select count(*)::int from orders o where o.customer_id = ${users.id})`, spent: sql<number>`(select coalesce(sum(grand_total),0)::bigint from orders o where o.customer_id = ${users.id} and o.paid_at is not null)` }).from(users).where(where).orderBy(desc(users.createdAt)).limit(25).offset((page - 1) * 25),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
  ]);
  return (
    <div>
      <PageHeader title="العملاء" />
      <form className="mb-4 flex gap-2"><input name="q" defaultValue={q} placeholder="بحث بالاسم أو البريد أو الهاتف" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm" /><button className="h-9 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">بحث</button></form>
      <DataTable rows={rows} rowKey={(r) => r.u.id} columns={[
        { key: 'n', header: 'الاسم', cell: (r) => <Link href={`/admin/customers/${r.u.id}`} className="font-semibold text-brand-700 hover:underline">{r.u.fullName}</Link> },
        { key: 'e', header: 'البريد', cell: (r) => <span className="ltr text-xs">{r.u.email}</span> },
        { key: 'p', header: 'الهاتف', cell: (r) => <span className="ltr text-xs">{r.u.phone}</span> },
        { key: 'o', header: 'الطلبات', cell: (r) => r.orders },
        { key: 'd', header: 'التسجيل', cell: (r) => formatDate(r.u.createdAt) },
        { key: 's', header: 'الحالة', cell: (r) => <Badge tone={r.u.status === 'ACTIVE' ? 'success' : 'danger'}>{r.u.status}</Badge> },
      ]} />
      <Pagination page={page} pages={Math.ceil(n / 25)} hrefFor={(p) => `/admin/customers?page=${p}&q=${encodeURIComponent(q)}`} />
    </div>
  );
}
