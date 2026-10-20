import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import {
  categories,
  pricingCategoryClasses,
  pricingTiers,
  pricingVersions,
  riskFlags,
  type EconomicClass,
  type PricingAssumptions,
  type PricingModel,
} from '@/server/db/schema';
import {
  computeFee,
  computeMarketplaceFee,
  effectiveBps,
  OWNER_APPROVED_DEAL_MIN_FEE,
  OWNER_APPROVED_DEAL_TIERS,
  OWNER_APPROVED_MARKETPLACE_MIN_FEE,
  OWNER_APPROVED_MARKETPLACE_TIERS,
  SAMPLE_AMOUNTS_EGP,
  type MarketFeeResult,
  type TierInput,
} from './engine';
import { batchSimulate, DEFAULT_ASSUMPTIONS, expectedMargin, MARKETPLACE_CLASSES, simulate, validateVersionConfig, type SimulationInput, type VersionConfig } from './validation';

export type PricingVersion = typeof pricingVersions.$inferSelect;

export interface LoadedVersion extends VersionConfig {
  id: string;
  versionNo: number;
  name: string;
  status: string;
  effectiveFrom: Date | null;
  notes: string | null;
  /** categoryId → class (marketplace only). */
  categoryClasses: Record<string, EconomicClass>;
}

/* ═══════════════ Loading (published versions are immutable → cached by id) ═══════════════ */

const cache = new Map<string, LoadedVersion>();

export async function loadVersion(conn: DbOrTx, versionId: string): Promise<LoadedVersion> {
  const hit = cache.get(versionId);
  if (hit) return hit;
  const [v] = await conn.select().from(pricingVersions).where(eq(pricingVersions.id, versionId));
  if (!v) throw notFound('إصدار التسعير');
  const tiers = await conn.select().from(pricingTiers).where(eq(pricingTiers.versionId, v.id)).orderBy(asc(pricingTiers.economicClass), asc(pricingTiers.seq));
  const maps = v.model === 'MARKETPLACE' ? await conn.select().from(pricingCategoryClasses).where(eq(pricingCategoryClasses.versionId, v.id)) : [];
  const tiersByClass: Record<string, TierInput[]> = {};
  for (const t of tiers) (tiersByClass[t.economicClass] ??= []).push({ lowerBound: t.lowerBound, upperBound: t.upperBound, buyerBps: t.buyerBps, sellerBps: t.sellerBps, totalBps: t.totalBps });
  const loaded: LoadedVersion = {
    id: v.id,
    versionNo: v.versionNo,
    name: v.name,
    status: v.status,
    effectiveFrom: v.effectiveFrom,
    notes: v.notes,
    model: v.model,
    currency: v.currency,
    minFee: v.minFee,
    targetMarginBps: v.targetMarginBps,
    assumptions: v.assumptions,
    tiersByClass,
    categoryClasses: Object.fromEntries(maps.map((m) => [m.categoryId, m.economicClass])),
  };
  // Only immutable (published) versions are cached: cache invalidation is by version identity.
  if (v.status === 'PUBLISHED') cache.set(v.id, loaded);
  return loaded;
}

/** The version in force now (DB clock): latest PUBLISHED with effective_from <= now(). */
export async function activeVersionId(conn: DbOrTx, model: PricingModel): Promise<string | null> {
  const r = await conn.execute<{ id: string }>(sql`select id from pricing_versions
    where model = ${model} and status = 'PUBLISHED' and effective_from <= now() order by effective_from desc limit 1`);
  return r.rows[0]?.id ?? null;
}

const PRICING_UNAVAILABLE = 'الشراء متوقف مؤقتًا: لا يوجد إصدار رسوم ساري. فريق اضمن يعمل على إصلاح ذلك — حاول لاحقًا.';

/** Fail closed when no valid pricing version exists (with a de-duplicated Operations alert). */
export async function requireActiveVersion(conn: DbOrTx, model: PricingModel): Promise<LoadedVersion> {
  const id = await activeVersionId(conn, model);
  if (!id) {
    await opsAlert('PRICING_VERSION_MISSING', model, `لا يوجد إصدار تسعير منشور وساري للنموذج ${model}`);
    throw new DomainError('INVALID_STATE', PRICING_UNAVAILABLE);
  }
  return loadVersion(conn, id);
}

