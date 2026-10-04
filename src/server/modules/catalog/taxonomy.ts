import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, type Actor } from '@/server/core/actor';
import { invalidState, notFound, validation } from '@/server/core/errors';
import { normalizeSearch, slugify } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { attributeOptions, attributes, brands, categories, categoryAttributes, listingPolicyRules, products } from '@/server/db/schema';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason } from '../_shared';

export type Category = typeof categories.$inferSelect;

/* ───────── Categories ───────── */

export const categorySchema = z.object({
  parentId: z.string().uuid().nullable(),
  nameAr: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().min(2).max(80),
  slug: z.string().trim().max(80).optional().default(''),
  descriptionAr: z.string().trim().max(500).optional().default(''),
  icon: z.string().trim().max(40).optional().default(''),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  seoTitle: z.string().trim().max(120).optional().default(''),
  seoDescription: z.string().trim().max(300).optional().default(''),
  isRestricted: z.boolean().default(false),
  isProhibited: z.boolean().default(false),
});

export async function saveCategory(actor: Actor, id: string | null, input: z.input<typeof categorySchema>, image?: { data: Buffer; name: string } | null) {
  requirePermission(actor, 'catalog.manage');
  const d = parse(categorySchema, input);
  const slug = slugify(d.slug || d.nameEn || d.nameAr);
  return db.transaction(async (tx) => {
    const [dupe] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
    if (dupe && dupe.id !== id) throw validation('الرابط (slug) مستخدم لتصنيف آخر');
    let parentPath: string[] = [];
    if (d.parentId) {
      const [parent] = await tx.select().from(categories).where(eq(categories.id, d.parentId));
      if (!parent) throw notFound('التصنيف الأب');
      if (id && parent.path.includes(id)) throw validation('لا يمكن نقل التصنيف داخل أحد فروعه');
      parentPath = parent.path;
    }
    const img = image ? await storeUpload(tx, actor, { purpose: 'CATEGORY_IMAGE', data: image.data, originalName: image.name }) : null;
    const values = {
      parentId: d.parentId,
      slug,
      nameAr: d.nameAr,
      nameEn: d.nameEn,
      descriptionAr: d.descriptionAr || null,
      icon: d.icon || null,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
      seoTitle: d.seoTitle || null,
      seoDescription: d.seoDescription || null,
      isRestricted: d.isRestricted,
      isProhibited: d.isProhibited,
      ...(img ? { imageFileId: img.id } : {}),
    };
    if (id) {
      const [old] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
      if (!old) throw notFound('التصنيف');
      const newPath = [...parentPath, id];
      await tx.update(categories).set({ ...values, path: newPath, depth: newPath.length - 1 }).where(eq(categories.id, id));
      if (old.parentId !== d.parentId) {
        // Re-root every descendant's path.
        await tx.execute(sql`
          update categories set
            path = ${sql.raw(`'{${newPath.join(',')}}'::uuid[]`)} || path[array_position(path, ${id}::uuid) + 1 :],
            depth = cardinality(${sql.raw(`'{${newPath.join(',')}}'::uuid[]`)} || path[array_position(path, ${id}::uuid) + 1 :]) - 1
          where ${id}::uuid = any(path) and id <> ${id}::uuid`);
      }
      await audit(tx, actor, { action: 'catalog.category_updated', entityType: 'category', entityId: id, oldValues: { nameAr: old.nameAr, parentId: old.parentId, isActive: old.isActive, isRestricted: old.isRestricted, isProhibited: old.isProhibited }, newValues: values });
      return id;
    }
    const [row] = await tx.insert(categories).values(values).returning({ id: categories.id });
    const path = [...parentPath, row.id];
    await tx.update(categories).set({ path, depth: path.length - 1 }).where(eq(categories.id, row.id));
    await audit(tx, actor, { action: 'catalog.category_created', entityType: 'category', entityId: row.id, newValues: values });
    return row.id;
  });
}

export async function categoryTree(conn: DbOrTx = db, opts: { activeOnly?: boolean } = {}) {
  const rows = await conn
    .select()
    .from(categories)
    .where(opts.activeOnly ? eq(categories.isActive, true) : undefined)
    .orderBy(asc(categories.depth), asc(categories.sortOrder), asc(categories.nameAr));
  type Node = Category & { children: Node[] };
  const map = new Map<string, Node>();
  const roots: Node[] = [];
  for (const r of rows) map.set(r.id, { ...r, children: [] });
  for (const n of map.values()) {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n);
    else if (!n.parentId) roots.push(n);
  }
  return roots;
}

