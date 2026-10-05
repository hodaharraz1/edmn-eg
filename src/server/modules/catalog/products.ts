import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { productMachine, type ProductStatus } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireSeller, type Actor } from '@/server/core/actor';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { slugify } from '@/server/core/text';
import { db, type DbOrTx, type Tx } from '@/server/db/client';
import {
  attributes,
  categories,
  files,
  productAttributeValues,
  productImages,
  productModerationEvents,
  productRevisions,
  productVariants,
  products,
  sellers,
} from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { getSetting } from '@/server/modules/settings';
import { requireActiveSeller } from '@/server/modules/sellers/service';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason, transition } from '../_shared';
import { refreshProductReadModel } from './read-model';
import { assertNotSelfDealing } from '@/server/modules/finance/self-dealing';
import { effectiveAttributes, evaluateListingPolicy } from './taxonomy';

export type Product = typeof products.$inferSelect;

/** Listing states in which the seller edits the product directly (not yet approved). */
const DIRECT_EDIT: readonly ProductStatus[] = ['DRAFT', 'REJECTED'];
/** Approved listings: material edits go through a moderated revision. */
const REVISION_EDIT: readonly ProductStatus[] = ['APPROVED', 'LIVE'];

/** Fields whose change could turn a listing into a different product → must be re-moderated. */
export const MATERIAL_FIELDS = [
  'titleAr',
  'titleEn',
  'description',
  'keyFeatures',
  'categoryId',
  'brandId',
  'condition',
  'usedGrade',
  'conditionNotes',
  'defects',
  'includedAccessories',
  'usageInfo',
  'warrantyInfo',
] as const;

async function loadOwned(tx: DbOrTx, actor: Actor, productId: string, lock = true): Promise<Product> {
  const sellerId = requireSeller(actor, 'products.manage');
  const q = tx.select().from(products).where(eq(products.id, productId));
  const [p] = lock ? await q.for('update') : await q;
  if (!p) throw notFound('المنتج');
  if (p.sellerId !== sellerId) throw forbidden();
  return p;
}

async function uniqueSlug(tx: DbOrTx, title: string): Promise<string> {
  return `${slugify(title).slice(0, 60)}-${randomUUID().slice(0, 6)}`;
}

/* ───────── Step 1: create draft with category ───────── */

export async function createDraft(actor: Actor, input: { categoryId: string; titleAr: string; condition: 'NEW' | 'USED' }) {
  const sellerId = requireSeller(actor, 'products.manage');
  const d = parse(
    z.object({ categoryId: z.string().uuid('اختر التصنيف'), titleAr: z.string().trim().min(5, 'اسم المنتج قصير جداً').max(200), condition: z.enum(['NEW', 'USED']) }),
    input,
  );
  return db.transaction(async (tx) => {
    await requireActiveSeller(tx, sellerId);
    const [cat] = await tx.select().from(categories).where(eq(categories.id, d.categoryId));
    if (!cat || !cat.isActive) throw validation('التصنيف غير متاح');
    if (cat.isProhibited) throw validation('هذا التصنيف غير مسموح بالبيع فيه على اضمن');
    const [p] = await tx
      .insert(products)
      .values({ sellerId, categoryId: d.categoryId, titleAr: d.titleAr, condition: d.condition, slug: await uniqueSlug(tx, d.titleAr) })
      .returning();
    await recordTransitionOnly(tx, actor, p.id, null, 'DRAFT');
    await audit(tx, actor, { action: 'product.draft_created', entityType: 'product', entityId: p.id, newValues: d });
    return p;
  });
}

async function recordTransitionOnly(tx: DbOrTx, actor: Actor, id: string, from: ProductStatus | null, to: ProductStatus, reason?: string) {
  const { recordTransition } = await import('@/server/audit/audit');
  await recordTransition(tx, actor, 'product', id, from, to, reason);
}

/* ───────── Steps 2–5, 9–10: details (material) ───────── */