async function opsAlert(code: string, entityId: string, note: string) {
  try {
    const open = await db.select({ id: riskFlags.id }).from(riskFlags).where(and(eq(riskFlags.code, code), eq(riskFlags.entityId, entityId), eq(riskFlags.status, 'OPEN'))).limit(1);
    if (!open.length) await db.insert(riskFlags).values({ entityType: 'pricing', entityId, code, severity: 'HIGH', note });
    console.error(`[pricing] ${code}: ${note}`);
  } catch {
    /* alerting must never mask the fail-closed error */
  }
}

/** Serialize financial commitments against a publication (shared) / publication itself (exclusive). */
export async function lockPricingShared(tx: DbOrTx, model: PricingModel) {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext(${'pricing:' + model}))`);
}
async function lockPricingExclusive(tx: DbOrTx, model: PricingModel) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'pricing:' + model}))`);
}

/* ═══════════════ Quotes ═══════════════ */

/** Economic class of each category: nearest mapped ancestor (incl. itself). Unmapped → null (fail closed). */
export async function classesFor(conn: DbOrTx, v: LoadedVersion, categoryIds: (string | null)[]): Promise<Record<string, EconomicClass | null>> {
  const ids = [...new Set(categoryIds.filter((x): x is string => !!x))];
  const out: Record<string, EconomicClass | null> = {};
  if (!ids.length) return out;
  const rows = await conn.select({ id: categories.id, path: categories.path }).from(categories).where(inArray(categories.id, ids));
  for (const id of ids) {
    const path = rows.find((r) => r.id === id)?.path ?? [id];
    let cls: EconomicClass | null = null;
    for (const c of [...path].reverse()) {
      if (v.categoryClasses[c]) {
        cls = v.categoryClasses[c];
        break;
      }
    }
    out[id] = cls;
  }
  return out;
}

export interface MarketQuoteLine {
  key: string;
  categoryId: string | null;
  lineTotal: number;
}

export interface MarketQuote {
  version: LoadedVersion;
  result: MarketFeeResult;
  lineClasses: Record<string, EconomicClass>;
}

/** Quote one seller sub-order. Throws (fail closed) when a line's category has no pricing class. */
export async function quoteMarketplace(conn: DbOrTx, v: LoadedVersion, lines: MarketQuoteLine[]): Promise<MarketQuote> {
  const classes = await classesFor(conn, v, lines.map((l) => l.categoryId));
  const lineClasses: Record<string, EconomicClass> = {};
  for (const l of lines) {
    const c = l.categoryId ? classes[l.categoryId] : null;
    if (!c) {
      await opsAlert('PRICING_CATEGORY_UNMAPPED', l.categoryId ?? 'none', `فئة بدون تصنيف تسعير في الإصدار ${v.versionNo}`);
      throw new DomainError('INVALID_STATE', 'الشراء من هذا التصنيف متوقف مؤقتًا لحين ضبط الرسوم من الإدارة.');
    }
    lineClasses[l.key] = c;
  }
  const result = computeMarketplaceFee(lines.map((l) => ({ key: l.key, lineTotal: l.lineTotal, economicClass: lineClasses[l.key] })), v.tiersByClass, v.minFee);
  return { version: v, result, lineClasses };
}

export function marketplaceSnapshot(q: MarketQuote, extra: { shipping: number; categoryByLine: Record<string, string | null>; refundPolicyVersion: string | null }) {
  const v = q.version;
  return {
    snapshotVersion: 1,
    model: 'MARKETPLACE' as const,
    pricingVersionId: v.id,
    pricingVersionNo: v.versionNo,
    pricingVersionName: v.name,
    effectiveFrom: v.effectiveFrom?.toISOString() ?? null,
    currency: v.currency,
    feeUnit: 'SELLER_SUB_ORDER',
    lineMethod: 'CLASS_GROUP_PROGRESSIVE_THEN_ALLOCATE_BY_LINE_VALUE',
    feeBase: q.result.base,
    shippingExcludedFromBase: true,
    shipping: extra.shipping,
    minimumFee: v.minFee,
    minimumApplied: q.result.minApplied,
    minimumAllocation: 'PROPORTIONAL',
    rounding: 'TOTAL_HALF_UP__BUYER_HALF_UP__SELLER_REMAINDER',
    groups: q.result.groups.map((g) => ({ ...g, tiers: v.tiersByClass[g.economicClass] })),
    lines: q.result.lines.map((l) => ({ ...l, categoryId: extra.categoryByLine[l.key] ?? null })),
    buyerFee: q.result.buyer,
    sellerFee: q.result.seller,
    totalFee: q.result.total,
    assumptions: v.assumptions,
    payoutCostPolicy: 'SELLER_PAYS_CONFIGURED_CHANNEL_COST',
    refundPolicyVersion: extra.refundPolicyVersion,
    computedAt: new Date().toISOString(),
  };
}

