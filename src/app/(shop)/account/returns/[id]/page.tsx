import { notFound } from 'next/navigation';
import { escalateReturnAction, shipReturnAction } from '@/app/_actions/account';
import { returnGraph } from '@/server/modules/postpurchase/returns';
import { isDomainError } from '@/server/core/errors';
import { requireCustomer } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Field, Input, Textarea } from '@/ui/form';

export default async function ReturnDetail(props: PageProps<'/account/returns/[id]'>) {
  const actor = await requireCustomer('/account/returns');
  let g;
  try {
    g = await returnGraph(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const r = g.ret;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'المرتجعات', href: '/account/returns' }, { label: `#${r.number}` }]} />} title={`طلب إرجاع #${r.number}`} description={`على الطلب ${g.orderLabel}`} actions={<StatusChip status={r.status} />} />
      {r.status === 'APPROVED' && <Alert tone="success" title="تمت الموافقة على الإرجاع">أرسل المنتج إلى عنوان الإرجاع الخاص بالبائع ثم سجّل بيانات الشحن أدناه.</Alert>}
      {r.status === 'REJECTED' && <Alert tone="danger" title="تم رفض طلب الإرجاع">السبب: {r.decisionReason}. إذا كنت ترى أن القرار غير عادل يمكنك تصعيد الأمر لفريق اضمن.</Alert>}
      {r.status === 'REFUND_PENDING' && <Alert tone="info">تم قبول استرداد {formatEGP(r.refundAmount)} وسيتم تحويله إليك من فريق اضمن المالي.</Alert>}
      {r.status === 'REFUNDED' && <Alert tone="success">تم رد المبلغ {formatEGP(r.refundAmount)}.</Alert>}
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'السبب', value: label('returnReason', r.reason) },
          { label: 'تاريخ الطلب', value: formatDate(r.createdAt, true) },
          { label: 'الوصف', value: r.description },
          { label: 'شحن المرتجع', value: r.returnCarrier ? `${r.returnCarrier} ${r.returnTracking ?? ''}` : '—' },
        ]} />
        <ul className="mt-4 divide-y divide-line text-sm">
          {g.items.map(({ ri, item }) => (
            <li key={ri.id} className="flex justify-between py-2"><span>{item.titleSnapshot} × {ri.quantity}</span><span>{formatEGP(item.unitPrice * ri.quantity)}</span></li>
          ))}
        </ul>
        {g.evidence.length > 0 && (
          <div className="mt-3 flex gap-2">
            {g.evidence.map((e) => (
              <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="size-16 overflow-hidden rounded-lg border border-line">
                <img src={`/api/files/${e.fileId}`} alt="دليل" className="size-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </section>
      {r.status === 'APPROVED' && (
        <ActionForm action={shipReturnAction} className="card grid gap-3 p-5 sm:grid-cols-3">
          <input type="hidden" name="returnId" value={r.id} />
          <Field label="شركة الشحن" htmlFor="carrier" required><Input id="carrier" name="carrier" required /></Field>
          <Field label="رقم التتبع" htmlFor="tracking"><Input id="tracking" name="tracking" dir="ltr" /></Field>
          <div className="flex items-end"><SubmitButton>تسجيل شحن المرتجع</SubmitButton></div>
        </ActionForm>
      )}
      {r.status === 'REJECTED' && (
        <ActionForm action={escalateReturnAction} className="card space-y-3 p-5">
          <input type="hidden" name="returnId" value={r.id} />
          <Field label="لماذا تعترض على القرار؟" htmlFor="description" required><Textarea id="description" name="description" required minLength={10} /></Field>
          <SubmitButton variant="accent">تصعيد لفريق اضمن (فتح نزاع)</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
