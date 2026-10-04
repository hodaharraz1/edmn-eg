import Link from 'next/link';
import { asc, eq, inArray } from 'drizzle-orm';
import { BadgeCheck } from 'lucide-react';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { sellers, stores, users } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { label } from '@/lib/i18n/labels';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { EmptyState, StatusChip } from '@/ui/feedback';

export const metadata = { title: 'التحقق من البائعين' };

export default async function SellerVerificationQueue(props: PageProps<'/admin/seller-verification'>) {
  const { allowed } = await adminWith('sellers.review');
  if (!allowed) return <Forbidden />;
  const tab = (await props.searchParams).tab === 'info' ? 'info' : 'pending';
  const statuses = tab === 'info' ? (['MORE_INFO_REQUIRED'] as const) : (['PENDING_REVIEW'] as const);
  const rows = await db
    .select({ s: sellers, store: stores.name, user: users.fullName })
    .from(sellers)
    .innerJoin(users, eq(users.id, sellers.ownerUserId))
    .leftJoin(stores, eq(stores.sellerId, sellers.id))
    .where(inArray(sellers.status, [...statuses]))
    .orderBy(asc(sellers.submittedAt));
  return (
    <div>
      <PageHeader title="مركز التحقق من البائعين" description="الطلبات مرتبة من الأقدم. كل قرار يُسجل في سجل التدقيق." />
      <Tabs active={tab} tabs={[{ key: 'pending', label: 'قيد المراجعة', href: '/admin/seller-verification' }, { key: 'info', label: 'بانتظار معلومات', href: '/admin/seller-verification?tab=info' }]} />
      <DataTable rows={rows} rowKey={(r) => r.s.id} empty={<EmptyState icon={BadgeCheck} title="لا توجد طلبات" />} columns={[
        { key: 'a', header: 'المتقدم', cell: (r) => <Link href={`/admin/sellers/${r.s.id}`} className="font-semibold text-brand-700 hover:underline">{r.s.legalName ?? r.user}</Link> },
        { key: 'st', header: 'المتجر', cell: (r) => r.store ?? '—' },
        { key: 't', header: 'النوع', cell: (r) => label('sellerType', r.s.type) },
        { key: 'd', header: 'تاريخ الإرسال', cell: (r) => formatDate(r.s.submittedAt, true) },
        { key: 'r', header: 'المخاطر', cell: (r) => r.s.riskLevel },
        { key: 's', header: 'الحالة', cell: (r) => <StatusChip status={r.s.status} /> },
      ]} />
    </div>
  );
}
