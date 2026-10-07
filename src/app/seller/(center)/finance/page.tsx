import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { ledgerAdjustments, sellerOrders } from '@/server/db/schema';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { sellerStatement } from '@/server/modules/finance/seller-statement';
import { requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { SellerForbidden } from '@/app/_components/seller-forbidden';
import { DataTable, PageHeader, StatCard } from '@/ui/data';
import { Alert } from '@/ui/feedback';

export const metadata = { title: 'المالية وكشف الحساب' };
const signed = (v: number) => (v === 0 ? '' : <span className={v > 0 ? 'text-emerald-700' : 'text-red-700'}>{v > 0 ? '+' : '−'}{formatEGP(Math.abs(v))}</span>);

export default async function SellerFinance() {
  const actor = await requireSellerActor('/seller/finance');
  if (!actor.sellerPermissions?.has('finance.view')) return <SellerForbidden />;
  const sellerId = actor.sellerId!;
  // Seller fee = the seller's share only (the buyer's share is paid by the buyer). Legacy orders: stored values as-is.
  const [[t], [adj], balances, statement, entitled] = await Promise.all([
    db
      .select({
        sales: sql<string>`coalesce(sum(merchandise_subtotal + shipping_fee) filter (where status <> 'CANCELLED' and paid_at is not null),0)`,
        fees: sql<string>`coalesce(sum(case when buyer_fee_total + seller_fee_total = commission_total and commission_total > 0 then seller_fee_total else commission_total - buyer_fee_total end) filter (where status <> 'CANCELLED' and paid_at is not null),0)`,
        refunds: sql<string>`coalesce(sum(refunded_total),0)`,
      })
      .from(sellerOrders)
      .where(eq(sellerOrders.sellerId, sellerId)),
    db.select({ total: sql<string>`coalesce(sum(amount) filter (where status = 'POSTED'),0)` }).from(ledgerAdjustments).where(eq(ledgerAdjustments.sellerId, sellerId)),
    sellerBalances(db, sellerId),
    sellerStatement(sellerId),
    db.execute<{ s: string }>(sql`select coalesce(sum(seller_net), 0)::text s from seller_orders where seller_id = ${sellerId} and status = 'DELIVERED' and funds_released_at is null`),
  ]);
  const paid = await db.execute<{ s: string; c: string }>(sql`select coalesce(sum(amount),0)::text s, coalesce(sum(case when transfer_cost_payer = 'SELLER_PAYS' then least(coalesce(actual_transfer_cost, transfer_cost), transfer_cost) else 0 end),0)::text c from withdrawal_requests where seller_id = ${sellerId} and status = 'PAID'`);
  const ent = Number(entitled.rows[0].s);
  return (
    <div className="space-y-5">
      <PageHeader title="المالية وكشف الحساب" description="كل الأرقام من دفتر قيود مزدوج غير قابل للتعديل. رسوم خدمة اضمن تُحسب مرة واحدة على كل عملية بيع ولا تُخصم مرة تانية عند السحب." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="قيمة المبيعات (منتجات + شحن)" value={formatEGP(Number(t.sales))} />
        <StatCard label="رسوم خدمة اضمن عليك" value={formatEGP(Number(t.fees))} tone="neutral" />
        <StatCard label="المستردات" value={formatEGP(Number(t.refunds))} tone="warning" />
        <StatCard label="التسويات" value={formatEGP(Number(adj.total))} tone="neutral" />
        <StatCard label="معلق (لحين الاستلام)" value={formatEGP(balances.pending - ent)} tone="warning" />
        <StatCard label="مستحق بانتظار اعتماد الإدارة" value={formatEGP(ent)} tone="warning" />
        <StatCard label="المتاح للسحب" value={formatEGP(balances.available)} tone="success" />
        <StatCard label="محجوز لطلبات سحب" value={formatEGP(balances.reserved)} tone="brand" />
        <StatCard label="تم صرفه" value={formatEGP(Number(paid.rows[0].s))} tone="success" hint={`رسوم تحويل تحملتها: ${formatEGP(Number(paid.rows[0].c))}`} />
      </div>
      {balances.available < 0 && <Alert tone="danger" title="التزام سالب">عليك مديونية {formatEGP(-balances.available)} بعد استرداد لاحق للإتاحة. تتم تسويتها من مبيعاتك القادمة، ولا يمكن صرف أي سحب قبل تسويتها.</Alert>}
      <h2 className="font-bold">كشف الحساب</h2>
      <DataTable
        rows={statement.rows}
        rowKey={(r) => r.entryId}
        columns={[
          { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.date, true) },
          { key: 'ref', header: 'المرجع', cell: (r) => r.reference },
          { key: 'desc', header: 'البيان', cell: (r) => <span className="text-xs">{r.description}</span> },
          { key: 'g', header: 'قيمة البيع', cell: (r) => (r.grossSale ? formatEGP(r.grossSale) : '') },
          { key: 'f', header: 'رسوم خدمة اضمن', cell: (r) => (r.sellerFee ? `−${formatEGP(r.sellerFee)}` : '') },
          { key: 'rf', header: 'استرداد', cell: (r) => (r.refund ? `−${formatEGP(r.refund)}` : '') },
          { key: 'adj', header: 'تسوية', cell: (r) => signed(r.adjustment) },
          { key: 'pc', header: 'رسوم التحويل', cell: (r) => (r.payoutCost ? `−${formatEGP(r.payoutCost)}` : '') },
          { key: 'n', header: 'الأثر على رصيدك', cell: (r) => signed(r.netEffect) },
          { key: 'bal', header: 'معلق / متاح / محجوز', cell: (r) => <span className="text-xs">{formatEGP(r.pending)} / {formatEGP(r.available)} / {formatEGP(r.reserved)}</span> },
        ]}
      />
    </div>
  );
}
