import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/client';
import { brands } from '@/server/db/schema';
import { Listing, type SP } from '@/app/_components/listing';
import { Breadcrumbs, PageHeader } from '@/ui/data';

async function load(slug: string) {
  const [b] = await db.select().from(brands).where(eq(brands.slug, decodeURIComponent(slug)));
  return b && b.isActive ? b : null;
}

export async function generateMetadata(props: PageProps<'/brand/[slug]'>): Promise<Metadata> {
  const b = await load((await props.params).slug);
  if (!b) return {};
  return { title: b.seoTitle || `منتجات ${b.nameAr || b.name}`, description: b.seoDescription || `تسوّق منتجات ${b.name} الأصلية من بائعين موثّقين على اضمن.`, alternates: { canonical: `/brand/${b.slug}` } };
}

export default async function BrandPage(props: PageProps<'/brand/[slug]'>) {
  const b = await load((await props.params).slug);
  if (!b) notFound();
  const sp = (await props.searchParams) as SP;
  return (
    <div className="container-page py-6">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: 'الرئيسية', href: '/' }, { label: b.nameAr || b.name }]} />} title={`${b.nameAr || b.name}`} description={`كل منتجات ${b.name} المتاحة على اضمن`} />
      <Listing path={`/brand/${b.slug}`} sp={{ ...sp, brand: b.id }} hideBrand />
    </div>
  );
}
