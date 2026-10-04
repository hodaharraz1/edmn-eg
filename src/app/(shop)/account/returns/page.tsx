import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { returnsForCustomer } from '@/server/modules/postpurchase/returns';
import { currentUser } from '@/server/web/session';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { PageHeader } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المرتجعات' };

export default async function ReturnsPage() {
  const user = (await currentUser())!;
  const list = await returnsForCustomer(user.id);
  return (
    <div>
      <PageHeader title="المرتجعات" description="لطلب إرجاع افتح الطلب واختر «طلب إرجاع» بعد تأكيد الاستلام." />
      {list.length === 0 ? (
        <EmptyState icon={RotateCcw} title="لا توجد طلبات إرجاع" />
      ) : (
        <ul className="card divide-y divide-line">
          {list.map((r) => (
            <li key={r.id}>
              <Link href={`/account/returns/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm hover:bg-page/50">
                <span>مرتجع #{r.number} · {label('returnReason', r.reason)} · {formatDate(r.createdAt)}</span>
                <StatusChip status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
