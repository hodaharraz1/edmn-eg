import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { enforce } from '@/server/auth/rate-limit';
import { hasPermission, requirePermission, requireSeller, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { encrypt, hmac } from '@/server/core/crypto';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import {
  externalDeals,
  files,
  productPassportEvents,
  productPassports,
  products,
  riskFlags,
  usedConditionEvidence,
  usedConditionReports,
  usedInspections,
  users,
} from '@/server/db/schema';
import { assertNotSelfDealing } from '@/server/modules/finance/self-dealing';
import { identityStatus } from '@/server/modules/identity/service';
import { storeUpload } from '@/server/storage/uploads';
import { checkReport, coerceAnswers, maskIdentifier, normalizeIdentifier, protectionLevel, type ReportCheck, type UsedPolicy } from '@/domain/used';
import { track } from './analytics';
import { policyById, policyForCategory } from './policies';

export type Report = typeof usedConditionReports.$inferSelect;
export type Passport = typeof productPassports.$inferSelect;

/** Deal statuses in which the seller may still document / change the condition (before an offer is pending). */
const DEAL_EDITABLE = ['SELLER_JOINED', 'CHANGE_REQUESTED'];

export function identifierHash(normalized: string): string {
  return hmac(`used-identifier:${normalized}`);
}

function passportCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(8);
  return `EP-${Array.from(b, (x) => alphabet[x % alphabet.length]).join('')}`;
}

async function loadReport(conn: DbOrTx, reportId: string, lock = false): Promise<Report> {
  const q = conn.select().from(usedConditionReports).where(eq(usedConditionReports.id, reportId));
  const [r] = lock ? await q.for('update') : await q;
  if (!r) throw notFound('بيانات الحالة');
  return r;
}

/** Only the item's seller may document it (store members need products.manage; a deal needs its bound seller). */
async function authorizeEdit(conn: DbOrTx, actor: Actor, r: Report) {
  const uid = requireUser(actor);
  if (r.status === 'LOCKED') throw invalidState('بيانات الحالة اتثبتت في اتفاق ومينفعش تتعدل. أي تغيير جوهري بيتعمل كتعديل يوافق عليه المشتري.');
  if (r.productId) {
    const sellerId = requireSeller(actor, 'products.manage');
    const [p] = await conn.select({ sellerId: products.sellerId }).from(products).where(eq(products.id, r.productId));
    if (!p || p.sellerId !== sellerId) throw forbidden();
    return;
  }
  const [d] = await conn.select({ sellerUserId: externalDeals.sellerUserId, status: externalDeals.status }).from(externalDeals).where(eq(externalDeals.id, r.dealId!));
  if (!d || d.sellerUserId !== uid) throw forbidden();
  if (!DEAL_EDITABLE.includes(d.status)) throw invalidState('مينفعش تعدّل بيانات الحالة في مرحلة الصفقة دي');
}

/** Who may READ a report (and its private evidence): the seller side, the deal buyer, and authorized staff. */
export async function canViewReport(conn: DbOrTx, actor: Actor, r: Report): Promise<boolean> {
  if (!actor.userId) return false;
  if (r.authorUserId === actor.userId) return true;
  if (r.productId) {
    if (hasPermission(actor, 'products.view') || hasPermission(actor, 'products.moderate') || hasPermission(actor, 'disputes.manage')) return true;
    if (actor.type === 'SELLER' && actor.sellerId) {
      const [p] = await conn.select({ sellerId: products.sellerId }).from(products).where(eq(products.id, r.productId));
      return p?.sellerId === actor.sellerId;
    }
    return false;
  }
  if (hasPermission(actor, 'deals.view') || hasPermission(actor, 'disputes.manage')) return true;
  const [d] = await conn.select({ buyerId: externalDeals.buyerId, sellerUserId: externalDeals.sellerUserId }).from(externalDeals).where(eq(externalDeals.id, r.dealId!));
  return !!d && (d.buyerId === actor.userId || d.sellerUserId === actor.userId);
}

