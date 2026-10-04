import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { returnsForSeller } from '@/server/modules/postpurchase/returns';
import { requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المرتجعات' };

export default async function SellerReturns() {
  const actor = await requireSellerActor('/seller/returns');
  const rows = await returnsForSeller(actor.sellerId!);
  return (
    <div>
      <PageHeader title="المرتجعات" description="راجع طلبات الإرجاع واتخذ القرار. الرفض قابل للتصعيد لفريق اضمن." />
      <DataTable rows={rows} rowKey={(r) => r.id} empty={<EmptyState icon={RotateCcw} title="لا توجد مرتجعات" />} columns={[
        { key: 'n', header: 'رقم', cell: (r) => <Link href={`/seller/returns/${r.id}`} className="font-semibold text-brand-700 hover:underline">#{r.number}</Link> },
        { key: 'r', header: 'السبب', cell: (r) => label('returnReason', r.reason) },
        { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.createdAt) },
        { key: 'a', header: 'مبلغ الاسترداد', cell: (r) => formatEGP(r.refundAmount) },
        { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.status} /> },
      ]} />
    </div>
  );
}
