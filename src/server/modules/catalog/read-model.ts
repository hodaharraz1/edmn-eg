import { and, eq, inArray, sql } from 'drizzle-orm';
import { normalizeSearch } from '@/server/core/text';
import type { DbOrTx } from '@/server/db/client';
import { attributeOptions, brands, categories, productAttributeValues, productVariants, products, stores } from '@/server/db/schema';

/**
 * Maintains denormalized listing fields (min price, availability, search text) inside the same
 * transaction as the change — no eventually-consistent search index to drift out of sync.
 */
export async function refreshProductReadModel(tx: DbOrTx, productId: string): Promise<void> {
  const [p] = await tx.select().from(products).where(eq(products.id, productId));
  if (!p) return;
  const [agg] = await tx
    .select({
      minPrice: sql<number | null>`min(${productVariants.price}) filter (where ${productVariants.isActive})`,
      maxCompare: sql<number | null>`max(${productVariants.compareAtPrice}) filter (where ${productVariants.isActive})`,
      available: sql<number>`coalesce(sum(${productVariants.stockOnHand} - ${productVariants.reserved}) filter (where ${productVariants.isActive}), 0)`,
      skus: sql<string>`coalesce(string_agg(${productVariants.sku} || ' ' || ${productVariants.label}, ' '), '')`,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));
  const parts: string[] = [p.titleAr, p.titleEn ?? '', agg.skus ?? '', ...(p.keyFeatures ?? [])];
  if (p.brandId) {
    const [b] = await tx.select({ name: brands.name, nameAr: brands.nameAr }).from(brands).where(eq(brands.id, p.brandId));
    if (b) parts.push(b.name, b.nameAr ?? '');
  }
  if (p.categoryId) {
    const [c] = await tx.select({ path: categories.path }).from(categories).where(eq(categories.id, p.categoryId));
    if (c?.path.length) {
      const chain = await tx.select({ nameAr: categories.nameAr, nameEn: categories.nameEn }).from(categories).where(inArray(categories.id, c.path));
      for (const x of chain) parts.push(x.nameAr, x.nameEn);
    }
  }
  const [store] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.sellerId, p.sellerId));
  if (store) parts.push(store.name);
  const attrs = await tx.select({ values: productAttributeValues.values, attributeId: productAttributeValues.attributeId }).from(productAttributeValues).where(eq(productAttributeValues.productId, productId));
  for (const a of attrs) {
    parts.push(...a.values);
    if (!a.values.length) continue;
    const labels = await tx
      .select({ labelAr: attributeOptions.labelAr })
      .from(attributeOptions)
      .where(and(eq(attributeOptions.attributeId, a.attributeId), inArray(attributeOptions.value, a.values)));
    for (const l of labels) parts.push(l.labelAr);
  }
  await tx
    .update(products)
    .set({
      minPrice: agg.minPrice === null ? null : Number(agg.minPrice),
      maxCompareAtPrice: agg.maxCompare === null ? null : Number(agg.maxCompare),
      totalAvailable: Number(agg.available ?? 0),
      searchText: normalizeSearch(parts.filter(Boolean).join(' ')).slice(0, 4000),
    })
    .where(eq(products.id, productId));
}