async function evidenceCounts(conn: DbOrTx, reportId: string): Promise<Record<string, number>> {
  const rows = await conn.select({ slot: usedConditionEvidence.slot }).from(usedConditionEvidence).where(eq(usedConditionEvidence.reportId, reportId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.slot] = (out[r.slot] ?? 0) + 1;
  return out;
}

export async function evaluate(conn: DbOrTx, r: Report, policy: UsedPolicy): Promise<ReportCheck> {
  return checkReport(policy, (r.answers ?? {}) as Record<string, string | number | boolean>, !!r.identifierHash, await evidenceCounts(conn, r.id));
}

/** Any change after a declaration needs a NEW declaration (and voids an earlier staff verification). */
async function afterChange(tx: DbOrTx, actor: Actor, r: Report, policy: UsedPolicy, sets: Partial<Report>) {
  const check = checkReport(policy, (sets.answers ?? r.answers ?? {}) as Record<string, string | number | boolean>, !!(sets.identifierHash ?? r.identifierHash), await evidenceCounts(tx, r.id));
  const wasDeclared = r.status === 'DECLARED';
  await tx
    .update(usedConditionReports)
    .set({
      ...sets,
      status: 'DRAFT',
      declaredAt: wasDeclared ? null : r.declaredAt,
      version: wasDeclared ? r.version + 1 : r.version,
      conditionCompleteness: Math.round(check.conditionCompleteness * 100),
      evidenceCompleteness: Math.round(check.evidenceCompleteness * 100),
      defectsCount: check.defects.length,
    })
    .where(eq(usedConditionReports.id, r.id));
  const [pp] = await tx.select().from(productPassports).where(eq(productPassports.reportId, r.id));
  if (pp && wasDeclared) {
    await tx.update(productPassports).set({ verificationStatus: 'UNREVIEWED', verifiedBy: null, verifiedAt: null, verificationNote: null }).where(eq(productPassports.id, pp.id));
    await tx.insert(productPassportEvents).values({ passportId: pp.id, kind: 'UPDATED', actorUserId: actor.userId, data: { reportVersion: r.version + 1 } });
    await recomputeLevel(tx, pp.id);
  }
  return check;
}

/* ───────── Creating reports ───────── */

export async function ensureProductReport(actor: Actor, productId: string) {
  const sellerId = requireSeller(actor, 'products.manage');
  const uid = requireUser(actor);
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, productId)).for('update');
    if (!p || p.sellerId !== sellerId) throw notFound('المنتج');
    if (p.condition !== 'USED') throw validation('توثيق الحالة للمنتجات المستعملة فقط');
    const [existing] = await tx.select().from(usedConditionReports).where(eq(usedConditionReports.productId, productId));
    if (existing) return existing;
    const resolved = await policyForCategory(p.categoryId, tx);
    if (!resolved) throw validation('الفئة دي لسه مش مفعّل فيها توثيق المستعمل');
    const [r] = await tx.insert(usedConditionReports).values({ policyId: resolved.row.id, policyVersion: resolved.row.version, productId, authorUserId: uid }).returning();
    await track(tx, 'USED_LISTING_STARTED', r.id, { profile: resolved.policy.profile, channel: 'MARKETPLACE' });
    return r;
  });
}

export async function ensureDealReport(actor: Actor, dealId: string) {
  const uid = requireUser(actor);
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!d || d.sellerUserId !== uid) throw notFound('الصفقة');
    if (d.condition !== 'USED') throw validation('توثيق الحالة للمنتجات المستعملة فقط');
    const [existing] = await tx.select().from(usedConditionReports).where(eq(usedConditionReports.dealId, dealId));
    if (existing) return existing;
    if (!DEAL_EDITABLE.includes(d.status)) throw invalidState('مينفعش تبدأ توثيق الحالة في مرحلة الصفقة دي');
    const resolved = await policyForCategory(d.categoryId, tx);
    if (!resolved) throw validation('الفئة دي لسه مش مفعّل فيها توثيق المستعمل');
    const [r] = await tx.insert(usedConditionReports).values({ policyId: resolved.row.id, policyVersion: resolved.row.version, dealId, authorUserId: uid }).returning();
    await track(tx, 'USED_LISTING_STARTED', r.id, { profile: resolved.policy.profile, channel: 'PROTECTED_DEAL' });
    return r;
  });
}

