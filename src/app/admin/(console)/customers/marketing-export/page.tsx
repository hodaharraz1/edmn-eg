import { marketingExportExecuteAction, marketingExportRejectAction, marketingExportRequestAction } from '@/app/_actions/marketing-exports';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { listMarketingExports } from '@/server/modules/customers/marketing';
import { formatDate } from '@/lib/format';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Checkbox, Input } from '@/ui/form';

export const metadata = { title: 'تصدير قائمة التسويق' };

export default async function MarketingExportPage() {
  const { actor, allowed } = await adminWith('customers.view');
  if (!allowed) return <Forbidden />;
  const can = hasPermission(actor, 'customers.exportMarketing');
  const rows = can ? await listMarketingExports(actor) : [];
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'العملاء', href: '/admin/customers' }, { label: 'تصدير قائمة التسويق' }]} />} title="تصدير قائمة عملاء التسويق" description="القائمة تشمل العملاء الموافقين على رسائل التسويق والحسابات النشطة فقط: الاسم، الموبايل، البريد، المحافظة، فئات المشتريات. لا تتضمن أبدًا الرقم القومي أو صور الهوية أو الإيصالات أو العناوين التفصيلية أو الحسابات المقفلة." />
      {!can && <Alert tone="info">التصدير يحتاج صلاحية «تصدير قائمة عملاء التسويق». اطلبها من مدير النظام.</Alert>}
      {can && (
        <>
          <Alert tone="info">ثلاث رقابات: الصلاحية المخصصة + تأكيدك الصريح + موافقة موظف آخر بنفس الصلاحية. الملف مشفّر وتظهر كلمة فك التشفير مرة واحدة فقط للموافِق المنفِّذ. كل طلب وتنفيذ وتحميل مُسجّل.</Alert>
          <section className="card space-y-3 p-4" data-testid="marketing-export-request">
            <h3 className="font-bold">طلب تصدير جديد</h3>
            <ActionForm action={marketingExportRequestAction} className="space-y-2">
              <Input name="reason" required minLength={10} placeholder="سبب التصدير (10 أحرف على الأقل) — مثال: حملة عروض رمضان" aria-label="سبب التصدير" />
              <Checkbox name="confirm" required label="أؤكد أن القائمة ستُستخدم لرسائل تسويق اضمن فقط وللعملاء الموافقين فقط، ولن تُشارك مع أي طرف خارجي" />
              <SubmitButton variant="outline">طلب التصدير (يتطلب موافقة شخص آخر)</SubmitButton>
            </ActionForm>
          </section>
          <section className="card space-y-3 p-4">
            <h3 className="font-bold">الطلبات</h3>
            {rows.length === 0 && <p className="text-sm text-muted">لا توجد طلبات تصدير بعد.</p>}
            {rows.map(({ e, requesterName, approverName }) => (
              <div key={e.id} className="rounded-xl border border-line p-3 text-sm" data-testid={`marketing-export-${e.status.toLowerCase()}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{formatDate(e.requestedAt, true)} — {requesterName}</span>
                  <StatusChip status={e.status} />
                </div>
                <p className="mt-1 text-muted">السبب: {e.requestReason}</p>
                {e.status === 'EXECUTED' && (
                  <p className="mt-1">نفّذه: <b>{approverName}</b> ({formatDate(e.executedAt, true)}) — {e.rowCount} عميل. <a href={`/api/marketing-export/${e.id}`} className="font-semibold text-brand-700 underline">تحميل الملف المشفر</a> (مُسجّل)</p>
                )}
                {e.status === 'REJECTED' && <p className="mt-1 text-red-700">رفضه {approverName}: {e.rejectReason}</p>}
                {e.status === 'REQUESTED' && e.requestedBy === actor.userId && <Alert tone="info" className="mt-2">طلبك بانتظار موافقة موظف آخر — لا يمكنك تنفيذه بنفسك.</Alert>}
                {e.status === 'REQUESTED' && e.requestedBy !== actor.userId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ActionForm action={marketingExportExecuteAction}>
                      <input type="hidden" name="exportId" value={e.id} />
                      <ConfirmSubmit confirm="تنفيذ التصدير الآن؟ سيظهر لك مفتاح فك التشفير مرة واحدة فقط.">موافقة وتنفيذ التصدير</ConfirmSubmit>
                    </ActionForm>
                    <ActionForm action={marketingExportRejectAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="exportId" value={e.id} />
                      <Input name="reason" required minLength={5} placeholder="سبب الرفض" aria-label="سبب رفض طلب التصدير" className="max-w-xs" />
                      <SubmitButton variant="ghost" size="sm">رفض</SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
