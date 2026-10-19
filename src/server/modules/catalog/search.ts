import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { normalizeSearch } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import {
  attributeOptions,
  attributes,
  brands,
  categories,
  files,
  productAttributeValues,
  productImages,
  productVariants,
  products,
  sellers,
  stores,
} from '@/server/db/schema';

/**
 * Marketplace search on PostgreSQL: full-text (tsvector over Arabic-normalized text) + trigram
 * similarity for typo tolerance. The `SearchBackend` boundary lets a dedicated engine
 * (Meilisearch/OpenSearch) replace this later without touching pages.
 */
export const SORTS = ['recommended', 'best_selling', 'top_rated', 'newest', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];

export interface SearchQuery {
  q?: string;
  categoryId?: string;
  brandIds?: string[];
  sellerId?: string;
  condition?: 'NEW' | 'USED';
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStock?: boolean;
  verifiedOnly?: boolean;
  dealsOnly?: boolean;
  governorateId?: number;
  attrs?: Record<string, string[]>;
  sort?: Sort;
  page?: number;
  pageSize?: number;
}

export const listingCardFields = {
  id: products.id,
  slug: products.slug,
  titleAr: products.titleAr,
  condition: products.condition,
  usedGrade: products.usedGrade,
  minPrice: products.minPrice,
  maxCompareAtPrice: products.maxCompareAtPrice,
  totalAvailable: products.totalAvailable,
  ratingAvg: products.ratingAvg,
  ratingCount: products.ratingCount,
  salesCount: products.salesCount,
  sellerId: products.sellerId,
  storeName: stores.name,
  storeSlug: stores.slug,
  storeVerified: stores.isVerified,
  imageKey: sql<string | null>`(select f.storage_key from product_images pi join files f on f.id = pi.file_id where pi.product_id = ${products.id} order by pi.sort_order limit 1)`,
  defaultVariantId: sql<string | null>`(select v.id from product_variants v where v.product_id = ${products.id} and v.is_active order by v.price limit 1)`,
  variantCount: sql<number>`(select count(*)::int from product_variants v where v.product_id = ${products.id} and v.is_active)`,
};

/** Only LIVE products of currently-approved (or restricted) sellers are purchasable/visible. */
export function visibleCondition(): SQL {
  return and(eq(products.status, 'LIVE'), inArray(sellers.status, ['APPROVED', 'RESTRICTED']))!;
}

/**
 * The WHERE conditions of a catalog query — shared by the result list and by every facet, so counts always describe
 * the same result set the shopper is looking at. `except` drops one filter group (disjunctive faceting: a facet's own
 * selection is ignored when counting its values, so selecting a second brand still shows how many it adds).
 */
export function catalogConditions(query: SearchQuery, except?: { brand?: boolean; attr?: string; allAttrs?: boolean }): SQL[] {
  const where: SQL[] = [visibleCondition()];
  const q = query.q ? normalizeSearch(query.q).slice(0, 100) : '';
  if (q) {
    const tsq = searchTsQuery(q);
    where.push(sql`(${products.searchVector} @@ to_tsquery('simple', ${tsq}) or word_similarity(${q}, ${products.searchText}) > 0.45 or ${products.searchText} ilike ${'%' + q + '%'})`);
  }
  if (query.categoryId) where.push(sql`${products.categoryId} in (select id from categories where ${query.categoryId}::uuid = any(path))`);
  if (query.brandIds?.length && !except?.brand) where.push(inArray(products.brandId, query.brandIds));
  if (query.sellerId) where.push(eq(products.sellerId, query.sellerId));
  if (query.condition) where.push(eq(products.condition, query.condition));
  if (query.minPrice !== undefined) where.push(gte(products.minPrice, query.minPrice));
  if (query.maxPrice !== undefined) where.push(lte(products.minPrice, query.maxPrice));
  if (query.minRating) where.push(gte(products.ratingAvg, String(query.minRating)));
  if (query.inStock) where.push(sql`${products.totalAvailable} > 0`);
  if (query.verifiedOnly) where.push(eq(stores.isVerified, true));
  if (query.dealsOnly) where.push(sql`${products.maxCompareAtPrice} is not null`);
  if (query.governorateId) {
    where.push(sql`exists (select 1 from seller_shipping_rates r where r.seller_id = ${products.sellerId} and r.governorate_id = ${query.governorateId} and r.enabled)`);
  }
  for (const [code, values] of Object.entries(query.attrs ?? {})) {
    if (!values.length || code === except?.attr || except?.allAttrs) continue;
    where.push(sql`exists (select 1 from product_attribute_values pav join attributes a on a.id = pav.attribute_id
      where pav.product_id = ${products.id} and a.code = ${code} and pav.values && ARRAY[${sql.join(values.slice(0, 20).map((v) => sql`${v}`), sql`, `)}]::text[])`);
  }
  return where;
}

