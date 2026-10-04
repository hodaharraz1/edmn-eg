import { notFound } from 'next/navigation';
import { sellerReturnAction } from '@/app/_actions/seller';
import { returnGraph, returnRefundCeiling } from '@/server/modules/postpurchase/returns';
import { isDomainError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Checkbox, Field, Input, Textarea } from '@/ui/form';

export default async function SellerReturnDetail(props: PageProps<'/seller/returns/[id]'>) {
  const actor = await requireSellerActor('/seller/returns');
  let g;
  try {
    g = await returnGraph(actor, (await props.params).id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const r = g.ret;
  const ceiling = await returnRefundCeiling(db, r, false);
  const Op = ({ op, children, variant }: { op: string; children: React.ReactNode; variant?: 'primary' | 'outline' | 'danger' }) => (
    <ActionForm action={sellerReturnAction}><input type="hidden" name="returnId" value={r.id} /><input type="hidden" name="op" value={op} /><SubmitButton variant={variant ?? 'primary'}>{children}</SubmitButton></ActionForm>
  );
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'المرتجعات', href: '/seller/returns' }, { label: `#${r.number}` }]} />} title={`مرتجع #${r.number}`} description={`الطلب ${g.orderLabel}`} actions={<StatusChip status={r.status} />} />
      {r.isStatutory && <Alert tone="info">هذا الطلب مقدم خلال فترة الإرجاع القانونية. يرجى مراعاة حقوق المستهلك المقررة قانوناً عند اتخاذ القرار.</Alert>}
      <section className="card p-5">
        <DefinitionList items={[{ label: 'السبب', value: label('returnReason', r.reason) }, { label: 'التاريخ', value: formatDate(r.createdAt, true) }, { label: 'وصف العميل', value: r.description }, { label: 'شحن المرتجع', value: r.returnCarrier ? `${r.returnCarrier} ${r.returnTracking ?? ''}` : '—' }]} />
        <ul className="mt-3 divide-y divide-line text-sm">{g.items.map(({ ri, item }) => <li key={ri.id} className="flex justify-between py-2"><span>{item.titleSnapshot} × {ri.quantity}</span><span>{formatEGP(item.unitPrice * ri.quantity)}</span></li>)}</ul>
        {g.evidence.length > 0 && <div className="mt-3 flex gap-2">{g.evidence.map((e) => <a key={e.id} href={`/api/files/${e.fileId}`} target="_blank" className="size-16 overflow-hidden rounded-lg border border-line"><img src={`/api/files/${e.fileId}`} alt="دليل" className="size-full object-cover" /></a>)}</div>}
      </section>
      {['REQUESTED', 'UNDER_REVIEW'].includes(r.status) && (
        <div className="grid gap-4 md:grid-cols-2">
          <ActionForm action={sellerReturnAction} className="card space-y-2 p-5">
            <input type="hidden" name="returnId" value={r.id} /><input type="hidden" name="op" value="approve" />
            <h2 className="font-bold">الموافقة</h2>
            <Field label="تعليمات للعميل (اختياري)" htmlFor="note"><Textarea id="note" name="note" rows={2} /></Field>
            <SubmitButton variant="success">موافقة على الإرجاع</SubmitButton>
          </ActionForm>
          <ActionForm action={sellerReturnAction} className="card space-y-2 p-5">
            <input type="hidden" name="returnId" value={r.id} /><input type="hidden" name="op" value="reject" />
            <h2 className="font-bold">الرفض</h2>
            <Field label="سبب الرفض" htmlFor="reason" required><Textarea id="reason" name="reason" rows={2} required /></Field>
            <SubmitButton variant="danger">رفض</SubmitButton>
          </ActionForm>
        </div>
      )}
      {['APPROVED', 'RETURN_IN_TRANSIT'].includes(r.status) && <Op op="received">استلمت المرتجع</Op>}
      {r.status === 'RECEIVED' && <Op op="inspect" variant="outline">بدء الفحص</Op>}
      {['RECEIVED', 'INSPECTION'].includes(r.status) && (
        <div className="grid gap-4 md:grid-cols-2">
          <ActionForm action={sellerReturnAction} className="card space-y-3 p-5">
            <input type="hidden" name="returnId" value={r.id} /><input type="hidden" name="op" value="refund" />
            <h2 className="font-bold">قبول الاسترداد</h2>
            <Field label="مبلغ الاسترداد (ج.م)" htmlFor="amount" hint={`قيمة المنتجات ${formatEGP(ceiling.items)} — الحد الأقصى ${formatEGP(ceiling.max)}`}><Input id="amount" name="amount" defaultValue={toInputAmount(ceiling.items)} dir="ltr" /></Field>
            <Checkbox name="includeShipping" label="يشمل مصاريف الشحن" />
            <Checkbox name="restock" defaultChecked label="إعادة المنتج للمخزون (صالح للبيع)" />
            <Field label="ملاحظات الفحص" htmlFor="note"><Textarea id="note" name="note" rows={2} /></Field>
            <SubmitButton variant="success">تأكيد الاسترداد</SubmitButton>
            <p className="text-xs text-muted">سيتم خصم المبلغ (ناقص حصة العمولة) من رصيدك، ويحوّل فريق اضمن المبلغ للعميل.</p>
          </ActionForm>
          {r.status === 'INSPECTION' && (
            <ActionForm action={sellerReturnAction} className="card space-y-2 p-5">
              <input type="hidden" name="returnId" value={r.id} /><input type="hidden" name="op" value="dispute" />
              <h2 className="font-bold">المنتج المرتجع غير مطابق</h2>
              <Field label="اشرح المشكلة (سيراجعها فريق اضمن)" htmlFor="reason" required><Textarea id="reason" name="reason" rows={3} required /></Field>
              <SubmitButton variant="danger">رفع نزاع</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