export const detailsSchema = z.object({
  titleAr: z.string().trim().min(5, 'اسم المنتج قصير جداً').max(200),
  titleEn: z.string().trim().max(200).optional().default(''),
  brandId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid(),
  description: z.string().trim().max(10000).optional().default(''),
  keyFeatures: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  condition: z.enum(['NEW', 'USED']),
  usedGrade: z.enum(['LIKE_NEW', 'VERY_GOOD', 'GOOD', 'ACCEPTABLE']).nullable().optional(),
  conditionNotes: z.string().trim().max(2000).optional().default(''),
  defects: z.string().trim().max(2000).optional().default(''),
  includedAccessories: z.string().trim().max(1000).optional().default(''),
  usageInfo: z.string().trim().max(1000).optional().default(''),
  warrantyInfo: z.string().trim().max(1000).optional().default(''),
  attributes: z.record(z.string(), z.array(z.string().trim().max(200))).default({}),
});
export type DetailsInput = z.input<typeof detailsSchema>;

export const logisticsSchema = z.object({
  weightGrams: z.number().int().min(0).max(1_000_000).nullable(),
  lengthCm: z.number().int().min(0).max(1000).nullable(),
  widthCm: z.number().int().min(0).max(1000).nullable(),
  heightCm: z.number().int().min(0).max(1000).nullable(),
  processingDays: z.number().int().min(0).max(30).nullable(),
  returnPolicyOverride: z.boolean(),
  acceptsVoluntaryReturns: z.boolean().nullable(),
  voluntaryReturnDays: z.number().int().min(1).max(365).nullable(),
  seoTitle: z.string().trim().max(120).optional().default(''),
  seoDescription: z.string().trim().max(300).optional().default(''),
});

async function writeAttributes(tx: DbOrTx, productId: string, categoryId: string, attrs: Record<string, string[]>) {
  const schema = await effectiveAttributes(tx, categoryId);
  await tx.delete(productAttributeValues).where(eq(productAttributeValues.productId, productId));
  for (const a of schema) {
    const raw = (attrs[a.attr.code] ?? []).map((v) => v.trim()).filter(Boolean);
    if (!raw.length) continue;
    let values = raw;
    if (a.attr.type === 'NUMBER') {
      if (raw.some((v) => !/^-?\d+(\.\d+)?$/.test(v))) throw validation(`قيمة "${a.attr.nameAr}" يجب أن تكون رقماً`);
      values = [raw[0]];
    } else if (a.attr.type === 'BOOLEAN') {
      values = [raw[0] === 'true' ? 'true' : 'false'];
    } else if (a.attr.type === 'SELECT' || a.attr.type === 'MULTI_SELECT') {
      const allowed = new Set(a.options.map((o) => o.value));
      if (raw.some((v) => !allowed.has(v))) throw validation(`قيمة غير مسموحة للسمة "${a.attr.nameAr}"`);
      values = a.attr.type === 'SELECT' ? [raw[0]] : raw;
    } else {
      values = [raw[0].slice(0, 200)];
    }
    await tx.insert(productAttributeValues).values({ productId, attributeId: a.attr.id, values });
  }
}

/**
 * Update descriptive details. DRAFT/REJECTED → applied directly. APPROVED/LIVE → staged as a
 * moderated revision (the live listing keeps serving the approved version meanwhile).
 */
