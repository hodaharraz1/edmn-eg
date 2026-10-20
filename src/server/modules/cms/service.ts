import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, type Actor } from '@/server/core/actor';
import { invalidState, notFound, validation } from '@/server/core/errors';
import { slugify } from '@/server/core/text';
import { db } from '@/server/db/client';
import { cmsBlocks, cmsPages, legalDocuments } from '@/server/db/schema';
import { storeUpload } from '@/server/storage/uploads';

/** CMS links: site-relative paths or https URLs only (no javascript:/data:/protocol-relative). */
const safeHref = (max: number) =>
  z
    .string()
    .max(max)
    .default('')
    .refine((v) => v === '' || (/^\/(?![\/\\])/.test(v) && !/[\u0000-\u001f\\]/.test(v)) || /^https:\/\/[^\s]+$/i.test(v), 'رابط غير مسموح — استخدم مساراً داخلياً يبدأ بـ / أو رابط https');
import { parse, requireReason } from '../_shared';

/**
 * Homepage & marketing content managed by admins. Intentionally a small, typed set of block types
 * (hero, banner, category grid, product rail, featured sellers, deal CTA, trust, footer) —
 * not a general page builder.
 */
export const blockDataSchemas = {
  HERO: z.object({ heading: z.string().max(120), subheading: z.string().max(300).default(''), ctaLabel: z.string().max(40).default(''), ctaHref: safeHref(300), imageKey: z.string().optional() }),
  BANNER: z.object({ heading: z.string().max(120), body: z.string().max(300).default(''), href: safeHref(300), tone: z.enum(['brand', 'accent', 'dark']).default('brand'), imageKey: z.string().optional() }),
  FEATURED_CATEGORIES: z.object({ categorySlugs: z.array(z.string()).max(24).default([]) }),
  PRODUCT_RAIL: z.object({ source: z.enum(['DEALS', 'BEST_SELLERS', 'NEW_ARRIVALS', 'TOP_RATED', 'USED', 'MANUAL']), productSlugs: z.array(z.string()).max(24).default([]), categorySlug: z.string().default(''), limit: z.number().int().min(4).max(24).default(12) }),
  FEATURED_SELLERS: z.object({ storeSlugs: z.array(z.string()).max(12).default([]) }),
  DEAL_CTA: z.object({ heading: z.string().max(120), body: z.string().max(400).default(''), ctaLabel: z.string().max(40).default('ابدأ صفقة محمية') }),
  TRUST: z.object({ items: z.array(z.object({ title: z.string().max(60), body: z.string().max(200) })).max(6).default([]) }),
  FOOTER: z.object({ about: z.string().max(400).default(''), links: z.array(z.object({ label: z.string().max(60), href: safeHref(200) })).max(20).default([]) }),
} as const;
export type BlockType = keyof typeof blockDataSchemas;

export async function activeBlocks(placement = 'HOME') {
  const now = new Date();
  return db
    .select()
    .from(cmsBlocks)
    .where(
      and(
        eq(cmsBlocks.placement, placement),
        eq(cmsBlocks.isActive, true),
        or(isNull(cmsBlocks.startsAt), lte(cmsBlocks.startsAt, now)),
        or(isNull(cmsBlocks.endsAt), gte(cmsBlocks.endsAt, now)),
      ),
    )
    .orderBy(asc(cmsBlocks.sortOrder));
}

export async function saveBlock(
  actor: Actor,
  id: string | null,
  input: { placement: string; type: BlockType; title: string; data: unknown; isActive: boolean; sortOrder: number; startsAt?: Date | null; endsAt?: Date | null },
  image?: { data: Buffer; name: string } | null,
) {
  requirePermission(actor, 'cms.manage');
  const schema = blockDataSchemas[input.type];
  if (!schema) throw validation('نوع غير معروف');
  const data = parse(schema, input.data, 'بيانات المحتوى غير صحيحة') as Record<string, unknown>;
  return db.transaction(async (tx) => {
    if (image) {
      const f = await storeUpload(tx, actor, { purpose: 'CMS_IMAGE', data: image.data, originalName: image.name });
      data.imageKey = f.storageKey;
    } else if (id) {
      const [old] = await tx.select().from(cmsBlocks).where(eq(cmsBlocks.id, id));
      if (old && (old.data as Record<string, unknown>).imageKey && !data.imageKey) data.imageKey = (old.data as Record<string, unknown>).imageKey;
    }
    const values = { placement: input.placement, type: input.type, title: input.title || null, data, isActive: input.isActive, sortOrder: input.sortOrder, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, updatedBy: actor.userId };
    let blockId = id;
    if (id) await tx.update(cmsBlocks).set(values).where(eq(cmsBlocks.id, id));
    else blockId = (await tx.insert(cmsBlocks).values(values).returning({ id: cmsBlocks.id }))[0].id;
    await audit(tx, actor, { action: id ? 'cms.block_updated' : 'cms.block_created', entityType: 'cms_block', entityId: blockId, newValues: { type: input.type, isActive: input.isActive } });
    return blockId!;
  });
}

export async function deleteBlock(actor: Actor, id: string) {
  requirePermission(actor, 'cms.manage');
  await db.transaction(async (tx) => {
    await tx.update(cmsBlocks).set({ isActive: false }).where(eq(cmsBlocks.id, id));
    await audit(tx, actor, { action: 'cms.block_disabled', entityType: 'cms_block', entityId: id });
  });
}

