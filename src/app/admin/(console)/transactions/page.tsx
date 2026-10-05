import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المعاملات المالية' };

type Row = { kind: string; id: string; ref: string; party: string | null; amount: number; status: string; at: string; href: string };
const KIND: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  ORDER_PAYMENT: { label: 'دفع طلب (وارد)', tone: 'success' },
  DEAL_PAYMENT: { label: 'دفع صفقة (وارد)', tone: 'success' },
  WITHDRAWAL: { label: 'سحب بائع (صادر)', tone: 'warning' },
  REFUND: { label: 'استرداد عميل (صادر)', tone: 'danger' },
  DEAL_PAYOUT: { label: 'مستحق صفقة (صادر)', tone: 'warning' },
};

/** Read-only, unified view of every money movement document. The ledger stays the source of truth. */
export default async function Transactions(props: PageProps<'/admin/transactions'>) {
  const { allowed } = await adminWith(['finance.view', 'payments.view']);
  if (!allowed) return <Forbidden />;
  const kind = String((await props.searchParams).kind ?? 'all');
  const filter = kind in KIND ? sql`where kind = ${kind}` : sql``;
  const r = await db.execute<Row>(sql`select * from (
      select case when p.order_id is not null then 'ORDER_PAYMENT' else 'DEAL_PAYMENT' end kind, p.id::text id,
             coalesce('#' || o.number::text, 'D-' || d.number::text) ref, u.full_name party, coalesce(p.confirmed_amount, p.amount_due) amount, p.status, p.updated_at::text at,
             '/admin/payments/' || p.id href
        from payments p join users u on u.id = p.payer_user_id left join orders o on o.id = p.order_id left join external_deals d on d.id = p.deal_id
      union all
      select 'WITHDRAWAL', w.id::text, 'W-' || w.number::text, st.name, w.amount, w.status, w.updated_at::text, '/admin/withdrawals' from withdrawal_requests w left join stores st on st.seller_id = w.seller_id
      union all
      select 'REFUND', rf.id::text, 'R-' || rf.number::text, u.full_name, rf.amount, rf.status, rf.updated_at::text, '/admin/refunds' from refunds rf join users u on u.id = rf.customer_id
      union all
      select 'DEAL_PAYOUT', dp.id::text, 'D-' || d.number::text, u.full_name, dp.amount, dp.status, dp.created_at::text, '/admin/refunds' from deal_payouts dp join external_deals d on d.id = dp.deal_id left join users u on u.id = dp.payee_user_id
    ) t ${filter} order by at desc limit 200`);
  return (
    <div className="space-y-4">
      <PageHeader title="المعاملات المالية" description="عرض موحّد (للقراءة فقط) لكل مستندات حركة الأموال: الوارد من العملاء والصادر للبائعين والعملاء. المصدر المحاسبي المعتمد هو دفتر القيود." />
      <Tabs
        active={kind}
        tabs={[{ key: 'all', label: 'الكل', href: '/admin/transactions' }, ...Object.entries(KIND).map(([k, v]) => ({ key: k, label: v.label, href: `/admin/transactions?kind=${k}` }))]}
      />
      <DataTable
        rows={r.rows}
        rowKey={(x) => `${x.kind}-${x.id}`}
        columns={[
          { key: 'kind', header: 'النوع', cell: (x) => <Badge tone={KIND[x.kind].tone}>{KIND[x.kind].label}</Badge> },
          { key: 'ref', header: 'المرجع', cell: (x) => <Link href={x.href} className="ltr font-mono text-brand-700 hover:underline">{x.ref}</Link> },
          { key: 'party', header: 'الطرف', cell: (x) => x.party ?? '—' },
          { key: 'amount', header: 'المبلغ', cell: (x) => <span className="font-semibold tabular-nums">{formatEGP(Number(x.amount))}</span> },
          { key: 'status', header: 'الحالة', cell: (x) => <StatusChip status={x.status} /> },
          { key: 'at', header: 'آخر تحديث', cell: (x) => <span className="text-xs text-muted">{formatDate(x.at, true)}</span> },
        ]}
        empty={<p className="card p-8 text-center text-sm text-muted">لا توجد معاملات</p>}
      />
    </div>
  );
}
