import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { Wallet } from 'lucide-react';
import { db } from '@/server/db/client';
import { externalDeals, orders, payments, refunds } from '@/server/db/schema';
import { requireUser } from '@/server/web/session';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'المدفوعات' };

export default async function PaymentsPage() {
  const user = await requireUser('/account');
  const rows = await db
    .select({ p: payments, orderNumber: orders.number, dealNumber: externalDeals.number })
    .from(payments)
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(externalDeals, eq(externalDeals.id, payments.dealId))
    .where(eq(payments.payerUserId, user.id))
    .orderBy(desc(payments.createdAt));
  const myRefunds = await db.select().from(refunds).where(eq(refunds.customerId, user.id)).orderBy(desc(refunds.createdAt));
  return (
    <div className="space-y-6">
      <PageHeader title="المدفوعات والمستردات" />
      <DataTable
        rows={rows}
        rowKey={(r) => r.p.id}
        empty={<EmptyState icon={Wallet} title="لا توجد مدفوعات" />}
        columns={[
          { key: 'ref', header: 'الطلب / الصفقة', cell: (r) => (r.p.orderId ? <Link className="text-brand-700 hover:underline" href={`/account/orders/${r.p.orderId}/pay`}>طلب #{r.orderNumber}</Link> : <Link className="text-brand-700 hover:underline" href={`/account/deals/${r.p.dealId}`}>صفقة #{r.dealNumber}</Link>) },
          { key: 'method', header: 'الطريقة', cell: (r) => label('paymentMethod', r.p.method) },
          { key: 'amount', header: 'المبلغ', cell: (r) => formatEGP(r.p.amountDue) },
          { key: 'date', header: 'التاريخ', cell: (r) => formatDate(r.p.createdAt) },
          { key: 'status', header: 'الحالة', cell: (r) => <StatusChip status={r.p.status} /> },
        ]}
      />
      {myRefunds.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">المبالغ المستردة</h2>
          <DataTable
            rows={myRefunds}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'رقم', cell: (r) => `#${r.number}` },
              { key: 'a', header: 'المبلغ', cell: (r) => formatEGP(r.amount) },
              { key: 'r', header: 'السبب', cell: (r) => r.reason },
              { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.status} /> },
              { key: 'ref', header: 'مرجع التحويل', cell: (r) => r.paidReference ?? '—' },
            ]}
          />
        </section>
      )}
    </div>
  );
}
