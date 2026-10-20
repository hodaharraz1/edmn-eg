import type { PricingAssumptions } from '@/server/db/schema';
import { computeFee, computeMarketplaceFee, SAMPLE_AMOUNTS_EGP, type TierInput } from './engine';

export interface VersionConfig {
  model: 'MARKETPLACE' | 'PROTECTED_DEAL';
  currency: string;
  minFee: number;
  targetMarginBps: number;
  assumptions: PricingAssumptions;
  tiersByClass: Record<string, TierInput[]>;
}

export const MARKETPLACE_CLASSES = ['LOW_MARGIN', 'STANDARD', 'HIGH_MARGIN'] as const;

/**
 * Server-side publication validator. Returns every problem (empty = valid). Never relies on the UI.
 * Checks: classes present, contiguous tiers from 0 (no gap/overlap, ordered, last open-ended), rates
 * in range, buyer + seller = total, minimum valid, currency, monotonic fee at every boundary (±1
 * piastre) and buyer + seller = total after rounding on boundaries and samples.
 */
export function validateVersionConfig(cfg: VersionConfig): string[] {
  const errs: string[] = [];
  if (cfg.currency !== 'EGP') errs.push('العملة غير مدعومة (EGP فقط)');
  if (!Number.isSafeInteger(cfg.minFee) || cfg.minFee < 0) errs.push('الحد الأدنى للرسوم غير صالح');
  if (!Number.isInteger(cfg.targetMarginBps) || cfg.targetMarginBps < 0 || cfg.targetMarginBps > 10000) errs.push('هامش المساهمة المستهدف غير صالح');
  const classes = cfg.model === 'MARKETPLACE' ? [...MARKETPLACE_CLASSES] : ['DEAL'];
  for (const k of Object.keys(cfg.tiersByClass)) if (!classes.includes(k as never)) errs.push(`فئة شرائح غير معروفة: ${k}`);
  for (const c of classes) {
    const tiers = [...(cfg.tiersByClass[c] ?? [])].sort((a, b) => a.lowerBound - b.lowerBound);
    if (!tiers.length) {
      errs.push(`لا توجد شرائح للفئة ${c}`);
      continue;
    }
    if (tiers[0].lowerBound !== 0) errs.push(`${c}: أول شريحة لازم تبدأ من 0`);
    tiers.forEach((t, i) => {
      const n = `${c} شريحة ${i + 1}`;
      for (const v of [t.buyerBps, t.sellerBps, t.totalBps]) if (!Number.isInteger(v) || v < 0) errs.push(`${n}: نسبة سالبة أو غير صحيحة`);
      if (t.totalBps > 10000) errs.push(`${n}: النسبة أكبر من 100%`);
      if (t.buyerBps + t.sellerBps !== t.totalBps) errs.push(`${n}: نسبة المشتري + نسبة البائع لا تساوي الإجمالي`);
      if (t.upperBound !== null && t.upperBound <= t.lowerBound) errs.push(`${n}: الحد الأعلى لازم يكون أكبر من الأدنى`);
      const next = tiers[i + 1];
      if (next) {
        if (t.upperBound === null) errs.push(`${n}: شريحة مفتوحة قبل شرائح أخرى (تداخل)`);
        else if (next.lowerBound > t.upperBound) errs.push(`${n}: فجوة بين الشرائح`);
        else if (next.lowerBound < t.upperBound) errs.push(`${n}: تداخل بين الشرائح`);
      } else if (t.upperBound !== null) errs.push(`${n}: آخر شريحة لازم تكون مفتوحة (بدون حد أعلى)`);
    });
    if (errs.length) continue;
    // Monotonicity + rounding invariants at every boundary ±1 piastre and on the samples.
    const points = new Set<number>([0, 1]);
    for (const t of tiers) for (const b of [t.lowerBound, t.upperBound]) if (b !== null) for (const d of [-1, 0, 1]) if (b + d >= 0) points.add(b + d);
    for (const egp of SAMPLE_AMOUNTS_EGP) points.add(egp * 100);
    const sorted = [...points].sort((a, b) => a - b);
    let prev = -1;
    for (const p of sorted) {
      let f;
      try {
        f = computeFee(p, tiers, cfg.minFee);
      } catch {
        errs.push(`${c}: تعذر حساب الرسوم عند ${p / 100} ج.م`);
        break;
      }
      if (f.buyer + f.seller !== f.total || f.buyer < 0 || f.seller < 0) errs.push(`${c}: تقريب غير متسق عند ${p / 100} ج.م`);
      if (f.total < prev) errs.push(`${c}: الرسوم تقل عند تجاوز حد شريحة (${p / 100} ج.م)`);
      prev = f.total;
    }
  }
  return errs;
}

/* ─────────────── Simulation & margin governance ─────────────── */

