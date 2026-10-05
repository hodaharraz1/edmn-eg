import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { settlements } from '@/server/db/schema';
import { getSetting } from '@/server/modules/settings';
import { formatDate, formatEGP, formatNumber } from '@/lib/format';
import { DataTable, PageHeader, StatCard } from '@/ui/data';
import { StatusChip } from '@/ui/feedback';

export const metadata = { title: 'التسويات' };

export default async function Settlements() {
  const { allowed } = await adminWith(['settlements.manage', 'finance.view']);
  if (!allowed) return <Forbidden />;
  const [mode, days, min] = await Promise.all([getSetting('settlement.mode'), getSetting('settlement.daysOfMonth'), getSetting('settlement.minimumAmount')]);
  const rows = await db.select().from(settlements).orderBy(desc(settlements.scheduledFor)).limit(60);
  const r = await db.execute<{ available: string; pending: string }>(sql`select
      coalesce(sum(balance) filter (where code = 'SELLER_AVAILABLE'), 0)::text available,
      coalesce(sum(balance) filter (where code = 'SELLER_PENDING'), 0)::text pending
    from ledger_accounts where seller_id is not null`);
  return (
    <div className="space-y-6">
      <PageHeader
        title="التسويات الدورية"
        description={<>دفعات السحب التلقائية للبائعين حسب إعدادات التسوية. تعديل الوضع والمواعيد من <Link href="/admin/settings" className="text-brand-700 underline">إعدادات النظام</Link>. كل دفعة تُنشئ طلبات سحب عادية تمر بنفس الاعتماد والصرف.</>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="وضع التسوية" value={mode === 'ON_REQUEST' ? 'عند الطلب' : 'مجدولة'} tone="neutral" />
        <StatCard label="أيام التسوية في الشهر" value={mode === 'ON_REQUEST' ? '—' : days.join('، ')} tone="neutral" />
        <StatCard label="أرصدة متاحة للبائعين" value={formatEGP(Number(r.rows[0]?.available ?? 0))} hint={`الحد الأدنى للتسوية ${formatEGP(min)}`} tone="success" />
        <StatCard label="أرصدة معلّقة (قبل تأكيد الاستلام)" value={formatEGP(Number(r.rows[0]?.pending ?? 0))} tone="warning" />
      </div>
      <DataTable
        rows={rows}
        rowKey={(s) => s.id}
        columns={[
          { key: 'n', header: 'رقم الدفعة', cell: (s) => <span className="ltr font-mono">S-{s.number}</span> },
          { key: 'd', header: 'التاريخ', cell: (s) => formatDate(s.scheduledFor) },
          { key: 'c', header: 'عدد الطلبات', cell: (s) => formatNumber(s.itemCount) },
          { key: 't', header: 'الإجمالي', cell: (s) => formatEGP(s.totalAmount) },
          { key: 's', header: 'الحالة', cell: (s) => <StatusChip status={s.status} /> },
          { key: 'w', header: '', cell: () => <Link href="/admin/withdrawals" className="text-sm text-brand-700 hover:underline">طلبات السحب</Link> },
        ]}
        empty={<p className="card p-8 text-center text-sm text-muted">لا توجد دفعات تسوية بعد{mode === 'ON_REQUEST' ? ' — الوضع الحالي: السحب عند طلب البائع.' : '.'}</p>}
      />
    </div>
  );
}
