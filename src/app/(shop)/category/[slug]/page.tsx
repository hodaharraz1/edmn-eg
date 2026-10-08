import type { Metadata } from 'next';
import Link from '@/ui/link';
import { notFound } from 'next/navigation';
import { categoryAncestors, categoryBySlug, categoryTree } from '@/server/modules/catalog/taxonomy';
import { db } from '@/server/db/client';
import { Listing, type SP } from '@/app/_components/listing';
import { Breadcrumbs, PageHeader } from '@/ui/data';
import { JsonLd, breadcrumbJsonLd } from '@/app/_components/seo';

export async function generateMetadata(props: PageProps<'/category/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const c = await categoryBySlug(decodeURIComponent(slug));
  if (!c) return {};
  return {
    title: c.seoTitle || `${c.nameAr} — تسوّق أونلاين`,
    description: c.seoDescription || `تسوّق ${c.nameAr} جديد ومستعمل من بائعين موثّقين مع دفع محمي على اضمن.`,
    alternates: { canonical: `/category/${c.slug}` },
  };
}

export default async function CategoryPage(props: PageProps<'/category/[slug]'>) {
  const { slug } = await props.params;
  const sp = (await props.searchParams) as SP;
  const c = await categoryBySlug(decodeURIComponent(slug));
  if (!c || !c.isActive || c.isProhibited) notFound();
  const chain = await categoryAncestors(db, c);
  const tree = await categoryTree(db, { activeOnly: true });
  const find = (nodes: typeof tree): (typeof tree)[number] | undefined => {
    for (const n of nodes) {
      if (n.id === c.id) return n;
      const f = find(n.children);
      if (f) return f;
    }
  };
  const children = find(tree)?.children ?? [];
  const crumbs = [{ label: 'الرئيسية', href: '/' }, ...chain.map((x) => ({ label: x.nameAr, href: x.id === c.id ? undefined : `/category/${x.slug}` }))];
  return (
    <div className="container-page py-6">
      <JsonLd data={breadcrumbJsonLd(crumbs.map((x, i) => ({ name: x.label, url: x.href ?? (i === crumbs.length - 1 ? `/category/${c.slug}` : '/') })))} />
      <PageHeader breadcrumbs={<Breadcrumbs items={crumbs} />} title={c.nameAr} description={c.descriptionAr ?? undefined} />
      {children.length > 0 && (
        <div className="scrollbar-none -mx-1 mb-5 flex gap-2 overflow-x-auto px-1">
          {children.map((ch) => (
            <Link key={ch.id} href={`/category/${ch.slug}`} className="whitespace-nowrap rounded-full border border-line bg-white px-4 py-1.5 text-sm hover:border-brand-400 hover:text-brand-700">
              {ch.nameAr}
            </Link>
          ))}
        </div>
      )}
      <Listing path={`/category/${c.slug}`} sp={sp} base={{ categoryId: c.id }} />
    </div>
  );
}
