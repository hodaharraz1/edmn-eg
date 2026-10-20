import { closureAdminAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { closureBlockerLabel, closureBlockers, pendingClosures } from '@/server/modules/customers/closure';
import { formatDate } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, EmptyState } from '@/ui/feedback';
import { UserX } from 'lucide-react';

export const metadata = { title: 'طلبات إغلاق الحسابات' };

export default async function Closures() {
  const { actor, allowed } = await adminWith(['customers.manage', 'customers.view']);
  if (!allowed) return <Forbidden />;
  const rows = await pendingClosures();
  const withBlockers = await Promise.all(rows.map(async (r) => ({ ...r, blockers: await closureBlockers(db, r.r.userId) })));
  const can = hasPermission(actor, 'customers.manage');
  return (
    <div className="space-y-4">
      <PageHeader title="طلبات إغلاق الحسابات" description="الإغلاق ممنوع طالما فيه أي عملية أو مستحقات أو التزامات مفتوحة. عند الإغلاق: تعطيل الحساب وإخفاء البيانات الشخصية مع الاحتفاظ بالطلبات والقيود والاستردادات والنزاعات والأدلة." />
      <Alert tone="warning">مدد الاحتفاظ القانونية لم تُعتمد بعد — لا يتم حذف أي سجل مالي أو دليل. (LEGAL REVIEW REQUIRED)</Alert>
      {withBlockers.length === 0 ? <EmptyState icon={UserX} title="لا توجد طلبات معلقة" /> : (
        <ul className="space-y-2">
          {withBlockers.map(({ r, fullName, email, blockers }) => (
            <li key={r.id} className="card p-3 text-sm">
              <p><b>{fullName}</b> <span className="ltr text-xs text-muted">{email}</span> · {formatDate(r.createdAt, true)}</p>
              {blockers.length ? <p className="text-xs text-red-700">موانع حالية: {blockers.map((b) => `${closureBlockerLabel(b.code)} (${b.count})`).join('، ')}</p> : <p className="text-xs text-emerald-700">لا توجد موانع حاليًا (يُعاد الفحص لحظة التنفيذ).</p>}
              {can && (
                <ActionForm action={closureAdminAction} className="mt-2">
                  <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="back" value="/admin/closures" />
                  <SubmitButton size="sm" variant="outline">تنفيذ الإغلاق (يُعاد فحص الموانع)</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
