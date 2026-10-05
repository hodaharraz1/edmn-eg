import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  ATTRIBUTE_TYPES,
  PRODUCT_CONDITIONS,
  PRODUCT_STATUSES,
  REVISION_STATUSES,
  USED_GRADES,
} from '@/domain/machines';
import { createdAt, enumCheck, money, ts, updatedAt } from './_helpers';
import { files } from './files';
import { users } from './identity';
import { sellers } from './sellers';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
    slug: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    descriptionAr: text(),
    imageFileId: uuid().references(() => files.id),
    icon: text(), // lucide icon name for navigation
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    seoTitle: text(),
    seoDescription: text(),
    /** Restricted categories always require enhanced manual review. */
    isRestricted: boolean().notNull().default(false),
    /** Prohibited categories cannot receive listings at all. */
    isProhibited: boolean().notNull().default(false),
    /** Path of ancestor ids incl. self, maintained by the catalog module (for subtree queries). */
    path: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    depth: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('categories_slug_uq').on(t.slug),
    index('categories_parent_idx').on(t.parentId, t.sortOrder),
    index('categories_path_gin').using('gin', t.path),
  ],
);

export const brands = pgTable(
  'brands',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    nameAr: text(),
    logoFileId: uuid().references(() => files.id),
    isActive: boolean().notNull().default(true),
    seoTitle: text(),
    seoDescription: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('brands_slug_uq').on(t.slug)],
);

export const attributes = pgTable(
  'attributes',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    type: text({ enum: ATTRIBUTE_TYPES }).notNull(),
    unit: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('attributes_code_uq').on(t.code), enumCheck('attributes_type_chk', t.type, ATTRIBUTE_TYPES)],
);

export const attributeOptions = pgTable(
  'attribute_options',
  {
    id: uuid().primaryKey().defaultRandom(),
    attributeId: uuid()
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    value: text().notNull(),
    labelAr: text().notNull(),
    labelEn: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [uniqueIndex('attribute_options_uq').on(t.attributeId, t.value)],
);

/** Category-specific attribute schema (inherited by child categories). */
export const categoryAttributes = pgTable(
  'category_attributes',
  {
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    attributeId: uuid()
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    isRequired: boolean().notNull().default(false),
    isFilterable: boolean().notNull().default(false),
    isVariantAxis: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.attributeId] })],
);

export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    sellerId: uuid()
      .notNull()
      .references(() => sellers.id),
    categoryId: uuid().references(() => categories.id),
    brandId: uuid().references(() => brands.id),
    status: text({ enum: PRODUCT_STATUSES }).notNull().default('DRAFT'),
    statusReason: text(),
    slug: text().notNull(),
    titleAr: text().notNull(),
    titleEn: text(),
    description: text(),
    keyFeatures: text().array().notNull().default(sql`'{}'::text[]`),
    condition: text({ enum: PRODUCT_CONDITIONS }).notNull().default('NEW'),
    // Used-product disclosures (required when condition = USED)
    usedGrade: text({ enum: USED_GRADES }),
    conditionNotes: text(),
    defects: text(),
    includedAccessories: text(),
    usageInfo: text(),
    warrantyInfo: text(),
    // Shipping & physical
    weightGrams: integer(),
    lengthCm: integer(),
    widthCm: integer(),
    heightCm: integer(),
    processingDays: integer(),
    // Return settings (voluntary; statutory rights unaffected)
    returnPolicyOverride: boolean().notNull().default(false),
    acceptsVoluntaryReturns: boolean(),
    voluntaryReturnDays: integer(),
    returnConditionKeys: jsonb().$type<string[]>(),
    returnShippingPayer: text(),
    returnPolicyNotes: text(),
    /** The seller explicitly chose a return policy for this listing (store default or custom) — required before submission. */
    returnPolicyConfirmed: boolean().notNull().default(false),
    // SEO
    seoTitle: text(),
    seoDescription: text(),
    // Denormalized read-model fields maintained transactionally
    minPrice: money(),
    maxCompareAtPrice: money(),
    totalAvailable: integer().notNull().default(0),
    ratingAvg: numeric({ precision: 3, scale: 2 }).notNull().default('0'),
    ratingCount: integer().notNull().default(0),
    salesCount: integer().notNull().default(0),
    searchText: text().notNull().default(''),
    searchVector: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', coalesce(search_text, ''))`),
    needsEnhancedReview: boolean().notNull().default(false),
    submittedAt: ts(),
    approvedAt: ts(),
    approvedBy: uuid().references(() => users.id),
    publishedAt: ts(),
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('products_slug_uq').on(t.slug),
    index('products_seller_idx').on(t.sellerId, t.status),
    index('products_category_idx').on(t.categoryId, t.status),
    index('products_brand_idx').on(t.brandId),
    index('products_status_idx').on(t.status, t.submittedAt),
    index('products_live_price_idx').on(t.minPrice).where(sql`${t.status} = 'LIVE'`),
    index('products_live_new_idx').on(t.publishedAt).where(sql`${t.status} = 'LIVE'`),
    index('products_search_gin').using('gin', t.searchVector),
    index('products_search_trgm').using('gin', sql`${t.searchText} gin_trgm_ops`),
    enumCheck('products_status_chk', t.status, PRODUCT_STATUSES),
    enumCheck('products_condition_chk', t.condition, PRODUCT_CONDITIONS),
    check('products_used_grade_chk', sql`${t.condition} <> 'USED' or ${t.status} in ('DRAFT') or ${t.usedGrade} is not null`),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    sku: text().notNull(),
    barcode: text(),
    /** e.g. {"color":"أسود","storage":"128GB"} — keys are attribute codes */
    options: jsonb().$type<Record<string, string>>().notNull().default({}),
    label: text().notNull().default(''),
    price: money().notNull(),
    compareAtPrice: money(),
    /** Physical units the seller holds. */
    stockOnHand: integer().notNull().default(0),
    /** Units held by unpaid/under-review orders. available = stock_on_hand - reserved */
    reserved: integer().notNull().default(0),
    lowStockThreshold: integer().notNull().default(2),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('variants_product_idx').on(t.productId),
    check('variants_price_chk', sql`${t.price} > 0`),
    check('variants_compare_chk', sql`${t.compareAtPrice} is null or ${t.compareAtPrice} > ${t.price}`),
    check('variants_stock_chk', sql`${t.stockOnHand} >= 0 and ${t.reserved} >= 0 and ${t.reserved} <= ${t.stockOnHand}`),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    alt: text(),
    /** true = photo of the actual item being sold (mandatory for used listings) */
    isActualItem: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.sortOrder)],
);