export interface SimulationInput {
  amount: number;
  shipping: number;
  economicClass?: string;
  /** EDMN-borne payout cost (0 when the seller pays the transfer cost). */
  edmnPayoutCost?: number;
  /** Seller-borne payout transfer cost (deducted from what the seller receives). */
  sellerPayoutCost?: number;
  extraDirectCost?: number;
}

export interface SimulationRow {
  amount: number;
  shipping: number;
  economicClass: string;
  buyerFee: number;
  sellerFee: number;
  totalFee: number;
  minApplied: boolean;
  buyerPayable: number;
  sellerNetBeforePayout: number;
  sellerPayoutCost: number;
  sellerNetAfterPayout: number;
  collectionCost: number;
  edmnPayoutCost: number;
  reserves: number;
  taxProvision: number;
  directCosts: number;
  netContribution: number;
  /** null when the gross revenue is 0 (margin undefined). */
  marginBps: number | null;
  effectiveFeeBps: number;
}

function bpsOf(amount: number, bps: number) {
  return Math.floor((amount * bps + 5000) / 10000);
}

export function simulate(cfg: VersionConfig, input: SimulationInput): SimulationRow {
  const cls = cfg.model === 'MARKETPLACE' ? (input.economicClass ?? 'STANDARD') : 'DEAL';
  const fee =
    cfg.model === 'MARKETPLACE'
      ? (() => {
          const r = computeMarketplaceFee([{ key: 'x', lineTotal: input.amount, economicClass: cls }], cfg.tiersByClass, cfg.minFee);
          return { total: r.total, buyer: r.buyer, seller: r.seller, minApplied: r.minApplied };
        })()
      : computeFee(input.amount, cfg.tiersByClass.DEAL, cfg.minFee);
  const a = cfg.assumptions;
  const buyerPayable = input.amount + input.shipping + fee.buyer;
  const collectionCost = bpsOf(buyerPayable, a.collectionCostBps) + a.collectionCostFixed;
  const reserves = bpsOf(input.amount, a.refundReserveBps + a.disputeReserveBps + a.operationalReserveBps + a.fraudReserveBps);
  const taxProvision = bpsOf(fee.total, a.taxProvisionBps);
  const edmnPayoutCost = input.edmnPayoutCost ?? a.edmnPayoutCostFixed;
  const directCosts = collectionCost + edmnPayoutCost + (input.extraDirectCost ?? 0);
  const net = fee.total - directCosts - reserves - taxProvision;
  const sellerNet = input.amount + input.shipping - fee.seller;
  const sellerPayoutCost = input.sellerPayoutCost ?? 0;
  return {
    amount: input.amount,
    shipping: input.shipping,
    economicClass: cls,
    buyerFee: fee.buyer,
    sellerFee: fee.seller,
    totalFee: fee.total,
    minApplied: fee.minApplied,
    buyerPayable,
    sellerNetBeforePayout: sellerNet,
    sellerPayoutCost,
    sellerNetAfterPayout: sellerNet - sellerPayoutCost,
    collectionCost,
    edmnPayoutCost,
    reserves,
    taxProvision,
    directCosts,
    netContribution: net,
    marginBps: fee.total > 0 ? Math.round((net * 10000) / fee.total) : null,
    effectiveFeeBps: input.amount > 0 ? Math.round((fee.total * 10000) / input.amount) : 0,
  };
}

/** Batch simulation over the representative amounts for every class of the version. */
export function batchSimulate(cfg: VersionConfig, shipping = 0): SimulationRow[] {
  const classes = cfg.model === 'MARKETPLACE' ? [...MARKETPLACE_CLASSES] : ['DEAL'];
  return classes.flatMap((c) => SAMPLE_AMOUNTS_EGP.map((egp) => simulate(cfg, { amount: egp * 100, shipping, economicClass: c })));
}

/**
 * Governance: expected contribution margin = average of the per-sample margins (equal weight per
 * representative transaction). Below the target → publication blocked unless an authorized override.
 */
export function expectedMargin(cfg: VersionConfig): { expectedMarginBps: number; belowTarget: boolean; samplesBelowTarget: SimulationRow[] } {
  const rows = batchSimulate(cfg).filter((r) => r.marginBps !== null);
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + (r.marginBps ?? 0), 0) / rows.length) : 0;
  return { expectedMarginBps: avg, belowTarget: avg < cfg.targetMarginBps, samplesBelowTarget: rows.filter((r) => (r.marginBps ?? 0) < cfg.targetMarginBps) };
}

export const DEFAULT_ASSUMPTIONS: PricingAssumptions = {
  collectionCostBps: 0,
  collectionCostFixed: 0,
  refundReserveBps: 50,
  disputeReserveBps: 25,
  operationalReserveBps: 50,
  fraudReserveBps: 25,
  taxProvisionBps: 0,
  edmnPayoutCostFixed: 0,
};
