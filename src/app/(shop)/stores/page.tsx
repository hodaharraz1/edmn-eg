import type { Metadata } from 'next';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { Store } from 'lucide-react';
import { db } from '@/server/db/client';
import { files, sellers, stores } from '@/server/db/schema';
import { SellerCard } from '@/ui/commerce';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { EmptyState } from '@/ui/feedback';

export const metadata: Metadata = { title: 'المتاجر الموثّقة', alternates: { canonical: '/stores' } };

export default async function StoresPage() {
  const rows = await db
    .select({
      name: stores.name,
      slug: stores.slug,
      isVerified: stores.isVerified,
      description: stores.description,
      logoKey: files.storageKey,
      ratingAvg: sellers.ratingAvg,
      ratingCount: sellers.ratingCount,
      productCount: sql<number>`(select count(*)::int from products p where p.seller_id = ${sellers.id} and p.status = 'LIVE')`,
    })
    .from(stores)
    .innerJoin(sellers, eq(sellers.id, stores.sellerId))
    .leftJoin(files, eq(files.id, stores.logoFileId))
    .where(inArray(sellers.status, ['APPROVED', 'RESTRICTED']))
    .orderBy(desc(sellers.ratingCount));
  return (
    <div className="container-page py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: 'المتاجر' }]} />} title="المتاجر على اضمن" description="كل البائعين هنا مرّوا بمراجعة هوية قبل البيع." />
      {rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((s) => (
            <SellerCard key={s.slug} s={s} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Store} title="مفيش متاجر لسه" />
      )}
    </div>
  );
}
