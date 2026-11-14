import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { absoluteUrl } from '@/server/core/urls';
import { db, type DbOrTx } from '@/server/db/client';
import { categories, files, governorates, products, sellers, stores } from '@/server/db/schema';
import { productReviewsPublic, reviewerDisplayName, sellerReviewsPublic } from '@/server/modules/reviews/service';
import { productDetailBySlug, searchProducts, type SearchQuery } from './search';
import { categoryTree } from './taxonomy';

/**
 * PUBLIC catalog read model, shared by the web storefront pages and the mobile API (Phase 1).
 *
 * Visibility decisions live HERE, not in pages or route handlers: only LIVE products of APPROVED/RESTRICTED sellers and
 * stores of APPROVED/RESTRICTED sellers are ever returned; reviewer names are reduced to "First L."; media are absolute
 * public URLs. Every function returns a plain, explicit shape (an allow-list), never a raw table row.
 */

const VISIBLE_SELLER = ['APPROVED', 'RESTRICTED'] as const;

/** Absolute public media URL (same convention as the web `mediaUrl`). */
export function publicMediaUrl(key: string | null | undefined, size?: 'thumb' | 'md'): string | null {
  if (!key) return null;
  return absoluteUrl(`/media/${size ? key.replace(/\.webp$/, `_${size}.webp`) : key}`);
}

export interface PublicCategoryNode {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  icon: string | null;
  children: PublicCategoryNode[];
}

export async function publicCategoryTree(conn: DbOrTx = db): Promise<PublicCategoryNode[]> {
  type Node = Awaited<ReturnType<typeof categoryTree>>[number];
  const map = (n: Node): PublicCategoryNode => ({ id: n.id, slug: n.slug, nameAr: n.nameAr, nameEn: n.nameEn, icon: n.icon ?? null, children: (n.children as Node[]).map(map) });
  return (await categoryTree(conn, { activeOnly: true })).filter((c) => !c.isProhibited).map(map);
}

export async function publicGovernorates(conn: DbOrTx = db) {
  return conn
    .select({ id: governorates.id, code: governorates.code, nameAr: governorates.nameAr, nameEn: governorates.nameEn })
    .from(governorates)
    .where(eq(governorates.isActive, true))
    .orderBy(asc(governorates.sortOrder));
}

export async function publicProductSearch(query: SearchQuery) {
  const r = await searchProducts(query);
  return {
    items: r.items.map((p) => ({
      id: p.id,
      slug: p.slug,
      titleAr: p.titleAr,
      condition: p.condition,
      usedGrade: p.usedGrade ?? null,
      minPricePiastres: p.minPrice ?? null,
      compareAtPricePiastres: p.maxCompareAtPrice ?? null,
      inStock: p.totalAvailable > 0,
      ratingAvg: Number(p.ratingAvg),
      ratingCount: p.ratingCount,
      store: { name: p.storeName, slug: p.storeSlug, verified: !!p.storeVerified },
      imageUrl: publicMediaUrl(p.imageKey, 'md'),
      defaultVariantId: p.defaultVariantId ?? null,
      variantCount: Number(p.variantCount ?? 0),
    })),
    page: r.page,
    pageSize: r.pageSize,
    total: r.total,
    pages: r.pages,
  };
}

/** Product detail for buyers; null when the product is not publicly visible (draft, moderated, suspended seller…). */
export async function publicProductDetail(slug: string) {
  const d = await productDetailBySlug(slug);
  if (!d || !d.visible || !VISIBLE_SELLER.includes(d.seller.status as (typeof VISIBLE_SELLER)[number])) return null;
  const p = d.product;
  return {
    id: p.id,
    slug: p.slug,
    titleAr: p.titleAr,
    titleEn: p.titleEn ?? null,
    description: p.description ?? null,
    keyFeatures: p.keyFeatures,
    condition: p.condition,
    usedGrade: p.usedGrade ?? null,
    conditionNotes: p.conditionNotes ?? null,
    defects: p.defects ?? null,
    includedAccessories: p.includedAccessories ?? null,
    warrantyInfo: p.warrantyInfo ?? null,
    processingDays: p.processingDays ?? null,
    ratingAvg: Number(p.ratingAvg),
    ratingCount: p.ratingCount,
    brand: d.brand ? { id: d.brand.id, slug: d.brand.slug, name: d.brand.name, nameAr: d.brand.nameAr ?? null } : null,
    category: d.category ? { id: d.category.id, slug: d.category.slug, nameAr: d.category.nameAr, nameEn: d.category.nameEn } : null,
    breadcrumbs: d.breadcrumbs.map((b) => ({ id: b.id, slug: b.slug, nameAr: b.nameAr, nameEn: b.nameEn })),
    store: { name: d.store.name, slug: d.store.slug, verified: d.store.isVerified, ratingAvg: Number(d.seller.ratingAvg), ratingCount: d.seller.ratingCount },
    images: d.images.map((i) => ({ url: publicMediaUrl(i.key)!, thumbUrl: publicMediaUrl(i.key, 'thumb')!, alt: i.alt ?? null, isActualItem: !!i.isActualItem, width: i.width ?? null, height: i.height ?? null })),
    specs: d.specs.map((s) => ({ code: s.code, name: s.name, value: s.value })),
    variants: d.variants.map((v) => ({
      id: v.id,
      label: v.label,
      options: v.options ?? {},
      pricePiastres: v.price,
      compareAtPricePiastres: v.compareAtPrice ?? null,
      // Availability only — never stock counts or reservations.
      available: v.stockOnHand - v.reserved > 0,
      specs: (d.variantSpecs[v.id] ?? []).map((s) => ({ code: s.code, name: s.name, value: s.value })),
    })),
  };
}

