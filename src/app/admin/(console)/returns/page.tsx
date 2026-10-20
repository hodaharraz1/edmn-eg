import Link from '@/ui/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { Undo2 } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { returns, stores, users } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المرتجعات' };
const GROUPS = {
  open: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'RETURN_IN_TRANSIT', 'RECEIVED', 'INSPECTION'],
  refund: ['REFUND_PENDING'],
  disputed: ['DISPUTED'],
  closed: ['REFUNDED', 'REJECTED'],
} as const;

export default async function AdminReturns(props: PageProps<'/admin/returns'>) {
  const { allowed } = await adminWith('returns.manage');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'open') as keyof typeof GROUPS;
  const statuses = GROUPS[tab] ?? GROUPS.open;
  const rows = await db
    .select({ r: returns, store: stores.name, customer: users.fullName })
    .from(returns)
    .innerJoin(stores, eq(stores.sellerId, returns.sellerId))
    .innerJoin(users, eq(users.id, returns.customerId))
    .where(inArray(returns.status, [...statuses]))
    .orderBy(desc(returns.createdAt))
    .limit(200);
  return (
    <div>
      <PageHeader title="المرتجعات" description="متابعة طلبات الإرجاع، والتدخل عند تأخر البائع أو تصعيد العميل." />
      <Tabs active={tab} tabs={[{ key: 'open', label: 'مفتوحة', href: '/admin/returns' }, { key: 'refund', label: 'بانتظار الاسترداد', href: '/admin/returns?tab=refund' }, { key: 'disputed', label: 'متنازع عليها', href: '/admin/returns?tab=disputed' }, { key: 'closed', label: 'منتهية', href: '/admin/returns?tab=closed' }]} />
      <DataTable rows={rows} rowKey={(r) => r.r.id} empty={<EmptyState icon={Undo2} title="لا توجد مرتجعات" />} columns={[
        { key: 'n', header: 'الرقم', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/returns/${r.r.id}`}>#{r.r.number}</Link> },
        { key: 'c', header: 'العميل', cell: (r) => r.customer },
        { key: 's', header: 'البائع', cell: (r) => r.store },
        { key: 'reason', header: 'السبب', cell: (r) => <span>{label('returnReason', r.r.reason)} {r.r.isStatutory && <Badge tone="info">قانوني</Badge>}</span> },
        { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.r.createdAt, true) },
        { key: 'st', header: 'الحالة', cell: (r) => <StatusChip status={r.r.status} /> },
      ]} />
    </div>
  );
}
