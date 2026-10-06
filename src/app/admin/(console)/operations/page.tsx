import Link from 'next/link';
import { sql, type SQL } from 'drizzle-orm';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { pageOf } from '@/server/modules/_shared';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/ui/data';
import { Badge, EmptyState } from '@/ui/feedback';
import { ClipboardList } from 'lucide-react';

export const metadata = { title: 'طوابير العمليات' };

type QRow = { id: string; ref: string; since: string | null; due: string | null; note: string | null; href: string };
const soRef = sql`o.number::text || '-' || so.suffix`;
const soFrom = sql`from seller_orders so join orders o on o.id = so.order_id`;
const link = sql`'/admin/orders/' || o.id`;

/** Every actionable operations queue. Each query is stable-ordered (oldest first, then id) and paginated. */
const QUEUES: { key: string; label: string; q: SQL }[] = [
  { key: 'payments', label: 'مدفوعات بانتظار المراجعة', q: sql`select p.id, coalesce(o.number::text, 'صفقة') ref, p.updated_at::text since, p.due_at::text due, p.status note, '/admin/payments/' || p.id href from payments p left join orders o on o.id = p.order_id where p.status in ('PAYMENT_SUBMITTED','UNDER_REVIEW') order by p.updated_at, p.id` },
  { key: 'sellerOverdue', label: 'تأخر البائع في التأكيد', q: sql`select so.id, ${soRef} ref, so.paid_at::text since, so.seller_response_due_at::text due, null note, ${link} href ${soFrom} where so.status = 'PAID' and so.seller_response_due_at < now() order by so.seller_response_due_at, so.id` },
  { key: 'shipOverdue', label: 'تأخر الشحن', q: sql`select so.id, ${soRef} ref, so.paid_at::text since, so.ship_by_due_at::text due, so.status note, ${link} href ${soFrom} where so.status in ('PAID','SELLER_CONFIRMED','PROCESSING','READY_TO_SHIP') and so.ship_by_due_at < now() order by so.ship_by_due_at, so.id` },
  { key: 'cancellations', label: 'طلبات إلغاء معلقة (الشحن موقوف)', q: sql`select so.id, ${soRef} ref, c.created_at::text since, null due, c.note, ${link} href from cancellation_requests c join seller_orders so on so.id = c.seller_order_id join orders o on o.id = so.order_id where c.status = 'PENDING' order by c.created_at, c.id` },
  { key: 'shipExceptions', label: 'مشاكل الشحن', q: sql`select so.id, ${soRef} ref, sh.exception_at::text since, null due, sh.exception_code note, ${link} href from shipments sh join seller_orders so on so.id = sh.seller_order_id join orders o on o.id = so.order_id where sh.status in ('EXCEPTION','FAILED','RETURNED_TO_SELLER') and so.status in ('SHIPPED','AWAITING_BUYER_RESPONSE') order by sh.exception_at nulls first, so.id` },
  { key: 'noDeliveryEvent', label: 'مشحون بدون حدث تسليم موثّق', q: sql`select so.id, ${soRef} ref, so.shipped_at::text since, null due, case when so.seller_delivery_confirmed_at is not null then 'البائع أرسل دليل — بانتظار تحقق شركة الشحن' else null end note, ${link} href ${soFrom} where so.status = 'SHIPPED' and so.delivery_event_at is null order by so.shipped_at, so.id` },
  { key: 'evidenceDue', label: 'بانتظار دليل البائع (مهلة 24 ساعة)', q: sql`select so.id, ${soRef} ref, so.delivery_event_at::text since, so.delivery_report_due_at::text due, null note, ${link} href ${soFrom} where so.status = 'SHIPPED' and so.delivery_event_at is not null and so.seller_delivery_confirmed_at is null order by so.delivery_report_due_at, so.id` },
  { key: 'deliveryExceptions', label: 'استثناءات تسليم (مراجعة العمليات)', q: sql`select so.id, ${soRef} ref, so.delivery_exception_at::text since, null due, so.delivery_exception_code note, ${link} href ${soFrom} where so.delivery_exception_code is not null and so.status in ('SHIPPED','AWAITING_BUYER_RESPONSE','DELIVERED') and so.funds_released_at is null order by so.delivery_exception_at, so.id` },
  { key: 'buyerWindow', label: 'مهلة رد المشتري جارية', q: sql`select so.id, ${soRef} ref, so.delivery_established_at::text since, so.buyer_response_due_at::text due, null note, ${link} href ${soFrom} where so.status = 'AWAITING_BUYER_RESPONSE' order by so.buyer_response_due_at, so.id` },
  { key: 'entitled', label: 'مستحق — بانتظار إتاحة الإدارة', q: sql`select so.id, ${soRef} ref, so.entitled_at::text since, null due, so.receipt_basis note, '/admin/releases/' || so.id href ${soFrom} where so.status = 'DELIVERED' and so.funds_released_at is null order by so.entitled_at, so.id` },
  { key: 'refunds', label: 'استردادات تحتاج إجراء', q: sql`select r.id, '#' || r.number::text ref, r.created_at::text since, null due, r.status note, '/admin/refunds' href from refunds r where r.status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','FAILED','PENDING') order by r.created_at, r.id` },
  { key: 'returns', label: 'مرتجعات مفتوحة', q: sql`select r.id, '#' || r.number::text ref, r.created_at::text since, null due, r.status note, '/admin/returns/' || r.id href from returns r where r.status not in ('REFUNDED','REJECTED') order by r.created_at, r.id` },
  { key: 'disputes', label: 'نزاعات مفتوحة', q: sql`select d.id, '#' || d.number::text ref, d.created_at::text since, null due, d.reason_code note, '/admin/disputes/' || d.id href from disputes d where d.status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION') order by d.created_at, d.id` },
  { key: 'withdrawals', label: 'طلبات سحب', q: sql`select w.id, '#' || w.number::text ref, w.created_at::text since, w.sla_due_at::text due, w.status note, '/admin/withdrawals/' || w.id href from withdrawal_requests w where w.status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING') order by w.sla_due_at, w.id` },
  { key: 'recon', label: 'عدم تطابق في المطابقة', q: sql`select x.id, x.external_ref ref, x.occurred_at::text since, null due, x.state note, '/admin/reconciliation' href from external_transactions x where x.state in ('MISMATCH','SUGGESTED_MATCH') order by x.occurred_at, x.id` },
  { key: 'risk', label: 'مؤشرات مخاطر مفتوحة', q: sql`select f.id, f.entity_type || ':' || left(f.entity_id, 8) ref, f.created_at::text since, null due, f.code note, '/admin/risk' href from risk_flags f where f.status = 'OPEN' order by f.created_at, f.id` },
  { key: 'closures', label: 'طلبات إغلاق حسابات', q: sql`select c.id, left(c.user_id::text, 8) ref, c.created_at::text since, null due, c.status note, '/admin/closures' href from account_closure_requests c where c.status = 'PENDING' order by c.created_at, c.id` },
];

