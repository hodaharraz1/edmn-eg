import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, type Actor } from '@/server/core/actor';
import { validation } from '@/server/core/errors';
import { applyBps, assertMinor, type Minor } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import { categories, commissionRules, type CommissionTier } from '@/server/db/schema';

export type CommissionRule = typeof commissionRules.$inferSelect;

/**
 * Pick the rate for a unit price. Tiers are price bands on the UNIT price
 * ([{upTo: 30000, bps: 500}, {upTo: null, bps: 300}] → ≤300 EGP: 5%, above: 3%).
 */
export function bpsForUnitPrice(rule: Pick<CommissionRule, 'percentBps' | 'tiers'>, unitPrice: Minor): number {
  const tiers = (rule.tiers ?? []) as CommissionTier[];
  if (!tiers.length) return rule.percentBps;
  const sorted = [...tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const t of sorted) if (t.upTo === null || unitPrice <= t.upTo) return t.bps;
  return sorted[sorted.length - 1].bps;
}

/** Deterministic commission for one order line. Result is capped to the line total. */
export function computeLineCommission(
  rule: Pick<CommissionRule, 'percentBps' | 'tiers' | 'minFee'>,
  unitPrice: Minor,
  quantity: number,
): { bps: number; amount: Minor } {
  assertMinor(unitPrice);
  const lineTotal = unitPrice * quantity;
  const bps = bpsForUnitPrice(rule, unitPrice);
  let amount = applyBps(lineTotal, bps);
  if (rule.minFee && amount < rule.minFee) amount = rule.minFee;
  if (amount > lineTotal) amount = lineTotal;
  return { bps, amount };
}

/**
 * Resolve the effective rule for a category at a point in time: the most specific category in the
 * ancestry path with an enabled rule effective at `at` (latest effectiveFrom wins), else the default rule.
 */
export async function resolveRule(conn: DbOrTx, categoryId: string | null, at: Date = new Date()): Promise<CommissionRule> {
  let path: string[] = [];
  if (categoryId) {
    const [cat] = await conn.select({ path: categories.path }).from(categories).where(eq(categories.id, categoryId));
    path = cat?.path ?? [categoryId];
  }
  if (path.length) {
    const candidates = await conn
      .select()
      .from(commissionRules)
      .where(and(inArray(commissionRules.categoryId, path), eq(commissionRules.isEnabled, true), lte(commissionRules.effectiveFrom, at)))
      .orderBy(desc(commissionRules.effectiveFrom));
    for (const catId of [...path].reverse()) {
      const r = candidates.find((c) => c.categoryId === catId);
      if (r) return r;
    }
  }
  const [def] = await conn
    .select()
    .from(commissionRules)
    .where(and(isNull(commissionRules.categoryId), eq(commissionRules.isEnabled, true), lte(commissionRules.effectiveFrom, at)))
    .orderBy(desc(commissionRules.effectiveFrom))
    .limit(1);
  if (!def) throw new Error('No default commission rule configured');
  return def;
}

export const ruleInputSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  label: z.string().trim().min(2).max(120),
  percentBps: z.number().int().min(0).max(10000),
  minFee: z.number().int().min(0).nullable(),
  tiers: z
    .array(z.object({ upTo: z.number().int().positive().nullable(), bps: z.number().int().min(0).max(10000) }))
    .max(10)
    .nullable(),
  effectiveFrom: z.date(),
  notes: z.string().max(500).optional(),
});

/**
 * Rules are append-only versions: changing a commission creates a NEW rule with a new effective date.
 * Historical order items keep the rule id, bps and amount captured at checkout.
 */
export async function createRule(actor: Actor, input: z.input<typeof ruleInputSchema>) {
  requirePermission(actor, 'commissions.manage');
  const parsed = ruleInputSchema.safeParse(input);
  if (!parsed.success) throw validation('بيانات العمولة غير صحيحة');
  const r = parsed.data;
  if (r.tiers && r.tiers.length && r.tiers.filter((t) => t.upTo === null).length !== 1) {
    throw validation('يجب أن تحتوي الشرائح على شريحة أخيرة مفتوحة (بدون حد أعلى)');
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(commissionRules)
      .values({ ...r, tiers: r.tiers && r.tiers.length ? r.tiers : null, createdBy: actor.userId })
      .returning();
    await audit(tx, actor, { action: 'commission.rule_created', entityType: 'commission_rule', entityId: row.id, newValues: row as unknown as Record<string, unknown> });
    return row;
  });
}

export async function setRuleEnabled(actor: Actor, ruleId: string, enabled: boolean, reason: string) {
  requirePermission(actor, 'commissions.manage');
  if (!reason?.trim()) throw validation('يجب ذكر السبب');
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(commissionRules).where(eq(commissionRules.id, ruleId)).for('update');
    if (!old) throw validation('القاعدة غير موجودة');
    await tx.update(commissionRules).set({ isEnabled: enabled }).where(eq(commissionRules.id, ruleId));
    await audit(tx, actor, { action: 'commission.rule_toggled', entityType: 'commission_rule', entityId: ruleId, oldValues: { isEnabled: old.isEnabled }, newValues: { isEnabled: enabled }, reason });
  });
}