/** Protected-deal fee on the agreed deal value (shipping excluded). */
export function quoteDeal(v: LoadedVersion, dealValue: number) {
  const r = computeFee(dealValue, v.tiersByClass.DEAL, v.minFee);
  return {
    result: r,
    snapshot: {
      snapshotVersion: 1,
      model: 'PROTECTED_DEAL' as const,
      pricingVersionId: v.id,
      pricingVersionNo: v.versionNo,
      pricingVersionName: v.name,
      effectiveFrom: v.effectiveFrom?.toISOString() ?? null,
      currency: v.currency,
      feeBase: dealValue,
      shippingExcludedFromBase: true,
      tiers: v.tiersByClass.DEAL,
      components: r.components,
      exactTotal: r.exactTotal,
      exactBuyer: r.exactBuyer,
      minimumFee: v.minFee,
      minimumApplied: r.minApplied,
      rounding: 'TOTAL_HALF_UP__BUYER_HALF_UP__SELLER_REMAINDER',
      buyerFee: r.buyer,
      sellerFee: r.seller,
      totalFee: r.total,
      assumptions: v.assumptions,
      computedAt: new Date().toISOString(),
    },
  };
}

export { effectiveBps };

/* ═══════════════ Admin workflow: DRAFT → VALIDATED → APPROVED → PUBLISHED (scheduled/active) ═══════════════ */

export interface DraftInput {
  name?: string;
  minFee?: number;
  targetMarginBps?: number;
  assumptions?: Partial<PricingAssumptions>;
  notes?: string | null;
  tiers?: { economicClass: string; lowerBound: number; upperBound: number | null; buyerBps: number; sellerBps: number; totalBps: number }[];
  categoryClasses?: { categoryId: string; economicClass: EconomicClass }[];
}

async function lockVersion(tx: DbOrTx, id: string) {
  const [v] = await tx.select().from(pricingVersions).where(eq(pricingVersions.id, id)).for('update');
  if (!v) throw notFound('إصدار التسعير');
  return v;
}