export const pageSchema = z.object({ slug: z.string().trim().min(2).max(80), title: z.string().trim().min(2).max(150), body: z.string().max(50000), isPublished: z.boolean() });

export async function savePage(actor: Actor, id: string | null, input: z.input<typeof pageSchema>) {
  requirePermission(actor, 'cms.manage');
  const d = parse(pageSchema, input);
  const slug = slugify(d.slug);
  await db.transaction(async (tx) => {
    if (id) await tx.update(cmsPages).set({ ...d, slug, updatedBy: actor.userId }).where(eq(cmsPages.id, id));
    else await tx.insert(cmsPages).values({ ...d, slug, updatedBy: actor.userId });
    await audit(tx, actor, { action: 'cms.page_saved', entityType: 'cms_page', entityId: id ?? slug });
  });
}

export async function pageBySlug(slug: string) {
  const [p] = await db.select().from(cmsPages).where(and(eq(cmsPages.slug, slug), eq(cmsPages.isPublished, true)));
  return p ?? null;
}

/* ───────── Legal documents (versioned; drafts until approved by counsel) ───────── */

export const LEGAL_CODES = {
  TERMS_OF_USE: { slug: 'terms', title: 'شروط الاستخدام' },
  PRIVACY_POLICY: { slug: 'privacy', title: 'سياسة الخصوصية' },
  COOKIE_POLICY: { slug: 'cookies', title: 'سياسة ملفات تعريف الارتباط' },
  BUYER_TERMS: { slug: 'buyer-terms', title: 'شروط الشراء من السوق' },
  SELLER_AGREEMENT: { slug: 'seller-agreement', title: 'اتفاقية البائع' },
  RETURNS_POLICY: { slug: 'returns', title: 'سياسة الإرجاع والاسترداد' },
  SHIPPING_POLICY: { slug: 'shipping', title: 'سياسة الشحن' },
  PROHIBITED_PRODUCTS: { slug: 'prohibited-products', title: 'سياسة المنتجات المحظورة' },
  REVIEW_POLICY: { slug: 'review-policy', title: 'سياسة التقييمات' },
  DISPUTE_POLICY: { slug: 'dispute-policy', title: 'سياسة النزاعات' },
  EXTERNAL_DEAL_TERMS: { slug: 'protected-deal-terms', title: 'شروط الصفقات المحمية' },
  FEES_POLICY: { slug: 'fees', title: 'الرسوم والعمولات' },
  DATA_DELETION: { slug: 'data-deletion', title: 'حذف الحساب والبيانات' },
} as const;
export type LegalCode = keyof typeof LEGAL_CODES;

export function legalCodeForSlug(slug: string): LegalCode | null {
  const hit = Object.entries(LEGAL_CODES).find(([, v]) => v.slug === slug);
  return (hit?.[0] as LegalCode) ?? null;
}

export async function currentLegal(code: LegalCode) {
  const [d] = await db.select().from(legalDocuments).where(and(eq(legalDocuments.code, code), eq(legalDocuments.isCurrent, true)));
  return d ?? null;
}

export async function legalVersions(code: LegalCode) {
  return db.select().from(legalDocuments).where(eq(legalDocuments.code, code)).orderBy(desc(legalDocuments.createdAt));
}

export async function saveLegalDraft(actor: Actor, code: LegalCode, version: string, title: string, body: string) {
  requirePermission(actor, 'legal.manage');
  if (!/^[\w.-]{1,30}$/.test(version)) throw validation('رقم الإصدار غير صالح');
  if (body.trim().length < 20) throw validation('النص قصير جداً');
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(legalDocuments).where(and(eq(legalDocuments.code, code), eq(legalDocuments.version, version)));
    if (existing && (existing.status !== 'DRAFT' || existing.isCurrent)) throw invalidState('لا يمكن تعديل إصدار منشور أو معتمد. أنشئ إصداراً جديداً');
    if (existing) await tx.update(legalDocuments).set({ title, body }).where(eq(legalDocuments.id, existing.id));
    else await tx.insert(legalDocuments).values({ code, version, title, body });
    await audit(tx, actor, { action: 'legal.draft_saved', entityType: 'legal_document', entityId: `${code}@${version}` });
  });
}

/**
 * Publish a version as current. `approvedByCounsel` must be explicitly confirmed — the system
 * records who asserted legal approval. Unapproved drafts can still be published as "DRAFT"
 * (shown with a visible draft banner) so the platform is usable before final legal text exists.
 */
export async function publishLegal(actor: Actor, code: LegalCode, version: string, approvedByCounsel: boolean, reason: string) {
  requirePermission(actor, 'legal.manage');
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(legalDocuments).where(and(eq(legalDocuments.code, code), eq(legalDocuments.version, version))).for('update');
    if (!doc) throw notFound('الإصدار');
    await tx.update(legalDocuments).set({ isCurrent: false }).where(eq(legalDocuments.code, code));
    await tx
      .update(legalDocuments)
      .set({ isCurrent: true, status: approvedByCounsel ? 'APPROVED' : 'DRAFT', approvedBy: approvedByCounsel ? actor.userId : null, approvedAt: approvedByCounsel ? new Date() : null })
      .where(eq(legalDocuments.id, doc.id));
    await audit(tx, actor, { action: 'legal.published', entityType: 'legal_document', entityId: `${code}@${version}`, newValues: { approvedByCounsel }, reason: why });
  });
}