export async function updateDetails(actor: Actor, productId: string, input: DetailsInput) {
  const d = parse(detailsSchema, input);
  return db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    const [cat] = await tx.select().from(categories).where(eq(categories.id, d.categoryId));
    if (!cat?.isActive || cat.isProhibited) throw validation('التصنيف غير متاح');
    const fields = {
      titleAr: d.titleAr,
      titleEn: d.titleEn || null,
      brandId: d.brandId ?? null,
      categoryId: d.categoryId,
      description: d.description || null,
      keyFeatures: d.keyFeatures,
      condition: d.condition,
      usedGrade: d.condition === 'USED' ? (d.usedGrade ?? null) : null,
      conditionNotes: d.conditionNotes || null,
      defects: d.condition === 'USED' ? d.defects || null : null,
      includedAccessories: d.includedAccessories || null,
      usageInfo: d.condition === 'USED' ? d.usageInfo || null : null,
      warrantyInfo: d.warrantyInfo || null,
    };
    if (DIRECT_EDIT.includes(p.status)) {
      await tx.update(products).set(fields).where(eq(products.id, p.id));
      await writeAttributes(tx, p.id, d.categoryId, d.attributes);
      await refreshProductReadModel(tx, p.id);
      await audit(tx, actor, { action: 'product.details_updated', entityType: 'product', entityId: p.id });
      return { staged: false };
    }
    if (REVISION_EDIT.includes(p.status)) {
      const changed = MATERIAL_FIELDS.filter((f) => JSON.stringify((p as Record<string, unknown>)[f] ?? null) !== JSON.stringify((fields as Record<string, unknown>)[f] ?? null));
      const currentAttrs = await attributeMap(tx, p.id);
      const attrsChanged = JSON.stringify(normalizeAttrMap(currentAttrs)) !== JSON.stringify(normalizeAttrMap(d.attributes));
      if (!changed.length && !attrsChanged) return { staged: false };
      await stageRevision(tx, actor, p, { fields, attributes: d.attributes }, [...changed, ...(attrsChanged ? ['attributes'] : [])]);
      return { staged: true };
    }
    throw invalidState('لا يمكن تعديل المنتج في حالته الحالية');
  });
}

function normalizeAttrMap(m: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v.length).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
}

export async function attributeMap(conn: DbOrTx, productId: string): Promise<Record<string, string[]>> {
  const rows = await conn
    .select({ code: attributes.code, values: productAttributeValues.values })
    .from(productAttributeValues)
    .innerJoin(attributes, eq(attributes.id, productAttributeValues.attributeId))
    .where(eq(productAttributeValues.productId, productId));
  return Object.fromEntries(rows.map((r) => [r.code, r.values]));
}

interface RevisionData {
  fields?: Record<string, unknown>;
  attributes?: Record<string, string[]>;
  images?: { fileId: string; isActualItem: boolean; alt?: string | null }[];
}

async function stageRevision(tx: Tx | DbOrTx, actor: Actor, p: Product, patch: RevisionData, changedFields: string[]) {
  const [open] = await tx.select().from(productRevisions).where(and(eq(productRevisions.productId, p.id), eq(productRevisions.status, 'SUBMITTED'))).for('update');
  if (open) {
    const data = { ...(open.data as RevisionData), ...patch };
    const fieldsSet = new Set([...open.changedFields, ...changedFields]);
    await tx.update(productRevisions).set({ data, changedFields: [...fieldsSet] }).where(eq(productRevisions.id, open.id));
  } else {
    const [rev] = await tx.insert(productRevisions).values({ productId: p.id, data: patch, changedFields, submittedBy: actor.userId }).returning();
    await tx.insert(productModerationEvents).values({ productId: p.id, revisionId: rev.id, action: 'REVISION_SUBMIT', actorUserId: actor.userId });
  }
  await audit(tx, actor, { action: 'product.revision_staged', entityType: 'product', entityId: p.id, newValues: { changedFields } });
}

export async function updateLogistics(actor: Actor, productId: string, input: z.input<typeof logisticsSchema>) {
  const d = parse(logisticsSchema, input);
  if (d.returnPolicyOverride && d.acceptsVoluntaryReturns && !d.voluntaryReturnDays) throw validation('حدد مدة الإرجاع الاختياري');
  await db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    if (p.status === 'ARCHIVED') throw invalidState('المنتج مؤرشف');
    // Logistics & return settings are operational (non-material) and apply immediately.
    await tx
      .update(products)
      .set({ ...d, seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null })
      .where(eq(products.id, p.id));
    await audit(tx, actor, { action: 'product.logistics_updated', entityType: 'product', entityId: p.id });
  });
}

/* ───────── Images ───────── */