export default async function Operations(props: PageProps<'/admin/operations'>) {
  const { allowed } = await adminWith(['orders.view', 'finance.view']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const key = String(sp.q ?? 'payments');
  const { limit, offset, page } = pageOf(sp.page);
  const counts = await Promise.all(QUEUES.map(async (q) => Number((await db.execute<{ n: string }>(sql`select count(*)::text n from (${q.q}) t`)).rows[0].n)));
  const active = QUEUES.find((q) => q.key === key) ?? QUEUES[0];
  const rows = (await db.execute<QRow>(sql`select * from (${active.q}) t limit ${limit} offset ${offset}`)).rows;
  const now = new Date().getTime();
  const age = (t: string | null) => (t ? `${Math.max(0, Math.round((now - new Date(t).getTime()) / 3600_000))} س` : '—');
  return (
    <div className="space-y-4">
      <PageHeader title="طوابير العمليات" description="كل ما يحتاج تدخلًا مع عمر الطلب (SLA). الطوابير لا تنفذ أي حركة مالية؛ القرار المالي في صفحته بموافقة صريحة." />
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {QUEUES.map((q, i) => (
          <li key={q.key}>
            <Link href={`/admin/operations?q=${q.key}`} className={`card flex items-center justify-between gap-2 p-3 text-sm ${q.key === active.key ? 'border-brand-400' : ''}`} aria-current={q.key === active.key ? 'page' : undefined}>
              <span>{q.label}</span>
              <Badge tone={counts[i] ? 'warning' : 'neutral'}>{counts[i]}</Badge>
            </Link>
          </li>
        ))}
      </ul>
      <section className="card p-4">
        <h2 className="mb-2 font-bold">{active.label}</h2>
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="لا توجد عناصر" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr><th className="p-2 text-start">المرجع</th><th className="p-2 text-start">منذ</th><th className="p-2 text-start">العمر</th><th className="p-2 text-start">الموعد</th><th className="p-2 text-start">ملاحظة</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.id}-${r.ref}`} className="border-t border-line">
                    <td className="p-2"><Link className="font-semibold text-brand-700" href={r.href as never}>{r.ref}</Link></td>
                    <td className="p-2 text-xs">{r.since ? formatDate(new Date(r.since), true) : '—'}</td>
                    <td className="p-2 text-xs">{age(r.since)}</td>
                    <td className="p-2 text-xs">{r.due ? <>{formatDate(new Date(r.due), true)}{new Date(r.due).getTime() < now && <Badge tone="danger" className="ms-1">متأخر</Badge>}</> : '—'}</td>
                    <td className="p-2 text-xs">{r.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">صفحة {page}{rows.length === limit && <> · <Link className="text-brand-700" href={`/admin/operations?q=${active.key}&page=${page + 1}`}>التالي</Link></>}</p>
      </section>
    </div>
  );
}
