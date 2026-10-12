import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Wallet } from 'lucide-react';
import { cancelAccountWithdrawalAction, previewAccountWithdrawalAction, requestAccountWithdrawalAction } from '@/app/_actions/earnings';
import { AccountWithdrawalForm } from '@/app/_components/allocation-preview';
import { SellerFinanceSummary } from '@/app/_components/seller-finance-summary';
import { db } from '@/server/db/client';
import { receivingDestinations, sellers } from '@/server/db/schema';
import { sellerFinancialView } from '@/server/modules/finance/seller-wallet';
import { accountWithdrawals } from '@/server/modules/finance/withdrawals';
import { activePayoutMethod } from '@/server/modules/sellers/service';
import { identityStatus } from '@/server/modules/identity/service';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/ui/action-form';
import { PageHeader } from '@/ui/data';
import { Alert, EmptyState, StatusChip } from '@/ui/feedback';
import Link from '@/ui/link';

export const metadata = { title: 'مستحقاتي من البيع' };

const SOURCE = { MARKETPLACE: 'رصيد مبيعات المتجر', PROTECTED_DEAL: 'رصيد الصفقات المحمية' } as const;
const ALLOC = { RESERVED: 'محجوز', PAID: 'اتحوّل', RELEASED: 'رجع للمصدر', RETURNED: 'ارتد ورجع للمصدر' } as const;

export default async function EarningsPage() {
  const user = await requireUser('/account/earnings');
  const view = await sellerFinancialView(db, user.id);
  const [store] = await db.select().from(sellers).where(eq(sellers.ownerUserId, user.id)).limit(1);
  const pm = store ? await activePayoutMethod(db, store.id) : null;
  const dests = await db.select().from(receivingDestinations).where(and(eq(receivingDestinations.userId, user.id), eq(receivingDestinations.status, 'APPROVED')));
  const verified = (await identityStatus(db, user.id)) === 'APPROVED';
  const options = [
    ...(pm ? [{ value: 'store', label: `وسيلة سحب المتجر ${pm.maskedLabel} (المتجر + الصفقات)` }] : []),
    ...dests.map((d) => ({ value: `rd:${d.id}`, label: `${d.maskedLabel} (الصفقات المحمية فقط)` })),
  ];
  const mine = await accountWithdrawals(user.id);
  return (
    <div className="space-y-5">
      <PageHeader title="مستحقاتي من البيع" description="مكان واحد لمستحقاتك كبائع: من متجرك في السوق ومن الصفقات المحمية، كل واحد لوحده ومعاهم الإجمالي." />
      {!view.marketplace && !view.protectedDeal ? <EmptyState icon={Wallet} title="مفيش مستحقات بيع لحد دلوقتي" description="لما تبيع في السوق أو كبائع في صفقة محمية هتلاقي مستحقاتك هنا." /> : <SellerFinanceSummary view={view} />}
      <section className="card space-y-3 p-5">
        <h2 className="font-bold">طلب سحب</h2>
        <p className="text-sm text-muted">بنحسب المبلغ من مصادرك بترتيب ثابت: مستحقات الصفقات المحمية الأقدم أولاً، وبعدها رصيد مبيعات المتجر. كل جزء بيفضل مسجل بمصدره. رصيد المتجر بيتحوّل بس على وسيلة سحب المتجر المتحقق منها.</p>
        {!verified ? (
          <Alert tone="warning" action={<Link className="text-brand-700 underline" href="/account/identity">التحقق من الهوية</Link>}>لازم تتحقق من هويتك قبل طلب أي سحب.</Alert>
        ) : options.length === 0 ? (
          <Alert tone="warning" action={<Link className="text-brand-700 underline" href="/account/receiving">إضافة وجهة صرف</Link>}>مفيش وجهة صرف متحقق منها. أضف «بيانات استلام الأموال» واستنى التحقق منها قبل السحب.</Alert>
        ) : (
          <AccountWithdrawalForm preview={previewAccountWithdrawalAction} request={requestAccountWithdrawalAction} destinations={options} clientKey={randomUUID()} />
        )}
      </section>
      {mine.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-2 font-bold">طلبات السحب</h2>
          <ul className="space-y-3" data-testid="account-withdrawals">
            {mine.map(({ w, allocations }) => (
              <li key={w.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>#{w.number} · {formatDate(w.createdAt, true)} · <span className="ltr">{w.payoutMasked}</span></span>
                  <span className="flex items-center gap-2"><b>{formatEGP(w.amount)}</b><StatusChip status={w.status} kind="withdrawal" /></span>
                </div>
                {allocations.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {allocations.map((a) => <li key={a.id}>{SOURCE[a.sourceType]}: {formatEGP(a.amount)} — {ALLOC[a.status]}</li>)}
                  </ul>
                )}
                {['REQUESTED', 'UNDER_REVIEW'].includes(w.status) && w.requestedBy === user.id && !w.sellerId && (
                  <ActionForm action={cancelAccountWithdrawalAction} className="mt-2"><input type="hidden" name="id" value={w.id} /><SubmitButton size="sm" variant="ghost">إلغاء الطلب</SubmitButton></ActionForm>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
