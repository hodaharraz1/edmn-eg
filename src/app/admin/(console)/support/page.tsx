import Link from '@/ui/link';
import { LifeBuoy } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { ticketQueue } from '@/server/modules/support/service';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'الدعم الفني' };

export default async function AdminSupport(props: PageProps<'/admin/support'>) {
  const { actor, allowed } = await adminWith('support.manage');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'open');
  const rows = await ticketQueue(tab === 'closed' ? ['RESOLVED', 'CLOSED'] : ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SELLER', 'ESCALATED']);
  const list = tab === 'mine' ? rows.filter((r) => r.t.assigneeId === actor.userId) : rows;
  return (
    <div>
      <PageHeader title="الدعم الفني" description="مرتبة حسب الأولوية ثم الأقدم." />
      <Tabs active={tab} tabs={[{ key: 'open', label: 'مفتوحة', href: '/admin/support' }, { key: 'mine', label: 'مسندة إليّ', href: '/admin/support?tab=mine' }, { key: 'closed', label: 'منتهية', href: '/admin/support?tab=closed' }]} />
      <DataTable rows={list} rowKey={(r) => r.t.id} empty={<EmptyState icon={LifeBuoy} title="لا توجد تذاكر" />} columns={[
        { key: 'n', header: 'الرقم', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/support/${r.t.id}`}>#{r.t.number}</Link> },
        { key: 's', header: 'الموضوع', cell: (r) => r.t.subject },
        { key: 'ty', header: 'النوع', cell: (r) => <span>{label('ticketType', r.t.type)} {r.t.sellerId && <Badge tone="info">بائع</Badge>}</span> },
        { key: 'r', header: 'مقدم الطلب', cell: (r) => r.requester },
        { key: 'p', header: 'الأولوية', cell: (r) => <Badge tone={r.t.priority === 'URGENT' ? 'danger' : r.t.priority === 'HIGH' ? 'warning' : 'neutral'}>{label('priority', r.t.priority)}</Badge> },
        { key: 'd', header: 'آخر تحديث', cell: (r) => formatDate(r.t.updatedAt, true) },
        { key: 'st', header: 'الحالة', cell: (r) => <StatusChip status={r.t.status} /> },
      ]} />
    </div>
  );
}