function searchTsQuery(q: string) {
  const terms = q.split(' ').filter(Boolean).map((t) => t.replace(/[':&|!()*\\]/g, '')).filter(Boolean);
  return terms.map((t) => `${t}:*`).join(' & ');
}

export async function searchProducts(query: SearchQuery, conn: DbOrTx = db) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), 60);
  const page = Math.max(query.page ?? 1, 1);
  const where = catalogConditions(query);
  const q = query.q ? normalizeSearch(query.q).slice(0, 100) : '';
  const rank: SQL | null = q ? sql`(ts_rank(${products.searchVector}, to_tsquery('simple', ${searchTsQuery(q)})) + word_similarity(${q}, ${products.searchText}))` : null;
  const orderBy: SQL[] = (() => {
    switch (query.sort) {
      case 'best_selling':
        return [desc(products.salesCount)];
      case 'top_rated':
        return [desc(products.ratingAvg), desc(products.ratingCount)];
      case 'newest':
        return [desc(products.publishedAt)];
      case 'price_asc':
        return [asc(products.minPrice)];
      case 'price_desc':
        return [desc(products.minPrice)];
      default:
        return [
          ...(rank ? [desc(rank)] : []),
          sql`(${products.totalAvailable} > 0) desc`,
          desc(sql`(${products.ratingAvg}::numeric * ln(${products.ratingCount} + 2)) + ln(${products.salesCount} + 1)`),
          desc(products.publishedAt),
        ];
    }
  })();
  const base = conn
    .select(listingCardFields)
    .from(products)
    .innerJoin(sellers, eq(sellers.id, products.sellerId))
    .innerJoin(stores, eq(stores.sellerId, products.sellerId))
    .where(and(...where));
  const [items, [{ total }]] = await Promise.all([
    base.orderBy(...orderBy, asc(products.id)).limit(pageSize).offset((page - 1) * pageSize),
    conn
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(stores, eq(stores.sellerId, products.sellerId))
      .where(and(...where)),
  ]);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Brand facet: counts within the current result set (every active filter except the brand selection itself). */
export async function brandFacets(query: SearchQuery = {}, conn: DbOrTx = db) {
  return conn
    .select({ id: brands.id, name: brands.name, nameAr: brands.nameAr, slug: brands.slug, count: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(sellers, eq(sellers.id, products.sellerId))
    .innerJoin(stores, eq(stores.sellerId, products.sellerId))
    .where(and(...catalogConditions(query, { brand: true })))
    .groupBy(brands.id)
    .orderBy(desc(sql`count(*)`))
    .limit(30);
}

/**
 * Attribute facets of a category, counted within the current result set: every active filter applies except the
 * attribute's own selection (so ticking a second value of the same attribute still shows what it adds).
 */
/** Names of brands selected in the URL that have no match in the current results (count 0, still un-tickable). */
export async function brandsByIds(ids: string[], conn: DbOrTx = db) {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 30);
  return valid.length ? conn.select({ id: brands.id, name: brands.name, nameAr: brands.nameAr, slug: brands.slug }).from(brands).where(inArray(brands.id, valid)) : [];
}

export async function filterableAttributes(categoryId: string, query: SearchQuery = {}, conn: DbOrTx = db) {
  const [cat] = await conn.select({ path: categories.path }).from(categories).where(eq(categories.id, categoryId));
  if (!cat) return [];
  // Products matching everything except attribute filters…
  const inResults = sql`pav.product_id in (select ${products.id} from ${products}
      join ${sellers} on ${sellers.id} = ${products.sellerId} join ${stores} on ${stores.sellerId} = ${products.sellerId}
      where ${and(...catalogConditions({ ...query, categoryId }, { allAttrs: true }))})`;
  // …and every OTHER attribute's selection (the counted attribute's own selection is ignored).
  const otherAttrs = Object.entries(query.attrs ?? {})
    .filter(([, values]) => values.length)
    .map(
      ([code, values]) => sql`(a.code = ${code} or exists (select 1 from product_attribute_values pav2 join attributes a2 on a2.id = pav2.attribute_id
        where pav2.product_id = pav.product_id and a2.code = ${code} and pav2.values && ARRAY[${sql.join(values.slice(0, 20).map((v) => sql`${v}`), sql`, `)}]::text[]))`,
    );
  const rows = await conn.execute<{ code: string; name_ar: string; type: string; value: string; label_ar: string | null; count: number }>(sql`
    select a.code, a.name_ar, a.type, v.value, ao.label_ar, count(*)::int as count
    from category_attributes ca
    join attributes a on a.id = ca.attribute_id
    join product_attribute_values pav on pav.attribute_id = a.id
    cross join lateral unnest(pav.values) as v(value)
    left join attribute_options ao on ao.attribute_id = a.id and ao.value = v.value
    where ca.category_id = any(${sql.raw(`'{${cat.path.join(',')}}'::uuid[]`)}) and ca.is_filterable
      and ${inResults}
      ${otherAttrs.length ? sql`and ${sql.join(otherAttrs, sql` and `)}` : sql``}
    group by a.code, a.name_ar, a.type, v.value, ao.label_ar, ao.sort_order
    order by a.code, ao.sort_order nulls last, count desc`);
  const grouped = new Map<string, { code: string; nameAr: string; values: { value: string; label: string; count: number }[] }>();
  for (const r of rows.rows) {
    if (!grouped.has(r.code)) grouped.set(r.code, { code: r.code, nameAr: r.name_ar, values: [] });
    grouped.get(r.code)!.values.push({ value: r.value, label: r.label_ar ?? r.value, count: Number(r.count) });
  }
  return [...grouped.values()];
}

/* ───────── Product detail ───────── */

export async function productDetailBySlug(slug: string, conn: DbOrTx = db) {
  const [row] = await conn
    .select({ product: products, store: stores, seller: { id: sellers.id, status: sellers.status, ratingAvg: sellers.ratingAvg, ratingCount: sellers.ratingCount, positiveCount: sellers.positiveCount, approvedAt: sellers.approvedAt } })
    .from(products)
    .innerJoin(sellers, eq(sellers.id, products.sellerId))
    .innerJoin(stores, eq(stores.sellerId, products.sellerId))
    .where(eq(products.slug, slug));
  if (!row) return null;
  const visible = row.product.status === 'LIVE' && (row.seller.status === 'APPROVED' || row.seller.status === 'RESTRICTED');
  const [variants, images, attrRows, brand, category] = await Promise.all([
    conn.select().from(productVariants).where(and(eq(productVariants.productId, row.product.id), eq(productVariants.isActive, true))).orderBy(asc(productVariants.sortOrder)),
    conn
      .select({ key: files.storageKey, alt: productImages.alt, isActualItem: productImages.isActualItem, width: files.width, height: files.height })
      .from(productImages)
      .innerJoin(files, eq(files.id, productImages.fileId))
      .where(eq(productImages.productId, row.product.id))
      .orderBy(asc(productImages.sortOrder)),
    conn
      .select({ code: attributes.code, nameAr: attributes.nameAr, type: attributes.type, unit: attributes.unit, values: productAttributeValues.values, attributeId: attributes.id })
      .from(productAttributeValues)
      .innerJoin(attributes, eq(attributes.id, productAttributeValues.attributeId))
      .where(eq(productAttributeValues.productId, row.product.id)),
    row.product.brandId ? conn.select().from(brands).where(eq(brands.id, row.product.brandId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    row.product.categoryId ? conn.select().from(categories).where(eq(categories.id, row.product.categoryId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  // Variant-defining attributes (e.g. storage, color) live on each variant's `options`, keyed by attribute code.
  // Their metadata is loaded too, so a variant can be described even when the product has no product-level value.
  const variantCodes = [...new Set(variants.flatMap((v) => Object.keys(v.options ?? {})))].filter((c) => !attrRows.some((a) => a.code === c));
  const variantAttrs = variantCodes.length
    ? await conn.select({ code: attributes.code, nameAr: attributes.nameAr, type: attributes.type, unit: attributes.unit, attributeId: attributes.id }).from(attributes).where(inArray(attributes.code, variantCodes))
    : [];
  const allAttrs = [...attrRows, ...variantAttrs.map((a) => ({ ...a, values: [] as string[] }))];
  const optionIds = allAttrs.filter((a) => a.type === 'SELECT' || a.type === 'MULTI_SELECT').map((a) => a.attributeId);
  const labels = optionIds.length ? await conn.select().from(attributeOptions).where(inArray(attributeOptions.attributeId, optionIds)) : [];
  const describe = (a: (typeof allAttrs)[number], values: string[]) =>
    values.map((v) => (a.type === 'BOOLEAN' ? (v === 'true' ? 'نعم' : 'لا') : (labels.find((l) => l.attributeId === a.attributeId && l.value === v)?.labelAr ?? v))).join('، ') + (a.unit ? ` ${a.unit}` : '');
  /** Specifications of one variant: product-level values, overridden by (and extended with) the variant's own options. */
  const specsFor = (options: Record<string, string> | null | undefined) => {
    const opts = options ?? {};
    const rows = attrRows.map((a) => ({ code: a.code, name: a.nameAr, value: describe(a, opts[a.code] != null ? [opts[a.code]] : a.values) }));
    for (const a of variantAttrs) if (opts[a.code] != null) rows.push({ code: a.code, name: a.nameAr, value: describe({ ...a, values: [] }, [opts[a.code]]) });
    return rows.filter((r) => r.value.trim() !== '');
  };
  const specs = specsFor(null);
  const variantSpecs: Record<string, ReturnType<typeof specsFor>> = Object.fromEntries(variants.map((v) => [v.id, specsFor(v.options)]));
  const breadcrumbs = category ? await conn.select().from(categories).where(inArray(categories.id, category.path)) : [];
  return {
    ...row,
    visible,
    variants,
    images,
    specs,
    variantSpecs,
    brand,
    category,
    breadcrumbs: category ? category.path.map((id) => breadcrumbs.find((b) => b.id === id)!).filter(Boolean) : [],
  };
}

export async function relatedProducts(productId: string, categoryId: string | null, limit = 8) {
  if (!categoryId) return [];
  return db
    .select(listingCardFields)
    .from(products)
    .innerJoin(sellers, eq(sellers.id, products.sellerId))
    .innerJoin(stores, eq(stores.sellerId, products.sellerId))
    .where(and(visibleCondition(), eq(products.categoryId, categoryId), sql`${products.id} <> ${productId}`))
    .orderBy(desc(products.salesCount))
    .limit(limit);
}

export async function productsByIds(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select(listingCardFields)
    .from(products)
    .innerJoin(sellers, eq(sellers.id, products.sellerId))
    .innerJoin(stores, eq(stores.sellerId, products.sellerId))
    .where(and(visibleCondition(), inArray(products.id, ids)));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => !!r);
}

export type ListingCard = Awaited<ReturnType<typeof searchProducts>>['items'][number];
