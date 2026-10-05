import Link from 'next/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { Handshake } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { externalDeals, users } from '@/server/db/schema';
import { formatDate, formatEGP } from '@/lib/format';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'الصفقات الخارجية المحمية' };
const GROUPS = {
  active: ['INVITED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED'],
  disputed: ['DISPUTED'],
  done: ['COMPLETED', 'REFUNDED', 'CANCELLED'],
  draft: ['DRAFT'],
} as const;

export default async function AdminDeals(props: PageProps<'/admin/deals'>) {
  const { allowed } = await adminWith('deals.view');
  if (!allowed) return <Forbidden />;
  const tab = String((await props.searchParams).tab ?? 'active') as keyof typeof GROUPS;
  const statuses = (GROUPS[tab] ?? GROUPS.active) as readonly string[];
  const rows = await db
    .select({ d: externalDeals, buyer: users.fullName })
    .from(externalDeals)
    .innerJoin(users, eq(users.id, externalDeals.buyerId))
    .where(inArray(externalDeals.status, statuses as (typeof externalDeals.$inferSelect.status)[]))
    .orderBy(desc(externalDeals.updatedAt))
    .limit(200);
  return (
    <div>
      <PageHeader title="الصفقات الخارجية المحمية" description="صفقات بين مشترٍ وبائع خارج المتجر تُحفظ أموالها لدى المنصة حتى تأكيد الاستلام." />
      <Tabs active={tab} tabs={[{ key: 'active', label: 'جارية', href: '/admin/deals' }, { key: 'disputed', label: 'متنازع عليها', href: '/admin/deals?tab=disputed' }, { key: 'done', label: 'منتهية', href: '/admin/deals?tab=done' }, { key: 'draft', label: 'مسودات', href: '/admin/deals?tab=draft' }]} />
      <DataTable rows={rows} rowKey={(r) => r.d.id} empty={<EmptyState icon={Handshake} title="لا توجد صفقات" />} columns={[
        { key: 'n', header: 'الرقم', cell: (r) => <Link className="font-semibold text-brand-700" href={`/admin/deals/${r.d.id}`}>#{r.d.number}</Link> },
        { key: 't', header: 'العنوان', cell: (r) => r.d.title },
        { key: 'b', header: 'المشتري', cell: (r) => r.buyer },
        { key: 's', header: 'البائع', cell: (r) => r.d.sellerFullName ?? (r.d.sellerName ? `${r.d.sellerName} (غير مؤكد)` : '—') },
        { key: 'a', header: 'يدفع المشتري', cell: (r) => (r.d.buyerPays != null ? formatEGP(r.d.buyerPays) : '—') },
        { key: 'u', header: 'آخر تحديث', cell: (r) => formatDate(r.d.updatedAt, true) },
        { key: 'st', header: 'الحالة', cell: (r) => <StatusChip status={r.d.status} /> },
      ]} />
    </div>
  );
}
