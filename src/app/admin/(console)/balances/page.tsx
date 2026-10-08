import Link from '@/ui/link';
import { eq, sql } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { ledgerAccounts, sellers, stores } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, StatCard } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'أرصدة البائعين' };

export default async function Balances() {
  const { allowed } = await adminWith('finance.view');
  if (!allowed) return <Forbidden />;
  const rows = await db
    .select({
      id: sellers.id,
      store: stores.name,
      status: sellers.status,
      hold: sellers.payoutHoldUntil,
      pending: sql<number>`coalesce(sum(${ledgerAccounts.balance}) filter (where ${ledgerAccounts.code} = 'SELLER_PENDING'), 0)::bigint`.mapWith(Number),
      available: sql<number>`coalesce(sum(${ledgerAccounts.balance}) filter (where ${ledgerAccounts.code} = 'SELLER_AVAILABLE'), 0)::bigint`.mapWith(Number),
      reserved: sql<number>`coalesce(sum(${ledgerAccounts.balance}) filter (where ${ledgerAccounts.code} = 'SELLER_WITHDRAWAL_RESERVED'), 0)::bigint`.mapWith(Number),
    })
    .from(sellers)
    .innerJoin(stores, eq(stores.sellerId, sellers.id))
    .leftJoin(ledgerAccounts, eq(ledgerAccounts.sellerId, sellers.id))
    .groupBy(sellers.id, stores.name)
    .orderBy(sql`5 desc`);
  const sum = (k: 'pending' | 'available' | 'reserved') => rows.reduce((a, r) => a + r[k], 0);
  return (
    <div className="space-y-4">
      <PageHeader title="أرصدة البائعين" description="الأرصدة مشتقة من دفتر القيود المزدوجة (لا تُعدّل يدوياً — استخدم التسويات المعتمدة)." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="إجمالي المعلق" value={formatEGP(sum('pending'))} hint="بانتظار تأكيد الاستلام" />
        <StatCard label="إجمالي المتاح للسحب" value={formatEGP(sum('available'))} tone="success" />
        <StatCard label="محجوز لطلبات السحب" value={formatEGP(sum('reserved'))} tone="warning" />
      </div>
      <DataTable rows={rows} rowKey={(r) => r.id} columns={[
        { key: 's', header: 'المتجر', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/sellers/${r.id}`}>{r.store}</Link> },
        { key: 'st', header: 'الحالة', cell: (r) => <span className="flex gap-1"><StatusChip status={r.status} />{r.hold && r.hold > new Date() && <Badge tone="danger">تجميد حتى {formatDate(r.hold)}</Badge>}</span> },
        { key: 'p', header: 'معلق', cell: (r) => formatEGP(r.pending) },
        { key: 'a', header: 'متاح', cell: (r) => <b>{formatEGP(r.available)}</b> },
        { key: 'r', header: 'محجوز', cell: (r) => formatEGP(r.reserved) },
      ]} />
    </div>
  );
}
