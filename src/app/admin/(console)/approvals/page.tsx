import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { BadgeCheck, Banknote, CreditCard, Gavel, PackageSearch, Receipt, RotateCcw, Scale, Wallet } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import type { Permission } from '@/server/rbac/permissions';
import { formatEGP, formatNumber } from '@/lib/format';
import { PageHeader } from '@/ui/data';

export const metadata = { title: 'مركز الموافقات' };

type Q = { key: string; label: string; hint: string; href: string; perm: Permission | Permission[]; icon: typeof BadgeCheck };
const QUEUES: Q[] = [
  { key: 'sellers', label: 'طلبات البائعين', hint: 'مراجعة الهوية والمستندات', href: '/admin/seller-verification', perm: 'sellers.review', icon: BadgeCheck },
  { key: 'products', label: 'منتجات ومراجعات تعديل', hint: 'قبل الظهور للعامة', href: '/admin/moderation', perm: 'products.moderate', icon: PackageSearch },
  { key: 'payments', label: 'إثباتات دفع', hint: 'لا يُعتبر الطلب مدفوعاً قبل التأكيد', href: '/admin/payments', perm: 'payments.view', icon: CreditCard },
  { key: 'withdrawals', label: 'طلبات سحب البائعين', hint: 'مراجعة → اعتماد → صرف', href: '/admin/withdrawals', perm: 'withdrawals.view', icon: Wallet },
  { key: 'releases', label: 'إتاحة أرباح البائعين', hint: 'مستحق — لا إتاحة تلقائية', href: '/admin/releases', perm: ['finance.release', 'finance.view'], icon: Banknote },
  { key: 'refunds', label: 'مستردات للعملاء', hint: 'اعتماد ثم صرف', href: '/admin/refunds', perm: ['refunds.pay', 'refunds.approve', 'finance.view'], icon: RotateCcw },
  { key: 'dealPayouts', label: 'مستحقات صفقات خارجية', hint: 'بانتظار الصرف للبائع', href: '/admin/refunds', perm: ['deals.payout', 'finance.view'], icon: Banknote },
  { key: 'adjustments', label: 'تسويات دفترية', hint: 'نظام المُنشئ/المعتمِد', href: '/admin/ledger?tab=adjustments', perm: 'ledger.adjust.approve', icon: Scale },
  { key: 'disputes', label: 'نزاعات مفتوحة', hint: 'تحتاج قراراً', href: '/admin/disputes', perm: 'disputes.manage', icon: Gavel },
  { key: 'returns', label: 'طلبات إرجاع', hint: 'بانتظار البائع أو الإدارة', href: '/admin/returns', perm: 'returns.manage', icon: Receipt },
];

const can = (a: Actor, p: Permission | Permission[]) => (Array.isArray(p) ? p.some((x) => hasPermission(a, x)) : hasPermission(a, p));

export default async function ApprovalCenter() {
  const { actor, allowed } = await adminWith('dashboard.view');
  if (!allowed) return <Forbidden />;
  const r = await db.execute<Record<string, string>>(sql`select
    (select count(*) from sellers where status = 'PENDING_REVIEW') sellers,
    (select count(*) from products where status in ('SUBMITTED','UNDER_REVIEW')) + (select count(*) from product_revisions where status = 'SUBMITTED') products,
    (select count(*) from payments where status in ('PAYMENT_SUBMITTED','UNDER_REVIEW')) payments,
    (select count(*) from withdrawal_requests where status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING')) withdrawals,
    (select coalesce(sum(amount),0) from withdrawal_requests where status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING')) withdrawals_amount,
    (select count(*) from refunds where status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','FAILED','PENDING')) refunds,
    (select count(*) from deal_payouts where status = 'PENDING') deal_payouts,
    (select count(*) from seller_orders where status = 'DELIVERED' and funds_released_at is null) + (select count(*) from external_deals where status in ('BUYER_CONFIRMED_RECEIPT','ENTITLED_AWAITING_RELEASE')) releases,
    (select count(*) from ledger_adjustments where status = 'PENDING_APPROVAL') adjustments,
    (select count(*) from disputes where status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')) disputes,
    (select count(*) from returns where status in ('REQUESTED','UNDER_REVIEW','RECEIVED','INSPECTION','REFUND_PENDING')) returns_open`);
  const c = r.rows[0];
  const count = (k: string) => Number(k === 'dealPayouts' ? c.deal_payouts : k === 'returns' ? c.returns_open : c[k]);
  const visible = QUEUES.filter((q) => can(actor, q.perm));
  const total = visible.reduce((s, q) => s + count(q.key), 0);
  return (
    <div className="space-y-6">
      <PageHeader title="مركز الموافقات" description={`كل ما ينتظر قراراً من فريق العمليات في مكان واحد — ${formatNumber(total)} عنصر. الصلاحيات تُطبّق على كل قائمة.`} />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((q) => {
          const n = count(q.key);
          const Icon = q.icon;
          return (
            <li key={q.key}>
              <Link href={q.href} className="card flex items-center gap-4 p-4 transition hover:border-brand-300 hover:shadow-sm focus-visible:outline-2">
                <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${n ? 'bg-amber-100 text-amber-800' : 'bg-page text-muted'}`}><Icon className="size-5" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{q.label}</span>
                  <span className="block text-xs text-muted">{q.key === 'withdrawals' && n ? `إجمالي ${formatEGP(Number(c.withdrawals_amount))} · ` : ''}{q.hint}</span>
                </span>
                <span className={`text-2xl font-bold tabular-nums ${n ? 'text-ink' : 'text-muted'}`}>{formatNumber(n)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
