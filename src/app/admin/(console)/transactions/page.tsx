import Link from '@/ui/link';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { hasPermission } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { listTransactions } from '@/server/modules/finance/transactions';
import { TX_KIND_META, TX_KINDS, TX_KINDS_NEED_PAYMENTS_VIEW, TX_METHOD_GROUPS, TX_METHOD_GROUP_LABEL, parseTxKind, parseTxMethodGroup, txMethodGroupOf } from '@/lib/transaction-labels';
import { label } from '@/lib/i18n/labels';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المعاملات المالية' };

/** Read-only, unified view of every money movement document. The ledger stays the source of truth. */
export default async function Transactions(props: PageProps<'/admin/transactions'>) {
  const { actor, allowed } = await adminWith(['finance.view', 'payments.view']);
  if (!allowed) return <Forbidden />;
  // A deposit is a payment document: it is listed only for people who can see payments.
  const canViewPayments = hasPermission(actor, 'payments.view');
  const sp = await props.searchParams;
  const visibleKinds = TX_KINDS.filter((k) => canViewPayments || !TX_KINDS_NEED_PAYMENTS_VIEW.includes(k));
  const kind = parseTxKind(sp.kind);
  const method = parseTxMethodGroup(sp.method);
  const activeKind = kind && visibleKinds.includes(kind) ? kind : null;
  const rows = await listTransactions(db, { kind: activeKind, method, canViewPayments });
  const href = (k: string | null, m: string | null) => {
    const qs = new URLSearchParams();
    if (k) qs.set('kind', k);
    if (m) qs.set('method', m);
    const s = qs.toString();
    return s ? `/admin/transactions?${s}` : '/admin/transactions';
  };
  return (
    <div className="space-y-4">
      <PageHeader title="المعاملات المالية" description="عرض موحّد (للقراءة فقط) لكل مستندات حركة الأموال: الوارد من العملاء والصادر للبائعين والعملاء، مع إيداعات المحافظ والصرف منها والاسترجاع إليها. المصدر المحاسبي المعتمد هو دفتر القيود. الاسترداد الذي يذهب للمحفظة يظهر مرتين: مستند الاسترداد وقيد الاسترجاع للمحفظة." />
      <Tabs active={activeKind ?? 'all'} tabs={[{ key: 'all', label: 'الكل', href: href(null, method) }, ...visibleKinds.map((k) => ({ key: k, label: TX_KIND_META[k].label, href: href(k, method) }))]} />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="tx-method-filter">
        <span className="text-muted">طريقة الدفع:</span>
        <Link href={href(activeKind, null)} className={method ? 'rounded-full border border-line px-3 py-1' : 'rounded-full border border-brand-700 bg-brand-50 px-3 py-1 font-semibold'}>كل الطرق</Link>
        {TX_METHOD_GROUPS.map((m) => (
          <Link key={m} href={href(activeKind, m)} className={method === m ? 'rounded-full border border-brand-700 bg-brand-50 px-3 py-1 font-semibold' : 'rounded-full border border-line px-3 py-1'}>
            {TX_METHOD_GROUP_LABEL[m]}
          </Link>
        ))}
      </div>
      <DataTable
        rows={rows}
        rowKey={(x) => `${x.kind}-${x.id}`}
        columns={[
          { key: 'kind', header: 'النوع', cell: (x) => <Badge tone={TX_KIND_META[x.kind].tone}>{TX_KIND_META[x.kind].label}</Badge> },
          { key: 'method', header: 'طريقة الدفع', cell: (x) => <span data-testid="tx-method">{x.method ? (txMethodGroupOf(x.method) === 'MOBILE_WALLET' ? `محفظة إلكترونية (${label('paymentMethod', x.method)})` : label('paymentMethod', x.method)) : '—'}</span> },
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
