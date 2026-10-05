import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { journalEntries, journalLines, ledgerAccounts, ledgerAdjustments, sellerOrders } from '@/server/db/schema';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { requireSellerActor } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, StatCard } from '@/ui/data';

export const metadata = { title: 'المالية' };
const ACCOUNT_LABEL: Record<string, string> = { SELLER_PENDING: 'معلق', SELLER_AVAILABLE: 'متاح', SELLER_WITHDRAWAL_RESERVED: 'محجوز للسحب' };

export default async function SellerFinance() {
  const actor = await requireSellerActor('/seller/finance');
  const sellerId = actor.sellerId!;
  const [[t], [adj], balances, lines] = await Promise.all([
    db.select({ gross: sql<string>`coalesce(sum(gross_total) filter (where status <> 'CANCELLED' and paid_at is not null),0)`, fees: sql<string>`coalesce(sum(commission_total) filter (where status <> 'CANCELLED' and paid_at is not null),0)`, refunds: sql<string>`coalesce(sum(refunded_total),0)` }).from(sellerOrders).where(eq(sellerOrders.sellerId, sellerId)),
    db.select({ total: sql<string>`coalesce(sum(amount) filter (where status = 'POSTED'),0)` }).from(ledgerAdjustments).where(eq(ledgerAdjustments.sellerId, sellerId)),
    sellerBalances(db, sellerId),
    db
      .select({ line: journalLines, entry: journalEntries, code: ledgerAccounts.code })
      .from(journalLines)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(eq(ledgerAccounts.sellerId, sellerId))
      .orderBy(desc(journalEntries.seq))
      .limit(200),
  ]);
  const paid = await db.execute<{ s: string }>(sql`select coalesce(sum(amount),0) s from withdrawal_requests where seller_id = ${sellerId} and status = 'PAID'`);
  return (
    <div className="space-y-5">
      <PageHeader title="المالية" description="كشف حساب مبني على دفتر قيود مزدوج غير قابل للتعديل." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="إجمالي المبيعات" value={formatEGP(Number(t.gross))} />
        <StatCard label="رسوم اضمن (العمولات)" value={formatEGP(Number(t.fees))} tone="neutral" />
        <StatCard label="المستردات" value={formatEGP(Number(t.refunds))} tone="warning" />
        <StatCard label="التسويات" value={formatEGP(Number(adj.total))} tone="neutral" />
        <StatCard label="الرصيد المعلق" value={formatEGP(balances.pending)} tone="warning" />
        <StatCard label="الرصيد المتاح" value={formatEGP(balances.available)} tone="success" />
        <StatCard label="قيد السحب" value={formatEGP(balances.reserved)} tone="brand" />
        <StatCard label="تم صرفه" value={formatEGP(Number(paid.rows[0].s))} tone="success" />
      </div>
      <h2 className="font-bold">كشف الحساب</h2>
      <DataTable rows={lines} rowKey={(r) => r.line.id} columns={[
        { key: 'd', header: 'التاريخ', cell: (r) => formatDate(r.entry.createdAt, true) },
        { key: 'desc', header: 'البيان', cell: (r) => r.entry.description },
        { key: 'a', header: 'الحساب', cell: (r) => ACCOUNT_LABEL[r.code] ?? r.code },
        { key: 'in', header: 'دائن (+)', cell: (r) => (r.line.credit ? <span className="text-emerald-700">{formatEGP(r.line.credit)}</span> : '') },
        { key: 'out', header: 'مدين (−)', cell: (r) => (r.line.debit ? <span className="text-red-700">{formatEGP(r.line.debit)}</span> : '') },
      ]} />
    </div>
  );
}