/* ───────── Editing ───────── */

export async function saveReportAnswers(actor: Actor, reportId: string, raw: Record<string, unknown>) {
  const uid = requireUser(actor);
  await enforce(`used-report:${uid}`, 60, 900);
  return db.transaction(async (tx) => {
    const r = await loadReport(tx, reportId, true);
    await authorizeEdit(tx, actor, r);
    const { policy } = await policyById(r.policyId, tx);
    const answers = coerceAnswers(policy, raw);
    const sets: Partial<Report> = { answers };
    const idField = policy.fields.find((f) => f.identifier);
    const rawId = idField ? String(raw[idField.code] ?? '').trim() : '';
    if (idField && rawId) {
      const norm = normalizeIdentifier(rawId);
      if (!norm) throw validation(`${idField.label}: الرقم مش صحيح. IMEI لازم يكون 15 رقم صحيح، أو اكتب الرقم التسلسلي (6–20 حرف ورقم).`);
      sets.identifierEnc = encrypt(norm);
      sets.identifierMasked = maskIdentifier(norm);
      sets.identifierHash = identifierHash(norm);
    }
    const check = await afterChange(tx, actor, r, policy, sets);
    await audit(tx, actor, { action: 'used.report_saved', entityType: 'used_condition_report', entityId: r.id, newValues: { completeness: check.conditionCompleteness, identifierChanged: !!sets.identifierHash } });
    return check;
  });
}

export async function addReportEvidence(actor: Actor, reportId: string, slot: string, uploads: { data: Buffer; name: string }[]) {
  const uid = requireUser(actor);
  if (!uploads.length) throw validation('اختار صورة');
  return db.transaction(async (tx) => {
    const r = await loadReport(tx, reportId, true);
    await authorizeEdit(tx, actor, r);
    const { policy } = await policyById(r.policyId, tx);
    const def = policy.evidence.find((s) => s.code === slot);
    if (!def) throw validation('نوع صورة غير معروف');
    const have = (await evidenceCounts(tx, r.id))[slot] ?? 0;
    if (have + uploads.length > def.maxFiles) throw validation(`أقصى عدد صور لـ«${def.label}» هو ${def.maxFiles}`);
    // Public marketplace photos go through the public image pipeline (scan, re-encode, EXIF/GPS stripped);
    // anything private (identifier photos, every protected-deal photo) is CONDITION_EVIDENCE, private storage.
    const purpose = r.productId && !def.private ? 'PRODUCT_IMAGE' : 'CONDITION_EVIDENCE';
    for (const u of uploads) {
      const f = await storeUpload(tx, actor, { purpose, data: u.data, originalName: u.name });
      await tx.insert(usedConditionEvidence).values({ reportId: r.id, slot, fileId: f.id, uploadedBy: uid });
    }
    await afterChange(tx, actor, r, policy, {});
    await audit(tx, actor, { action: 'used.evidence_added', entityType: 'used_condition_report', entityId: r.id, newValues: { slot, count: uploads.length } });
  });
}

export async function removeReportEvidence(actor: Actor, reportId: string, evidenceId: string) {
  return db.transaction(async (tx) => {
    const r = await loadReport(tx, reportId, true);
    await authorizeEdit(tx, actor, r);
    const [e] = await tx.select().from(usedConditionEvidence).where(and(eq(usedConditionEvidence.id, evidenceId), eq(usedConditionEvidence.reportId, r.id)));
    if (!e) throw notFound('الصورة');
    await tx.delete(usedConditionEvidence).where(eq(usedConditionEvidence.id, e.id));
    // The bytes stop being served (public /media and private /api/files both refuse deleted files).
    await tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, e.fileId));
    const { policy } = await policyById(r.policyId, tx);
    await afterChange(tx, actor, r, policy, {});
    await audit(tx, actor, { action: 'used.evidence_removed', entityType: 'used_condition_report', entityId: r.id, newValues: { slot: e.slot } });
  });
}

