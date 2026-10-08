import Link from '@/ui/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { Scale } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { disputes, users } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'النزاعات' };

export default async function AdminDisputes(props: PageProps<'/admin/disputes'>) {
  const { actor, allowed } = await adminWith('disputes.manage');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'open');
  const statuses = tab === 'closed' ? (['RESOLVED', 'CLOSED'] as const) : (['OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'] as const);
  const rows = await db
    .select({ d: disputes, claimant: users.fullName })
    .from(disputes)
    .innerJoin(users, eq(users.id, disputes.claimantUserId))
    .where(inArray(disputes.status, [...statuses]))
    .orderBy(desc(disputes.createdAt))
    .limit(200);
  const mine = tab === 'mine';
  const list = mine ? rows.filter((r) => r.d.assignedTo === actor.userId) : rows;
  return (
    <div>
      <PageHeader title="مركز النزاعات" description="القرارات المالية تُنفذ فقط عبر سير العمل المعتمد (استرداد/إتاحة) وتُسجّل في الدفتر وسجل التدقيق." />
      <Tabs active={tab} tabs={[{ key: 'open', label: 'مفتوحة', href: '/admin/disputes' }, { key: 'mine', label: 'مسندة إليّ', href: '/admin/disputes?tab=mine' }, { key: 'closed', label: 'منتهية', href: '/admin/disputes?tab=closed' }]} />
      <DataTable rows={list} rowKey={(r) => r.d.id} empty={<EmptyState icon={Scale} title="لا توجد نزاعات" />} columns={[
        { key: 'n', header: 'الرقم', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/disputes/${r.d.id}`}>#{r.d.number}</Link> },
        { key: 'k', header: 'النوع', cell: (r) => (r.d.dealId ? 'صفقة خارجية' : r.d.returnId ? 'مرتجع' : 'طلب') },
        { key: 'c', header: 'المدّعي', cell: (r) => r.claimant },
        { key: 'r', header: 'السبب', cell: (r) => r.d.reasonCode },
        { key: 'a', header: 'المبلغ المطالب', cell: (r) => (r.d.claimedAmount != null ? formatEGP(r.d.claimedAmount) : '—') },
        { key: 'd', header: 'فُتح', cell: (r) => formatDate(r.d.createdAt, true) },
        { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.d.status} /> },
      ]} />
    </div>
  );
}
