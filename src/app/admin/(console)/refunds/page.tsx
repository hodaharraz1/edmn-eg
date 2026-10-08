import Link from '@/ui/link';
import { desc, eq } from 'drizzle-orm';
import { Banknote } from 'lucide-react';
import { refundDecisionAction, refundPaidAction, revealPayoutAction } from '@/app/_actions/admin';
import { RevealPayout } from '@/app/_components/reveal-id';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { dealPayouts, externalDeals } from '@/server/db/schema';
import { refundQueue } from '@/server/modules/finance/refunds';
import { pageOf } from '@/server/modules/_shared';
import type { RefundStatus } from '@/domain/machines';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader, Tabs } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import { Input, Select } from '@/ui/form';

export const metadata = { title: 'المستردات ومستحقات الصفقات' };

const TABS: { key: string; label: string; statuses: RefundStatus[] }[] = [
  { key: 'requested', label: 'بانتظار الاعتماد', statuses: ['REQUESTED', 'UNDER_REVIEW'] },
  { key: 'payout', label: 'معتمدة — بانتظار الصرف', statuses: ['APPROVED', 'PROCESSING', 'FAILED', 'PENDING'] },
  { key: 'done', label: 'مصروفة', statuses: ['COMPLETED', 'PAID'] },
  { key: 'closed', label: 'مرفوضة/ملغاة', statuses: ['REJECTED', 'CANCELLED'] },
];

function DealPayForm({ id }: { id: string }) {
  return (
    <ActionForm action={refundPaidAction} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="kind" value="deal" /><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value="/admin/refunds?tab=deals" />
      <Input name="reference" required minLength={3} placeholder="مرجع التحويل" className="ltr" aria-label="مرجع التحويل" />
      <FileInput name="proof" label="إثبات (اختياري)" accept="image/jpeg,image/png,image/webp,application/pdf" />
      <SubmitButton size="sm">تسجيل الصرف</SubmitButton>
    </ActionForm>
  );
}