/** The seller's declaration: only a complete report can be declared. Creates the Product Passport on first declaration. */
export async function declareReport(actor: Actor, reportId: string, accepted: boolean) {
  if (!accepted) throw validation('لازم تأكد الإقرار إن البيانات بتمثل حالة المنتج الفعلية');
  return db.transaction(async (tx) => {
    const r = await loadReport(tx, reportId, true);
    await authorizeEdit(tx, actor, r);
    const { policy } = await policyById(r.policyId, tx);
    const check = await evaluate(tx, r, policy);
    if (!check.complete) throw validation(`التوثيق لسه مش كامل: ${check.problems.slice(0, 4).join('، ')}`);
    await tx.update(usedConditionReports).set({ status: 'DECLARED', declaredAt: new Date() }).where(eq(usedConditionReports.id, r.id));
    let [pp] = await tx.select().from(productPassports).where(eq(productPassports.reportId, r.id));
    if (!pp) {
      [pp] = await tx.insert(productPassports).values({ code: passportCode(), reportId: r.id, productId: r.productId, dealId: r.dealId, identifierHash: r.identifierHash }).returning();
      await tx.insert(productPassportEvents).values({ passportId: pp.id, kind: 'CREATED', actorUserId: actor.userId, data: { profile: policy.profile } });
    } else if (pp.identifierHash !== r.identifierHash) {
      await tx.update(productPassports).set({ identifierHash: r.identifierHash }).where(eq(productPassports.id, pp.id));
    }
    await tx.insert(productPassportEvents).values({ passportId: pp.id, kind: 'DECLARED', actorUserId: actor.userId, data: { reportVersion: r.version, defects: check.defects.length } });
    await flagDuplicateIdentifier(tx, r, pp.id);
    await recomputeLevel(tx, pp.id);
    await audit(tx, actor, { action: 'used.report_declared', entityType: 'used_condition_report', entityId: r.id, newValues: { version: r.version, passport: pp.code } });
    await track(tx, 'USED_LISTING_COMPLETED', r.id, { profile: policy.profile, channel: r.productId ? 'MARKETPLACE' : 'PROTECTED_DEAL' });
    return { passportCode: pp.code };
  });
}

/** Fraud signal: the same device identifier documented by a DIFFERENT seller. A review flag for staff, not a hold. */
async function flagDuplicateIdentifier(tx: DbOrTx, r: Report, passportId: string) {
  if (!r.identifierHash) return;
  const others = await tx
    .select({ id: usedConditionReports.id })
    .from(usedConditionReports)
    .where(and(eq(usedConditionReports.identifierHash, r.identifierHash), ne(usedConditionReports.id, r.id), ne(usedConditionReports.authorUserId, r.authorUserId), inArray(usedConditionReports.status, ['DECLARED', 'LOCKED'])));
  if (!others.length) return;
  const [open] = await tx
    .select({ id: riskFlags.id })
    .from(riskFlags)
    .where(and(eq(riskFlags.entityType, 'product_passport'), eq(riskFlags.entityId, passportId), eq(riskFlags.code, 'DUPLICATE_IDENTIFIER'), eq(riskFlags.status, 'OPEN')));
  if (open) return;
  await tx.insert(riskFlags).values({
    entityType: 'product_passport',
    entityId: passportId,
    code: 'DUPLICATE_IDENTIFIER',
    severity: 'HIGH',
    note: 'نفس رقم الجهاز موثّق في جواز منتج تاني لبائع مختلف — محتاج مراجعة.',
    meta: { otherReports: others.map((o) => o.id) },
  });
}

/* ───────── Protection level ───────── */

