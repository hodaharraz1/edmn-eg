import { CircleHelp } from 'lucide-react';
import type { SellerFinancialView, SourceBalances } from '@/server/modules/finance/seller-wallet';
import { formatEGP } from '@/lib/format';
import Link from '@/ui/link';

const ROWS: { key: keyof SourceBalances; label: string; hint: string }[] = [
  { key: 'available', label: 'رصيد متاح', hint: 'أتاحته الإدارة بعد موافقتها، ومتاح لطلب السحب. التحويل بيتم بس بعد طلب سحب تعتمده الإدارة: رصيد المتجر على بيانات استلام أموال المتجر، ومستحقات الصفقات المحمية على «بيانات استلام الأموال» المتحقق منها.' },
  { key: 'pending', label: 'رصيد معلّق', hint: 'مدفوع من المشتري ولسه في التسليم أو مهلة رد المشتري.' },
  { key: 'entitledAwaitingRelease', label: 'مستحق — بانتظار موافقة الإدارة', hint: 'المشتري أكد الاستلام أو انتهت مهلته. لسه محتاج موافقة الإدارة. التأكيد أو انتهاء المهلة لا يحرك فلوس لوحده.' },
  { key: 'held', label: 'مجمّد بسبب نزاع أو تجميد إداري', hint: 'لا يتحرك لحد ما يتحسم النزاع أو يترفع التجميد.' },
  { key: 'reserved', label: 'رصيد محجوز', hint: 'محجوز لطلب سحب معتمد قيد التحويل.' },
  { key: 'liability', label: 'مديونية', hint: 'مبالغ عليك (مثلاً استرداد بعد الإتاحة أكبر من المتاح). أي سحب موقوف لحد تسويتها.' },
];

function Column({ title, b, testid, children }: { title: string; b: SourceBalances; testid: string; children?: React.ReactNode }) {
  return (
    <section className="card space-y-2 p-4" data-testid={testid}>
      <h2 className="font-bold">{title}</h2>
      <dl className="space-y-1 text-sm">
        {ROWS.map((r) => (
          <div key={r.key} className={`flex items-center justify-between gap-2 ${r.key === 'liability' && b.liability > 0 ? 'text-red-700' : ''}`}>
            <dt className="flex items-center gap-1" title={r.hint}>{r.label}<CircleHelp className="size-3.5 text-muted" aria-hidden /></dt>
            <dd className="font-semibold tabular-nums">{formatEGP(b[r.key])}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 border-t border-line pt-1 text-muted"><dt>اتحوّل لك فعلًا</dt><dd className="tabular-nums">{formatEGP(b.paidOut)}</dd></div>
      </dl>
      {children}
    </section>
  );
}

/**
 * ONE financial experience, TWO attributed sources (owner decision #12–#14): Marketplace and Protected Deal
 * balances are shown separately and the combined total is a sum for information only — each amount keeps its
 * source, and each source is paid through its own channel.
 */
export function SellerFinanceSummary({ view, showProtectedDeal = true }: { view: SellerFinancialView; showProtectedDeal?: boolean }) {
  const label = { MARKETPLACE: 'السوق', PROTECTED_DEAL: 'صفقة محمية' } as const;
  const bucket = { pending: 'معلّق', held: 'مجمّد (نزاع/تجميد)', entitledAwaitingRelease: 'بانتظار موافقة الإدارة', available: 'متاح' } as const;
  const items = view.items.filter((i) => showProtectedDeal || i.sourceType === 'MARKETPLACE');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {view.marketplace && (
          <Column title={`رصيد مبيعات المتجر${view.marketplace.storeName ? ` — ${view.marketplace.storeName}` : ''}`} b={view.marketplace} testid="balance-marketplace">
            <Link className="text-sm text-brand-700" href="/seller/withdrawals">طلب سحب من رصيد المتجر</Link>
          </Column>
        )}
        {showProtectedDeal && view.protectedDeal && (
          <Column title="رصيد الصفقات المحمية" b={view.protectedDeal} testid="balance-protected-deal">
            <p className="text-xs text-muted">مستحقات الصفقات بتتحوّل بس لما تطلب سحب من «مستحقاتي من البيع» على «بيانات استلام الأموال» المتحقق منها والإدارة تعتمده. مش محتاج متجر.</p>
          </Column>
        )}
        {showProtectedDeal && view.marketplace && view.protectedDeal && (
          <Column title="إجمالي الرصيد" b={view.combined} testid="balance-combined">
            <p className="text-xs text-muted">للعرض فقط: مجموع المصدرين. كل مبلغ محتفظ بمصدره، وكل مصدر بيتصرف بطريقته.</p>
          </Column>
        )}
      </div>
      {items.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-bold">تفاصيل المبالغ حسب المصدر</h2>
          <ul className="divide-y divide-line text-sm" data-testid="balance-items">
            {items.map((i) => (
              <li key={`${i.sourceType}:${i.entityId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="rounded bg-page px-1.5 py-0.5 text-xs">{label[i.sourceType]}</span> <span className="ltr">{i.ref}</span> · {bucket[i.bucket]}</span>
                <b className="tabular-nums">{formatEGP(i.amount)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