export async function categoryBySlug(slug: string, conn: DbOrTx = db) {
  const [c] = await conn.select().from(categories).where(eq(categories.slug, slug));
  return c ?? null;
}

export async function categoryAncestors(conn: DbOrTx, cat: Category) {
  if (cat.path.length <= 1) return [cat];
  const rows = await conn.select().from(categories).where(inArray(categories.id, cat.path));
  return cat.path.map((id) => rows.find((r) => r.id === id)!).filter(Boolean);
}

/** Effective attribute schema of a category = own + inherited from ancestors. */
export async function effectiveAttributes(conn: DbOrTx, categoryId: string) {
  const [cat] = await conn.select().from(categories).where(eq(categories.id, categoryId));
  if (!cat) return [];
  const rows = await conn
    .select({ ca: categoryAttributes, attr: attributes })
    .from(categoryAttributes)
    .innerJoin(attributes, eq(attributes.id, categoryAttributes.attributeId))
    .where(inArray(categoryAttributes.categoryId, cat.path))
    .orderBy(asc(categoryAttributes.sortOrder));
  const opts = rows.length
    ? await conn.select().from(attributeOptions).where(inArray(attributeOptions.attributeId, rows.map((r) => r.attr.id))).orderBy(asc(attributeOptions.sortOrder))
    : [];
  const seen = new Map<string, (typeof rows)[number] & { options: typeof opts }>();
  // Deeper categories override inherited settings for the same attribute.
  for (const catId of cat.path) {
    for (const r of rows.filter((x) => x.ca.categoryId === catId)) seen.set(r.attr.id, { ...r, options: opts.filter((o) => o.attributeId === r.attr.id) });
  }
  return [...seen.values()];
}

/* ───────── Brands ───────── */

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().max(80).optional().default(''),
  slug: z.string().trim().max(80).optional().default(''),
  isActive: z.boolean().default(true),
  seoTitle: z.string().trim().max(120).optional().default(''),
  seoDescription: z.string().trim().max(300).optional().default(''),
});

export async function saveBrand(actor: Actor, id: string | null, input: z.input<typeof brandSchema>, logo?: { data: Buffer; name: string } | null) {
  requirePermission(actor, 'catalog.manage');
  const d = parse(brandSchema, input);
  const slug = slugify(d.slug || d.name);
  return db.transaction(async (tx) => {
    const [dupe] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug));
    if (dupe && dupe.id !== id) throw validation('الرابط (slug) مستخدم لعلامة أخرى');
    const img = logo ? await storeUpload(tx, actor, { purpose: 'BRAND_LOGO', data: logo.data, originalName: logo.name }) : null;
    const values = { name: d.name, nameAr: d.nameAr || null, slug, isActive: d.isActive, seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null, ...(img ? { logoFileId: img.id } : {}) };
    if (id) {
      await tx.update(brands).set(values).where(eq(brands.id, id));
      await audit(tx, actor, { action: 'catalog.brand_updated', entityType: 'brand', entityId: id, newValues: values });
      return id;
    }
    const [row] = await tx.insert(brands).values(values).returning({ id: brands.id });
    await audit(tx, actor, { action: 'catalog.brand_created', entityType: 'brand', entityId: row.id, newValues: values });
    return row.id;
  });
}

/* ───────── Attributes ───────── */

export const attributeSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, 'الكود: أحرف إنجليزية صغيرة وأرقام و _'),
  nameAr: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  type: z.enum(['TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN']),
  unit: z.string().trim().max(20).optional().default(''),
  options: z.array(z.object({ value: z.string().trim().min(1).max(60), labelAr: z.string().trim().min(1).max(60), labelEn: z.string().trim().max(60).optional() })).max(200).default([]),
});

export async function saveAttribute(actor: Actor, id: string | null, input: z.input<typeof attributeSchema>) {
  requirePermission(actor, 'catalog.manage');
  const d = parse(attributeSchema, input);
  if ((d.type === 'SELECT' || d.type === 'MULTI_SELECT') && !d.options.length) throw validation('أضف خيارات لهذه السمة');
  return db.transaction(async (tx) => {
    let attrId = id;
    if (id) {
      await tx.update(attributes).set({ nameAr: d.nameAr, nameEn: d.nameEn, unit: d.unit || null }).where(eq(attributes.id, id));
    } else {
      const [row] = await tx.insert(attributes).values({ code: d.code, nameAr: d.nameAr, nameEn: d.nameEn, type: d.type, unit: d.unit || null }).returning({ id: attributes.id });
      attrId = row.id;
    }
    for (const [i, o] of d.options.entries()) {
      await tx
        .insert(attributeOptions)
        .values({ attributeId: attrId!, value: o.value, labelAr: o.labelAr, labelEn: o.labelEn || o.value, sortOrder: i })
        .onConflictDoUpdate({ target: [attributeOptions.attributeId, attributeOptions.value], set: { labelAr: o.labelAr, labelEn: o.labelEn || o.value, sortOrder: i } });
    }
    await audit(tx, actor, { action: id ? 'catalog.attribute_updated' : 'catalog.attribute_created', entityType: 'attribute', entityId: attrId, newValues: { code: d.code, type: d.type } });
    return attrId!;
  });
}