export const productAttributeValues = pgTable(
  'product_attribute_values',
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    attributeId: uuid()
      .notNull()
      .references(() => attributes.id),
    /** Canonical value(s): text / number-as-string / option values / "true"|"false" */
    values: text().array().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.attributeId] }),
    index('pav_attr_values_gin').using('gin', t.values),
  ],
);

/**
 * Material edits to an approved listing are staged here and only applied after moderation,
 * so a live listing can never be silently turned into a different product.
 */
export const productRevisions = pgTable(
  'product_revisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    status: text({ enum: REVISION_STATUSES }).notNull().default('SUBMITTED'),
    data: jsonb().notNull(),
    changedFields: text().array().notNull(),
    reason: text(),
    submittedBy: uuid().references(() => users.id),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('product_revisions_product_idx').on(t.productId, t.status),
    uniqueIndex('product_revisions_one_open_uq').on(t.productId).where(sql`${t.status} = 'SUBMITTED'`),
    enumCheck('product_revisions_status_chk', t.status, REVISION_STATUSES),
  ],
);

export const MODERATION_ACTIONS = [
  'SUBMIT',
  'START_REVIEW',
  'APPROVE',
  'REJECT',
  'REQUEST_CHANGES',
  'SUSPEND',
  'REINSTATE',
  'REVISION_SUBMIT',
  'REVISION_APPROVE',
  'REVISION_REJECT',
] as const;
export const productModerationEvents = pgTable(
  'product_moderation_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    revisionId: uuid().references(() => productRevisions.id),
    action: text({ enum: MODERATION_ACTIONS }).notNull(),
    reasonCode: text(),
    reason: text(),
    actorUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('pme_product_idx').on(t.productId, t.createdAt)],
);

/** Configurable prohibited / restricted listing policy. */
export const POLICY_RULE_KINDS = ['BLOCK_KEYWORD', 'REVIEW_KEYWORD'] as const;
export const listingPolicyRules = pgTable(
  'listing_policy_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text({ enum: POLICY_RULE_KINDS }).notNull(),
    pattern: text().notNull(), // normalized keyword/phrase
    reasonCode: text().notNull(),
    description: text(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [enumCheck('listing_policy_rules_kind_chk', t.kind, POLICY_RULE_KINDS)],
);

export const INVENTORY_RESERVATION_STATUSES = ['ACTIVE', 'COMMITTED', 'RELEASED'] as const;
export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    orderItemId: uuid().notNull(),
    quantity: integer().notNull(),
    status: text({ enum: INVENTORY_RESERVATION_STATUSES }).notNull().default('ACTIVE'),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
    resolvedAt: ts(),
  },
  (t) => [
    uniqueIndex('inv_res_order_item_uq').on(t.orderItemId),
    index('inv_res_active_idx').on(t.status, t.expiresAt),
    check('inv_res_qty_chk', sql`${t.quantity} > 0`),
    enumCheck('inv_res_status_chk', t.status, INVENTORY_RESERVATION_STATUSES),
  ],
);

export const INVENTORY_MOVEMENT_TYPES = ['ADJUSTMENT', 'RESERVE', 'RELEASE', 'COMMIT', 'RESTOCK'] as const;
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    type: text({ enum: INVENTORY_MOVEMENT_TYPES }).notNull(),
    deltaOnHand: integer().notNull().default(0),
    deltaReserved: integer().notNull().default(0),
    reference: text(),
    actorUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('inv_mov_variant_idx').on(t.variantId, t.createdAt)],
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);
