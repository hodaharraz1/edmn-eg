import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { Banknote } from 'lucide-react';
import { refundPaidAction, revealPayoutAction } from '@/app/_actions/admin';
import { RevealPayout } from '@/app/_components/reveal-id';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { dealPayouts, externalDeals, refunds, users } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { FileInput } from '@/ui/client';
import { PageHeader, Tabs } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import { Input } from '@/ui/form';

export const metadata = { title: 'المستردات ومستحقات الصفقات' };

function PayForm({ kind, id }: { kind: 'refund' | 'deal'; id: string }) {
  return (
    <ActionForm action={refundPaidAction} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value="/admin/refunds" />
      <Input name="reference" required minLength={3} placeholder="مرجع التحويل" className="ltr" aria-label="مرجع التحويل" />
      <FileInput name="proof" label="إثبات (اختياري)" accept="image/jpeg,image/png,image/webp,application/pdf" />
      <SubmitButton size="sm">تسجيل الصرف</SubmitButton>
    </ActionForm>
  );
}

export default async function Refunds(props: PageProps<'/admin/refunds'>) {
  const { actor, allowed } = await adminWith(['refunds.pay', 'deals.payout', 'finance.view']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const tab = String(sp.tab ?? 'refunds');
  const showPaid = sp.paid === '1';
  const refundRows = tab === 'refunds' ? await db.select({ r: refunds, customer: users.fullName, phone: users.phone }).from(refunds).innerJoin(users, eq(users.id, refunds.customerId)).where(eq(refunds.status, showPaid ? 'PAID' : 'PENDING')).orderBy(desc(refunds.createdAt)).limit(200) : [];
  const payoutRows = tab === 'deals' ? await db.select({ p: dealPayouts, deal: externalDeals }).from(dealPayouts).innerJoin(externalDeals, eq(externalDeals.id, dealPayouts.dealId)).where(eq(dealPayouts.status, showPaid ? 'PAID' : 'PENDING')).orderBy(desc(dealPayouts.createdAt)).limit(200) : [];
  const canRefund = hasPermission(actor, 'refunds.pay');
  const canPayout = hasPermission(actor, 'deals.payout');
  return (
    <div className="space-y-3">
      <PageHeader title="المستردات ومستحقات الصفقات" description="المبالغ المستحقة للعملاء (مستردات) ولبائعي الصفقات الخارجية. لا تُصرف تلقائياً؛ سجّل الصرف بعد التحويل الفعلي مع المرجع." />
      <Alert tone="info">تسجيل الصرف يتطلب تحققاً إضافياً حديثاً (2FA) ويُنشئ قيداً محاسبياً غير قابل للتعديل.</Alert>
      <Tabs active={tab} tabs={[{ key: 'refunds', label: 'مستردات العملاء', href: '/admin/refunds' }, { key: 'deals', label: 'مستحقات بائعي الصفقات', href: '/admin/refunds?tab=deals' }]} />
      <p className="text-sm"><Link className="text-brand-700" href={`/admin/refunds?tab=${tab}${showPaid ? '' : '&paid=1'}`}>{showPaid ? 'عرض المعلقة' : 'عرض المصروفة'}</Link></p>
      {tab === 'refunds' && (refundRows.length === 0 ? <EmptyState icon={Banknote} title="لا توجد مستردات" /> : (
        <ul className="space-y-3">{refundRows.map(({ r, customer, phone }) => (
          <li key={r.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><b>استرداد #{r.number}</b> · {customer} <span className="ltr text-xs text-muted">{phone}</span> · {r.sourceType} · {formatDate(r.createdAt, true)}</span>
              <span className="flex items-center gap-2"><b>{formatEGP(r.amount)}</b><StatusChip status={r.status} /></span>
            </div>
            <p className="mt-1 text-xs text-muted">{r.reason} {r.customerDestination && `· وجهة العميل: ${r.customerDestination}`} {r.paidReference && `· مرجع ${r.paidReference}`}</p>
            {r.status === 'PENDING' && canRefund && <PayForm kind="refund" id={r.id} />}
          </li>
        ))}</ul>
      ))}
      {tab === 'deals' && (payoutRows.length === 0 ? <EmptyState icon={Banknote} title="لا توجد مستحقات" /> : (
        <ul className="space-y-3">{payoutRows.map(({ p, deal }) => (
          <li key={p.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><Link className="font-bold text-brand-700" href={`/admin/deals/${deal.id}`}>صفقة #{deal.number}</Link> · {deal.sellerName} · {deal.sellerPayoutMasked && <span className="ltr text-xs">{deal.sellerPayoutMasked}</span>}</span>
              <span className="flex items-center gap-2"><b>{formatEGP(p.amount)}</b><StatusChip status={p.status} /></span>
            </div>
            {p.paidReference && <p className="mt-1 text-xs text-muted">مرجع {p.paidReference} · {formatDate(p.paidAt, true)}</p>}
            {p.status === 'PENDING' && canPayout && <div className="mt-2"><RevealPayout action={revealPayoutAction} kind="deal_payout" id={p.id} back="/admin/refunds?tab=deals" /></div>}
            {p.status === 'PENDING' && canPayout && <PayForm kind="deal" id={p.id} />}
          </li>
        ))}</ul>
      ))}
    </div>
  );
}
