import type { MetadataRoute } from 'next';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { brands, categories, products, sellers, stores } from '@/server/db/schema';
import { LEGAL_CODES } from '@/server/modules/cms/service';

export const dynamic = 'force-dynamic';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** Sitemap of public, indexable pages only (LIVE products of active sellers). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const u = (p: string) => new URL(p, APP_URL).toString();
  const [prods, cats, brs, sts] = await Promise.all([
    db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).innerJoin(sellers, eq(sellers.id, products.sellerId)).where(and(eq(products.status, 'LIVE'), inArray(sellers.status, ['APPROVED', 'RESTRICTED']))).limit(45000),
    db.select({ slug: categories.slug, updatedAt: categories.updatedAt }).from(categories).where(and(eq(categories.isActive, true), eq(categories.isProhibited, false))),
    db.select({ slug: brands.slug, updatedAt: brands.updatedAt }).from(brands).where(eq(brands.isActive, true)),
    db.select({ slug: stores.slug, updatedAt: stores.updatedAt }).from(stores).innerJoin(sellers, eq(sellers.id, stores.sellerId)).where(eq(sellers.status, 'APPROVED')),
  ]);
  return [
    { url: u('/'), changeFrequency: 'daily', priority: 1 },
    { url: u('/deals'), changeFrequency: 'daily', priority: 0.8 },
    { url: u('/best-sellers'), changeFrequency: 'daily', priority: 0.7 },
    { url: u('/categories'), changeFrequency: 'weekly', priority: 0.6 },
    { url: u('/stores'), changeFrequency: 'weekly', priority: 0.5 },
    { url: u('/protected-deal'), changeFrequency: 'monthly', priority: 0.7 },
    { url: u('/sell'), changeFrequency: 'monthly', priority: 0.5 },
    ...Object.values(LEGAL_CODES).map((l) => ({ url: u(`/legal/${l.slug}`), changeFrequency: 'monthly' as const, priority: 0.2 })),
    ...cats.map((c) => ({ url: u(`/category/${c.slug}`), lastModified: c.updatedAt, changeFrequency: 'daily' as const, priority: 0.7 })),
    ...brs.map((b) => ({ url: u(`/brand/${b.slug}`), lastModified: b.updatedAt, priority: 0.5 })),
    ...sts.map((s) => ({ url: u(`/store/${s.slug}`), lastModified: s.updatedAt, priority: 0.5 })),
    ...prods.map((p) => ({ url: u(`/product/${p.slug}`), lastModified: p.updatedAt, changeFrequency: 'weekly' as const, priority: 0.8 })),
  ];
}