function configHash(v: Pick<LoadedVersion, 'minFee' | 'targetMarginBps' | 'assumptions' | 'tiersByClass' | 'categoryClasses'>) {
  const canonical = JSON.stringify({
    minFee: v.minFee,
    target: v.targetMarginBps,
    assumptions: Object.fromEntries(Object.entries(v.assumptions).sort()),
    tiers: Object.keys(v.tiersByClass).sort().map((k) => [k, v.tiersByClass[k]]),
    classes: Object.keys(v.categoryClasses).sort().map((k) => [k, v.categoryClasses[k]]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

async function nextVersionNo(tx: DbOrTx, model: PricingModel) {
  const r = await tx.execute<{ n: number }>(sql`select coalesce(max(version_no), 0) + 1 as n from pricing_versions where model = ${model}`);
  return Number(r.rows[0].n);
}

/** New DRAFT, empty or cloned from an existing version (its tiers, classes, assumptions). */
export async function createDraft(actor: Actor, model: PricingModel, fromVersionId?: string | null, name?: string) {
  requirePermission(actor, 'pricing.draft');
  return db.transaction(async (tx) => {
    await lockPricingExclusive(tx, model);
    const src = fromVersionId ? await loadVersion(tx, fromVersionId) : null;
    if (src && src.model !== model) throw validation('لا يمكن نسخ إصدار من نموذج مختلف');
    const no = await nextVersionNo(tx, model);
    const [v] = await tx
      .insert(pricingVersions)
      .values({
        model,
        versionNo: no,
        name: name?.trim() || (src ? `نسخة من الإصدار ${src.versionNo}` : `إصدار ${no}`),
        minFee: src?.minFee ?? (model === 'MARKETPLACE' ? OWNER_APPROVED_MARKETPLACE_MIN_FEE : OWNER_APPROVED_DEAL_MIN_FEE),
        targetMarginBps: src?.targetMarginBps ?? 5000,
        assumptions: src?.assumptions ?? DEFAULT_ASSUMPTIONS,
        clonedFromId: src?.id ?? null,
        createdBy: actor.userId,
      })
      .returning();
    if (src) {
      const rows = Object.entries(src.tiersByClass).flatMap(([c, ts]) => ts.map((t, i) => ({ versionId: v.id, economicClass: c, seq: i + 1, ...t })));
      if (rows.length) await tx.insert(pricingTiers).values(rows);
      const maps = Object.entries(src.categoryClasses).map(([categoryId, economicClass]) => ({ versionId: v.id, categoryId, economicClass }));
      if (maps.length) await tx.insert(pricingCategoryClasses).values(maps);
    }
    await audit(tx, actor, { action: 'pricing.draft_created', entityType: 'pricing_version', entityId: v.id, newValues: { model, versionNo: no, clonedFrom: src?.id ?? null } });
    return v;
  });
}

/** Edit a DRAFT (DB triggers refuse edits to any non-draft version). Audited with before/after. */
export async function updateDraft(actor: Actor, id: string, input: DraftInput, reason?: string) {
  requirePermission(actor, 'pricing.draft');
  return db.transaction(async (tx) => {
    const v = await lockVersion(tx, id);
    if (v.status !== 'DRAFT') throw invalidState('الإصدار ده مش مسودة. الإصدارات المعتمدة/المنشورة لا تُعدل — اعمل إصدار جديد');
    const before = await loadVersion(tx, id);
    const sets: Partial<PricingVersion> = {};
    if (input.name !== undefined) sets.name = input.name.trim().slice(0, 120) || v.name;
    if (input.minFee !== undefined) {
      if (!Number.isSafeInteger(input.minFee) || input.minFee < 0) throw validation('الحد الأدنى غير صالح');
      sets.minFee = input.minFee;
    }
    if (input.targetMarginBps !== undefined) {
      if (!Number.isInteger(input.targetMarginBps) || input.targetMarginBps < 0 || input.targetMarginBps > 10000) throw validation('الهامش المستهدف غير صالح');
      sets.targetMarginBps = input.targetMarginBps;
    }
    if (input.assumptions) {
      const merged = { ...v.assumptions, ...input.assumptions };
      for (const [k, val] of Object.entries(merged)) if (!Number.isInteger(val) || (val as number) < 0) throw validation(`افتراض غير صالح: ${k}`);
      sets.assumptions = merged as PricingAssumptions;
    }
    if (input.notes !== undefined) sets.notes = input.notes;
    if (Object.keys(sets).length) await tx.update(pricingVersions).set(sets).where(eq(pricingVersions.id, id));
    if (input.tiers) {
      for (const t of input.tiers) {
        for (const n of [t.lowerBound, t.buyerBps, t.sellerBps, t.totalBps]) if (!Number.isSafeInteger(n) || n < 0) throw validation('قيم الشرائح لازم تكون أرقام موجبة صحيحة');
        if (t.upperBound !== null && !Number.isSafeInteger(t.upperBound)) throw validation('حد أعلى غير صالح');
        if (t.buyerBps + t.sellerBps !== t.totalBps) throw validation('نسبة المشتري + نسبة البائع لازم تساوي الإجمالي');
      }
      await tx.delete(pricingTiers).where(eq(pricingTiers.versionId, id));
      const byClass = new Map<string, typeof input.tiers>();
      for (const t of input.tiers) byClass.set(t.economicClass, [...(byClass.get(t.economicClass) ?? []), t]);
      const rows = [...byClass.entries()].flatMap(([c, ts]) =>
        [...ts].sort((a, b) => a.lowerBound - b.lowerBound).map((t, i) => ({ versionId: id, economicClass: c, seq: i + 1, lowerBound: t.lowerBound, upperBound: t.upperBound, buyerBps: t.buyerBps, sellerBps: t.sellerBps, totalBps: t.totalBps })),
      );
      try {
        if (rows.length) await tx.insert(pricingTiers).values(rows);
      } catch {
        throw validation('الشرائح غير صالحة (تحقق من الحدود والنسب)');
      }
    }
    if (input.categoryClasses) {
      if (v.model !== 'MARKETPLACE') throw validation('تصنيف الفئات للسوق فقط');
      await tx.delete(pricingCategoryClasses).where(eq(pricingCategoryClasses.versionId, id));
      const seen = new Set<string>();
      const rows = input.categoryClasses.filter((m) => !seen.has(m.categoryId) && seen.add(m.categoryId)).map((m) => ({ versionId: id, categoryId: m.categoryId, economicClass: m.economicClass }));
      if (rows.length) await tx.insert(pricingCategoryClasses).values(rows);
    }
    const after = await loadVersion(tx, id);
    await audit(tx, actor, {
      action: 'pricing.draft_updated',
      entityType: 'pricing_version',
      entityId: id,
      oldValues: snapshotForAudit(before),
      newValues: snapshotForAudit(after),
      reason: reason ?? null,
    });
    if (input.categoryClasses) {
      await audit(tx, actor, { action: 'pricing.category_classes_changed', entityType: 'pricing_version', entityId: id, oldValues: { classes: before.categoryClasses }, newValues: { classes: after.categoryClasses }, reason: reason ?? null });
    }
    return after;
  });
}

function snapshotForAudit(v: LoadedVersion): Record<string, unknown> {
  return { name: v.name, minFee: v.minFee, targetMarginBps: v.targetMarginBps, assumptions: v.assumptions, tiers: v.tiersByClass, categoryClasses: v.categoryClasses };
}

/** Full validation for one version (including category coverage for marketplace). */
export async function validateVersion(conn: DbOrTx, v: LoadedVersion): Promise<string[]> {
  const errs = validateVersionConfig(v);
  if (v.model === 'MARKETPLACE') {
    const roots = await conn.select({ id: categories.id, name: categories.nameAr }).from(categories).where(and(isNull(categories.parentId), eq(categories.isActive, true)));
    const missing = roots.filter((r) => !v.categoryClasses[r.id]);
    if (missing.length) errs.push(`تصنيفات رئيسية بدون فئة تسعير: ${missing.map((m) => m.name).join('، ')}`);
    for (const c of Object.values(v.categoryClasses)) if (!(MARKETPLACE_CLASSES as readonly string[]).includes(c)) errs.push(`فئة تسعير غير صالحة: ${c}`);
  }
  return errs;
}

/** Maker submits: server-side validation + governance simulation → VALIDATED. */
export async function submitVersion(actor: Actor, id: string, note?: string) {
  requirePermission(actor, 'pricing.submit');
  return db.transaction(async (tx) => {
    const v = await lockVersion(tx, id);
    if (v.status !== 'DRAFT') throw invalidState('يمكن إرسال المسودات فقط');
    const loaded = await loadVersion(tx, id);
    const errs = await validateVersion(tx, loaded);
    if (errs.length) throw new DomainError('VALIDATION', `لا يمكن الإرسال: ${errs.slice(0, 8).join(' — ')}`);
    let margin: ReturnType<typeof expectedMargin>;
    try {
      margin = expectedMargin(loaded);
    } catch {
      throw validation('تعذر تشغيل محاكاة الربحية لهذا الإصدار');
    }
    await tx
      .update(pricingVersions)
      .set({ status: 'VALIDATED', validatedBy: actor.userId, validatedAt: new Date(), expectedMarginBps: margin.expectedMarginBps, configHash: configHash(loaded) })
      .where(eq(pricingVersions.id, id));
    await audit(tx, actor, { action: 'pricing.submitted', entityType: 'pricing_version', entityId: id, newValues: { status: 'VALIDATED', expectedMarginBps: margin.expectedMarginBps, belowTarget: margin.belowTarget }, reason: note ?? null });
    return { expectedMarginBps: margin.expectedMarginBps, belowTarget: margin.belowTarget };
  });
}

/** Back to DRAFT (clears submission/approval). */
export async function reopenDraft(actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'pricing.draft');
  if (!reason?.trim()) throw validation('يجب ذكر السبب');
  await db.transaction(async (tx) => {
    const v = await lockVersion(tx, id);
    if (v.status !== 'VALIDATED' && v.status !== 'APPROVED') throw invalidState('يمكن إعادة الفتح للإصدارات المرسلة/المعتمدة غير المنشورة فقط');
    await tx
      .update(pricingVersions)
      .set({ status: 'DRAFT', validatedBy: null, validatedAt: null, approvedBy: null, approvedAt: null, approvalReason: null, marginOverride: false, marginOverrideBy: null, marginOverrideReason: null, configHash: null })
      .where(eq(pricingVersions.id, id));
    await audit(tx, actor, { action: 'pricing.reopened', entityType: 'pricing_version', entityId: id, oldValues: { status: v.status }, newValues: { status: 'DRAFT' }, reason });
  });
}

/**
 * Checker approves: different person from the maker, fresh 2FA, reason; re-validates; margin guard
 * (below target → refused unless an authorized override with its own reason, audited).
 */
export async function approveVersion(actor: Actor, id: string, input: { reason: string; overrideMarginGuard?: boolean; overrideReason?: string }) {
  requirePermission(actor, 'pricing.approve');
  requireStepUp(actor);
  if (!input.reason || input.reason.trim().length < 5) throw validation('اكتب سبب الاعتماد (5 أحرف على الأقل)');
  return db.transaction(async (tx) => {
    const v = await lockVersion(tx, id);
    if (v.status !== 'VALIDATED') throw invalidState('الإصدار لازم يكون مُرسلاً (VALIDATED) قبل الاعتماد');
    if (v.validatedBy === actor.userId || v.createdBy === actor.userId) throw forbidden('لا يمكن لمنشئ/مرسل الإصدار اعتماده بنفسه (رقابة مزدوجة)');
    const loaded = await loadVersion(tx, id);
    const errs = await validateVersion(tx, loaded);
    if (errs.length) throw new DomainError('VALIDATION', `الإصدار لم يعد صالحًا: ${errs.slice(0, 5).join(' — ')}`);
    if (configHash(loaded) !== v.configHash) throw invalidState('تغيّرت إعدادات الإصدار بعد الإرسال');
    const margin = expectedMargin(loaded);
    let override = false;
    if (margin.belowTarget) {
      if (!input.overrideMarginGuard) {
        throw new DomainError('INVALID_STATE', `الهامش المتوقع ${(margin.expectedMarginBps / 100).toFixed(2)}% أقل من المستهدف ${(loaded.targetMarginBps / 100).toFixed(2)}%. النشر محظور إلا باستثناء موثق من صاحب الصلاحية`);
      }
      requirePermission(actor, 'pricing.override_margin_guard');
      if (!input.overrideReason || input.overrideReason.trim().length < 10) throw validation('اكتب سبب تجاوز حارس الهامش (10 أحرف على الأقل)');
      override = true;
    }
    await tx
      .update(pricingVersions)
      .set({
        status: 'APPROVED',
        approvedBy: actor.userId,
        approvedAt: new Date(),
        approvalReason: input.reason.trim(),
        expectedMarginBps: margin.expectedMarginBps,
        marginOverride: override,
        marginOverrideBy: override ? actor.userId : null,
        marginOverrideReason: override ? input.overrideReason!.trim() : null,
      })
      .where(eq(pricingVersions.id, id));
    await audit(tx, actor, {
      action: override ? 'pricing.approved_with_margin_override' : 'pricing.approved',
      entityType: 'pricing_version',
      entityId: id,
      oldValues: { status: 'VALIDATED' },
      newValues: { status: 'APPROVED', expectedMarginBps: margin.expectedMarginBps, targetMarginBps: loaded.targetMarginBps, override, stepUpAt: actor.stepUpAt?.toISOString() ?? null },
      reason: override ? `${input.reason} | override: ${input.overrideReason}` : input.reason,
    });
    return { expectedMarginBps: margin.expectedMarginBps, override };
  });
}

/**
 * Publish an APPROVED version, effective now or at a future time (scheduled). Fresh 2FA, reason,
 * publisher ≠ maker. Serialized against checkouts/deal commitments (exclusive pricing lock).
 * Existing orders/deals keep their snapshots; nothing historical is touched.
 */
export async function publishVersion(actor: Actor, id: string, input: { effectiveFrom?: Date | null; reason: string }) {
  requirePermission(actor, 'pricing.publish');
  requireStepUp(actor);
  if (!input.reason || input.reason.trim().length < 5) throw validation('اكتب سبب النشر');
  return db.transaction(async (tx) => {
    const [pre] = await tx.select({ model: pricingVersions.model }).from(pricingVersions).where(eq(pricingVersions.id, id));
    if (!pre) throw notFound('إصدار التسعير');
    await lockPricingExclusive(tx, pre.model);
    const v = await lockVersion(tx, id);
    if (v.status !== 'APPROVED') throw invalidState('النشر متاح للإصدارات المعتمدة فقط');
    if (v.validatedBy === actor.userId || v.createdBy === actor.userId) throw forbidden('منشئ الإصدار لا يمكنه نشره (رقابة مزدوجة)');
    const [{ now }] = (await tx.execute<{ now: Date }>(sql`select now() as now`)).rows;
    const nowDate = new Date(now);
    const eff = input.effectiveFrom && input.effectiveFrom.getTime() > nowDate.getTime() ? input.effectiveFrom : nowDate;
    const [latest] = (await tx.execute<{ max: Date | null }>(sql`select max(effective_from) as max from pricing_versions where model = ${v.model} and status = 'PUBLISHED'`)).rows;
    if (latest?.max && new Date(latest.max).getTime() >= eff.getTime()) throw invalidState('تاريخ السريان لازم يكون بعد آخر إصدار منشور/مجدول');
    const before = await activeVersionId(tx, v.model);
    await tx.update(pricingVersions).set({ status: 'PUBLISHED', effectiveFrom: eff, publishedBy: actor.userId, publishedAt: nowDate, publishReason: input.reason.trim() }).where(eq(pricingVersions.id, id));
    await audit(tx, actor, {
      action: 'pricing.published',
      entityType: 'pricing_version',
      entityId: id,
      oldValues: { activeVersionId: before },
      newValues: { status: 'PUBLISHED', effectiveFrom: eff.toISOString(), scheduled: eff.getTime() > nowDate.getTime(), configHash: v.configHash, stepUpAt: actor.stepUpAt?.toISOString() ?? null },
      reason: input.reason,
    });
    return { effectiveFrom: eff, scheduled: eff.getTime() > nowDate.getTime() };
  });
}

/** Cancel a draft / unpublished version, or a published one that is not yet effective. */
export async function cancelVersion(actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'pricing.publish');
  requireStepUp(actor);
  if (!reason?.trim()) throw validation('يجب ذكر السبب');
  await db.transaction(async (tx) => {
    const v = await lockVersion(tx, id);
    if (v.status === 'CANCELLED') return;
    if (v.status === 'PUBLISHED') {
      const r = await tx.execute<{ future: boolean }>(sql`select ${v.effectiveFrom!.toISOString()}::timestamptz > now() as future`);
      if (!r.rows[0].future) throw invalidState('الإصدار ساري بالفعل ولا يمكن إلغاؤه — انشر إصدارًا جديدًا');
    }
    await tx.update(pricingVersions).set({ status: 'CANCELLED', cancelledBy: actor.userId, cancelledAt: new Date() }).where(eq(pricingVersions.id, id));
    await audit(tx, actor, { action: 'pricing.cancelled', entityType: 'pricing_version', entityId: id, oldValues: { status: v.status }, newValues: { status: 'CANCELLED' }, reason });
  });
}

/* ═══════════════ Reads ═══════════════ */

export type DisplayStatus = 'DRAFT' | 'VALIDATED' | 'APPROVED' | 'SCHEDULED' | 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';

export async function listVersions(model: PricingModel) {
  const rows = await db.select().from(pricingVersions).where(eq(pricingVersions.model, model)).orderBy(desc(pricingVersions.versionNo));
  const active = await activeVersionId(db, model);
  const now = Date.now();
  return rows.map((v) => ({ ...v, displayStatus: displayStatus(v, active, now) }));
}

export function displayStatus(v: Pick<PricingVersion, 'id' | 'status' | 'effectiveFrom'>, activeId: string | null, now = Date.now()): DisplayStatus {
  if (v.status !== 'PUBLISHED') return v.status as DisplayStatus;
  if (v.id === activeId) return 'ACTIVE';
  return v.effectiveFrom && v.effectiveFrom.getTime() > now ? 'SCHEDULED' : 'SUPERSEDED';
}

/** Current vs proposed on the representative amounts (no historical data is touched). */
export async function compareVersions(currentId: string | null, proposedId: string) {
  const proposed = await loadVersion(db, proposedId);
  const current = currentId ? await loadVersion(db, currentId) : null;
  const classes = proposed.model === 'MARKETPLACE' ? [...MARKETPLACE_CLASSES] : ['DEAL'];
  return classes.flatMap((c) =>
    SAMPLE_AMOUNTS_EGP.map((egp) => {
      const p = simulate(proposed, { amount: egp * 100, shipping: 0, economicClass: c });
      const cur = current ? simulate(current, { amount: egp * 100, shipping: 0, economicClass: c }) : null;
      return {
        economicClass: c,
        amount: egp * 100,
        current: cur,
        proposed: p,
        buyerDiff: cur ? p.buyerFee - cur.buyerFee : null,
        sellerDiff: cur ? p.sellerFee - cur.sellerFee : null,
        revenueDiff: cur ? p.totalFee - cur.totalFee : null,
        marginDiffBps: cur && cur.marginBps !== null && p.marginBps !== null ? p.marginBps - cur.marginBps : null,
      };
    }),
  );
}

export async function simulateWith(versionId: string, input: SimulationInput) {
  return simulate(await loadVersion(db, versionId), input);
}
export async function batchFor(versionId: string) {
  return batchSimulate(await loadVersion(db, versionId));
}
export async function governanceFor(versionId: string) {
  const v = await loadVersion(db, versionId);
  return { ...expectedMargin(v), targetMarginBps: v.targetMarginBps, errors: await validateVersion(db, v) };
}

/* ═══════════════ Seed: owner-approved initial versions as DRAFTS (never auto-activated) ═══════════════ */

const LOW_MARGIN_SLUGS = ['mobile-phones', 'computers', 'large-appliances'];
const HIGH_MARGIN_SLUGS = ['fashion'];

export async function seedOwnerApprovedDrafts() {
  for (const model of ['MARKETPLACE', 'PROTECTED_DEAL'] as const) {
    const [exists] = await db.select({ id: pricingVersions.id }).from(pricingVersions).where(eq(pricingVersions.model, model)).limit(1);
    if (exists) continue;
    await db.transaction(async (tx) => {
      const [v] = await tx
        .insert(pricingVersions)
        .values({
          model,
          versionNo: 1,
          name: model === 'MARKETPLACE' ? 'تسعير السوق المعتمد من المالك (الإصدار 1)' : 'تسعير الضمانة المعتمد من المالك (الإصدار 1)',
          minFee: model === 'MARKETPLACE' ? OWNER_APPROVED_MARKETPLACE_MIN_FEE : OWNER_APPROVED_DEAL_MIN_FEE,
          targetMarginBps: 5000,
          assumptions: DEFAULT_ASSUMPTIONS,
          notes: 'Owner-approved rates (executive prompt). Cost assumptions are ESTIMATES for governance only. Tax treatment UNRESOLVED.',
        })
        .returning();
      const tiers =
        model === 'MARKETPLACE'
          ? Object.entries(OWNER_APPROVED_MARKETPLACE_TIERS).flatMap(([c, ts]) => ts.map((t, i) => ({ versionId: v.id, economicClass: c, seq: i + 1, ...t })))
          : OWNER_APPROVED_DEAL_TIERS.map((t, i) => ({ versionId: v.id, economicClass: 'DEAL', seq: i + 1, ...t }));
      await tx.insert(pricingTiers).values(tiers);
      if (model === 'MARKETPLACE') {
        const cats = await tx.select({ id: categories.id, slug: categories.slug, parentId: categories.parentId }).from(categories);
        const maps: { versionId: string; categoryId: string; economicClass: EconomicClass }[] = [];
        for (const c of cats) {
          if (LOW_MARGIN_SLUGS.includes(c.slug)) maps.push({ versionId: v.id, categoryId: c.id, economicClass: 'LOW_MARGIN' });
          else if (HIGH_MARGIN_SLUGS.includes(c.slug)) maps.push({ versionId: v.id, categoryId: c.id, economicClass: 'HIGH_MARGIN' });
          else if (!c.parentId) maps.push({ versionId: v.id, categoryId: c.id, economicClass: 'STANDARD' });
        }
        if (maps.length) await tx.insert(pricingCategoryClasses).values(maps);
      }
    });
  }
}

/** Test/demo helper: run the real workflow (maker submits, checker approves + publishes). */
export async function activateVersionWorkflow(maker: Actor, checker: Actor, versionId: string, reason = 'تفعيل الإصدار المعتمد من المالك') {
  const [v] = await db.select().from(pricingVersions).where(eq(pricingVersions.id, versionId));
  if (v.status === 'PUBLISHED') return;
  if (v.status === 'DRAFT') await submitVersion(maker, versionId, reason);
  const [v2] = await db.select().from(pricingVersions).where(eq(pricingVersions.id, versionId));
  if (v2.status === 'VALIDATED') await approveVersion(checker, versionId, { reason });
  await publishVersion(checker, versionId, { reason });
}

export async function versionRow(id: string) {
  const [v] = await db.select().from(pricingVersions).where(eq(pricingVersions.id, id));
  if (!v) throw notFound('إصدار التسعير');
  return v;
}

export { DEFAULT_ASSUMPTIONS };
