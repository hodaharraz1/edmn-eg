import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { db } from '@/server/db/client';
import { categories, files } from '@/server/db/schema';
import { searchProducts } from '@/server/modules/catalog/search';
import { activeBlocks } from '@/server/modules/cms/service';
import { getAllSettings } from '@/server/modules/settings';
import { JsonLd, siteJsonLd } from '@/app/_components/seo';
import { HomeBanners } from './_home/banners';
import { CategoryBrowser, type HomeCategory } from './_home/categories';
import { EscrowHowItWorks } from './_home/escrow';
import { FeaturedProducts } from './_home/featured';
import { HomeHero, TrustStrip } from './_home/hero';
import { MetricsStrip } from './_home/metrics';
import { UsedTrustedSection } from './_home/used';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/** Categories for «تصفح حسب الفئة»: the CMS featured-categories block when set, otherwise the top-level catalog. */
async function homeCategories(): Promise<HomeCategory[]> {
  const blocks = await activeBlocks('HOME');
  const slugs = (blocks.find((b) => b.type === 'FEATURED_CATEGORIES')?.data as { categorySlugs?: string[] } | undefined)?.categorySlugs ?? [];
  const cols = { slug: categories.slug, nameAr: categories.nameAr, icon: categories.icon, imageKey: files.storageKey };
  if (slugs.length) {
    const rows = await db.select(cols).from(categories).leftJoin(files, eq(files.id, categories.imageFileId)).where(and(inArray(categories.slug, slugs), eq(categories.isActive, true)));
    const ordered = slugs.map((s) => rows.find((r) => r.slug === s)).filter((r): r is HomeCategory => !!r);
    if (ordered.length) return ordered;
  }
  return db.select(cols).from(categories).leftJoin(files, eq(files.id, categories.imageFileId)).where(and(isNull(categories.parentId), eq(categories.isActive, true))).orderBy(asc(categories.sortOrder)).limit(12);
}

/** Live catalog products for «منتجات مميزة» (products with images first). */
async function homeProducts() {
  const { items } = await searchProducts({ sort: 'recommended', pageSize: 24, inStock: true });
  return [...items.filter((p) => p.imageKey), ...items.filter((p) => !p.imageKey)].slice(0, 6);
}

export default async function HomePage() {
  const [s, cats, featured] = await Promise.all([getAllSettings(), homeCategories(), homeProducts()]);
  return (
    <>
      <JsonLd data={siteJsonLd({ legalName: s['company.legalName'] || undefined, email: s['marketplace.supportEmail'] || undefined, phone: s['marketplace.supportPhone'] || undefined, sameAs: s['company.socialLinks'].map((l) => l.href) })} />
      <HomeHero />
      <TrustStrip />
      <div className="container-page space-y-10 py-8 sm:space-y-12 sm:py-10">
        <CategoryBrowser categories={cats} />
        <FeaturedProducts products={featured} />
        <UsedTrustedSection />
        <EscrowHowItWorks />
        <MetricsStrip />
        <HomeBanners products={featured.map((p) => ({ imageKey: p.imageKey }))} />
      </div>
    </>
  );
}