export async function recomputeLevel(tx: DbOrTx, passportId: string) {
  const [pp] = await tx.select().from(productPassports).where(eq(productPassports.id, passportId));
  if (!pp) return null;
  const r = await loadReport(tx, pp.reportId);
  const { policy } = await policyById(r.policyId, tx);
  const check = await evaluate(tx, r, policy);
  const [insp] = await tx.select({ result: usedInspections.result }).from(usedInspections).where(eq(usedInspections.passportId, pp.id)).orderBy(desc(usedInspections.performedAt)).limit(1);
  const level = protectionLevel(policy, {
    complete: check.complete && r.status !== 'DRAFT',
    identityApproved: (await identityStatus(tx, r.authorUserId)) === 'APPROVED',
    staffVerified: pp.verificationStatus === 'VERIFIED',
    inspectionPassed: insp?.result === 'PASS' || insp?.result === 'PASS_WITH_NOTES',
  });
  if (level !== pp.level) {
    await tx.update(productPassports).set({ level }).where(eq(productPassports.id, pp.id));
    await tx.insert(productPassportEvents).values({ passportId: pp.id, kind: 'LEVEL_CHANGED', data: { from: pp.level, to: level } });
  }
  return level;
}

/* ───────── Staff: verification and real inspections ───────── */

async function staffPassport(tx: DbOrTx, actor: Actor, passportId: string) {
  const [pp] = await tx.select().from(productPassports).where(eq(productPassports.id, passportId)).for('update');
  if (!pp) throw notFound('جواز المنتج');
  requirePermission(actor, pp.productId ? 'products.moderate' : 'deals.manage');
  requireStepUp(actor);
  const r = await loadReport(tx, pp.reportId);
  if (r.authorUserId === actor.userId) throw forbidden('مينفعش تراجع جواز منتج إنت اللي موثّقه');
  if (pp.productId) {
    const [p] = await tx.select({ sellerId: products.sellerId }).from(products).where(eq(products.id, pp.productId));
    if (p) await assertNotSelfDealing(tx, actor, p.sellerId);
  } else {
    const [d] = await tx.select({ buyerId: externalDeals.buyerId, sellerUserId: externalDeals.sellerUserId }).from(externalDeals).where(eq(externalDeals.id, pp.dealId!));
    if (d && (d.buyerId === actor.userId || d.sellerUserId === actor.userId)) throw forbidden('مينفعش تراجع صفقة إنت طرف فيها');
  }
  return { pp, r };
}

/** Condition verification = a staff DOCUMENT review of the declared data and evidence (never a technical inspection). */
export async function verifyPassport(actor: Actor, passportId: string, decision: 'VERIFIED' | 'REJECTED', note: string) {
  if (note.trim().length < 3) throw validation('اكتب ملاحظة المراجعة');
  return db.transaction(async (tx) => {
    const { pp, r } = await staffPassport(tx, actor, passportId);
    if (r.status === 'DRAFT') throw invalidState('البائع لسه ما أقرّش بالبيانات بعد آخر تعديل');
    await tx.update(productPassports).set({ verificationStatus: decision, verifiedBy: actor.userId, verifiedAt: new Date(), verificationNote: note.trim().slice(0, 1000) }).where(eq(productPassports.id, pp.id));
    await tx.insert(productPassportEvents).values({ passportId: pp.id, kind: decision === 'VERIFIED' ? 'VERIFIED' : 'VERIFICATION_REJECTED', actorUserId: actor.userId, data: { reportVersion: r.version } });
    const level = await recomputeLevel(tx, pp.id);
    await audit(tx, actor, { action: 'used.passport_verification', entityType: 'product_passport', entityId: pp.id, oldValues: { status: pp.verificationStatus }, newValues: { status: decision, level }, reason: note.trim() });
    if (decision === 'VERIFIED') await track(tx, 'PASSPORT_VERIFIED', pp.id, { level: level ?? 'PROTECTED' });
    return { level };
  });
}

export const INSPECTION_INPUT_LIMITS = { provider: 120, inspector: 120, summary: 2000 };

