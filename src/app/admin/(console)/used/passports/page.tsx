import { desc, eq } from 'drizzle-orm';
import Link from '@/ui/link';
import { adminWith, Forbidden } from '@/app/_components/admin-guard';
import { db } from '@/server/db/client';
import { externalDeals, productPassports, products } from '@/server/db/schema';
import { formatDate } from '@/lib/format';
import { DataTable, PageHeader, Tabs } from '@/ui/data';
import { Badge } from '@/ui/feedback';
import { ProtectionLevelBadge } from '@/app/_components/used';
import type { ProtectionLevel } from '@/domain/used';

export const metadata = { title: 'جوازات المنتجات' };
const STATUS = { UNREVIEWED: 'محتاج مراجعة', VERIFIED: 'اتراجع', REJECTED: 'محتاج تصحيح' } as const;

export default async function PassportQueue(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { allowed } = await adminWith(['products.moderate', 'deals.manage']);
  if (!allowed) return <Forbidden />;
  const sp = await props.searchParams;
  const status = (['UNREVIEWED', 'VERIFIED', 'REJECTED'] as const).find((s) => s === sp.status) ?? 'UNREVIEWED';
  const rows = await db
    .select({ pp: productPassports, productTitle: products.titleAr, dealTitle: externalDeals.title })
    .from(productPassports)
    .leftJoin(products, eq(products.id, productPassports.productId))
    .leftJoin(externalDeals, eq(externalDeals.id, productPassports.dealId))
    .where(eq(productPassports.verificationStatus, status))
    .orderBy(desc(productPassports.updatedAt))
    .limit(200);
  return (
    <div className="space-y-4">
      <PageHeader title="جوازات المنتجات" description="مراجعة المستندات والصور (موثّق) منفصلة تمامًا عن الفحص الفني (مفحوص) — المفحوص محتاج تقرير فحص فعلي." />
      <Tabs active={status} tabs={Object.entries(STATUS).map(([k, l]) => ({ key: k, label: l, href: `/admin/used/passports?status=${k}` }))} />
      <DataTable
        rows={rows}
        rowKey={(r) => r.pp.id}
        columns={[
          { key: 'c', header: 'الجواز', cell: (r) => <Link href={`/admin/used/passports/${r.pp.id}`} className="ltr font-mono font-semibold text-brand-700 hover:underline">{r.pp.code}</Link> },
          { key: 't', header: 'المنتج', cell: (r) => r.productTitle ?? r.dealTitle ?? '—' },
          { key: 's', header: 'المسار', cell: (r) => <Badge tone={r.pp.productId ? 'brand' : 'info'}>{r.pp.productId ? 'السوق' : 'صفقة محمية'}</Badge> },
          { key: 'l', header: 'المستوى', cell: (r) => <ProtectionLevelBadge level={r.pp.level as ProtectionLevel} /> },
          { key: 'u', header: 'آخر تحديث', cell: (r) => formatDate(r.pp.updatedAt, true) },
        ]}
      />
    </div>
  );
}
