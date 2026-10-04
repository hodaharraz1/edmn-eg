import { randomUUID } from 'node:crypto';
import { Wallet } from 'lucide-react';
import { cancelWithdrawalAction, requestWithdrawalAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { sellerWithdrawals } from '@/server/modules/finance/withdrawals';
import { activePayoutMethod, sellerContextForUser } from '@/server/modules/sellers/service';
import { getSetting } from '@/server/modules/settings';
import { requireUser, requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { DataTable, PageHeader } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import { Field, Input } from '@/ui/form';

export const metadata = { title: 'السحوبات' };

export default async function WithdrawalsPage() {
  const actor = await requireSellerActor('/seller/withdrawals');
  const user = await requireUser('/seller');
  const ctx = (await sellerContextForUser(user.id))!;
  const [b, list, pm, min, mode, days, sla] = await Promise.all([
    sellerBalances(db, actor.sellerId!),
    sellerWithdrawals(actor.sellerId!),
    activePayoutMethod(db, actor.sellerId!),
    getSetting('withdrawals.minimumAmount'),
    getSetting('settlement.mode'),
    getSetting('settlement.daysOfMonth'),
    getSetting('withdrawals.slaBusinessHours'),
  ]);
  const hold = ctx.seller.payoutHoldUntil && ctx.seller.payoutHoldUntil > new Date();
  const canWithdraw = actor.sellerPermissions?.has('finance.withdraw');
  return (
    <div className="space-y-5">
      <PageHeader title="السحوبات" description={`الهدف تنفيذ طلبات السحب خلال ${sla} ساعة عمل. ${mode !== 'ON_REQUEST' ? `كما تتم تسوية دورية تلقائية يوم ${days.join(' و ')} من كل شهر.` : ''}`} />
      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="card space-y-3 p-5">
          <p className="text-sm text-muted">الرصيد المتاح للسحب</p>
          <p className="text-3xl font-bold text-emerald-700">{formatEGP(b.available)}</p>
          <p className="text-xs text-muted">وسيلة السحب: {pm ? pm.maskedLabel : 'لا توجد وسيلة معتمدة'} · الحد الأدنى {formatEGP(min)}</p>
          {!pm && <LinkButton href="/seller/settings" size="sm" variant="outline">إضافة وسيلة سحب</LinkButton>}
          {hold && <Alert tone="warning">تم تعديل بيانات السحب مؤخراً. لحمايتك، السحب متاح بعد {formatDate(ctx.seller.payoutHoldUntil, true)}.</Alert>}
        </div>
        {canWithdraw ? (
          <ActionForm action={requestWithdrawalAction} className="card space-y-3 p-5">
            <input type="hidden" name="clientKey" value={randomUUID()} />
            <Field label="المبلغ المطلوب (ج.م)" htmlFor="amount" required><Input id="amount" name="amount" inputMode="decimal" dir="ltr" defaultValue={toInputAmount(b.available)} required /></Field>
            <SubmitButton>تقديم طلب السحب</SubmitButton>
            <p className="text-xs text-muted">يُحجز المبلغ فور تقديم الطلب ولا يمكن استخدامه في طلب آخر. وقت التنفيذ المستهدف ليس إثباتاً لإتمام التحويل؛ ستصلك إشعارات عند كل تحديث.</p>
          </ActionForm>
        ) : (
          <Alert tone="info">ليس لديك صلاحية طلب السحب. تواصل مع مالك المتجر.</Alert>
        )}
      </div>
      <DataTable rows={list} rowKey={(r) => r.id} empty={<EmptyState icon={Wallet} title="لا توجد طلبات سحب" />} columns={[
        { key: 'n', header: 'رقم', cell: (r) => `#${r.number}` },
        { key: 'a', header: 'المبلغ', cell: (r) => formatEGP(r.amount) },
        { key: 'm', header: 'الوسيلة', cell: (r) => `${label('payoutType', r.payoutType)} · ${r.payoutMasked}` },
        { key: 'src', header: 'النوع', cell: (r) => (r.source === 'SCHEDULED' ? 'تسوية دورية' : 'طلب يدوي') },
        { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.createdAt, true) },
        { key: 'sla', header: 'الموعد المستهدف', cell: (r) => (['PAID', 'REJECTED', 'CANCELLED'].includes(r.status) ? '—' : formatDate(r.slaDueAt, true)) },
        { key: 's', header: 'الحالة', cell: (r) => <div><StatusChip status={r.status} />{r.rejectReason && <p className="text-xs text-red-600">{r.rejectReason}</p>}{r.paidReference && <p className="text-xs text-muted ltr">{r.paidReference}</p>}</div> },
        { key: 'x', header: '', cell: (r) => r.status === 'REQUESTED' && canWithdraw && <form action={cancelWithdrawalAction}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit confirm="إلغاء طلب السحب؟" variant="outline" size="sm">إلغاء</ConfirmSubmit></form> },
      ]} />
    </div>
  );
}