export default async function Refunds(props: PageProps<'/admin/refunds'>) {
  const { actor, allowed } = await adminWith(['refunds.pay', 'refunds.approve', 'deals.payout', 'finance.view']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const tab = String(sp.tab ?? 'requested');
  const { limit, offset, page } = pageOf(sp.page);
  const def = TABS.find((t) => t.key === tab);
  const refundRows = def ? await refundQueue(def.statuses, limit, offset) : [];
  const showPaid = sp.paid === '1';
  const payoutRows = tab === 'deals' ? await db.select({ p: dealPayouts, deal: externalDeals }).from(dealPayouts).innerJoin(externalDeals, eq(externalDeals.id, dealPayouts.dealId)).where(eq(dealPayouts.status, showPaid ? 'PAID' : 'PENDING')).orderBy(desc(dealPayouts.createdAt), desc(dealPayouts.id)).limit(limit).offset(offset) : [];
  const canApprove = hasPermission(actor, 'refunds.approve');
  const canPay = hasPermission(actor, 'refunds.pay');
  const canPayout = hasPermission(actor, 'deals.payout');
  const back = `/admin/refunds?tab=${tab}`;
  return (
    <div className="space-y-3">
      <PageHeader title="المستردات ومستحقات الصفقات" description="كل استرداد يمر بخطوتين: اعتماد إداري (قيد عكسي على مستحقات البائع والرسوم) ثم تسجيل الصرف الفعلي بمرجع. لا شيء يتحرك تلقائيًا." />
      <Alert tone="info">الاعتماد والصرف يتطلبان تحققًا ثنائيًا حديثًا. فوق حد الرقابة المزدوجة، منفذ الصرف لازم يكون شخص غير معتمد الاسترداد. وجهة الاسترداد = وسيلة الدفع الأصلية، وأي استثناء يُسجل بسبب.</Alert>
      <Tabs active={tab} tabs={[...TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/refunds?tab=${t.key}` })), { key: 'deals', label: 'مستحقات بائعي الصفقات', href: '/admin/refunds?tab=deals' }]} />
      {def && (refundRows.length === 0 ? <EmptyState icon={Banknote} title="لا توجد مستردات" /> : (
        <ul className="space-y-3">{refundRows.map(({ r, customer, orderNumber, suffix }) => {
          const dest = (r.destinationSnapshot ?? null) as { method?: string; payerName?: string; payerReference?: string; details?: string } | null;
          return (
            <li key={r.id} className="card p-4" data-testid="refund-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b>استرداد #{r.number}</b> · {customer} · {label('refundSource', r.sourceType)} {orderNumber && `· ${orderNumber}-${suffix}`} · {formatDate(r.createdAt, true)}</span>
                <span className="flex items-center gap-2"><b>{formatEGP(r.amount)}</b><StatusChip status={r.status} /></span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                {[['قيمة المنتجات', r.principalAmount], ['الشحن', r.shippingAmount], ['رسوم المشتري المستردة', r.buyerFeeRefund], ['عكس رسوم البائع', r.sellerFeeReversal], ['على البائع', r.sellerLiability]].map(([l, v]) => <div key={l as string} className="rounded bg-page p-2"><dt className="text-muted">{l}</dt><dd className="font-semibold">{formatEGP(v as number)}</dd></div>)}
              </dl>
              <p className="mt-1 text-xs text-muted">{r.reason}{dest && ` · الوجهة: ${dest.method ?? ''} ${dest.payerName ?? ''} ${dest.payerReference ?? ''} ${dest.details ?? ''}`}{r.destinationOverride && ' (استثناء مسجل)'}{r.paidReference && ` · مرجع ${r.paidReference}`}{r.failureReason && ` · فشل: ${r.failureReason}`}</p>
              {['REQUESTED', 'UNDER_REVIEW'].includes(r.status) && canApprove && (
                <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
                  <ActionForm action={refundDecisionAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="op" value="approve" /><input type="hidden" name="refundId" value={r.id} /><input type="hidden" name="expectedAmount" value={r.amount} /><input type="hidden" name="back" value={back} />
                    <Input name="reason" required minLength={3} placeholder="سبب الاعتماد" aria-label="سبب الاعتماد" className="w-48" />
                    <SubmitButton size="sm">اعتماد استرداد {formatEGP(r.amount)}</SubmitButton>
                  </ActionForm>
                  <ActionForm action={refundDecisionAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="op" value="reject" /><input type="hidden" name="refundId" value={r.id} /><input type="hidden" name="back" value={back} />
                    <Input name="reason" required minLength={3} placeholder="سبب الرفض" aria-label="سبب الرفض" className="w-48" />
                    <SubmitButton size="sm" variant="outline">رفض</SubmitButton>
                  </ActionForm>
                </div>
              )}
              {['APPROVED', 'PROCESSING', 'FAILED', 'PENDING'].includes(r.status) && canPay && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <ActionForm action={refundDecisionAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <input type="hidden" name="op" value="pay" /><input type="hidden" name="refundId" value={r.id} /><input type="hidden" name="back" value={back} />
                    <Input name="reference" required minLength={3} placeholder="مرجع التحويل" className="ltr" aria-label="مرجع التحويل" />
                    <FileInput name="proof" label="إثبات (اختياري)" accept="image/jpeg,image/png,image/webp,application/pdf" />
                    <SubmitButton size="sm">تسجيل صرف {formatEGP(r.amount)}</SubmitButton>
                  </ActionForm>
                  {r.status !== 'FAILED' && (
                    <ActionForm action={refundDecisionAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="op" value="failed" /><input type="hidden" name="refundId" value={r.id} /><input type="hidden" name="back" value={back} />
                      <Input name="reason" required minLength={3} placeholder="سبب فشل التحويل" aria-label="سبب فشل التحويل" className="w-56" />
                      <SubmitButton size="sm" variant="outline">تسجيل فشل التحويل (المبلغ يفضل مستحق)</SubmitButton>
                    </ActionForm>
                  )}
                  {canApprove && (
                    <ActionForm action={refundDecisionAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="op" value="destination" /><input type="hidden" name="refundId" value={r.id} /><input type="hidden" name="back" value={back} />
                      <Select name="method" className="w-auto" aria-label="الوسيلة"><option value="INSTAPAY">إنستاباي</option><option value="VODAFONE_CASH">فودافون كاش</option><option value="BANK_TRANSFER">تحويل بنكي</option></Select>
                      <Input name="details" required placeholder="بيانات الوجهة البديلة" aria-label="بيانات الوجهة" className="w-48" />
                      <Input name="reason" required minLength={5} placeholder="سبب الاستثناء" aria-label="سبب الاستثناء" className="w-48" />
                      <SubmitButton size="sm" variant="outline">استثناء وجهة (2FA)</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              )}
            </li>
          );
        })}</ul>
      ))}
      {tab === 'deals' && (
        <>
          <p className="text-sm"><Link className="text-brand-700" href={`/admin/refunds?tab=deals${showPaid ? '' : '&paid=1'}`}>{showPaid ? 'عرض المعلقة' : 'عرض المصروفة'}</Link></p>
          {payoutRows.length === 0 ? <EmptyState icon={Banknote} title="لا توجد مستحقات" /> : (
            <ul className="space-y-3">{payoutRows.map(({ p, deal }) => (
              <li key={p.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><Link className="font-bold text-brand-700" href={`/admin/deals/${deal.id}`}>صفقة #{deal.number}</Link> · {deal.sellerName} · {deal.sellerPayoutMasked && <span className="ltr text-xs">{deal.sellerPayoutMasked}</span>}</span>
                  <span className="flex items-center gap-2"><b>{formatEGP(p.amount)}</b><StatusChip status={p.status} /></span>
                </div>
                {p.paidReference && <p className="mt-1 text-xs text-muted">مرجع {p.paidReference} · {formatDate(p.paidAt, true)}</p>}
                {p.status === 'PENDING' && canPayout && <div className="mt-2"><RevealPayout action={revealPayoutAction} kind="deal_payout" id={p.id} back="/admin/refunds?tab=deals" /></div>}
                {p.status === 'PENDING' && canPayout && <DealPayForm id={p.id} />}
              </li>
            ))}</ul>
          )}
        </>
      )}
      <p className="text-xs text-muted">صفحة {page}{(refundRows.length === limit || payoutRows.length === limit) && <> · <Link className="text-brand-700" href={`/admin/refunds?tab=${tab}&page=${page + 1}`}>التالي</Link></>}</p>
    </div>
  );
}