/** Records a REAL inspection (with its report document). «مفحوص» is never granted without one. */
export async function recordInspection(
  actor: Actor,
  passportId: string,
  input: { provider: string; inspectorName: string; result: 'PASS' | 'PASS_WITH_NOTES' | 'FAIL'; summary: string; performedAt: Date },
  report: { data: Buffer; name: string } | null,
) {
  if (!report) throw validation('ارفع تقرير الفحص (PDF أو صورة)');
  if (input.provider.trim().length < 2 || input.inspectorName.trim().length < 2) throw validation('اكتب جهة الفحص واسم الفاحص');
  if (input.summary.trim().length < 10) throw validation('اكتب ملخص نتيجة الفحص');
  if (!(input.performedAt instanceof Date) || Number.isNaN(input.performedAt.getTime()) || input.performedAt.getTime() > Date.now() + 60_000) throw validation('تاريخ الفحص مش صحيح');
  return db.transaction(async (tx) => {
    const { pp } = await staffPassport(tx, actor, passportId);
    const f = await storeUpload(tx, actor, { purpose: 'CONDITION_EVIDENCE', data: report.data, originalName: report.name });
    const [row] = await tx
      .insert(usedInspections)
      .values({
        passportId: pp.id,
        provider: input.provider.trim().slice(0, INSPECTION_INPUT_LIMITS.provider),
        inspectorName: input.inspectorName.trim().slice(0, INSPECTION_INPUT_LIMITS.inspector),
        result: input.result,
        summary: input.summary.trim().slice(0, INSPECTION_INPUT_LIMITS.summary),
        reportFileId: f.id,
        performedAt: input.performedAt,
        recordedBy: actor.userId!,
      })
      .returning();
    await tx.insert(productPassportEvents).values({ passportId: pp.id, kind: 'INSPECTION_RECORDED', actorUserId: actor.userId, data: { inspectionId: row.id, result: input.result } });
    const level = await recomputeLevel(tx, pp.id);
    await audit(tx, actor, { action: 'used.inspection_recorded', entityType: 'product_passport', entityId: pp.id, newValues: { inspectionId: row.id, result: input.result, provider: row.provider, level } });
    await track(tx, 'INSPECTION_RECORDED', pp.id, { result: input.result, level: level ?? 'PROTECTED' });
    return row;
  });
}

/* ───────── Reads ───────── */

export async function reportBundle(conn: DbOrTx, r: Report) {
  const { row: policyRow, policy } = await policyById(r.policyId, conn);
  const evidence = await conn
    .select({ id: usedConditionEvidence.id, slot: usedConditionEvidence.slot, fileId: usedConditionEvidence.fileId, storageKey: files.storageKey, visibility: files.visibility, sha256: files.sha256 })
    .from(usedConditionEvidence)
    .innerJoin(files, eq(files.id, usedConditionEvidence.fileId))
    .where(eq(usedConditionEvidence.reportId, r.id))
    .orderBy(asc(usedConditionEvidence.createdAt));
  const check = await evaluate(conn, r, policy);
  const [passport] = await conn.select().from(productPassports).where(eq(productPassports.reportId, r.id));
  const inspections = passport ? await conn.select().from(usedInspections).where(eq(usedInspections.passportId, passport.id)).orderBy(desc(usedInspections.performedAt)) : [];
  return { report: r, policy, policyRow, evidence, check, passport: passport ?? null, inspections };
}
export type ReportBundle = Awaited<ReturnType<typeof reportBundle>>;

/** A report for its seller-side editor or an authorized viewer (404 for everyone else). */
export async function reportFor(actor: Actor, reportId: string) {
  const r = await loadReport(db, reportId);
  if (!(await canViewReport(db, actor, r))) throw notFound('بيانات الحالة');
  return reportBundle(db, r);
}

export async function reportForProduct(productId: string) {
  const [r] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.productId, productId));
  return r ? reportBundle(db, r) : null;
}

export async function reportForDeal(dealId: string) {
  const [r] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.dealId, dealId));
  return r ? reportBundle(db, r) : null;
}

export async function authorOf(conn: DbOrTx, userId: string) {
  const [u] = await conn.select({ id: users.id, createdAt: users.createdAt, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, userId));
  return u ?? null;
}
