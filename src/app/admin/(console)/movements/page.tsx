import Link from '@/ui/link';
import { Banknote } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { MOVEMENT_LABELS, openMovementRequests } from '@/server/modules/finance/movements';
import { formatDate, formatEGP } from '@/lib/format';
import { PageHeader } from '@/ui/data';
import { Alert, Badge, EmptyState } from '@/ui/feedback';

export const metadata = { title: 'حركات مالية بانتظار معتمد' };

const linkFor = (entityType: string, entityId: string, kind: string) =>
  entityType === 'seller_order' ? `/admin/releases/${entityId}` : entityType === 'external_deal' ? `/admin/deals/${entityId}` : entityType === 'withdrawal' ? `/admin/withdrawals/${entityId}` : kind.startsWith('REFUND') ? '/admin/refunds?tab=' + (kind === 'REFUND_REVOCATION' ? 'payout' : 'requested') : '/admin/approvals';

export default async function Movements() {
  const { actor, allowed } = await adminWith(['finance.view', 'finance.movement.request']);
  if (!allowed) return <Forbidden />;
  const rows = await openMovementRequests(actor);
  return (
    <div className="space-y-4">
      <PageHeader title="حركات مالية بانتظار معتمد" description="كل حركة مالية فعلية تحتاج شخصين مختلفين: منشئ طلبها، ومعتمد آخر ينفذها من صفحة الكيان نفسه. لا يوجد حد أدنى للمبلغ يعفي من ذلك." />
      <Alert tone="info">الطلب وحده لا يحرك أي مبلغ. افتح الكيان لمراجعة التفاصيل ثم التنفيذ أو الرفض.</Alert>
      {rows.length === 0 ? <EmptyState icon={Banknote} title="لا توجد طلبات مفتوحة" /> : (
        <ul className="space-y-2" data-testid="movement-requests">
          {rows.map(({ r, maker }) => (
            <li key={r.id} className="card flex flex-wrap items-center justify-between gap-2 p-4">
              <span>
                <Link className="font-semibold text-brand-700" href={linkFor(r.entityType, r.entityId, r.kind)}>{MOVEMENT_LABELS[r.kind]}</Link>
                <span className="block text-xs text-muted">المنشئ: {maker} · {formatDate(r.requestedAt, true)} · {r.reason}</span>
              </span>
              <span className="flex items-center gap-2"><b>{formatEGP(r.amount)}</b>{r.requestedBy === actor.userId && <Badge tone="warning">طلبك — ينفذه شخص آخر</Badge>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