const reviewOut = (r: { r: { id: string; rating: number; title?: string | null; body: string | null; sellerResponse?: string | null; createdAt: Date }; author: string }) => ({
  id: r.r.id,
  rating: r.r.rating,
  title: r.r.title ?? null,
  body: r.r.body ?? null,
  author: reviewerDisplayName(r.author),
  sellerResponse: r.r.sellerResponse ?? null,
  createdAt: r.r.createdAt.toISOString(),
});

/** Published reviews of a publicly visible product (null for hidden or unknown products). */
export async function publicProductReviews(ref: { id: string } | { slug: string }, limit = 20) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(sellers, eq(sellers.id, products.sellerId))
    .where(and('id' in ref ? eq(products.id, ref.id) : eq(products.slug, ref.slug), eq(products.status, 'LIVE'), inArray(sellers.status, [...VISIBLE_SELLER])));
  if (!p) return null;
  return (await productReviewsPublic(p.id, Math.min(Math.max(limit, 1), 50))).map(reviewOut);
}

/** Store page read model (also used by the web store page). Null unless the seller is APPROVED / RESTRICTED. */
export async function publicStoreBySlug(slug: string, conn: DbOrTx = db) {
  const [row] = await conn
    .select({ store: stores, seller: sellers })
    .from(stores)
    .innerJoin(sellers, eq(sellers.id, stores.sellerId))
    .where(eq(stores.slug, slug));
  if (!row || !(VISIBLE_SELLER as readonly string[]).includes(row.seller.status)) return null;
  const { store, seller } = row;
  const [logo] = store.logoFileId ? await conn.select({ key: files.storageKey }).from(files).where(eq(files.id, store.logoFileId)) : [];
  const [banner] = store.bannerFileId ? await conn.select({ key: files.storageKey }).from(files).where(eq(files.id, store.bannerFileId)) : [];
  const cats = await conn
    .selectDistinct({ nameAr: categories.nameAr, slug: categories.slug })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.sellerId, seller.id), eq(products.status, 'LIVE')));
  const [{ count }] = await conn.select({ count: sql<number>`count(*)::int` }).from(products).where(and(eq(products.sellerId, seller.id), inArray(products.status, ['LIVE'])));
  return { store, seller, logoKey: logo?.key ?? null, bannerKey: banner?.key ?? null, categories: cats, productCount: count };
}

/** Mobile-facing projection of the store page (allow-list). */
export async function publicStoreView(slug: string) {
  const s = await publicStoreBySlug(slug);
  if (!s) return null;
  const reviews = (await sellerReviewsPublic(s.seller.id, 10)).map(reviewOut);
  return {
    name: s.store.name,
    slug: s.store.slug,
    description: s.store.description ?? null,
    verified: s.store.isVerified,
    logoUrl: publicMediaUrl(s.logoKey),
    bannerUrl: publicMediaUrl(s.bannerKey),
    ratingAvg: Number(s.seller.ratingAvg),
    ratingCount: s.seller.ratingCount,
    positivePercent: s.seller.ratingCount ? Math.round((s.seller.positiveCount / s.seller.ratingCount) * 100) : null,
    memberSince: s.seller.approvedAt ? s.seller.approvedAt.toISOString() : null,
    acceptsVoluntaryReturns: s.store.acceptsVoluntaryReturns,
    voluntaryReturnDays: s.store.voluntaryReturnDays ?? null,
    productCount: s.productCount,
    categories: s.categories,
    reviews,
  };
}
