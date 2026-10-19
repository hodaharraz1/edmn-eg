import { eq } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { externalDeals, products, sellers } from '@/server/db/schema';
import { fieldDisplay, type ProtectionLevel, type UsedAnswers } from '@/domain/used';
import { canViewReport, reportBundle, reportForDeal, reportForProduct, type ReportBundle } from './reports';
import { safetyFor } from './signals';
import { passportByCode } from './snapshots';

export function fieldsOf(b: ReportBundle) {
  const answers = (b.report.answers ?? {}) as UsedAnswers;
  return b.policy.fields.filter((f) => !f.identifier).map((f) => ({ code: f.code, group: f.group, label: f.label, display: fieldDisplay(f, answers[f.code]) }));
}

export function evidenceOf(b: ReportBundle) {
  return b.evidence.map((e) => ({ slot: e.slot, label: b.policy.evidence.find((s) => s.code === e.slot)?.label ?? e.slot, fileId: e.fileId, storageKey: e.storageKey, private: e.visibility === 'PRIVATE' }));
}

/** The score's «inspected» factor follows the server-computed level (a stale inspection never counts). */
export function inspectedOk(b: ReportBundle) {
  return b.passport?.level === 'INSPECTED';
}

export type UsedListingView = Awaited<ReturnType<typeof usedListingView>>;

/** A marketplace used listing's public passport data (null when the listing is not documented/declared). */
export async function usedListingView(productId: string, returnPolicy: 'VOLUNTARY' | 'NONE' | null) {
  const b = await reportForProduct(productId);
  if (!b || !b.passport || b.report.status === 'DRAFT') return null;
  const [owner] = await db.select({ userId: sellers.ownerUserId }).from(products).innerJoin(sellers, eq(sellers.id, products.sellerId)).where(eq(products.id, productId));
  const level = b.passport.level as ProtectionLevel;
  const { score, seller } = await safetyFor({
    sellerUserId: owner?.userId ?? null,
    conditionCompleteness: b.check.conditionCompleteness,
    evidenceCompleteness: b.check.evidenceCompleteness,
    level,
    inspected: inspectedOk(b),
    shippingEvidence: null,
    returnPolicy,
  });
  return { bundle: b, level, score, seller, fields: fieldsOf(b), evidence: evidenceOf(b), inspectionDays: b.policy.inspection.defaultDays };
}

/** Deal view (parties / staff — the caller has already authorized the deal). */
export async function usedDealView(dealId: string) {
  const b = await reportForDeal(dealId);
  if (!b) return null;
  const [deal] = await db.select({ sellerUserId: externalDeals.sellerUserId, deliveredAt: externalDeals.deliveredAt, agreedTerms: externalDeals.agreedTerms }).from(externalDeals).where(eq(externalDeals.id, dealId));
  const level = (b.passport?.level ?? 'PROTECTED') as ProtectionLevel;
  const rp = (deal?.agreedTerms as { returnPolicy?: { type?: string } } | null)?.returnPolicy?.type;
  const { score, seller } = await safetyFor({
    sellerUserId: deal?.sellerUserId ?? null,
    conditionCompleteness: b.check.conditionCompleteness,
    evidenceCompleteness: b.check.evidenceCompleteness,
    level,
    inspected: inspectedOk(b),
    shippingEvidence: deal?.deliveredAt ? true : null,
    returnPolicy: rp === 'VOLUNTARY' || rp === 'NONE' ? rp : null,
  });
  return { bundle: b, level, score, seller, fields: fieldsOf(b), evidence: evidenceOf(b) };
}

/**
 * Passport page access: a LIVE marketplace listing's declared passport is public (public evidence only);
 * a protected-deal passport is visible to its parties and authorized staff only. Everyone else: not found.
 */
export async function passportPage(code: string, actor: Actor | null) {
  if (!/^EP-[A-Z0-9]{8}$/.test(code)) return null;
  const b = await passportByCode(code);
  if (!b || !b.passport) return null;
  const canView = actor ? await canViewReport(db, actor, b.report) : false;
  if (b.report.productId) {
    const [p] = await db.select({ status: products.status, slug: products.slug, title: products.titleAr }).from(products).where(eq(products.id, b.report.productId));
    const isPublic = p?.status === 'LIVE' && b.report.status !== 'DRAFT';
    if (!isPublic && !canView) return null;
    return { bundle: b, product: p ?? null, deal: null, showPrivate: canView, fields: fieldsOf(b), evidence: evidenceOf(b) };
  }
  if (!canView) return null;
  const [d] = await db.select({ id: externalDeals.id, number: externalDeals.number, title: externalDeals.title }).from(externalDeals).where(eq(externalDeals.id, b.report.dealId!));
  return { bundle: b, product: null, deal: d ?? null, showPrivate: true, fields: fieldsOf(b), evidence: evidenceOf(b) };
}

export { reportBundle };
