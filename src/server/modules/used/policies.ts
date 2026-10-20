import { and, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { categories, usedCategoryPolicies } from '@/server/db/schema';
import { MOBILE_PHONE_POLICY, usedPolicySchema, type UsedPolicy } from '@/domain/used';

export type PolicyRow = typeof usedCategoryPolicies.$inferSelect;
export type ResolvedPolicy = { row: PolicyRow; policy: UsedPolicy };

export function parsePolicy(row: PolicyRow): UsedPolicy {
  return usedPolicySchema.parse(row.config);
}

/**
 * The used-condition policy that governs a category: the deepest ENABLED policy on the category's path (a policy
 * on a parent category applies to its children unless a child has its own).
 */
export async function policyForCategory(categoryId: string | null | undefined, conn: DbOrTx = db): Promise<ResolvedPolicy | null> {
  if (!categoryId) return null;
  const [cat] = await conn.select({ path: categories.path }).from(categories).where(eq(categories.id, categoryId));
  const path = (cat?.path as string[] | null) ?? [categoryId];
  if (!path.length) return null;
  const rows = await conn
    .select()
    .from(usedCategoryPolicies)
    .where(and(inArray(usedCategoryPolicies.categoryId, path), eq(usedCategoryPolicies.enabled, true)));
  if (!rows.length) return null;
  const row = rows.sort((a, b) => path.indexOf(b.categoryId) - path.indexOf(a.categoryId))[0];
  return { row, policy: parsePolicy(row) };
}

export async function policyById(id: string, conn: DbOrTx = db): Promise<ResolvedPolicy> {
  const [row] = await conn.select().from(usedCategoryPolicies).where(eq(usedCategoryPolicies.id, id));
  if (!row) throw notFound('سياسة الفئة');
  return { row, policy: parsePolicy(row) };
}

export async function listPolicies() {
  return db
    .select({ p: usedCategoryPolicies, categoryName: categories.nameAr, categorySlug: categories.slug })
    .from(usedCategoryPolicies)
    .innerJoin(categories, eq(categories.id, usedCategoryPolicies.categoryId))
    .orderBy(desc(usedCategoryPolicies.updatedAt));
}

/**
 * Admin: create or replace a category's used policy (catalog.manage + fresh 2FA, reason, audited with the old and new
 * configuration). Every change is a new version; existing reports and frozen snapshots keep the version they used.
 */
export async function savePolicy(actor: Actor, input: { categoryId: string; config: unknown; enabled: boolean; reason: string }) {
  requirePermission(actor, 'catalog.manage');
  requireStepUp(actor);
  if (!input.reason || input.reason.trim().length < 3) throw validation('اكتب سبب التعديل');
  const parsed = usedPolicySchema.safeParse(input.config);
  if (!parsed.success) throw validation(`إعدادات غير صالحة: ${parsed.error.issues.map((i) => i.message).slice(0, 3).join('، ')}`);
  return db.transaction(async (tx) => {
    const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, input.categoryId));
    if (!cat) throw notFound('الفئة');
    const [old] = await tx.select().from(usedCategoryPolicies).where(eq(usedCategoryPolicies.categoryId, input.categoryId)).for('update');
    const [row] = old
      ? await tx
          .update(usedCategoryPolicies)
          .set({ config: parsed.data, enabled: input.enabled, version: old.version + 1, updatedBy: actor.userId })
          .where(eq(usedCategoryPolicies.id, old.id))
          .returning()
      : await tx.insert(usedCategoryPolicies).values({ categoryId: input.categoryId, config: parsed.data, enabled: input.enabled, updatedBy: actor.userId }).returning();
    await audit(tx, actor, {
      action: old ? 'used.policy_updated' : 'used.policy_created',
      entityType: 'used_category_policy',
      entityId: row.id,
      oldValues: old ? { version: old.version, enabled: old.enabled, config: old.config } : undefined,
      newValues: { version: row.version, enabled: row.enabled, config: parsed.data },
      reason: input.reason.trim(),
    });
    return row;
  });
}

/** Reference seed: the V1 policy for used mobile phones (idempotent; never overwrites an admin-edited policy). */
export async function seedUsedPolicies(conn: DbOrTx = db) {
  const [cat] = await conn.select({ id: categories.id }).from(categories).where(eq(categories.slug, 'mobile-phones'));
  if (!cat) return;
  await conn.insert(usedCategoryPolicies).values({ categoryId: cat.id, config: usedPolicySchema.parse(MOBILE_PHONE_POLICY) }).onConflictDoNothing();
}
