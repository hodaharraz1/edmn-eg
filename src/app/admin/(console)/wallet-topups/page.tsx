import Link from '@/ui/link';
import { Wallet } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { topupQueue } from '@/server/modules/finance/wallet-topups';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'إيداعات المحافظ' };

const METHOD: Record<string, string> = { BANK_TRANSFER: 'تحويل بنكي', INSTAPAY: 'إنستاباي' };

export default async function WalletTopupsQueue(props: PageProps<'/admin/wallet-topups'>) {
  const { allowed } = await adminWith('payments.verify');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'pending');
  const statuses = tab === 'credited' ? (['CREDITED'] as const) : tab === 'rejected' ? (['REJECTED', 'CANCELLED'] as const) : (['PENDING_REVIEW'] as const);
  const rows = await topupQueue([...statuses]);
  return (
    <div>
      <PageHeader title="إيداعات المحافظ" description="كل إيداع يحتاج شخصين: منشئ يطلب الإضافة ومعتمد آخر ينفذ. لا يُضاف أي رصيد قبل التحقق من الإيصال في كشف الحساب." />
      <Tabs active={tab} tabs={[{ key: 'pending', label: 'بانتظار المراجعة', href: '/admin/wallet-topups' }, { key: 'credited', label: 'مضافة', href: '/admin/wallet-topups?tab=credited' }, { key: 'rejected', label: 'مرفوضة / ملغية', href: '/admin/wallet-topups?tab=rejected' }]} />
      <DataTable rows={rows} rowKey={(r) => r.t.id} empty={<EmptyState icon={Wallet} title="لا توجد إيداعات هنا" />} columns={[
        { key: 'c', header: 'العميل', cell: (r) => <Link href={`/admin/wallet-topups/${r.t.id}`} className="font-semibold text-brand-700">{r.user.fullName}</Link> },
        { key: 'm', header: 'الطريقة', cell: (r) => METHOD[r.t.method] ?? r.t.method },
        { key: 'a', header: 'المبلغ', cell: (r) => formatEGP(r.t.amount, { fixed: true }) },
        { key: 'd', header: 'وقت الرفع', cell: (r) => formatDate(r.t.createdAt, true) },
        { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.t.status} /> },
      ]} />
    </div>
  );
}
