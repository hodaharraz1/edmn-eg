import Link from '@/ui/link';
import { notFound } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { paymentDecisionAction } from '@/app/_actions/admin';
import { codRemittanceAction, codShortageResolveAction } from '@/app/_actions/finance-movements';
import { MovementPanel, openMovementFor } from '@/app/_components/movement-panel';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { codRemittanceShortfalls, externalDeals, orders, payments, sellerOrders, users } from '@/server/db/schema';
import { paymentReviewSignals, submissionsFor } from '@/server/modules/payments/service';
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
  const reviewerUsers = alias(users, 'reviewer_users');
  const [row] = await db.select({ p: payments, payer: users, reviewerName: reviewerUsers.fullName, orderNumber: orders.number, orderCodFee: orders.codFee, deal: externalDeals }).from(payments).innerJoin(users, eq(users.id, payments.payerUserId)).leftJoin(reviewerUsers, eq(reviewerUsers.id, payments.reviewStartedBy)).leftJoin(orders, eq(orders.id, payments.orderId)).leftJoin(externalDeals, eq(externalDeals.id, payments.dealId)).where(eq(payments.id, id));
  if (!row) notFound();
  const p = row.p;
  const subs = await submissionsFor(p.id);
  const open = subs.find((s) => s.status === 'SUBMITTED');
  const can = hasPermission(actor, 'payments.verify');
  const signals = await paymentReviewSignals(p.id);
  // COD: the expected remittance is what the courier collected for the DELIVERED sub-orders (+ COD fee).
  const codSos = p.method === 'COD' && p.orderId ? await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, p.orderId)) : [];
  const codExpected = codSos.filter((x) => x.status === 'DELIVERED' || x.status === 'COMPLETED').reduce((a, x) => a + x.grossTotal, 0) + (row.orderCodFee ?? 0);
  const shortfall = p.method === 'COD' ? await db.select().from(codRemittanceShortfalls).where(eq(codRemittanceShortfalls.paymentId, p.id)).then((r) => r[0] ?? null) : null;
  const pendingCancels = p.orderId
    ? (await db.execute<{ n: string }>(sql`select count(*)::text n from cancellation_requests c join seller_orders so on so.id = c.seller_order_id where so.order_id = ${p.orderId} and c.status = 'PENDING'`)).rows[0].n
    : '0';
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'المدفوعات', href: '/admin/payments' }, { label: row.orderNumber ? `طلب #${row.orderNumber}` : `صفقة #${row.deal?.number}` }]} />} title="مراجعة دفعة" actions={<StatusChip status={p.status} />} />
      {p.isTest && <Alert tone="warning" title="دفعة تجريبية (TEST)">أُنشئت والأموال الحقيقية معطّلة، ووجهة الدفع تجريبية. تأكيدها يكمل مسار الاختبار فقط ولا يعني استلام أموال فعلية.</Alert>}
      <section className="card p-4"><DefinitionList items={[
        { label: 'المرجع', value: p.orderId ? <Link href={`/admin/orders/${p.orderId}`} className="text-brand-700">طلب #{row.orderNumber}</Link> : <Link href={`/admin/deals/${p.dealId}`} className="text-brand-700">صفقة #{row.deal?.number}</Link> },
        { label: 'العميل', value: <Link href={`/admin/customers/${row.payer.id}`} className="text-brand-700">{row.payer.fullName} · <span className="ltr">{row.payer.phone}</span></Link> },
        { label: 'المبلغ المطلوب', value: <b>{formatEGP(p.amountDue, { fixed: true })}</b> },
        { label: 'الطريقة', value: label('paymentMethod', p.method) },
        { label: 'مهلة الدفع', value: formatDate(p.dueAt, true) },
        { label: 'بدأ المراجعة', value: row.reviewerName ?? '—' },
        { label: 'التأكيد', value: p.confirmedAt ? `${formatDate(p.confirmedAt, true)} · ${formatEGP(p.confirmedAmount)}` : '—' },
      ]} /></section>
      {p.status === 'UNDER_REVIEW' && <Alert tone="info">تأكيد الدفع يتطلب شخصين: من بدأ المراجعة لا يمكنه تأكيد الدفع — يؤكد موظف آخر بعد التحقق من الحساب.</Alert>}
      {p.method === 'COD' && p.status === 'COD_PENDING' && <Alert tone="info">دفع عند الاستلام: الطلب قيد التنفيذ لدى البائع/شركة الشحن. يُسجَّل التحصيل هنا بعد تسليم الطلب وتحصيل المندوب للمبلغ.</Alert>}
      {p.method === 'COD' && p.status === 'COD_COLLECTED' && can && (
        <MovementPanel actor={actor} kind="COD_REMITTANCE" entityId={p.id} amount={codExpected} back={`/admin/payments/${p.id}`} open={await openMovementFor('COD_REMITTANCE', p.id)}>
          <ActionForm action={codRemittanceAction} className="space-y-2">
            <input type="hidden" name="paymentId" value={p.id} />
            <input type="hidden" name="back" value={`/admin/payments/${p.id}`} />
            <Field label="المبلغ الفعلي المحوَّل من شركة الشحن (جنيه، كما في كشفها)" htmlFor="actualAmount">
              <Input id="actualAmount" name="actualAmount" required inputMode="decimal" dir="ltr" defaultValue={(codExpected / 100).toFixed(2)} />
            </Field>
            <Field label="مرجع كشف شركة الشحن" htmlFor="statementRef">
              <Input id="statementRef" name="statementRef" required minLength={3} placeholder="رقم/تاريخ الكشف" />
            </Field>
            <Input name="reason" required minLength={10} placeholder="سبب التسجيل (10 أحرف على الأقل)" aria-label="سبب التسجيل" />
            <p className="text-xs text-muted">المستحق: {formatEGP(codExpected, { fixed: true })}. لو الكشف أقل، يظهر الفرق كعجز للمراجعة؛ لو أكبر يُرفض التسجيل.</p>
            <SubmitButton>تسجيل التحصيل من الكشف</SubmitButton>
          </ActionForm>
        </MovementPanel>
      )}
      {shortfall && (
        <section className="card space-y-3 p-4" data-testid="cod-shortfall">
          <h3 className="font-bold">عجز تحصيل شركة الشحن</h3>
          <DefinitionList items={[
            { label: 'المستحق', value: formatEGP(shortfall.expectedAmount, { fixed: true }) },
            { label: 'المحوَّل فعليًا (كشف ' + shortfall.statementRef + ')', value: formatEGP(shortfall.actualAmount, { fixed: true }) },
            { label: 'العجز', value: <b className="text-red-700">{formatEGP(shortfall.shortfallAmount, { fixed: true })}</b> },
            { label: 'الحالة', value: shortfall.status === 'OPEN' ? 'مفتوح — بانتظار التسوية' : shortfall.resolution === 'RECOVERED' ? `مسوّى بالاسترداد · ${shortfall.resolvedAt ? formatDate(shortfall.resolvedAt, true) : ''}` : `مسوّى بالشطب كمصروف · ${shortfall.resolvedAt ? formatDate(shortfall.resolvedAt, true) : ''}` },
          ]} />
          {shortfall.status === 'OPEN' && can && (
            <>
              <MovementPanel actor={actor} kind="COD_SHORTAGE_RESOLUTION" entityId={shortfall.id} amount={shortfall.shortfallAmount} back={`/admin/payments/${p.id}`} modes={['RECOVERED', 'WRITTEN_OFF']} open={await openMovementFor('COD_SHORTAGE_RESOLUTION', shortfall.id)}>
                <ActionForm action={codShortageResolveAction} className="space-y-2">
                  <input type="hidden" name="shortfallId" value={shortfall.id} />
                  <input type="hidden" name="back" value={`/admin/payments/${p.id}`} />
                  <Input name="reason" required minLength={10} placeholder="سبب/مرجع التسوية (10 أحرف على الأقل)" aria-label="سبب التسوية" />
                  <SubmitButton>تنفيذ تسوية العجز (حسب طريقة الطلب)</SubmitButton>
                </ActionForm>
              </MovementPanel>
              <p className="text-xs text-muted">المنشئ يختار الطريقة في طلبه: استرداد نقدي من شركة الشحن لاحقًا، أو شطب كمصروف تسوية. المعتمد ينفذ طريقة الطلب نفسها.</p>
            </>
          )}
        </section>
      )}
      {signals.length > 0 && (
        <Alert tone="warning" title="إشارات مراجعة (لا تعني رفضًا تلقائيًا)">
          <ul className="list-disc ps-5">{signals.map((sg) => <li key={sg.code + sg.label} data-testid="payment-signal">{sg.label}{sg.refs.length ? ` — ${sg.refs.map((r) => r.slice(0, 8)).join('، ')}` : ''}</li>)}</ul>
        </Alert>
      )}
      {Number(pendingCancels) > 0 && <Alert tone="warning">العميل طلب إلغاء الطلب أثناء مراجعة الدفع. لو اتأكد الدفع، الإلغاء يتنفذ ويتسجل طلب استرداد للمبلغ (بانتظار اعتماد الإدارة).</Alert>}
      {subs.length === 0 && <Alert tone="info">لم يرفع العميل إثبات دفع بعد.</Alert>}
      {subs.map((s, i) => (
        <section key={s.id} className={`card grid gap-4 p-4 md:grid-cols-[1fr_1.2fr] ${s.status === 'SUBMITTED' ? 'border-brand-300' : ''}`}>
          <a href={`/api/files/${s.proofFileId}`} target="_blank" className="block overflow-hidden rounded-lg border border-line bg-page">
            <img src={`/api/files/${s.proofFileId}`} alt="إثبات الدفع" className="max-h-96 w-full object-contain" />
          </a>
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-bold">محاولة {subs.length - i} <StatusChip status={s.status} /></p>
            <DefinitionList items={[
              { label: 'المبلغ المعلن', value: <span className={s.claimedAmount !== p.amountDue ? 'font-bold text-red-700' : 'font-bold text-emerald-700'}>{formatEGP(s.claimedAmount, { fixed: true })}</span> },
              { label: 'رقم العملية', value: <span className="ltr">{s.reference ?? '—'}</span> },
              { label: 'اسم المحوّل', value: s.payerName ?? '—' },
              { label: 'وقت الرفع', value: formatDate(s.createdAt, true) },
              { label: 'ملاحظات', value: s.notes ?? '—' },
              { label: 'قرار المراجعة', value: s.reviewReason ?? '—' },
            ]} />
            {s.claimedAmount !== p.amountDue && <Alert tone="warning">المبلغ المعلن لا يطابق المبلغ المطلوب. تحقق من كشف الحساب قبل التأكيد.</Alert>}
            {can && s.id === open?.id && (
              <div className="space-y-3 border-t border-line pt-3">
                {p.status === 'PAYMENT_SUBMITTED' && <ActionForm action={paymentDecisionAction}><input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="back" value={`/admin/payments/${p.id}`} /><input type="hidden" name="op" value="review" /><SubmitButton size="sm" variant="outline">بدء المراجعة</SubmitButton></ActionForm>}
                {p.status === 'UNDER_REVIEW' && p.reviewStartedBy !== actor.userId && (
                <ActionForm action={paymentDecisionAction} className="space-y-2">
                  <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="back" value={`/admin/payments/${p.id}`} /><input type="hidden" name="submissionId" value={s.id} /><input type="hidden" name="op" value="confirm" /><input type="hidden" name="expectedAmount" value={p.amountDue} />
                  <Field label="ملاحظة داخلية (اختياري)" htmlFor="note"><Input id="note" name="note" /></Field>
                  <ConfirmSubmit confirm={`تأكيد استلام ${formatEGP(p.amountDue)} فعلياً في حساب اضمن؟ يُسجل قيد دفع واحد بموافقتك. لا يمكن التراجع.`} variant="success">تأكيد دفع {formatEGP(p.amountDue)} (تم التحقق من الحساب)</ConfirmSubmit>
                </ActionForm>
                )}
                {p.status === 'UNDER_REVIEW' && p.reviewStartedBy === actor.userId && <Alert tone="info">أنت من بدأ مراجعة هذه الدفعة — التأكيد ينتظر موظفاً آخر.</Alert>}
                <ActionForm action={paymentDecisionAction} className="space-y-2">
                  <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="back" value={`/admin/payments/${p.id}`} /><input type="hidden" name="submissionId" value={s.id} />
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
