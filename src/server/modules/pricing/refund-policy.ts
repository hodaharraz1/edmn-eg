import { desc, eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import {
  refundFeePolicyRules,
  refundFeePolicyVersions,
  REFUND_REASON_CODES,
  RESPONSIBLE_PARTIES,
  type RefundLifecycleStage,
  type RefundReasonCode,
  type ResponsibleParty,
} from '@/server/db/schema';

export type RefundPolicyRule = typeof refundFeePolicyRules.$inferSelect;

export interface FeeAttribution {
  source: 'PUBLISHED_POLICY' | 'UNPUBLISHED_SAFE_DEFAULT';
  versionId: string | null;
  buyerFeeRefundBps: number;
  sellerFeeReversalBps: number;
  shippingRefund: 'FULL' | 'NONE' | 'MANUAL';
  transferCostPayer: ResponsibleParty;
  manualReview: boolean;
  ruleId: string | null;
}

/**
 * Consumer-safe default used while no fee policy is published (LEGAL REVIEW REQUIRED): the buyer
 * gets back the buyer fee on the refunded units, the seller fee on those units is reversed, shipping
 * only when explicitly decided (never prorated blindly), EDMN bears the transfer cost, and the refund
 * is flagged for manual review. The consumer is never silently charged.
 */
export const SAFE_DEFAULT: Omit<FeeAttribution, 'versionId' | 'ruleId'> = {
  source: 'UNPUBLISHED_SAFE_DEFAULT',
  buyerFeeRefundBps: 10000,
  sellerFeeReversalBps: 10000,
  shippingRefund: 'MANUAL',
  transferCostPayer: 'EDMN',
  manualReview: true,
};

export function stageOfSellerOrder(status: string, fundsReleased: boolean): RefundLifecycleStage {
  if (fundsReleased) return 'AFTER_RELEASE';
  if (['PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PAID', 'SELLER_CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'CANCELLED'].includes(status)) return 'BEFORE_SHIPMENT';
  if (status === 'SHIPPED' || status === 'DELIVERY_FAILED') return 'IN_TRANSIT';
  return 'AFTER_DELIVERY';
}

/** Resolve the fee components policy for a refund: exact rule, then any-party rule, else safe default. */
export async function resolveAttribution(conn: DbOrTx, input: { stage: RefundLifecycleStage; reason: RefundReasonCode; party: ResponsibleParty }): Promise<FeeAttribution> {
  const [v] = await conn.select().from(refundFeePolicyVersions).where(eq(refundFeePolicyVersions.status, 'PUBLISHED')).orderBy(desc(refundFeePolicyVersions.versionNo)).limit(1);
  if (!v) return { ...SAFE_DEFAULT, versionId: null, ruleId: null };
  const rules = await conn.select().from(refundFeePolicyRules).where(eq(refundFeePolicyRules.versionId, v.id));
  const rule =
    rules.find((r) => r.lifecycleStage === input.stage && r.reasonCode === input.reason && r.responsibleParty === input.party) ??
    rules.find((r) => r.lifecycleStage === input.stage && r.reasonCode === input.reason && r.responsibleParty === 'UNDETERMINED');
  if (!rule) return { ...SAFE_DEFAULT, versionId: v.id, ruleId: null };
  return {
    source: 'PUBLISHED_POLICY',
    versionId: v.id,
    ruleId: rule.id,
    buyerFeeRefundBps: rule.buyerFeeRefundBps,
    sellerFeeReversalBps: rule.sellerFeeReversalBps,
    shippingRefund: rule.shippingRefund,
    transferCostPayer: rule.transferCostPayer,
    manualReview: rule.manualReview,
  };
}

export function parseReason(v: unknown): RefundReasonCode {
  return (REFUND_REASON_CODES as readonly string[]).includes(String(v)) ? (v as RefundReasonCode) : 'OTHER';
}
export function parseParty(v: unknown): ResponsibleParty {
  return (RESPONSIBLE_PARTIES as readonly string[]).includes(String(v)) ? (v as ResponsibleParty) : 'UNDETERMINED';
}

/* ─────────────── Admin ─────────────── */

export async function policyVersions() {
  const vs = await db.select().from(refundFeePolicyVersions).orderBy(desc(refundFeePolicyVersions.versionNo));
  const rules = await db.select().from(refundFeePolicyRules);
  return vs.map((v) => ({ ...v, rules: rules.filter((r) => r.versionId === v.id) }));
}

export type RuleInput = Omit<RefundPolicyRule, 'id' | 'versionId'>;

export async function saveDraftRules(actor: Actor, versionId: string, rules: RuleInput[], reason: string) {
  requirePermission(actor, 'refund_fee_policy.manage');
  if (!reason?.trim()) throw validation('يجب ذكر السبب');
  await db.transaction(async (tx) => {
    const [v] = await tx.select().from(refundFeePolicyVersions).where(eq(refundFeePolicyVersions.id, versionId)).for('update');
    if (!v) throw notFound('السياسة');
    if (v.status !== 'DRAFT') throw invalidState('السياسات المنشورة لا تُعدل — أنشئ إصدارًا جديدًا');
    const before = await tx.select().from(refundFeePolicyRules).where(eq(refundFeePolicyRules.versionId, versionId));
    await tx.delete(refundFeePolicyRules).where(eq(refundFeePolicyRules.versionId, versionId));
    if (rules.length) await tx.insert(refundFeePolicyRules).values(rules.map((r) => ({ ...r, versionId })));
    await audit(tx, actor, { action: 'refund_fee_policy.rules_saved', entityType: 'refund_fee_policy', entityId: versionId, oldValues: { rules: before }, newValues: { rules }, reason });
  });
}

export async function createPolicyDraft(actor: Actor, fromVersionId?: string | null) {
  requirePermission(actor, 'refund_fee_policy.manage');
  return db.transaction(async (tx) => {
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(version_no), 0) + 1 as n from refund_fee_policy_versions`)).rows;
    const [v] = await tx.insert(refundFeePolicyVersions).values({ versionNo: Number(n), createdBy: actor.userId, notes: 'LEGAL REVIEW REQUIRED' }).returning();
    if (fromVersionId) {
      const src = await tx.select().from(refundFeePolicyRules).where(eq(refundFeePolicyRules.versionId, fromVersionId));
      if (src.length) await tx.insert(refundFeePolicyRules).values(src.map(({ id: _id, versionId: _v, ...r }) => ({ ...r, versionId: v.id })));
    }
    await audit(tx, actor, { action: 'refund_fee_policy.draft_created', entityType: 'refund_fee_policy', entityId: v.id, newValues: { versionNo: v.versionNo, from: fromVersionId ?? null } });
    return v;
  });
}

/**
 * Publish: only after legal review is explicitly recorded (DB CHECK), with fresh 2FA and a reason.
 * The previously published version is retired. Existing refunds keep the policy they were decided with.
 */
export async function publishPolicy(actor: Actor, versionId: string, input: { legalReviewConfirmed: boolean; legalPolicyVersion: string; reason: string }) {
  requirePermission(actor, 'refund_fee_policy.manage');
  requireStepUp(actor);
  if (!input.legalReviewConfirmed) throw validation('النشر يتطلب تأكيد المراجعة القانونية (LEGAL REVIEW REQUIRED)');
  if (!input.reason?.trim() || !input.legalPolicyVersion?.trim()) throw validation('اكتب السبب ورقم إصدار السياسة القانونية');
  await db.transaction(async (tx) => {
    const [v] = await tx.select().from(refundFeePolicyVersions).where(eq(refundFeePolicyVersions.id, versionId)).for('update');
    if (!v) throw notFound('السياسة');
    if (v.status !== 'DRAFT') throw invalidState('الإصدار ده مش مسودة');
    await tx.update(refundFeePolicyVersions).set({ status: 'RETIRED' }).where(eq(refundFeePolicyVersions.status, 'PUBLISHED'));
    await tx
      .update(refundFeePolicyVersions)
      .set({ status: 'PUBLISHED', legalReviewRequired: false, legalPolicyVersion: input.legalPolicyVersion.trim(), publishedBy: actor.userId, publishedAt: new Date(), publishReason: input.reason.trim() })
      .where(eq(refundFeePolicyVersions.id, versionId));
    await audit(tx, actor, { action: 'refund_fee_policy.published', entityType: 'refund_fee_policy', entityId: versionId, newValues: { legalPolicyVersion: input.legalPolicyVersion }, reason: input.reason });
  });
}

/**
 * Seed: version 1 as a DRAFT proposal (LEGAL REVIEW REQUIRED, unpublished). Until counsel approves,
 * refunds use the consumer-safe default above.
 */
export async function seedRefundPolicyDraft() {
  const [any] = await db.select({ id: refundFeePolicyVersions.id }).from(refundFeePolicyVersions).limit(1);
  if (any) return;
  await db.transaction(async (tx) => {
    const [v] = await tx.insert(refundFeePolicyVersions).values({ versionNo: 1, notes: 'PROPOSAL — LEGAL REVIEW REQUIRED. Not published; refunds use the consumer-safe default until approved.' }).returning();
    const full = { buyerFeeRefundBps: 10000, sellerFeeReversalBps: 10000 };
    const rows: RuleInput[] = [
      { lifecycleStage: 'BEFORE_SHIPMENT', reasonCode: 'BUYER_CANCELLATION', responsibleParty: 'BUYER', ...full, shippingRefund: 'FULL', returnShippingPayer: 'UNDETERMINED', transferCostPayer: 'EDMN', manualReview: false, notes: 'Pre-shipment cancellation: full refund incl. fees and shipping' },
      { lifecycleStage: 'BEFORE_SHIPMENT', reasonCode: 'SELLER_FAULT', responsibleParty: 'SELLER', buyerFeeRefundBps: 10000, sellerFeeReversalBps: 0, shippingRefund: 'FULL', returnShippingPayer: 'SELLER', transferCostPayer: 'SELLER', manualReview: true, notes: 'Seller cannot fulfil: seller fee retained (proposal)' },
      { lifecycleStage: 'IN_TRANSIT', reasonCode: 'NON_DELIVERY', responsibleParty: 'CARRIER', ...full, shippingRefund: 'FULL', returnShippingPayer: 'CARRIER', transferCostPayer: 'EDMN', manualReview: true, notes: null },
      { lifecycleStage: 'AFTER_DELIVERY', reasonCode: 'NOT_AS_DESCRIBED', responsibleParty: 'SELLER', buyerFeeRefundBps: 10000, sellerFeeReversalBps: 0, shippingRefund: 'FULL', returnShippingPayer: 'SELLER', transferCostPayer: 'SELLER', manualReview: true, notes: 'Proposal' },
      { lifecycleStage: 'AFTER_DELIVERY', reasonCode: 'DAMAGED_ITEM', responsibleParty: 'SELLER', buyerFeeRefundBps: 10000, sellerFeeReversalBps: 0, shippingRefund: 'FULL', returnShippingPayer: 'SELLER', transferCostPayer: 'SELLER', manualReview: true, notes: 'Proposal' },
      { lifecycleStage: 'AFTER_DELIVERY', reasonCode: 'WRONG_ITEM', responsibleParty: 'SELLER', buyerFeeRefundBps: 10000, sellerFeeReversalBps: 0, shippingRefund: 'FULL', returnShippingPayer: 'SELLER', transferCostPayer: 'SELLER', manualReview: true, notes: 'Proposal' },
      { lifecycleStage: 'AFTER_DELIVERY', reasonCode: 'BUYER_VOLUNTARY_RETURN', responsibleParty: 'BUYER', ...full, shippingRefund: 'MANUAL', returnShippingPayer: 'BUYER', transferCostPayer: 'EDMN', manualReview: true, notes: 'Buyer fee treatment on voluntary returns needs legal decision' },
      { lifecycleStage: 'AFTER_DELIVERY', reasonCode: 'EDMN_ERROR', responsibleParty: 'EDMN', ...full, shippingRefund: 'FULL', returnShippingPayer: 'EDMN', transferCostPayer: 'EDMN', manualReview: true, notes: null },
    ];
    await tx.insert(refundFeePolicyRules).values(rows.map((r) => ({ ...r, versionId: v.id })));
  });
}
