import Link from '@/ui/link';
import { sql } from 'drizzle-orm';
import { HandCoins } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { formatDate, formatEGP } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { PageHeader, Tabs } from '@/ui/data';
import { Alert, Badge, EmptyState } from '@/ui/feedback';
import { pageOf } from '@/server/modules/_shared';

export const metadata = { title: 'إتاحة أرباح البائعين' };

type Row = { id: string; number: string; suffix: string; store: string; receipt_basis: string; entitled_at: string; seller_net: string; refunded_total: string; blocked: boolean; deal: boolean };

/** Entitled sub-orders / deals awaiting an explicit Admin release (oldest first, stable paging). */
export default async function Releases(props: PageProps<'/admin/releases'>) {
  const { allowed } = await adminWith(['finance.release', 'finance.view']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const tab = sp.tab === 'blocked' ? 'blocked' : sp.tab === 'deals' ? 'deals' : 'ready';
  const { limit, offset, page } = pageOf(sp.page);
  const rows =
    tab === 'deals'
      ? (
          await db.execute<Row>(sql`select d.id, d.number::text number, '' suffix, coalesce(d.seller_full_name, d.seller_name, '') store, d.receipt_basis, d.entitled_at::text entitled_at,
            coalesce(d.seller_receives, 0)::text seller_net, d.pending_buyer_refund::text refunded_total, d.financial_hold blocked, true deal
            from external_deals d where d.status in ('BUYER_CONFIRMED_RECEIPT','ENTITLED_AWAITING_RELEASE') order by d.entitled_at nulls first, d.id limit ${limit} offset ${offset}`)
        ).rows
      : (
          await db.execute<Row>(sql`select so.id, o.number::text number, so.suffix, st.name store, so.receipt_basis, so.entitled_at::text entitled_at, so.seller_net::text seller_net, so.refunded_total::text refunded_total,
            (so.financial_hold or so.delivery_exception_code is not null
              or exists (select 1 from disputes d where d.seller_order_id = so.id and d.status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION'))
              or exists (select 1 from returns r where r.seller_order_id = so.id and r.status not in ('REFUNDED','REJECTED'))
              or exists (select 1 from refunds f where f.seller_order_id = so.id and f.status in ('REQUESTED','UNDER_REVIEW'))) blocked, false deal
            from seller_orders so join orders o on o.id = so.order_id join stores st on st.seller_id = so.seller_id
            where so.status = 'DELIVERED' and so.funds_released_at is null order by so.entitled_at nulls first, so.id limit ${limit} offset ${offset}`)
        ).rows.filter((r) => (tab === 'blocked' ? r.blocked : !r.blocked));
  return (
    <div className="space-y-4">
      <PageHeader title="إتاحة أرباح البائعين" description="الطلبات اللي اتأكد استلامها أو انتهت مهلة المشتري بدون اعتراض. الفلوس لسه معلقة — مفيش أي إتاحة تلقائية؛ كل إتاحة بموافقة صريحة وتحقق ثنائي." />
      <Alert tone="warning">«مستحق وفي انتظار موافقة الإدارة» ≠ «متاح للسحب». الإتاحة لا تُنشئ سحبًا ولا تحويلًا خارجيًا.</Alert>
      <Tabs active={tab} tabs={[{ key: 'ready', label: 'جاهزة للمراجعة', href: '/admin/releases' }, { key: 'blocked', label: 'متوقفة (تجميد/نزاع/إرجاع)', href: '/admin/releases?tab=blocked' }, { key: 'deals', label: 'صفقات محمية', href: '/admin/releases?tab=deals' }]} />
      {rows.length === 0 ? (
        <EmptyState icon={HandCoins} title="لا توجد عناصر" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-page text-xs text-muted"><tr><th className="p-2 text-start">الطلب</th><th className="p-2 text-start">المتجر/البائع</th><th className="p-2 text-start">أساس الاستحقاق</th><th className="p-2 text-start">منذ</th><th className="p-2 text-start">صافي البائع</th><th className="p-2" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="p-2 font-semibold">{r.deal ? `صفقة #${r.number}` : `${r.number}-${r.suffix}`}</td>
                  <td className="p-2">{r.store}</td>
                  <td className="p-2">{label('receiptBasis', r.receipt_basis)}{r.blocked && <Badge tone="danger" className="ms-1">متوقف</Badge>}</td>
                  <td className="p-2 text-xs">{r.entitled_at ? formatDate(new Date(r.entitled_at), true) : '—'}</td>
                  <td className="p-2">{formatEGP(Number(r.seller_net))}</td>
                  <td className="p-2"><Link className="font-semibold text-brand-700" href={r.deal ? `/admin/deals/${r.id}` : `/admin/releases/${r.id}`}>مراجعة</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">صفحة {page}{rows.length === limit && <> · <Link className="text-brand-700" href={`/admin/releases?tab=${tab}&page=${page + 1}`}>التالي</Link></>}</p>
    </div>
  );
}
