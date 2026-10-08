import Link from '@/ui/link';
import { CreditCard } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { paymentQueue } from '@/server/modules/payments/service';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'التحقق من المدفوعات' };

export default async function PaymentsQueue(props: PageProps<'/admin/payments'>) {
  const { allowed } = await adminWith('payments.view');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'pending');
  const statuses = tab === 'confirmed' ? (['CONFIRMED'] as const) : tab === 'rejected' ? (['REJECTED'] as const) : (['PAYMENT_SUBMITTED', 'UNDER_REVIEW'] as const);
  const rows = await paymentQueue([...statuses], 100);
  return (
    <div>
      <PageHeader title="مركز التحقق من المدفوعات" description="لا يُعتبر أي طلب مدفوعاً إلا بعد تأكيد موظف مختص من هنا. التأكيد غير قابل للتكرار ومُسجّل." />
      <Tabs active={tab} tabs={[{ key: 'pending', label: 'بانتظار التحقق', href: '/admin/payments' }, { key: 'confirmed', label: 'مؤكدة', href: '/admin/payments?tab=confirmed' }, { key: 'rejected', label: 'مرفوضة', href: '/admin/payments?tab=rejected' }]} />
      <DataTable rows={rows} rowKey={(r) => r.payment.id} empty={<EmptyState icon={CreditCard} title="لا توجد مدفوعات هنا" />} columns={[
        { key: 'ref', header: 'المرجع', cell: (r) => <Link href={`/admin/payments/${r.payment.id}`} className="font-semibold text-brand-700">{r.orderNumber ? `طلب #${r.orderNumber}` : `صفقة #${r.dealNumber}`}</Link> },
        { key: 'c', header: 'العميل', cell: (r) => r.payer.fullName },
        { key: 'm', header: 'الطريقة', cell: (r) => label('paymentMethod', r.payment.method) },
        { key: 'a', header: 'المبلغ المطلوب', cell: (r) => formatEGP(r.payment.amountDue) },
        { key: 'd', header: 'آخر تحديث', cell: (r) => formatDate(r.payment.updatedAt, true) },
        { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.payment.status} /> },
      ]} />
    </div>
  );
}