export async function setCategoryAttribute(
  actor: Actor,
  categoryId: string,
  attributeId: string,
  cfg: { isRequired: boolean; isFilterable: boolean; isVariantAxis: boolean; sortOrder: number } | null,
) {
  requirePermission(actor, 'catalog.manage');
  await db.transaction(async (tx) => {
    if (!cfg) {
      await tx.delete(categoryAttributes).where(and(eq(categoryAttributes.categoryId, categoryId), eq(categoryAttributes.attributeId, attributeId)));
    } else {
      await tx
        .insert(categoryAttributes)
        .values({ categoryId, attributeId, ...cfg })
        .onConflictDoUpdate({ target: [categoryAttributes.categoryId, categoryAttributes.attributeId], set: cfg });
    }
    await audit(tx, actor, { action: 'catalog.category_attribute_set', entityType: 'category', entityId: categoryId, newValues: { attributeId, cfg } });
  });
}

/* ───────── Listing policy (prohibited / restricted) ───────── */

export interface PolicyVerdict {
  blocked: { reasonCode: string; pattern: string }[];
  review: { reasonCode: string; pattern: string }[];
}

export async function evaluateListingPolicy(conn: DbOrTx, text: string, categoryId: string | null): Promise<PolicyVerdict> {
  const normalized = ` ${normalizeSearch(text)} `;
  const rules = await conn.select().from(listingPolicyRules).where(eq(listingPolicyRules.isActive, true));
  const verdict: PolicyVerdict = { blocked: [], review: [] };
  for (const r of rules) {
    const p = normalizeSearch(r.pattern);
    if (p && normalized.includes(` ${p} `)) (r.kind === 'BLOCK_KEYWORD' ? verdict.blocked : verdict.review).push({ reasonCode: r.reasonCode, pattern: r.pattern });
  }
  if (categoryId) {
    const [cat] = await conn.select().from(categories).where(eq(categories.id, categoryId));
    if (cat) {
      const chain = await conn.select().from(categories).where(inArray(categories.id, cat.path));
      if (chain.some((c) => c.isProhibited)) verdict.blocked.push({ reasonCode: 'PROHIBITED_CATEGORY', pattern: cat.nameAr });
      else if (chain.some((c) => c.isRestricted)) verdict.review.push({ reasonCode: 'RESTRICTED_CATEGORY', pattern: cat.nameAr });
    }
  }
  return verdict;
}

export const policyRuleSchema = z.object({
  kind: z.enum(['BLOCK_KEYWORD', 'REVIEW_KEYWORD']),
  pattern: z.string().trim().min(2).max(80),
  reasonCode: z.string().trim().regex(/^[A-Z_]{3,40}$/, 'كود السبب بالأحرف الإنجليزية الكبيرة'),
  description: z.string().trim().max(300).optional().default(''),
});

export async function addPolicyRule(actor: Actor, input: z.input<typeof policyRuleSchema>) {
  requirePermission(actor, 'policy.manage');
  const d = parse(policyRuleSchema, input);
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(listingPolicyRules).values({ ...d, createdBy: actor.userId }).returning();
    await audit(tx, actor, { action: 'policy.rule_added', entityType: 'listing_policy_rule', entityId: row.id, newValues: d });
  });
}

export async function togglePolicyRule(actor: Actor, id: string, isActive: boolean, reason: string) {
  requirePermission(actor, 'policy.manage');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    await tx.update(listingPolicyRules).set({ isActive }).where(eq(listingPolicyRules.id, id));
    await audit(tx, actor, { action: 'policy.rule_toggled', entityType: 'listing_policy_rule', entityId: id, newValues: { isActive }, reason: why });
  });
}

export async function assertCategoryDeletable(conn: DbOrTx, id: string) {
  const [p] = await conn.select({ id: products.id }).from(products).where(eq(products.categoryId, id)).limit(1);
  if (p) throw invalidState('لا يمكن حذف تصنيف مرتبط بمنتجات. قم بإيقافه بدلاً من ذلك');
}
