import Link from '@/ui/link';
import { notFound } from 'next/navigation';
import { asc, eq, inArray } from 'drizzle-orm';
import { revealPayoutAction, withdrawalAdminAction } from '@/app/_actions/admin';
import { RevealPayout } from '@/app/_components/reveal-id';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { checkerMayExecute, MovementPanel, openMovementFor } from '@/app/_components/movement-panel';
import { withdrawalAllocationsOf } from '@/server/modules/finance/withdrawals';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { sellers, statusHistory, stores, users, withdrawalRequests } from '@/server/db/schema';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { formatDate, formatEGP } from '@/lib/format';
import { label, statusLabel } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { Breadcrumbs, DefinitionList, PageHeader, Timeline } from '@/ui/data';
import { Alert, Badge, StatusChip } from '@/ui/feedback';
import { TestMoneyNotice } from '@/app/_components/test-money';
import { Field, Input, Textarea } from '@/ui/form';

export default async function WithdrawalDetail(props: PageProps<'/admin/withdrawals/[id]'>) {
  const { actor, allowed } = await adminWith('withdrawals.view');
  if (!allowed) return <Forbidden />;
  const { id } = await props.params;
  const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id));
  if (!w) notFound();
  const [s] = w.sellerId ? await db.select({ seller: sellers, store: stores.name }).from(sellers).innerJoin(stores, eq(stores.sellerId, sellers.id)).where(eq(sellers.id, w.sellerId)) : [null];
  const bal = w.sellerId ? await sellerBalances(db, w.sellerId) : null;
  const allocations = await withdrawalAllocationsOf(w.id);
  const [beneficiary] = w.userId ? await db.select({ n: users.fullName }).from(users).where(eq(users.id, w.userId)) : [];
  const people = [w.requestedBy, w.reviewedBy, w.approvedBy, w.paidBy].filter((x): x is string => !!x);
  const names = people.length ? Object.fromEntries((await db.select({ id: users.id, n: users.fullName }).from(users).where(inArray(users.id, people))).map((u) => [u.id, u.n])) : {};
  const history = await db.select().from(statusHistory).where(eq(statusHistory.entityId, w.id)).orderBy(asc(statusHistory.createdAt));
  const canApprove = hasPermission(actor, 'withdrawals.approve');
  const canPay = hasPermission(actor, 'withdrawals.pay');
  const hold = !!s?.seller.payoutHoldUntil && s.seller.payoutHoldUntil > new Date();
  // Universal two-person rule (Batch 1.5): the payer is never the approver, whatever the amount.
  const sameAsApprover = w.approvedBy === actor.userId;
  const openReversal = await openMovementFor('WITHDRAWAL_REVERSAL', w.id);
  const openReturn = await openMovementFor('WITHDRAWAL_RETURN', w.id);
  const canMake = hasPermission(actor, 'finance.movement.request');
  const back = `/admin/withdrawals/${w.id}`;
  const hidden = <><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="back" value={`/admin/withdrawals/${w.id}`} /></>;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'السحوبات', href: '/admin/withdrawals' }, { label: `#${w.number}` }]} />} title={`طلب سحب #${w.number} — ${formatEGP(w.amount)}`} description={s?.store ?? `بائع صفقات محمية — ${beneficiary?.n ?? ''}`} actions={<StatusChip status={w.status} kind="withdrawal" />} />
      {w.isTest && <TestMoneyNotice kind="payout" />}
      {hold && <Alert tone="danger">على البائع تجميد صرف حتى {formatDate(s?.seller.payoutHoldUntil)} — راجع السبب في ملف البائع قبل الاعتماد.</Alert>}
      {s && s.seller.status !== 'APPROVED' && <Alert tone="warning">حالة البائع: {statusLabel(s.seller.status)}</Alert>}
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'البائع', value: s ? <Link className="text-brand-700" href={`/admin/sellers/${w.sellerId}`}>{s.store} · {s.seller.legalName}</Link> : `${beneficiary?.n ?? '—'} (بدون متجر — صفقات محمية)` },
          { label: 'وجهة الصرف', value: w.receivingDestinationId ? 'بيانات استلام أموال متحقق منها (مستوى المستخدم)' : 'بيانات استلام أموال المتجر المتحقق منها' },
          { label: 'الحساب (مقنّع)', value: <span>{label('payoutType', w.payoutType)} <span className="ltr">{w.payoutMasked}</span></span> },
          { label: 'المصدر', value: w.source === 'SCHEDULED' ? 'تسوية دورية' : w.source === 'ACCOUNT' ? 'طلب من حساب المستخدم' : 'طلب البائع' },
          { label: 'موعد SLA', value: formatDate(w.slaDueAt, true) },
          { label: 'رقابة مزدوجة', value: w.requiresDualControl ? <Badge tone="warning">مطلوبة: المنفّذ ≠ المعتمد</Badge> : 'لا' },
          { label: 'طلبه', value: `${w.requestedBy ? names[w.requestedBy] : 'النظام'} · ${formatDate(w.createdAt, true)}` },
          { label: 'اعتمده', value: w.approvedBy ? `${names[w.approvedBy]} · ${formatDate(w.approvedAt, true)}` : '—' },
          { label: 'صرفه', value: w.paidBy ? `${names[w.paidBy]} · ${formatDate(w.paidAt, true)} · مرجع ${w.paidReference}` : '—' },
          { label: 'إثبات التحويل', value: w.proofFileId ? <a className="text-brand-700 underline" target="_blank" href={`/api/files/${w.proofFileId}`}>عرض</a> : '—' },
          { label: 'رسوم التحويل', value: w.payoutChannel ? `${w.payoutChannel} · ${formatEGP(w.transferCost)} ${w.transferCostPayer === 'SELLER_PAYS' ? '(على البائع)' : '(على اضمن)'} · صافي للبائع ${formatEGP(w.netTransferAmount ?? w.amount)}${w.actualTransferCost !== null ? ` · الفعلية ${formatEGP(w.actualTransferCost)}` : ''}` : '— (طلب قبل محرك التكاليف)' },
          ...(((w.transferCostSnapshot as { warnings?: string[] } | null)?.warnings ?? []).length ? [{ label: 'تحذيرات الحدود', value: ((w.transferCostSnapshot as { warnings?: string[] }).warnings ?? []).join('، ') }] : []),
          ...(bal ? [{ label: 'أرصدة المتجر الآن', value: `متاح ${formatEGP(bal.available)} · محجوز ${formatEGP(bal.reserved)} · معلق ${formatEGP(bal.pending)}` }] : []),
          ...(w.rejectReason ? [{ label: 'سبب الرفض', value: w.rejectReason }] : []),
          ...(w.transferUncertainAt ? [{ label: 'نتيجة غير مؤكدة منذ', value: formatDate(w.transferUncertainAt, true) }] : []),
          ...(w.transferFailedAt ? [{ label: 'فشل قبل التحويل', value: `${formatDate(w.transferFailedAt, true)} · ${w.transferFailureReason ?? ''} · دليل ${w.transferFailureEvidence ?? ''}` }] : []),
          ...(w.returnedAt ? [{ label: 'ارتداد التحويل', value: `${formatEGP(w.returnedAmount ?? 0)} · ${formatDate(w.returnedAt, true)} · مرجع ${w.returnedReference ?? ''} · ${w.returnReason ?? ''}` }] : []),
        ]} />
        {canPay && ['APPROVED', 'PROCESSING', 'TRANSFER_UNCERTAIN'].includes(w.status) && (
          <div className="mt-3 border-t border-line pt-3">
            <RevealPayout action={revealPayoutAction} kind="withdrawal" id={w.id} back={`/admin/withdrawals/${w.id}`} />
            <p className="mt-1 text-xs text-muted">يتطلب تحققاً إضافياً حديثاً (2FA) وكل عملية عرض مسجّلة في سجل التدقيق.</p>
          </div>
        )}
      </section>
      <section className="card p-5" data-testid="withdrawal-allocations">
        <h2 className="mb-2 font-bold">توزيع مصادر السحب</h2>
        {allocations.length === 0 ? (
          <p className="text-sm text-muted">{w.reservedAt ? 'سحب سابق لنظام التوزيع: مصدره بالكامل رصيد مبيعات المتجر.' : 'يتحدد التوزيع عند الاعتماد: الصفقات المحمية المستحقة الأقدم أولاً، ثم رصيد مبيعات المتجر.'}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {allocations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{a.seq}. {a.sourceType === 'MARKETPLACE' ? 'رصيد مبيعات المتجر' : <>صفقة محمية {a.dealId && <Link className="text-brand-700" href={`/admin/deals/${a.dealId}`}>(الصفقة)</Link>}</>} · <Badge>{({ RESERVED: 'محجوز', PAID: 'تم التحويل', RELEASED: 'أُعيد للمصدر', RETURNED: 'ارتد وأُعيد للمصدر' } as const)[a.status]}</Badge>{a.restoredAmount > 0 && ` · أُعيد ${formatEGP(a.restoredAmount)}`}</span>
                <b className="tabular-nums">{formatEGP(a.amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {canApprove && w.status === 'REQUESTED' && <ActionForm action={withdrawalAdminAction} className="card p-5">{hidden}<input type="hidden" name="op" value="review" /><SubmitButton variant="outline">بدء المراجعة</SubmitButton></ActionForm>}
        {canApprove && ['REQUESTED', 'UNDER_REVIEW'].includes(w.status) && (
          <ActionForm action={withdrawalAdminAction} className="card space-y-2 p-5">
            {hidden}<input type="hidden" name="op" value="approve" />
            <h2 className="font-bold">اعتماد (المراجِع)</h2>
            <Field label="ملاحظة"><Input name="note" /></Field>
            <p className="text-xs text-muted">الاعتماد يعيد فحص الرصيد المتاح والحالة ويحجز {formatEGP(w.amount)} فورًا (قيد واحد بموافقتك). الطلب نفسه لم يحجز أي مبلغ.</p>
            <SubmitButton>اعتماد وحجز {formatEGP(w.amount)}</SubmitButton>
          </ActionForm>
        )}
        {canPay && w.status === 'APPROVED' && <ActionForm action={withdrawalAdminAction} className="card p-5">{hidden}<input type="hidden" name="op" value="processing" /><SubmitButton variant="outline">بدء التحويل (قيد التنفيذ)</SubmitButton></ActionForm>}
        {canPay && ['APPROVED', 'PROCESSING', 'TRANSFER_UNCERTAIN'].includes(w.status) && (
          <ActionForm action={withdrawalAdminAction} className="card space-y-2 p-5">
            {hidden}<input type="hidden" name="op" value="paid" />
            <h2 className="font-bold">تسجيل الصرف (المنفّذ)</h2>
            {sameAsApprover && <Alert tone="danger">أنت من اعتمد هذا الطلب؛ يجب أن يسجّل الصرف موظف آخر.</Alert>}
            <p className="text-xs text-muted">سجّل فقط بعد إتمام التحويل فعلياً. يتطلب تحققاً إضافياً (2FA حديث).</p>
            <Field label="رقم مرجع التحويل" required><Input name="reference" required minLength={3} className="ltr" /></Field>
            <FileInput name="proof" label="إثبات التحويل" accept="image/jpeg,image/png,image/webp,application/pdf" />
            <Field label={`رسوم التحويل الفعلية (ج.م) — المسعّرة ${formatEGP(w.transferCost)}`} hint="البائع لا يتحمل أكثر من المبلغ المعلن له؛ الزيادة تُسجل مصروفًا على اضمن."><Input name="actualTransferCost" className="ltr" placeholder={(w.transferCost / 100).toFixed(2)} /></Field>
            {!sameAsApprover && <SubmitButton>تأكيد الصرف</SubmitButton>}
          </ActionForm>
        )}
        {canPay && w.status === 'PROCESSING' && (
          <ActionForm action={withdrawalAdminAction} className="card space-y-2 p-5" data-testid="wd-uncertain">
            {hidden}<input type="hidden" name="op" value="uncertain" />
            <h2 className="font-bold">نتيجة التحويل غير مؤكدة</h2>
            <p className="text-xs text-muted">لا يتحرك أي مبلغ: يبقى {formatEGP(w.amount)} محجوزًا حتى تُثبت النتيجة (تم الصرف أو فشل قبل التحويل).</p>
            <Field label="السبب" required><Textarea name="reason" required minLength={5} rows={2} /></Field>
            <SubmitButton variant="outline">تسجيل نتيجة غير مؤكدة (2FA)</SubmitButton>
          </ActionForm>
        )}
        {(canApprove || canMake) && ['PROCESSING', 'TRANSFER_UNCERTAIN'].includes(w.status) && (
          <MovementPanel actor={actor} kind="WITHDRAWAL_REVERSAL" mode="FAILED_BEFORE_TRANSFER" entityId={w.id} amount={w.amount} back={back} open={openReversal}>
          {canApprove && checkerMayExecute(actor, openReversal) && w.processingBy !== actor.userId && w.transferUncertainBy !== actor.userId && (
          <ActionForm action={withdrawalAdminAction} className="space-y-2 border-t border-line pt-3" data-testid="wd-failed-before-transfer">
            {hidden}<input type="hidden" name="op" value="failed_before_transfer" />
            <h2 className="font-bold">فشل قبل التحويل (لم يخرج أي مبلغ)</h2>
            <p className="text-xs text-muted">استخدمه فقط بدليل أن التحويل لم يخرج من اضمن. يُعاد المبلغ المحجوز لرصيد البائع المتاح بقيد عكسي بموافقتك. يجب أن يكون شخصًا غير منفذ التحويل.</p>
            <Field label="دليل عدم خروج التحويل (مرجع كشف الحساب / رد المزود)" required><Input name="evidence" required minLength={3} className="ltr" /></Field>
            <Field label="السبب" required><Textarea name="reason" required minLength={5} rows={2} /></Field>
            <SubmitButton variant="danger">تأكيد الفشل قبل التحويل (2FA)</SubmitButton>
          </ActionForm>
          )}
          </MovementPanel>
        )}
        {(canApprove || canMake) && w.status === 'PAID' && (
          <MovementPanel actor={actor} kind="WITHDRAWAL_RETURN" entityId={w.id} amount={w.netTransferAmount ?? w.amount} back={back} open={openReturn}>
          {canApprove && checkerMayExecute(actor, openReturn) && w.paidBy !== actor.userId && (
          <ActionForm action={withdrawalAdminAction} className="space-y-2 border-t border-line pt-3" data-testid="wd-returned">
            {hidden}<input type="hidden" name="op" value="returned" />
            <h2 className="font-bold">تسجيل ارتداد التحويل</h2>
            <p className="text-xs text-muted">للتحويل الذي سُجّل صرفه ثم رجع من البنك/المزود. يُسجل قيد تعويضي بموافقتك (لا يُعدّل قيد الصرف الأصلي) ويُعاد المبلغ لرصيد البائع المتاح، ويلزم إعادة اعتماد بيانات استلام الأموال.</p>
            <input type="hidden" name="amount" value={((openReturn?.r.amount ?? 0) / 100).toFixed(2)} />
            <p className="text-sm">المبلغ المرتد (من طلب المنشئ): <b>{formatEGP(openReturn?.r.amount ?? 0)}</b></p>
            <Field label="مرجع الارتداد" required><Input name="reference" required minLength={3} className="ltr" /></Field>
            <Field label="السبب" required><Textarea name="reason" required minLength={5} rows={2} /></Field>
            <SubmitButton variant="danger">تسجيل الارتداد (2FA)</SubmitButton>
          </ActionForm>
          )}
          </MovementPanel>
        )}
        {(canApprove || canMake) && w.status === 'APPROVED' && w.reservedAt && (
          <MovementPanel actor={actor} kind="WITHDRAWAL_REVERSAL" mode="REJECT" entityId={w.id} amount={w.amount} back={back} open={openReversal}>
            {canApprove && checkerMayExecute(actor, openReversal) && (
              <ActionForm action={withdrawalAdminAction} className="space-y-2 border-t border-line pt-3">
                {hidden}<input type="hidden" name="op" value="reject" />
                <h2 className="font-bold">رفض الطلب وفك الحجز</h2>
                <p className="text-xs text-muted">يُعاد المبلغ المحجوز إلى رصيد البائع المتاح بقيد عكسي معتمد من شخصين.</p>
                <Field label="السبب" required><Textarea name="reason" required minLength={5} rows={2} /></Field>
                <SubmitButton variant="danger">رفض (2FA)</SubmitButton>
              </ActionForm>
            )}
          </MovementPanel>
        )}
        {canApprove && ['REQUESTED', 'UNDER_REVIEW'].includes(w.status) && (
          <ActionForm action={withdrawalAdminAction} className="card space-y-2 p-5">
            {hidden}<input type="hidden" name="op" value="reject" />
            <h2 className="font-bold">رفض الطلب</h2>
            <p className="text-xs text-muted">لم يُحجز أي مبلغ لهذا الطلب — الرفض لا يحرك أي مبلغ.</p>
            <Field label="السبب" required><Textarea name="reason" required minLength={5} rows={2} /></Field>
            <SubmitButton variant="danger">رفض</SubmitButton>
          </ActionForm>
        )}
      </div>
      <section className="card p-5"><h2 className="mb-2 font-bold">سجل الحالات</h2><Timeline items={history.map((h) => ({ title: `${h.fromStatus ?? '∅'} ← ${h.toStatus}`, time: `${formatDate(h.createdAt, true)} · ${h.actorType}`, body: h.reason }))} /></section>
    </div>
  );
}
