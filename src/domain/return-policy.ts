import { z } from 'zod';

/**
 * Seller's VOLUNTARY return policy (for marketplace listings and protected-deal offers).
 *
 * It is deliberately separate from (a) mandatory consumer rights, whose window/notice are admin
 * settings, and (b) the EDMN dispute/protection mechanism. "No voluntary returns" NEVER blocks a
 * defective / wrong / damaged / not-as-described claim or a dispute.
 */
export const RETURN_CONDITION_KEYS = ['ORIGINAL_CONDITION', 'ALL_ACCESSORIES', 'ORIGINAL_PACKAGING', 'NO_BUYER_DAMAGE'] as const;
export const RETURN_CONDITION_LABELS: Record<(typeof RETURN_CONDITION_KEYS)[number], string> = {
  ORIGINAL_CONDITION: 'المنتج بحالته الأصلية',
  ALL_ACCESSORIES: 'الملحقات كاملة',
  ORIGINAL_PACKAGING: 'التغليف الأصلي موجود (إن وُجد)',
  NO_BUYER_DAMAGE: 'المنتج لم يتعرض لتلف بسبب المشتري',
};
export const RETURN_SHIPPING_PAYERS = ['SELLER', 'BUYER', 'BY_REASON'] as const;
export const RETURN_SHIPPING_LABELS: Record<(typeof RETURN_SHIPPING_PAYERS)[number], string> = {
  SELLER: 'البائع يتحمل شحن الإرجاع',
  BUYER: 'المشتري يتحمل شحن الإرجاع',
  BY_REASON: 'حسب السبب: البائع عند العيب/الخطأ، والمشتري في الإرجاع الاختياري',
};

export const returnPolicySchema = z
  .object({
    type: z.enum(['VOLUNTARY', 'NONE']),
    windowDays: z.coerce.number().int().min(1, 'حدد مدة الإرجاع بالأيام').max(90).nullable().optional(),
    conditions: z.array(z.enum(RETURN_CONDITION_KEYS)).max(RETURN_CONDITION_KEYS.length).default([]),
    shippingPayer: z.enum(RETURN_SHIPPING_PAYERS).default('BY_REASON'),
    notes: z.string().trim().max(1000).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'VOLUNTARY' && !v.windowDays) ctx.addIssue({ code: 'custom', path: ['windowDays'], message: 'حدد مدة الإرجاع بالأيام' });
  })
  .transform((v) => (v.type === 'NONE' ? { type: 'NONE' as const, windowDays: null, conditions: [], shippingPayer: v.shippingPayer, notes: v.notes } : { ...v, windowDays: v.windowDays ?? null }));
export type ReturnPolicy = z.output<typeof returnPolicySchema>;

/** What is stored on order items / agreed deal terms: the policy plus the legal notice version shown. */
export type ReturnPolicySnapshot = ReturnPolicy & { legalNoticeVersion: string | null };

export const NO_VOLUNTARY_TEXT = 'البائع مش بيقدّم إرجاع اختياري للمنتج ده.';
export const DEFAULT_MANDATORY_NOTICE = 'مع عدم الإخلال بأي حقوق إلزامية للمستهلك تنطبق وفق القانون.';
/** Reasons that are never blocked by a seller's voluntary policy (handled by return/dispute rules). */
export const PROTECTED_REASONS = ['WRONG_ITEM', 'DAMAGED', 'DEFECTIVE', 'MISSING_PARTS', 'NOT_AS_DESCRIBED', 'COUNTERFEIT_SUSPECTED'] as const;

export function returnPolicySummary(p: Pick<ReturnPolicy, 'type' | 'windowDays'> | null | undefined): string {
  if (!p) return 'غير محددة';
  return p.type === 'VOLUNTARY' ? `بيقبل الإرجاع الاختياري خلال ${p.windowDays} يوم من الاستلام` : NO_VOLUNTARY_TEXT;
}

/** Read a policy from FormData-like values (fields prefixed "rp_"). */
export function returnPolicyFromValues(get: (k: string) => string, getAll: (k: string) => string[]): unknown {
  return {
    type: get('rp_type') === 'VOLUNTARY' ? 'VOLUNTARY' : 'NONE',
    windowDays: get('rp_windowDays') ? Number(get('rp_windowDays')) : null,
    conditions: getAll('rp_conditions'),
    shippingPayer: get('rp_shippingPayer') || 'BY_REASON',
    notes: get('rp_notes'),
  };
}
