import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { paymentDecisionAction } from '@/app/_actions/admin';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { externalDeals, orders, payments, users } from '@/server/db/schema';
import { submissionsFor } from '@/server/modules/payments/service';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { Breadcrumbs, DefinitionList, PageHeader } from '@/ui/data';
import { Alert, StatusChip } from '@/ui/feedback';
import { Field, Input, Textarea } from '@/ui/form';

export default async function PaymentReview(props: PageProps<'/admin/payments/[id]'>) {
  const { actor, allowed } = await adminWith('payments.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const [row] = await db.select({ p: payments, payer: users, orderNumber: orders.number, deal: externalDeals }).from(payments).innerJoin(users, eq(users.id, payments.payerUserId)).leftJoin(orders, eq(orders.id, payments.orderId)).leftJoin(externalDeals, eq(externalDeals.id, payments.dealId)).where(eq(payments.id, id));
  if (!row) notFound();
  const p = row.p;
  const subs = await submissionsFor(p.id);
  const open = subs.find((s) => s.status === 'SUBMITTED');
  const can = hasPermission(actor, 'payments.verify');
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'المدفوعات', href: '/admin/payments' }, { label: row.orderNumber ? `طلب #${row.orderNumber}` : `صفقة #${row.deal?.number}` }]} />} title="مراجعة دفعة" actions={<StatusChip status={p.status} />} />
      <section className="card p-4"><DefinitionList items={[
        { label: 'المرجع', value: p.orderId ? <Link href={`/admin/orders/${p.orderId}`} className="text-brand-700">طلب #{row.orderNumber}</Link> : <Link href={`/admin/deals/${p.dealId}`} className="text-brand-700">صفقة #{row.deal?.number}</Link> },
        { label: 'العميل', value: <Link href={`/admin/customers/${row.payer.id}`} className="text-brand-700">{row.payer.fullName} · <span className="ltr">{row.payer.phone}</span></Link> },
        { label: 'المبلغ المطلوب', value: <b>{formatEGP(p.amountDue, { fixed: true })}</b> },
        { label: 'الطريقة', value: label('paymentMethod', p.method) },
        { label: 'مهلة الدفع', value: formatDate(p.dueAt, true) },
        { label: 'التأكيد', value: p.confirmedAt ? `${formatDate(p.confirmedAt, true)} · ${formatEGP(p.confirmedAmount)}` : '—' },
      ]} /></section>
      {subs.length === 0 && <Alert tone="info">لم يرفع العميل إثبات دفع بعد.</Alert>}
      {subs.map((s, i) => (
        <section key={s.id} className={`card grid gap-4 p-4 md:grid-cols-[1fr_1.2fr] ${s.status === 'SUBMITTED' ? 'border-brand-300' : ''}`}>
          <a href={`/api/files/${s.proofFileId}`} target="_blank" className="block overflow-hidden rounded-lg border border-line bg-page">
            <img src={`/api/files/${s.proofFileId}`} alt="إثبات الدفع" className="max-h-96 w-full object-contain" />
          </a>
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-bold">محاولة {subs.length - i} <StatusChip status={s.status} /></p>
            <DefinitionList items={[
              { label: 'المبلغ المعلن', value: <span className={s.claimedAmount !== p.amountDue ? 'font-bold text-red-600' : 'font-bold text-emerald-700'}>{formatEGP(s.claimedAmount, { fixed: true })}</span> },
              { label: 'رقم العملية', value: <span className="ltr">{s.reference ?? '—'}</span> },
              { label: 'اسم المحوّل', value: s.payerName ?? '—' },
              { label: 'وقت الرفع', value: formatDate(s.createdAt, true) },
              { label: 'ملاحظات', value: s.notes ?? '—' },
              { label: 'قرار المراجعة', value: s.reviewReason ?? '—' },
            ]} />
            {s.claimedAmount !== p.amountDue && <Alert tone="warning">المبلغ المعلن لا يطابق المبلغ المطلوب. تحقق من كشف الحساب قبل التأكيد.</Alert>}
            {can && s.id === open?.id && (
              <div className="space-y-3 border-t border-line pt-3">
                {p.status === 'PAYMENT_SUBMITTED' && <ActionForm action={paymentDecisionAction}><input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="op" value="review" /><SubmitButton size="sm" variant="outline">بدء المراجعة</SubmitButton></ActionForm>}
                <ActionForm action={paymentDecisionAction} className="space-y-2">
                  <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="submissionId" value={s.id} /><input type="hidden" name="op" value="confirm" />
                  <Field label="ملاحظة داخلية (اختياري)" htmlFor="note"><Input id="note" name="note" /></Field>
                  <ConfirmSubmit confirm={`تأكيد استلام ${formatEGP(p.amountDue)} فعلياً في حساب اضمن؟ لا يمكن التراجع.`} variant="success">تأكيد الدفع (تم التحقق من الحساب)</ConfirmSubmit>
                </ActionForm>
                <ActionForm action={paymentDecisionAction} className="space-y-2">
                  <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="submissionId" value={s.id} />
                  <Field label="سبب الرفض (يظهر للعميل)" htmlFor="reason" required><Textarea id="reason" name="reason" rows={2} required /></Field>
                  <div className="flex gap-2">
                    <SubmitButton variant="outline" size="sm" name="op" value="newproof">طلب إثبات جديد</SubmitButton>
                    <SubmitButton variant="danger" size="sm" name="op" value="reject">رفض</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
