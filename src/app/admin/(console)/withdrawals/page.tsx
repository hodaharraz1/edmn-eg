import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { runSettlementAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { withdrawalQueue } from '@/server/modules/finance/withdrawals';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge, EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'طلبات السحب' };
const GROUPS: Record<string, string[]> = { open: ['REQUESTED', 'UNDER_REVIEW'], approved: ['APPROVED', 'PROCESSING'], paid: ['PAID'], closed: ['REJECTED', 'CANCELLED'] };

export default async function Withdrawals(props: PageProps<'/admin/withdrawals'>) {
  const { actor, allowed } = await adminWith('withdrawals.view');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'open');
  const rows = await withdrawalQueue(GROUPS[tab] ?? GROUPS.open, 200);
  const now = new Date();
  return (
    <div className="space-y-3">
      <PageHeader title="طلبات السحب" description="هدف الخدمة: الصرف خلال 48 ساعة عمل من الطلب (الأحد–الخميس). المراجِع يعتمد والمنفّذ يسجّل التحويل؛ المبالغ الكبيرة تتطلب شخصين مختلفين." actions={hasPermission(actor, 'settlements.manage') && (
        <ActionForm action={runSettlementAction}><input type="hidden" name="back" value="/admin/withdrawals" /><SubmitButton size="sm" variant="outline">تشغيل التسوية الدورية الآن</SubmitButton></ActionForm>
      )} />
      <Tabs active={tab} tabs={[{ key: 'open', label: 'بانتظار الاعتماد', href: '/admin/withdrawals' }, { key: 'approved', label: 'معتمدة للصرف', href: '/admin/withdrawals?tab=approved' }, { key: 'paid', label: 'مصروفة', href: '/admin/withdrawals?tab=paid' }, { key: 'closed', label: 'مرفوضة/ملغاة', href: '/admin/withdrawals?tab=closed' }]} />
      <DataTable rows={rows} rowKey={(r) => r.w.id} empty={<EmptyState icon={Wallet} title="لا توجد طلبات" />} columns={[
        { key: 'n', header: 'الرقم', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/withdrawals/${r.w.id}`}>#{r.w.number}</Link> },
        { key: 's', header: 'البائع', cell: (r) => <Link href={`/admin/sellers/${r.seller.id}`}>{r.seller.legalName ?? '—'}</Link> },
        { key: 'a', header: 'المبلغ', cell: (r) => <b>{formatEGP(r.w.amount)}</b> },
        { key: 'p', header: 'الحساب', cell: (r) => <span className="text-xs">{label('payoutType', r.w.payoutType)} <span className="ltr">{r.w.payoutMasked}</span></span> },
        { key: 'src', header: 'المصدر', cell: (r) => (r.w.source === 'SCHEDULED' ? <Badge tone="info">تسوية دورية</Badge> : 'طلب البائع') },
        { key: 'sla', header: 'موعد SLA', cell: (r) => <span className={['PAID', 'REJECTED', 'CANCELLED'].includes(r.w.status) ? '' : r.w.slaDueAt < now ? 'font-bold text-danger-700' : ''}>{formatDate(r.w.slaDueAt, true)}</span> },
        { key: 'f', header: '', cell: (r) => <span className="flex gap-1">{r.w.requiresDualControl && <Badge tone="warning">رقابة مزدوجة</Badge>}{r.seller.payoutHoldUntil && r.seller.payoutHoldUntil > now && <Badge tone="danger">تجميد</Badge>}</span> },
        { key: 'st', header: 'الحالة', cell: (r) => <StatusChip status={r.w.status} /> },
      ]} />
    </div>
  );
}
