import { notFound } from 'next/navigation';
import { adminReturnAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { isDomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { returnGraph, returnRefundCeiling } from '@/server/modules/postpurchase/returns';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Textarea } from '@/ui/form';

export default async function AdminReturn(props: PageProps<'/admin/returns/[id]'>) {
  const { actor, allowed } = await adminWith('returns.manage');
  if (!allowed) return <Forbidden />;
  let g;
  try {
    g = await returnGraph(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const r = g.ret;
  const ceiling = await returnRefundCeiling(db, r, true);
  const hidden = <><input type="hidden" name="returnId" value={r.id} /><input type="hidden" name="back" value={`/admin/returns/${r.id}`} /></>;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'المرتجعات', href: '/admin/returns' }, { label: `#${r.number}` }]} />} title={`مرتجع #${r.number}`} description={`الطلب ${g.orderLabel}`} actions={<StatusChip status={r.status} />} />
      {r.isStatutory && <Alert tone="info">مقدم خلال فترة الإرجاع القانونية — راعِ حقوق المستهلك المقررة قانوناً.</Alert>}
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'السبب', value: label('returnReason', r.reason) },
          { label: 'التاريخ', value: formatDate(r.createdAt, true) },
          { label: 'وصف العميل', value: r.description },
          { label: 'قرار البائع', value: r.decisionReason ?? '—' },
          { label: 'شحن المرتجع', value: r.returnCarrier ? `${r.returnCarrier} ${r.returnTracking ?? ''}` : '—' },
          { label: 'مبلغ الاسترداد', value: r.refundAmount != null ? formatEGP(r.refundAmount) : '—' },
        ]} />
        <ul className="mt-3 divide-y divide-line text-sm">{g.items.map(({ ri, item }) => <li key={ri.id} className="flex justify-between py-2"><span>{item.titleSnapshot} × {ri.quantity}</span><span>{formatEGP(item.unitPrice * ri.quantity)}</span></li>)}</ul>
        {g.evidence.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{g.evidence.map((e) => <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="size-20 overflow-hidden rounded-lg border border-line"><img src={`/api/files/${e.fileId}`} alt="دليل" className="size-full object-cover" /></a>)}</div>}
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {['REQUESTED', 'UNDER_REVIEW', 'DISPUTED'].includes(r.status) && (
          <ActionForm action={adminReturnAction} className="card space-y-2 p-5">
            {hidden}<input type="hidden" name="op" value="approve" />
            <h2 className="font-bold">الموافقة على الإرجاع (تدخل الإدارة)</h2>
            <Field label="ملاحظة"><Input name="note" /></Field>
            <SubmitButton>موافقة</SubmitButton>
          </ActionForm>
        )}
        {['REQUESTED', 'UNDER_REVIEW', 'DISPUTED'].includes(r.status) && (
          <ActionForm action={adminReturnAction} className="card space-y-2 p-5">
            {hidden}<input type="hidden" name="op" value="reject" />
            <h2 className="font-bold">رفض الإرجاع</h2>
            <Field label="السبب" required><Textarea name="reason" required minLength={5} rows={2} /></Field>
            <SubmitButton variant="danger">رفض</SubmitButton>
          </ActionForm>
        )}
        {['RECEIVED', 'INSPECTION', 'DISPUTED'].includes(r.status) && (
          <ActionForm action={adminReturnAction} className="card space-y-2 p-5 md:col-span-2">
            {hidden}<input type="hidden" name="op" value="refund" />
            <h2 className="font-bold">اعتماد الاسترداد</h2>
            <p className="text-xs text-muted">الحد الأقصى شاملاً الشحن: {formatEGP(ceiling.max)}. يُنشأ سجل استرداد يُصرف يدوياً من صفحة المستردات.</p>
            <Field label="المبلغ (اتركه فارغاً للحد الأقصى)"><Input name="amount" inputMode="decimal" placeholder={toInputAmount(ceiling.max)} /></Field>
            <Checkbox name="includeShipping" label="يشمل رسوم الشحن" />
            <Checkbox name="restock" label="إعادة المنتج للمخزون" />
            <Field label="ملاحظة"><Input name="note" /></Field>
            <SubmitButton>اعتماد الاسترداد</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
