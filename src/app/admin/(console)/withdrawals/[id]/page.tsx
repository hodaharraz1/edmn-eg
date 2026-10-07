import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq, inArray } from 'drizzle-orm';
import { revealPayoutAction, withdrawalAdminAction } from '@/app/_actions/admin';
import { RevealPayout } from '@/app/_components/reveal-id';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { sellers, statusHistory, stores, users, withdrawalRequests } from '@/server/db/schema';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
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
  const [s] = await db.select({ seller: sellers, store: stores.name }).from(sellers).innerJoin(stores, eq(stores.sellerId, sellers.id)).where(eq(sellers.id, w.sellerId));
  const bal = await sellerBalances(db, w.sellerId);
  const people = [w.requestedBy, w.reviewedBy, w.approvedBy, w.paidBy].filter((x): x is string => !!x);
  const names = people.length ? Object.fromEntries((await db.select({ id: users.id, n: users.fullName }).from(users).where(inArray(users.id, people))).map((u) => [u.id, u.n])) : {};
  const history = await db.select().from(statusHistory).where(eq(statusHistory.entityId, w.id)).orderBy(asc(statusHistory.createdAt));
  const canApprove = hasPermission(actor, 'withdrawals.approve');
  const canPay = hasPermission(actor, 'withdrawals.pay');
  const hold = s.seller.payoutHoldUntil && s.seller.payoutHoldUntil > new Date();
  const sameAsApprover = w.requiresDualControl && w.approvedBy === actor.userId;
  const hidden = <><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="back" value={`/admin/withdrawals/${w.id}`} /></>;
  return (
    <div className="space-y-4">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'السحوبات', href: '/admin/withdrawals' }, { label: `#${w.number}` }]} />} title={`طلب سحب #${w.number} — ${formatEGP(w.amount)}`} description={s.store} actions={<StatusChip status={w.status} />} />
      {w.isTest && <TestMoneyNotice kind="payout" />}
      {hold && <Alert tone="danger">على البائع تجميد صرف حتى {formatDate(s.seller.payoutHoldUntil)} — راجع السبب في ملف البائع قبل الاعتماد.</Alert>}
      {s.seller.status !== 'APPROVED' && <Alert tone="warning">حالة البائع: {s.seller.status}</Alert>}
      <section className="card p-5">
        <DefinitionList items={[
          { label: 'البائع', value: <Link className="text-brand-700" href={`/admin/sellers/${w.sellerId}`}>{s.store} · {s.seller.legalName}</Link> },
          { label: 'الحساب (مقنّع)', value: <span>{label('payoutType', w.payoutType)} <span className="ltr">{w.payoutMasked}</span></span> },
          { label: 'المصدر', value: w.source === 'SCHEDULED' ? 'تسوية دورية' : 'طلب البائع' },
          { label: 'موعد SLA', value: formatDate(w.slaDueAt, true) },
          { label: 'رقابة مزدوجة', value: w.requiresDualControl ? <Badge tone="warning">مطلوبة: المنفّذ ≠ المعتمد</Badge> : 'لا' },
          { label: 'طلبه', value: `${w.requestedBy ? names[w.requestedBy] : 'النظام'} · ${formatDate(w.createdAt, true)}` },
          { label: 'اعتمده', value: w.approvedBy ? `${names[w.approvedBy]} · ${formatDate(w.approvedAt, true)}` : '—' },
          { label: 'صرفه', value: w.paidBy ? `${names[w.paidBy]} · ${formatDate(w.paidAt, true)} · مرجع ${w.paidReference}` : '—' },
          { label: 'إثبات التحويل', value: w.proofFileId ? <a className="text-brand-700 underline" target="_blank" href={`/api/files/${w.proofFileId}`}>عرض</a> : '—' },
          { label: 'رسوم التحويل', value: w.payoutChannel ? `${w.payoutChannel} · ${formatEGP(w.transferCost)} ${w.transferCostPayer === 'SELLER_PAYS' ? '(على البائع)' : '(على اضمن)'} · صافي للبائع ${formatEGP(w.netTransferAmount ?? w.amount)}${w.actualTransferCost !== null ? ` · الفعلية ${formatEGP(w.actualTransferCost)}` : ''}` : '— (طلب قبل محرك التكاليف)' },
          ...(((w.transferCostSnapshot as { warnings?: string[] } | null)?.warnings ?? []).length ? [{ label: 'تحذيرات الحدود', value: ((w.transferCostSnapshot as { warnings?: string[] }).warnings ?? []).join('، ') }] : []),
          { label: 'أرصدة البائع الآن', value: `متاح ${formatEGP(bal.available)} · محجوز ${formatEGP(bal.reserved)} · معلق ${formatEGP(bal.pending)}` },
          ...(w.rejectReason ? [{ label: 'سبب الرفض', value: w.rejectReason }] : []),
        ]} />
        {canPay && ['APPROVED', 'PROCESSING'].includes(w.status) && (
          <div className="mt-3 border-t border-line pt-3">
            <RevealPayout action={revealPayoutAction} kind="withdrawal" id={w.id} back={`/admin/withdrawals/${w.id}`} />
            <p className="mt-1 text-xs text-muted">يتطلب تحققاً إضافياً حديثاً (2FA) وكل عملية عرض مسجّلة في سجل التدقيق.</p>
          </div>
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
        {canPay && ['APPROVED', 'PROCESSING'].includes(w.status) && (
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
        {canApprove && ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'].includes(w.status) && (
          <ActionForm action={withdrawalAdminAction} className="card space-y-2 p-5">
            {hidden}<input type="hidden" name="op" value="reject" />
            <h2 className="font-bold">رفض الطلب</h2>
            <p className="text-xs text-muted">{w.reservedAt ? 'يُعاد المبلغ المحجوز إلى رصيد البائع المتاح (قيد عكسي بموافقتك).' : 'لم يُحجز أي مبلغ لهذا الطلب.'}</p>
            <Field label="السبب" required><Textarea name="reason" required minLength={5} rows={2} /></Field>
            <SubmitButton variant="danger">رفض</SubmitButton>
          </ActionForm>
        )}
      </div>
      <section className="card p-5"><h2 className="mb-2 font-bold">سجل الحالات</h2><Timeline items={history.map((h) => ({ title: `${h.fromStatus ?? '∅'} ← ${h.toStatus}`, time: `${formatDate(h.createdAt, true)} · ${h.actorType}`, body: h.reason }))} /></section>
    </div>
  );
}
