import { and, eq } from 'drizzle-orm';
import { adminActor, sellerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { productPassports, products, productVariants, sellers, users, usedConditionReports } from '@/server/db/schema';
import { addReportEvidence, declareReport, ensureProductReport, saveReportAnswers, verifyPassport } from '@/server/modules/used/reports';
import { policyById } from '@/server/modules/used/policies';
import { demoImage } from './demo-images';

/**
 * Demo documentation for used listings in covered categories (DEMO DATA, staging/local only). The identifier is a
 * public test IMEI (valid checksum, not a real device). Photos are generated placeholders, never real people.
 */
export const USED_DEMO_DOCS: Record<string, Record<string, string | number | boolean>> = {
  'UW-IP13P-256': {
    brand: 'Apple',
    model: 'iPhone 13 Pro',
    storage: '256gb',
    color: 'فضي',
    imei: '490154203237518',
    battery_health: 88,
    screen_condition: 'perfect',
    screen_original: 'original',
    biometrics: 'works',
    cameras: 'works',
    speakers: 'works',
    microphone: 'works',
    charging: 'works',
    wifi: 'works',
    bluetooth: 'works',
    cellular: 'works',
    scratches: 'light',
    dents: 'none',
    cracks: 'none',
    opened: 'no',
    water_damage: 'none',
    box: true,
    charger: false,
    accessories: 'كابل شحن أصلي',
    known_defects: 'خدش صغير على الإطار الجانبي الأيسر',
  },
};

/** Documents + declares one used listing through the REAL services (no direct status writes). */
export async function documentUsedListing(seller: Actor, productId: string, answers: Record<string, string | number | boolean>) {
  const r = await ensureProductReport(seller, productId);
  if (r.status !== 'DRAFT') return r;
  await saveReportAnswers(seller, r.id, answers);
  const { policy } = await policyById(r.policyId);
  const hasDefects = !!answers.known_defects;
  for (const slot of policy.evidence) {
    if (!slot.required && !(slot.requiredWhenDefects && hasDefects)) continue;
    await addReportEvidence(seller, r.id, slot.code, [{ data: await demoImage(slot.label, 'phone', slot.code.length), name: `${slot.code}.png` }]);
  }
  await declareReport(seller, r.id, true);
  return r;
}

/**
 * Idempotent backfill for an EXISTING demo database (staging): documents the demo used phone if it is not documented
 * yet, then a catalog reviewer (not the seller) reviews the passport. Safe to run on every deploy.
 */
export async function seedUsedDemo() {
  for (const [sku, answers] of Object.entries(USED_DEMO_DOCS)) {
    const [row] = await db
      .select({ productId: products.id, ownerUserId: sellers.ownerUserId })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .where(eq(productVariants.sku, sku));
    if (!row) continue;
    const seller = await sellerActor(row.ownerUserId);
    if (!seller) continue;
    const [existing] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.productId, row.productId));
    if (!existing || existing.status === 'DRAFT') await documentUsedListing(seller, row.productId, answers);
    await reviewDemoPassport(row.productId);
  }
}

async function reviewDemoPassport(productId: string) {
  const [pp] = await db.select().from(productPassports).where(and(eq(productPassports.productId, productId), eq(productPassports.verificationStatus, 'UNREVIEWED')));
  if (!pp) return;
  const [reviewer] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'catalog@edmn.local'));
  if (!reviewer) return;
  const actor = await adminActor(reviewer.id, { stepUpAt: new Date() });
  await verifyPassport(actor, pp.id, 'VERIFIED', 'مراجعة بيانات وصور الديمو (مراجعة مستندات، مش فحص فني)');
}