export async function addImages(actor: Actor, productId: string, uploads: { data: Buffer; name: string }[], isActualItem: boolean) {
  if (!uploads.length) throw validation('اختر صورة واحدة على الأقل');
  if (uploads.length > 10) throw validation('الحد الأقصى 10 صور في المرة');
  return db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    const stored = [];
    for (const u of uploads) stored.push(await storeUpload(tx, actor, { purpose: 'PRODUCT_IMAGE', data: u.data, originalName: u.name }));
    if (DIRECT_EDIT.includes(p.status)) {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${productImages.sortOrder}), -1)` }).from(productImages).where(eq(productImages.productId, p.id));
      const count = await tx.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, p.id));
      if (count.length + stored.length > 15) throw validation('الحد الأقصى 15 صورة للمنتج');
      await tx.insert(productImages).values(stored.map((s, i) => ({ productId: p.id, fileId: s.id, isActualItem, alt: p.titleAr, sortOrder: Number(max) + 1 + i })));
      await audit(tx, actor, { action: 'product.images_added', entityType: 'product', entityId: p.id, newValues: { count: stored.length, isActualItem } });
      return { staged: false };
    }
    if (REVISION_EDIT.includes(p.status)) {
      const current = await currentImagesForRevision(tx, p.id);
      const images = [...current, ...stored.map((s) => ({ fileId: s.id, isActualItem, alt: p.titleAr }))];
      await stageRevision(tx, actor, p, { images }, ['images']);
      return { staged: true };
    }
    throw invalidState('لا يمكن تعديل صور المنتج في حالته الحالية');
  });
}

async function currentImagesForRevision(tx: DbOrTx, productId: string) {
  const [open] = await tx.select().from(productRevisions).where(and(eq(productRevisions.productId, productId), eq(productRevisions.status, 'SUBMITTED')));
  if (open && (open.data as RevisionData).images) return (open.data as RevisionData).images!;
  const imgs = await tx.select().from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.sortOrder));
  return imgs.map((i) => ({ fileId: i.fileId, isActualItem: i.isActualItem, alt: i.alt }));
}

export async function removeImage(actor: Actor, productId: string, fileId: string) {
  await db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    if (DIRECT_EDIT.includes(p.status)) {
      await tx.delete(productImages).where(and(eq(productImages.productId, p.id), eq(productImages.fileId, fileId)));
    } else if (REVISION_EDIT.includes(p.status)) {
      const images = (await currentImagesForRevision(tx, p.id)).filter((i) => i.fileId !== fileId);
      if (!images.length) throw validation('يجب أن يحتوي المنتج على صورة واحدة على الأقل');
      await stageRevision(tx, actor, p, { images }, ['images']);
    } else throw invalidState('لا يمكن تعديل الصور الآن');
    await audit(tx, actor, { action: 'product.image_removed', entityType: 'product', entityId: p.id, newValues: { fileId } });
  });
}

/* ───────── Variants, price & stock ───────── */

export const variantSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().trim().min(1, 'SKU مطلوب').max(64).regex(/^[A-Za-z0-9._\-]+$/, 'SKU: أحرف إنجليزية وأرقام و - _ . فقط'),
  barcode: z.string().trim().max(32).optional().default(''),
  options: z.record(z.string(), z.string().trim().max(60)).default({}),
  price: z.number().int().positive('السعر يجب أن يكون أكبر من صفر'),
  compareAtPrice: z.number().int().positive().nullable().optional(),
  stockOnHand: z.number().int().min(0).max(1_000_000),
  lowStockThreshold: z.number().int().min(0).max(10_000).default(2),
  isActive: z.boolean().default(true),
});

export async function saveVariants(actor: Actor, productId: string, input: z.input<typeof variantSchema>[]) {
  const list = input.map((v) => parse(variantSchema, v));
  if (!list.length) throw validation('أضف خياراً واحداً على الأقل بالسعر والكمية');
  if (new Set(list.map((v) => v.sku.toLowerCase())).size !== list.length) throw validation('رمز SKU مكرر');
  for (const v of list) if (v.compareAtPrice && v.compareAtPrice <= v.price) throw validation('السعر قبل الخصم يجب أن يكون أكبر من السعر الحالي');
  await db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    if (p.status === 'ARCHIVED' || p.status === 'SUSPENDED') throw invalidState('لا يمكن تعديل المنتج في حالته الحالية');
    const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, p.id)).for('update');
    const structural = DIRECT_EDIT.includes(p.status) || p.status === 'SUBMITTED';
    const keep = new Set<string>();
    for (const [i, v] of list.entries()) {
      const label = Object.values(v.options).filter(Boolean).join(' / ');
      const old = v.id ? existing.find((e) => e.id === v.id) : undefined;
      if (v.id && !old) throw forbidden();
      if (old) {
        if (!structural && JSON.stringify(old.options) !== JSON.stringify(v.options)) {
          throw invalidState('لا يمكن تغيير خيارات منتج معتمد. أضف المنتج كإعلان جديد أو تواصل مع الدعم');
        }
        if (v.stockOnHand < old.reserved) throw validation(`لا يمكن أن تقل كمية ${v.sku} عن ${old.reserved} وحدة محجوزة`);
        await tx
          .update(productVariants)
          .set({ sku: v.sku, barcode: v.barcode || null, options: v.options, label, price: v.price, compareAtPrice: v.compareAtPrice ?? null, stockOnHand: v.stockOnHand, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive, sortOrder: i })
          .where(eq(productVariants.id, old.id));
        if (old.price !== v.price) {
          await audit(tx, actor, { action: 'product.price_changed', entityType: 'product_variant', entityId: old.id, oldValues: { price: old.price }, newValues: { price: v.price } });
        }
        keep.add(old.id);
      } else {
        if (!structural) throw invalidState('لا يمكن إضافة خيارات جديدة لمنتج معتمد. أنشئ إعلاناً جديداً');
        const [row] = await tx
          .insert(productVariants)
          .values({ productId: p.id, sku: v.sku, barcode: v.barcode || null, options: v.options, label, price: v.price, compareAtPrice: v.compareAtPrice ?? null, stockOnHand: v.stockOnHand, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive, sortOrder: i })
          .returning({ id: productVariants.id });
        keep.add(row.id);
      }
    }
    for (const e of existing) {
      if (keep.has(e.id)) continue;
      // Never delete a variant that may be referenced by orders; deactivate instead.
      if (structural) {
        const refs = await tx.execute(sql`select 1 from order_items where variant_id = ${e.id} limit 1`);
        if (refs.rows.length || e.reserved > 0) await tx.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, e.id));
        else {
          await tx.execute(sql`delete from cart_items where variant_id = ${e.id}`);
          await tx.execute(sql`delete from inventory_movements where variant_id = ${e.id}`);
          await tx.delete(productVariants).where(eq(productVariants.id, e.id));
        }
      } else {
        await tx.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, e.id));
      }
    }
    await refreshProductReadModel(tx, p.id);
    await audit(tx, actor, { action: 'product.variants_saved', entityType: 'product', entityId: p.id, newValues: { count: list.length } });
  });
}

/* ───────── Submission & moderation ───────── */

export async function submissionProblems(conn: DbOrTx, p: Product): Promise<string[]> {
  const problems: string[] = [];
  if (!p.categoryId) problems.push('اختر التصنيف');
  if (p.titleAr.trim().length < 5) problems.push('اسم المنتج قصير جداً');
  if (!p.description || p.description.trim().length < 20) problems.push('أضف وصفاً للمنتج لا يقل عن 20 حرفاً');
  const imgs = await conn.select().from(productImages).where(eq(productImages.productId, p.id));
  const minImages = await getSetting('products.minImages', conn);
  if (imgs.length < minImages) problems.push(`أضف ${minImages} صورة على الأقل`);
  if (p.condition === 'USED') {
    if (!p.usedGrade) problems.push('حدد درجة حالة المنتج المستعمل');
    if (!p.conditionNotes) problems.push('اكتب وصفاً لحالة المنتج المستعمل');
    if (!p.defects) problems.push('اذكر العيوب الموجودة (أو اكتب "لا يوجد")');
    const minActual = await getSetting('products.minActualImagesForUsed', conn);
    if (imgs.filter((i) => i.isActualItem).length < minActual) problems.push(`المنتج المستعمل يتطلب ${minActual} صور فعلية على الأقل للقطعة نفسها`);
  }
  const variants = await conn.select().from(productVariants).where(and(eq(productVariants.productId, p.id), eq(productVariants.isActive, true)));
  if (!variants.length) problems.push('أضف السعر والكمية');
  if (p.categoryId) {
    const schema = await effectiveAttributes(conn, p.categoryId);
    const values = await attributeMap(conn, p.id);
    for (const a of schema) {
      if (a.ca.isRequired && !a.ca.isVariantAxis && !(values[a.attr.code] ?? []).length) problems.push(`السمة "${a.attr.nameAr}" مطلوبة`);
    }
  }
  return problems;
}

export async function submitForReview(actor: Actor, productId: string) {
  return db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    await requireActiveSeller(tx, p.sellerId);
    if (!DIRECT_EDIT.includes(p.status)) throw invalidState('المنتج ليس في حالة تسمح بالإرسال للمراجعة');
    const problems = await submissionProblems(tx, p);
    if (problems.length) throw validation(problems.join('، '));
    const verdict = await evaluateListingPolicy(tx, `${p.titleAr} ${p.titleEn ?? ''} ${p.description ?? ''} ${(p.keyFeatures ?? []).join(' ')}`, p.categoryId);
    if (verdict.blocked.length) {
      await audit(tx, actor, { action: 'product.submission_blocked', entityType: 'product', entityId: p.id, newValues: { verdict } });
      throw validation(`هذا المنتج مخالف لسياسة المنتجات المحظورة (${verdict.blocked.map((b) => b.reasonCode).join(', ')})`);
    }
    const enhanced = verdict.review.length > 0;
    const requireModeration = await getSetting('products.requireModeration', tx);
    const autoPublish = !requireModeration && !enhanced;
    const to: ProductStatus = autoPublish ? 'LIVE' : 'SUBMITTED';
    await transition(tx, actor, productMachine, p.id, p.status, to);
    await tx
      .update(products)
      .set({ status: to, statusReason: null, submittedAt: new Date(), needsEnhancedReview: enhanced, ...(autoPublish ? { publishedAt: new Date(), approvedAt: new Date() } : {}) })
      .where(eq(products.id, p.id));
    await tx.insert(productModerationEvents).values({ productId: p.id, action: 'SUBMIT', actorUserId: actor.userId, reason: enhanced ? `مراجعة معززة: ${verdict.review.map((r) => r.reasonCode).join(', ')}` : null });
    await audit(tx, actor, { action: 'product.submitted', entityType: 'product', entityId: p.id, newValues: { status: to, enhanced } });
    const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, p.sellerId));
    await notify(tx, { event: autoPublish ? 'PRODUCT_APPROVED' : 'PRODUCT_SUBMITTED', userIds: [s.ownerUserId], vars: { product: p.titleAr }, link: `/seller/products/${p.id}` });
    return to;
  });
}

export async function withdrawSubmission(actor: Actor, productId: string) {
  await db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    if (p.status !== 'SUBMITTED') throw invalidState('لا يمكن سحب المنتج من المراجعة الآن');
    await transition(tx, actor, productMachine, p.id, p.status, 'DRAFT');
    await tx.update(products).set({ status: 'DRAFT' }).where(eq(products.id, p.id));
  });
}

export type ModerationDecision = 'START_REVIEW' | 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'SUSPEND' | 'REINSTATE';

export async function moderateProduct(actor: Actor, productId: string, decision: ModerationDecision, reason?: string | null, reasonCode?: string | null) {
  requirePermission(actor, 'products.moderate');
  const needsReason = decision === 'REJECT' || decision === 'REQUEST_CHANGES' || decision === 'SUSPEND' || decision === 'REINSTATE';
  const why = needsReason ? requireReason(reason) : (reason?.trim() || null);
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, productId)).for('update');
    if (!p) throw notFound('المنتج');
    await assertNotSelfDealing(tx, actor, p.sellerId);
    const to: ProductStatus =
      decision === 'START_REVIEW' ? 'UNDER_REVIEW' : decision === 'APPROVE' ? 'LIVE' : decision === 'SUSPEND' ? 'SUSPENDED' : decision === 'REINSTATE' ? 'APPROVED' : 'REJECTED';
    await transition(tx, actor, productMachine, p.id, p.status, to, why);
    const sets: Partial<Product> = { status: to, statusReason: why };
    if (decision === 'APPROVE') {
      sets.approvedAt = new Date();
      sets.approvedBy = actor.userId;
      sets.publishedAt = p.publishedAt ?? new Date();
      sets.needsEnhancedReview = false;
    }
    await tx.update(products).set(sets).where(eq(products.id, p.id));
    await tx.insert(productModerationEvents).values({
      productId: p.id,
      action: decision === 'REINSTATE' ? 'REINSTATE' : decision,
      reasonCode: reasonCode ?? (decision === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : null),
      reason: why,
      actorUserId: actor.userId,
    });
    await audit(tx, actor, { action: `product.${decision.toLowerCase()}`, entityType: 'product', entityId: p.id, oldValues: { status: p.status }, newValues: { status: to }, reason: why });
    const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, p.sellerId));
    if (decision !== 'START_REVIEW') {
      const event = decision === 'APPROVE' || decision === 'REINSTATE' ? 'PRODUCT_APPROVED' : decision === 'SUSPEND' ? 'PRODUCT_SUSPENDED' : 'PRODUCT_REJECTED';
      await notify(tx, { event, userIds: [s.ownerUserId], vars: { product: p.titleAr, reason: why }, link: `/seller/products/${p.id}` });
    }
    return to;
  });
}

/** Apply or reject a staged revision of an approved listing. */
export async function moderateRevision(actor: Actor, revisionId: string, approve: boolean, reason?: string | null) {
  requirePermission(actor, 'products.moderate');
  const why = approve ? (reason?.trim() || null) : requireReason(reason);
  await db.transaction(async (tx) => {
    const [rev] = await tx.select().from(productRevisions).where(eq(productRevisions.id, revisionId)).for('update');
    if (!rev) throw notFound('التعديل');
    if (rev.status !== 'SUBMITTED') throw invalidState('تمت مراجعة هذا التعديل بالفعل');
    const [p] = await tx.select().from(products).where(eq(products.id, rev.productId)).for('update');
    if (approve) {
      const data = rev.data as RevisionData;
      if (data.fields) await tx.update(products).set(data.fields as Partial<Product>).where(eq(products.id, p.id));
      const catId = (data.fields?.categoryId as string | undefined) ?? p.categoryId;
      if (data.attributes && catId) await writeAttributes(tx, p.id, catId, data.attributes);
      if (data.images) {
        await tx.delete(productImages).where(eq(productImages.productId, p.id));
        if (data.images.length) {
          const valid = await tx.select({ id: files.id }).from(files).where(inArray(files.id, data.images.map((i) => i.fileId)));
          const ok = new Set(valid.map((v) => v.id));
          await tx.insert(productImages).values(
            data.images.filter((i) => ok.has(i.fileId)).map((i, idx) => ({ productId: p.id, fileId: i.fileId, isActualItem: i.isActualItem, alt: i.alt ?? p.titleAr, sortOrder: idx })),
          );
        }
      }
      // Re-check used-product requirements after applying.
      const [updated] = await tx.select().from(products).where(eq(products.id, p.id));
      const problems = await submissionProblems(tx, updated);
      if (problems.length) throw validation(`لا يمكن اعتماد التعديل: ${problems.join('، ')}`);
      await refreshProductReadModel(tx, p.id);
    }
    await tx.update(productRevisions).set({ status: approve ? 'APPROVED' : 'REJECTED', reason: why, reviewedBy: actor.userId, reviewedAt: new Date() }).where(eq(productRevisions.id, rev.id));
    await tx.insert(productModerationEvents).values({ productId: p.id, revisionId: rev.id, action: approve ? 'REVISION_APPROVE' : 'REVISION_REJECT', reason: why, actorUserId: actor.userId });
    await audit(tx, actor, { action: approve ? 'product.revision_approved' : 'product.revision_rejected', entityType: 'product', entityId: p.id, newValues: { revisionId, changedFields: rev.changedFields }, reason: why });
    const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, p.sellerId));
    await notify(tx, { event: approve ? 'PRODUCT_APPROVED' : 'PRODUCT_REJECTED', userIds: [s.ownerUserId], vars: { product: p.titleAr, reason: why }, link: `/seller/products/${p.id}` });
  });
}

/* ───────── Seller listing controls ───────── */

export async function setListingActive(actor: Actor, productId: string, active: boolean) {
  await db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    const to: ProductStatus = active ? 'LIVE' : 'APPROVED';
    if (p.status === to) return;
    // Sellers can only toggle an already-approved listing between live and paused. A SUSPENDED,
    // REJECTED or not-yet-moderated listing can only be changed by staff moderation.
    if (p.status !== 'APPROVED' && p.status !== 'LIVE') throw invalidState('لا يمكن تفعيل أو إيقاف هذا المنتج في حالته الحالية');
    if (active) await requireActiveSeller(tx, p.sellerId);
    await transition(tx, actor, productMachine, p.id, p.status, to);
    await tx.update(products).set({ status: to, ...(active && !p.publishedAt ? { publishedAt: new Date() } : {}) }).where(eq(products.id, p.id));
    await audit(tx, actor, { action: active ? 'product.activated' : 'product.deactivated', entityType: 'product', entityId: p.id });
  });
}

/** Soft archive: the product disappears from the catalogue, historical order items are untouched. */
export async function archiveProduct(actor: Actor, productId: string) {
  await db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    if (p.status === 'SUBMITTED' || p.status === 'UNDER_REVIEW') throw invalidState('اسحب المنتج من المراجعة أولاً');
    const [{ reserved }] = await tx.select({ reserved: sql<number>`coalesce(sum(${productVariants.reserved}),0)` }).from(productVariants).where(eq(productVariants.productId, p.id));
    if (Number(reserved) > 0) throw invalidState('يوجد طلبات غير مدفوعة تحجز كميات من هذا المنتج');
    await transition(tx, actor, productMachine, p.id, p.status, 'ARCHIVED');
    await tx.update(products).set({ status: 'ARCHIVED', archivedAt: new Date() }).where(eq(products.id, p.id));
    await audit(tx, actor, { action: 'product.archived', entityType: 'product', entityId: p.id });
  });
}

export async function markOutOfStock(actor: Actor, productId: string) {
  await db.transaction(async (tx) => {
    const p = await loadOwned(tx, actor, productId);
    const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, p.id)).for('update');
    for (const v of variants) await tx.update(productVariants).set({ stockOnHand: v.reserved }).where(eq(productVariants.id, v.id));
    await refreshProductReadModel(tx, p.id);
    await audit(tx, actor, { action: 'product.marked_out_of_stock', entityType: 'product', entityId: p.id });
  });
}

/** Admin: suspend all live listings of a seller (used when the seller account is suspended). */
export async function sellerListingsVisible(conn: DbOrTx, sellerId: string) {
  const [s] = await conn.select({ status: sellers.status }).from(sellers).where(eq(sellers.id, sellerId));
  return s?.status === 'APPROVED' || s?.status === 'RESTRICTED';
}

export async function productForSellerEdit(actor: Actor, productId: string) {
  const p = await loadOwned(db, actor, productId, false);
  const [variants, images, attrs, revision, events] = await Promise.all([
    db.select().from(productVariants).where(eq(productVariants.productId, p.id)).orderBy(asc(productVariants.sortOrder)),
    db
      .select({ img: productImages, key: files.storageKey })
      .from(productImages)
      .innerJoin(files, eq(files.id, productImages.fileId))
      .where(eq(productImages.productId, p.id))
      .orderBy(asc(productImages.sortOrder)),
    attributeMap(db, p.id),
    db.select().from(productRevisions).where(and(eq(productRevisions.productId, p.id), eq(productRevisions.status, 'SUBMITTED'))),
    db.select().from(productModerationEvents).where(eq(productModerationEvents.productId, p.id)).orderBy(sql`${productModerationEvents.createdAt} desc`).limit(20),
  ]);
  return { product: p, variants, images, attributes: attrs, openRevision: revision[0] ?? null, events };
}

