import { randomUUID } from 'node:crypto';
import { Wallet } from 'lucide-react';
import { cancelWithdrawalAction, requestWithdrawalAction } from '@/app/_actions/seller';
import { db } from '@/server/db/client';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { previewWithdrawal, sellerWithdrawals } from '@/server/modules/finance/withdrawals';
import { activePayoutMethod, sellerContextForUser } from '@/server/modules/sellers/service';
import { getSetting } from '@/server/modules/settings';
import { requireUser, requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP, toInputAmount } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/ui/action-form';
import { LinkButton } from '@/ui/button';
import { DataTable, PageHeader } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import { TestBadge, TestMoneyNotice } from '@/app/_components/test-money';
import { realMoneyEnabled } from '@/server/modules/settings';
import { SellerForbidden } from '@/app/_components/seller-forbidden';
import { Field, Input } from '@/ui/form';

export const metadata = { title: 'السحوبات' };

export default async function WithdrawalsPage(props: PageProps<'/seller/withdrawals'>) {
  const actor = await requireSellerActor('/seller/withdrawals');
  if (!actor.sellerPermissions?.has('finance.view')) return <SellerForbidden />;
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
  const sp = await props.searchParams;
  const previewAmount = typeof sp.preview === 'string' ? sp.preview : '';
  let preview: Awaited<ReturnType<typeof previewWithdrawal>> | null = null;
  let previewError: string | null = null;
  if (previewAmount && pm) {
    try {
      preview = await previewWithdrawal(actor, previewAmount);
    } catch (e) {
      previewError = e instanceof Error ? e.message : 'تعذر حساب رسوم التحويل';
    }
  }
  const canWithdraw = actor.sellerPermissions?.has('finance.withdraw');
  return (
    <div className="space-y-5">
      {!(await realMoneyEnabled()) && <TestMoneyNotice kind="payout" />}
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
          <div className="card space-y-3 p-5">
            <form method="get" className="flex flex-wrap items-end gap-2">
              <Field label="المبلغ المطلوب (ج.م)" htmlFor="preview" required><Input id="preview" name="preview" inputMode="decimal" dir="ltr" defaultValue={previewAmount || toInputAmount(b.available)} required /></Field>
              <button type="submit" className="h-10 rounded-lg border border-line px-4 text-sm font-semibold">احسب رسوم التحويل</button>
            </form>
            {previewError && <Alert tone="danger">{previewError}</Alert>}
            {preview && (
              <div className="space-y-2" data-testid="withdrawal-preview">
                <dl className="grid grid-cols-3 gap-2 rounded-lg bg-page p-3 text-sm">
                  <div><dt className="text-xs text-muted">مبلغ السحب</dt><dd>{formatEGP(preview.amount)}</dd></div>
                  <div><dt className="text-xs text-muted">رسوم التحويل</dt><dd data-testid="transfer-cost">−{formatEGP(preview.transferCost)}</dd></div>
                  <div><dt className="text-xs text-muted">صافي المتوقع تحويله</dt><dd className="font-bold" data-testid="transfer-net">{formatEGP(preview.net)}</dd></div>
                </dl>
                <p className="text-[11px] text-muted">رسوم التحويل تخص قناة التحويل ({preview.channel}) ومنفصلة عن رسوم خدمة اضمن اللي اتحسبت مرة واحدة على مبيعاتك ومش بتتخصم تاني هنا.</p>
                {preview.violations.length > 0 && <Alert tone="danger">{preview.violations.join('، ')}</Alert>}
                {preview.warnings.length > 0 && <Alert tone="warning">{preview.warnings.join('، ')}</Alert>}
                <ActionForm action={requestWithdrawalAction} className="space-y-2">
                  <input type="hidden" name="clientKey" value={randomUUID()} />
                  <input type="hidden" name="amount" value={toInputAmount(preview.amount)} />
                  <SubmitButton>تأكيد طلب سحب {formatEGP(preview.amount)}</SubmitButton>
                </ActionForm>
              </div>
            )}
            <p className="text-xs text-muted">الطلب لوحده مش بيحرك أي فلوس ومش بيحجز المبلغ؛ الحجز بيتم عند اعتماد الإدارة. وقت التنفيذ المستهدف ليس إثباتاً لإتمام التحويل؛ ستصلك إشعارات عند كل تحديث.</p>
          </div>
        ) : (
          <Alert tone="info">ليس لديك صلاحية طلب السحب. تواصل مع مالك المتجر.</Alert>
        )}
      </div>
      <DataTable rows={list} rowKey={(r) => r.id} empty={<EmptyState icon={Wallet} title="لا توجد طلبات سحب" />} columns={[
        { key: 'n', header: 'رقم', cell: (r) => `#${r.number}` },
        { key: 'a', header: 'المبلغ', cell: (r) => formatEGP(r.amount) },
        { key: 'tc', header: 'رسوم التحويل / الصافي', cell: (r) => (r.payoutChannel ? <span className="text-xs">−{formatEGP(r.status === 'PAID' && r.actualTransferCost !== null ? Math.min(r.actualTransferCost, r.transferCost) : r.transferCost)} / {formatEGP(r.netTransferAmount ?? r.amount)}</span> : '—') },
        { key: 'm', header: 'الوسيلة', cell: (r) => `${label('payoutType', r.payoutType)} · ${r.payoutMasked}` },
        { key: 'src', header: 'النوع', cell: (r) => (r.source === 'SCHEDULED' ? 'تسوية دورية' : 'طلب يدوي') },
        { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.createdAt, true) },
        { key: 'sla', header: 'الموعد المستهدف', cell: (r) => (['PAID', 'REJECTED', 'CANCELLED'].includes(r.status) ? '—' : formatDate(r.slaDueAt, true)) },
        { key: 's', header: 'الحالة', cell: (r) => <div><StatusChip status={r.status} />{r.rejectReason && <p className="text-xs text-red-700">{r.rejectReason}</p>}{r.paidReference && <p className="text-xs text-muted ltr">{r.paidReference}</p>}{r.isTest && <p className="mt-1 flex items-center gap-1 text-xs text-red-700"><TestBadge /> سحب تجريبي — لا تُحوَّل أموال فعلية</p>}</div> },
        { key: 'x', header: '', cell: (r) => r.status === 'REQUESTED' && canWithdraw && <form action={cancelWithdrawalAction}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit confirm="إلغاء طلب السحب؟" variant="outline" size="sm">إلغاء</ConfirmSubmit></form> },
      ]} />
    </div>
  );
}
