import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { adminActor, customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import {
  auditLogs,
  conditionSnapshots,
  dealTermsVersions,
  externalDeals,
  journalEntries,
  productPassportEvents,
  productPassports,
  riskFlags,
  usedAnalyticsEvents,
  usedConditionEvidence,
  usedConditionReports,
  usedInspections,
} from '@/server/db/schema';
import {
  claimInvitation,
  confirmDealReceipt,
  createDeal,
  deliveryOtpForBuyer,
  inviteSeller,
  markDealDelivered,
  releaseDeal,
  respondToOffer,
  saveDealStep,
  startDealPayment,
  submitSellerOffer,
  verifyDeliveryOtp,
} from '@/server/modules/deals/service';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { canReadPrivateFile } from '@/server/storage/access';
import { addReportEvidence, declareReport, ensureDealReport, ensureProductReport, recordInspection, removeReportEvidence, reportFor, saveReportAnswers, verifyPassport } from '@/server/modules/used/reports';
import { policyForCategory, savePolicy } from '@/server/modules/used/policies';
import { hashSnapshot, proposeConditionAmendment, respondConditionAmendment, snapshotIntact, snapshotsForDispute } from '@/server/modules/used/snapshots';
import { sanitizeProps, usedAnalytics } from '@/server/modules/used/analytics';
import { safetyFor, sellerSignals } from '@/server/modules/used/signals';
import { MOBILE_PHONE_POLICY, usedPolicySchema } from '@/domain/used';
import { updateSetting } from '@/server/modules/settings';
import { checkout, categoryId, ensurePaymentSetup, makeAdmin, makeCustomer, makeSeller, makeUser, pdf, png, sellerOrdersOf, makerRequest } from '../helpers/factory';
import { createDraft, updateDetails, addImages, saveVariants, updateLogistics, submitForReview, moderateProduct } from '@/server/modules/catalog/products';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
let mobile: string;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
  mobile = await categoryId('mobile-phones');
});

/** A fresh, valid (Luhn) 15-digit IMEI per call — no two tests document the same device by accident. */
function imei(): string {
  const body = `35${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let n = Number(body[13 - i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return body + String((10 - (sum % 10)) % 10);
}

const ANSWERS = {
  brand: 'Apple',
  model: 'iPhone 12',
  storage: '128gb',
  color: 'أزرق',
  battery_health: 86,
  screen_condition: 'light',
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
  charger: true,
  accessories: 'جراب',
  known_defects: 'خدش خفيف على الضهر',
};
const LOC = { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 };

async function joinedUsedDeal(opts: { inspectionDays?: number } = {}) {
  const buyerUser = await makeUser();
  const buyer = customerActor(buyerUser.id);
  const deal = await createDeal(buyer, { title: 'آيفون 12 مستعمل من جروب', description: 'لقيته على جروب بيع، الحالة كويسة جدًا حسب البائع', condition: 'USED', quantity: 1, categoryId: mobile });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '15000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'شحن مع شركة', deliveryDeadline: new Date(Date.now() + 6 * 86400_000), inspectionDays: opts.inspectionDays ?? 3 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const sellerUser = await makeUser();
  const seller = customerActor(sellerUser.id);
  await claimInvitation(seller, token);
  return { buyer, buyerUser, seller, sellerUser, dealId: deal.id };
}

async function documentReport(actor: Actor, reportId: string, answers: Record<string, unknown> = { ...ANSWERS, imei: imei() }) {
  await saveReportAnswers(actor, reportId, answers);
  const r = await reportFor(actor, reportId);
  for (const s of r.policy.evidence) {
    if (s.required || (s.requiredWhenDefects && answers.known_defects)) await addReportEvidence(actor, reportId, s.code, [{ data: await png(s.code), name: `${s.code}.png` }]);
  }
  return declareReport(actor, reportId, true);
}

const OFFER = (r: 'NONE' | 'VOLUNTARY' = 'NONE') => ({
  details: { fullName: 'بائع موبايل مستعمل' },
  location: LOC,
  payout: { type: 'INSTAPAY' as const, holderName: 'بائع موبايل', instapayAddress: `u${randomUUID().slice(0, 6)}@instapay` },
  offer: { shippingFee: '50', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 },
  returnPolicy: r === 'NONE' ? { type: 'NONE' } : { type: 'VOLUNTARY', windowDays: 7 },
});

async function agreedUsedDeal() {
  const d = await joinedUsedDeal();
  const r = await ensureDealReport(d.seller, d.dealId);
  const id = imei();
  await documentReport(d.seller, r.id, { ...ANSWERS, imei: id });
  const { version } = await submitSellerOffer(d.seller, d.dealId, OFFER(), true);
  await respondToOffer(d.buyer, d.dealId, version, 'ACCEPT');
  return { ...d, reportId: r.id, imei: id, version };
}

async function paidUsedDeal() {
  const d = await agreedUsedDeal();
  const p = await startDealPayment(d.buyer, d.dealId, 'INSTAPAY');
  const { submission } = await submitProof(d.buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  await confirmPayment(admin, p.id, submission.id);
  return d;
}

/** Drizzle wraps database errors ("Failed query: …"); the trigger's message is on the cause. */
async function expectDbError(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(() => null, (x: unknown) => x as { message?: string; cause?: { message?: string } });
  expect(e, 'expected the database to refuse').not.toBeNull();
  expect(`${e!.message} ${e!.cause?.message ?? ''}`).toMatch(re);
}

const dealRow = async (id: string) => (await db.select().from(externalDeals).where(eq(externalDeals.id, id)))[0];
const snaps = (dealId: string) => db.select().from(conditionSnapshots).where(eq(conditionSnapshots.dealId, dealId));

/* ───────────────────────── 1. Configuration ───────────────────────── */

describe('used commerce — configurable category policy', () => {
  it('the V1 mobile policy is seeded as data and resolves for the category; other categories have none', async () => {
    const p = await policyForCategory(mobile);
    expect(p?.policy.profile).toBe('mobile_phone');
    expect(p?.policy.fields.find((f) => f.identifier)?.code).toBe('imei');
    expect(await policyForCategory(await categoryId('fashion'))).toBeNull();
  });

  it('policy schema rejects broken configurations (duplicate codes, missing PROTECTED level, bad inspection range)', () => {
    const base = usedPolicySchema.parse(MOBILE_PHONE_POLICY);
    expect(usedPolicySchema.safeParse({ ...base, fields: [...base.fields, base.fields[0]] }).success).toBe(false);
    expect(usedPolicySchema.safeParse({ ...base, levels: ['VERIFIED'] }).success).toBe(false);
    expect(usedPolicySchema.safeParse({ ...base, inspection: { defaultDays: 1, minDays: 2, maxDays: 7 } }).success).toBe(false);
  });

  it('a new category (laptops) is enabled purely by configuration; editing needs catalog.manage + fresh 2FA + reason, audited and versioned', async () => {
    const laptops = await categoryId('computers');
    const config = { ...usedPolicySchema.parse(MOBILE_PHONE_POLICY), profile: 'laptop', title: 'لابتوب مستعمل' };
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    await expect(savePolicy(support, { categoryId: laptops, config, enabled: true, reason: 'تفعيل' })).rejects.toThrow();
    const stale = await adminActor((await makeUser({ staff: true, roles: ['SUPER_ADMIN'] })).id, {});
    await expect(savePolicy(stale, { categoryId: laptops, config, enabled: true, reason: 'تفعيل' })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await expect(savePolicy(admin, { categoryId: laptops, config, enabled: true, reason: '' })).rejects.toThrow();
    const row = await savePolicy(admin, { categoryId: laptops, config, enabled: true, reason: 'تفعيل اللابتوب' });
    expect(row.version).toBe(1);
    const again = await savePolicy(admin, { categoryId: laptops, config: { ...config, title: 'لابتوبات مستعملة' }, enabled: false, reason: 'تعطيل مؤقت' });
    expect(again.version).toBe(2);
    expect(await policyForCategory(laptops)).toBeNull(); // disabled
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'used_category_policy'), eq(auditLogs.entityId, row.id)));
    expect(logs.map((l) => l.action).sort()).toEqual(['used.policy_created', 'used.policy_updated']);
  });
});

/* ───────────────────────── 2. Condition, IMEI privacy, evidence ───────────────────────── */

describe('used commerce — condition documentation', () => {
  it('only the bound deal seller can document; invalid identifiers are refused; the identifier is encrypted + masked + keyed-hashed', async () => {
    const d = await joinedUsedDeal();
    await expect(ensureDealReport(d.buyer, d.dealId)).rejects.toThrow();
    await expect(ensureDealReport(customerActor((await makeUser()).id), d.dealId)).rejects.toThrow();
    const r = await ensureDealReport(d.seller, d.dealId);
    await expect(saveReportAnswers(d.seller, r.id, { ...ANSWERS, imei: '123456789012345' })).rejects.toThrow(/IMEI/);
    const id = imei();
    await saveReportAnswers(d.seller, r.id, { ...ANSWERS, imei: id });
    const [row] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.id, r.id));
    expect(row.identifierEnc).toBeTruthy();
    expect(row.identifierEnc).not.toContain(id);
    expect(row.identifierMasked).toMatch(new RegExp(`${id.slice(-4)}$`));
    expect(row.identifierMasked).not.toContain(id.slice(0, 8));
    expect(row.identifierHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row.answers)).not.toContain(id);
    // Stranger cannot read the report; the buyer can.
    await expect(reportFor(customerActor((await makeUser()).id), r.id)).rejects.toThrow();
    await expect(reportFor(d.buyer, r.id)).resolves.toBeTruthy();
    await expect(saveReportAnswers(d.buyer, r.id, ANSWERS)).rejects.toThrow();
  });

  it('an incomplete report cannot be declared; declaration creates the Product Passport (protection level PROTECTED, never INSPECTED)', async () => {
    const d = await joinedUsedDeal();
    const r = await ensureDealReport(d.seller, d.dealId);
    await saveReportAnswers(d.seller, r.id, { ...ANSWERS, imei: imei() });
    await expect(declareReport(d.seller, r.id, true)).rejects.toThrow(/مش كامل/);
    await expect(declareReport(d.seller, r.id, false)).rejects.toThrow(/الإقرار/);
    const { passportCode } = await documentReport(d.seller, r.id);
    const [pp] = await db.select().from(productPassports).where(eq(productPassports.code, passportCode));
    expect(pp.level).toBe('PROTECTED');
    expect(pp.verificationStatus).toBe('UNREVIEWED');
    const events = await db.select().from(productPassportEvents).where(eq(productPassportEvents.passportId, pp.id));
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['CREATED', 'DECLARED']));
  });

  it('deal evidence is private (CONDITION_EVIDENCE): parties and deal staff only', async () => {
    const d = await joinedUsedDeal();
    const r = await ensureDealReport(d.seller, d.dealId);
    await addReportEvidence(d.seller, r.id, 'imei', [{ data: await png('imei'), name: 'imei.png' }]);
    const [e] = await db.select().from(usedConditionEvidence).where(eq(usedConditionEvidence.reportId, r.id));
    expect(await canReadPrivateFile(d.seller, e.fileId)).toBe(true);
    expect(await canReadPrivateFile(d.buyer, e.fileId)).toBe(true);
    expect(await canReadPrivateFile(customerActor((await makeUser()).id), e.fileId)).toBe(false);
    expect(await canReadPrivateFile(admin, e.fileId)).toBe(true);
    // Per-slot limits and unknown slots are refused.
    await expect(addReportEvidence(d.seller, r.id, 'nope', [{ data: await png(), name: 'x.png' }])).rejects.toThrow();
    await addReportEvidence(d.seller, r.id, 'imei', [{ data: await png('i2'), name: 'i2.png' }]);
    await expect(addReportEvidence(d.seller, r.id, 'imei', [{ data: await png('i3'), name: 'i3.png' }])).rejects.toThrow(/أقصى/);
    // Removing evidence soft-deletes the file (it stops being served).
    await removeReportEvidence(d.seller, r.id, e.id);
    expect(await canReadPrivateFile(d.seller, e.fileId)).toBe(false);
  });

  it('the same device identifier documented by a different seller raises a HIGH fraud flag (no money hold)', async () => {
    const id = imei();
    const a = await joinedUsedDeal();
    const ra = await ensureDealReport(a.seller, a.dealId);
    await documentReport(a.seller, ra.id, { ...ANSWERS, imei: id });
    const b = await joinedUsedDeal();
    const rb = await ensureDealReport(b.seller, b.dealId);
    const { passportCode } = await documentReport(b.seller, rb.id, { ...ANSWERS, imei: id });
    const [pp] = await db.select().from(productPassports).where(eq(productPassports.code, passportCode));
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityType, 'product_passport'), eq(riskFlags.entityId, pp.id)));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: 'DUPLICATE_IDENTIFIER', severity: 'HIGH', status: 'OPEN' });
    expect(JSON.stringify(flags[0])).not.toContain(id);
  });
});

/* ───────────────────────── 3. Condition Freeze ───────────────────────── */

describe('used commerce — product condition freeze', () => {
  it('a covered used deal cannot be offered without a declared report', async () => {
    const d = await joinedUsedDeal();
    await expect(submitSellerOffer(d.seller, d.dealId, OFFER(), true)).rejects.toThrow(/وثّق حالة/);
  });

  it('offer → PROPOSED snapshot bound to the terms version; agreement → ACCEPTED, report LOCKED, hash intact; terms reference the hash', async () => {
    const d = await agreedUsedDeal();
    const rows = await snaps(d.dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACCEPTED', termsVersion: d.version, version: 1, prevHash: null });
    expect(snapshotIntact(rows[0])).toBe(true);
    const deal = await dealRow(d.dealId);
    const terms = deal.agreedTerms as { condition?: { hash: string; passportCode: string } };
    expect(terms.condition?.hash).toBe(rows[0].hash);
    const [r] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.id, d.reportId));
    expect(r.status).toBe('LOCKED');
    // The frozen description carries specs, defects, evidence references and commercial terms — never the clear IMEI.
    const s = rows[0].snapshot as { fields: { code: string }[]; defects: unknown[]; evidence: { sha256: string }[]; commercial: { goodsTotal: number; shippingFee: number; inspectionDays: number }; identifier: { masked: string } };
    expect(s.fields.map((f) => f.code)).toContain('battery_health');
    expect(s.defects.length).toBeGreaterThan(0);
    expect(s.evidence.every((e) => /^[0-9a-f]{64}$/.test(e.sha256))).toBe(true);
    expect(s.commercial).toMatchObject({ goodsTotal: 15000_00, shippingFee: 50_00, inspectionDays: 3 });
    expect(JSON.stringify(rows[0])).not.toContain(d.imei);
    expect(JSON.stringify(deal.agreedTerms)).not.toContain(d.imei);
  });

  it('after agreement the seller cannot silently change the condition: service refuses, DB triggers refuse', async () => {
    const d = await agreedUsedDeal();
    await expect(saveReportAnswers(d.seller, d.reportId, { ...ANSWERS, battery_health: 99 })).rejects.toThrow();
    await expect(addReportEvidence(d.seller, d.reportId, 'front', [{ data: await png(), name: 'f.png' }])).rejects.toThrow();
    await expectDbError(db.execute(sql`update used_condition_reports set answers = '{}'::jsonb where id = ${d.reportId}`), /locked/);
    await expectDbError(db.execute(sql`update used_condition_reports set status = 'DRAFT' where id = ${d.reportId}`), /locked/);
    await expectDbError(db.execute(sql`delete from used_condition_evidence where report_id = ${d.reportId}`), /locked/);
    const [row] = await snaps(d.dealId);
    await expectDbError(db.execute(sql`update condition_snapshots set snapshot = '{}'::jsonb where id = ${row.id}`), /immutable/);
    await expectDbError(db.execute(sql`update condition_snapshots set hash = 'x' where id = ${row.id}`), /immutable/);
    await expectDbError(db.execute(sql`delete from condition_snapshots where id = ${row.id}`), /append-only/);
    await expectDbError(db.execute(sql`update condition_snapshots set status = 'PROPOSED' where id = ${row.id}`), /transition/);
    // Tampering is also detectable in memory (content or chain changed → hash mismatch).
    expect(snapshotIntact({ ...row, snapshot: { ...(row.snapshot as object), defects: [] } })).toBe(false);
    expect(snapshotIntact({ ...row, prevHash: 'forged' })).toBe(false);
  });

  it('material change after agreement = new version + buyer approval + audit; chain links to the previous hash', async () => {
    const d = await paidUsedDeal();
    await expect(proposeConditionAmendment(d.buyer, d.dealId, { changes: { battery_health: 80 }, note: '', reason: 'تحديث البطارية' })).rejects.toThrow();
    const prop = await proposeConditionAmendment(d.seller, d.dealId, { changes: { battery_health: 79 }, note: 'ظهر خدش جديد بعد الاتفاق', reason: 'إفصاح قبل الشحن' });
    await expect(proposeConditionAmendment(d.seller, d.dealId, { changes: { battery_health: 78 }, note: '', reason: 'تعديل تاني على الحالة' })).rejects.toThrow(/مستني/);
    expect(prop.status).toBe('PROPOSED');
    const [first] = (await snaps(d.dealId)).filter((s) => s.version === 1);
    expect(prop.prevHash).toBe(first.hash);
    expect(prop.hash).toBe(hashSnapshot(prop.snapshot, first.hash));
    // Until the buyer accepts, version 1 remains binding.
    expect((await snapshotsForDispute({ dealId: d.dealId, sellerOrderId: null })).map((s) => s.row.version)).toEqual([1]);
    await expect(respondConditionAmendment(d.seller, d.dealId, prop.id, true)).rejects.toThrow();
    await respondConditionAmendment(d.buyer, d.dealId, prop.id, true);
    const all = await snaps(d.dealId);
    expect(all.find((s) => s.version === 1)!.status).toBe('SUPERSEDED');
    expect(all.find((s) => s.version === 2)!.status).toBe('ACCEPTED');
    const binding = await snapshotsForDispute({ dealId: d.dealId, sellerOrderId: null });
    expect(binding).toHaveLength(1);
    expect(binding[0].intact).toBe(true);
    expect((binding[0].snapshot.defects as { label: string }[]).map((x) => x.label)).toContain('إفصاح إضافي من البائع');
    const logs = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, d.dealId));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['used.condition_amendment_proposed', 'used.condition_amendment_accepted']));
  });

  it('rejected offers never bind their snapshot; a counter offer supersedes the pending one', async () => {
    const d = await joinedUsedDeal();
    const r = await ensureDealReport(d.seller, d.dealId);
    await documentReport(d.seller, r.id);
    const { version } = await submitSellerOffer(d.seller, d.dealId, OFFER(), true);
    await respondToOffer(d.buyer, d.dealId, version, 'REQUEST_CHANGE', { returnPolicy: { type: 'VOLUNTARY', windowDays: 7 }, message: 'محتاج إرجاع' });
    expect((await snaps(d.dealId)).map((s) => s.status)).toEqual(['SUPERSEDED']);
    const [rep] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.id, r.id));
    expect(rep.status).toBe('DECLARED'); // still editable before agreement
  });

  it('concurrent double-accept freezes exactly one snapshot', async () => {
    const d = await joinedUsedDeal();
    const r = await ensureDealReport(d.seller, d.dealId);
    await documentReport(d.seller, r.id);
    const { version } = await submitSellerOffer(d.seller, d.dealId, OFFER(), true);
    const res = await Promise.allSettled([respondToOffer(d.buyer, d.dealId, version, 'ACCEPT'), respondToOffer(d.buyer, d.dealId, version, 'ACCEPT')]);
    expect(res.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect((await snaps(d.dealId)).filter((s) => s.status === 'ACCEPTED')).toHaveLength(1);
    const accepted = await db.select().from(dealTermsVersions).where(and(eq(dealTermsVersions.dealId, d.dealId), eq(dealTermsVersions.status, 'ACCEPTED')));
    expect(accepted).toHaveLength(1);
  });
});

/* ───────────────────────── 4. Delivery OTP ≠ acceptance ≠ release ───────────────────────── */

describe('used commerce — inspection period and money', () => {
  it('the inspection period follows the category policy (2–7 days for phones)', async () => {
    await expect(joinedUsedDeal({ inspectionDays: 1 })).rejects.toThrow(/مدة الفحص/);
    await expect(joinedUsedDeal({ inspectionDays: 9 })).rejects.toThrow(/مدة الفحص/);
  });

  it('OTP proves receipt only and starts the inspection window; buyer acceptance only creates entitlement; nothing is released without Admin maker/checker', async () => {
    const d = await paidUsedDeal();
    await markDealDelivered(d.seller, d.dealId, 'شحن', [{ data: pdf(), name: 'waybill.pdf' }]);
    const code = (await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode!;
    const before = Date.now();
    await verifyDeliveryOtp(d.seller, d.dealId, code);
    let deal = await dealRow(d.dealId);
    expect(deal.status).toBe('DELIVERY_HANDOVER_VERIFIED');
    // 3 agreed inspection days (category policy range) — not 24 hours.
    expect(deal.buyerResponseDueAt!.getTime() - before).toBeGreaterThan(2.9 * 86400_000);
    const settled = () => db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, d.dealId), eq(journalEntries.entryType, 'DEAL_SETTLEMENT')));
    expect(await settled()).toHaveLength(0);
    await confirmDealReceipt(d.buyer, d.dealId);
    deal = await dealRow(d.dealId);
    expect(['BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE']).toContain(deal.status);
    expect(await settled()).toHaveLength(0);
    const remaining = deal.buyerPays! - deal.pendingBuyerRefund;
    const expectedPayout = remaining - Math.min(deal.feeAmount, remaining);
    // A single admin cannot release without an independent maker request.
    await expect(releaseDeal(admin, d.dealId, { expectedPayout, reason: 'إتاحة بدون طلب' })).rejects.toThrow();
    expect(await settled()).toHaveLength(0);
    // Authorized flow: maker ≠ checker.
    const maker = await makeAdmin(['FINANCE_OPERATOR']);
    await makerRequest('DEAL_RELEASE', d.dealId, expectedPayout, { maker });
    await expect(releaseDeal(maker, d.dealId, { expectedPayout, reason: 'نفس الشخص' })).rejects.toThrow();
    await releaseDeal(admin, d.dealId, { expectedPayout, reason: 'إتاحة بعد قبول المشتري' });
    expect(await settled()).toHaveLength(1);
    const [entry] = await settled();
    const lines = await db.execute<{ d: string; c: string }>(sql`select coalesce(sum(debit),0)::text d, coalesce(sum(credit),0)::text c from journal_lines where entry_id = ${entry.id}`);
    expect(lines.rows[0].d).toBe(lines.rows[0].c);
  });

  it('a structured used dispute during inspection holds the deal and is judged against the frozen snapshot', async () => {
    const d = await paidUsedDeal();
    await markDealDelivered(d.seller, d.dealId, 'شحن');
    await verifyDeliveryOtp(d.seller, d.dealId, (await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode!);
    // A stranger can never open it.
    await expect(openDispute(customerActor((await makeUser()).id), { dealId: d.dealId, reasonCode: 'UNDISCLOSED_DEFECT', description: 'الموبايل فيه مشكلة في الشحن مش مذكورة خالص' })).rejects.toThrow();
    const dispute = await openDispute(d.buyer, { dealId: d.dealId, reasonCode: 'UNDISCLOSED_DEFECT', description: 'الموبايل فيه مشكلة في الشحن مش مذكورة في جواز المنتج' }, [{ data: await png('ev'), name: 'ev.png' }]);
    expect((await dealRow(d.dealId)).status).toBe('DISPUTED');
    const binding = await snapshotsForDispute(dispute);
    expect(binding).toHaveLength(1);
    expect(binding[0].intact).toBe(true);
    expect(binding[0].snapshot.disputeReasons.map((r) => r.code)).toContain('UNDISCLOSED_DEFECT');
    await expect(releaseDeal(admin, d.dealId, { expectedPayout: 1, reason: 'محاولة إتاحة' })).rejects.toThrow();
  });
});

/* ───────────────────────── 5. Staff verification, inspection, levels ───────────────────────── */

describe('used commerce — verification and real inspection', () => {
  it('VERIFIED needs deal staff + fresh 2FA, never the author or a party; INSPECTED needs a recorded inspection with its report', async () => {
    const d = await joinedUsedDeal();
    const r = await ensureDealReport(d.seller, d.dealId);
    const { passportCode } = await documentReport(d.seller, r.id);
    const [pp] = await db.select().from(productPassports).where(eq(productPassports.code, passportCode));
    const catalogOnly = await makeAdmin(['CATALOG_REVIEWER']);
    await expect(verifyPassport(catalogOnly, pp.id, 'VERIFIED', 'تمام')).rejects.toThrow();
    const stale = await adminActor((await makeUser({ staff: true, roles: ['SUPER_ADMIN'] })).id, {});
    await expect(verifyPassport(stale, pp.id, 'VERIFIED', 'تمام')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect((await verifyPassport(admin, pp.id, 'VERIFIED', 'الصور والبيانات مطابقة')).level).toBe('VERIFIED');
    await expect(recordInspection(admin, pp.id, { provider: 'مركز فحص', inspectorName: 'فاحص', result: 'PASS', summary: 'كل الوظائف شغالة', performedAt: new Date() }, null)).rejects.toThrow(/تقرير/);
    const insp = await recordInspection(admin, pp.id, { provider: 'مركز فحص معتمد', inspectorName: 'م. أحمد', result: 'PASS', summary: 'كل الوظائف شغالة والبطارية مطابقة', performedAt: new Date() }, { data: pdf(), name: 'report.pdf' });
    const [after] = await db.select().from(productPassports).where(eq(productPassports.id, pp.id));
    expect(after.level).toBe('INSPECTED');
    // The inspection report is private evidence: parties yes, strangers no.
    expect(await canReadPrivateFile(d.buyer, insp.reportFileId)).toBe(true);
    expect(await canReadPrivateFile(customerActor((await makeUser()).id), insp.reportFileId)).toBe(false);
    await expectDbError(db.execute(sql`update used_inspections set result = 'FAIL' where id = ${insp.id}`), /append-only/);
    await expectDbError(db.execute(sql`delete from product_passport_events where passport_id = ${pp.id}`), /append-only/);
    expect(await db.select().from(usedInspections).where(eq(usedInspections.passportId, pp.id))).toHaveLength(1);
  });

  it('editing a declared report voids the earlier verification (re-declaration needed)', async () => {
    const d = await joinedUsedDeal();
    const r = await ensureDealReport(d.seller, d.dealId);
    const { passportCode } = await documentReport(d.seller, r.id);
    const [pp] = await db.select().from(productPassports).where(eq(productPassports.code, passportCode));
    await verifyPassport(admin, pp.id, 'VERIFIED', 'تمام');
    await saveReportAnswers(d.seller, r.id, { ...ANSWERS, battery_health: 70 });
    const [after] = await db.select().from(productPassports).where(eq(productPassports.id, pp.id));
    expect(after.verificationStatus).toBe('UNREVIEWED');
    expect(after.level).toBe('PROTECTED');
    const [rep] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.id, r.id));
    expect(rep.status).toBe('DRAFT');
  });
});

/* ───────────────────────── 6. Marketplace listing + checkout freeze ───────────────────────── */

describe('used commerce — marketplace listing', () => {
  it('a used phone listing needs a declared report to be submitted; public photos are public images, the IMEI photo is private; checkout freezes the condition for the buyer', async () => {
    const s = await makeSeller(admin);
    const p = await createDraft(s.actor, { categoryId: mobile, titleAr: 'سامسونج S21 مستعمل للبيع', condition: 'USED' });
    await updateDetails(s.actor, p.id, { titleAr: 'سامسونج S21 مستعمل للبيع', categoryId: mobile, description: 'موبايل سامسونج مستعمل بحالة ممتازة جدًا', keyFeatures: ['ميزة'], condition: 'USED', usedGrade: 'VERY_GOOD', conditionNotes: 'حالة ممتازة', defects: 'خدش', attributes: { model: ['S21'], storage: ['128GB'] } });
    await addImages(s.actor, p.id, [{ data: await png('a'), name: 'a.png' }, { data: await png('b'), name: 'b.png' }], true);
    await saveVariants(s.actor, p.id, [{ sku: `SKU-${randomUUID().slice(0, 6)}`, price: 9000_00, stockOnHand: 1, options: {}, isActive: true, lowStockThreshold: 1 }]);
    await updateLogistics(s.actor, p.id, { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, processingDays: null, returnPolicyOverride: false, acceptsVoluntaryReturns: null, voluntaryReturnDays: null });
    await expect(submitForReview(s.actor, p.id)).rejects.toThrow(/جواز المنتج/);
    const r = await ensureProductReport(s.actor, p.id);
    const id = imei();
    await documentReport(s.actor, r.id, { ...ANSWERS, imei: id });
    await submitForReview(s.actor, p.id);
    await moderateProduct(admin, p.id, 'APPROVE');
    const ev = await db.execute<{ slot: string; visibility: string; file_id: string }>(sql`select e.slot, f.visibility, e.file_id from used_condition_evidence e join files f on f.id = e.file_id where e.report_id = ${r.id}`);
    expect(ev.rows.find((x) => x.slot === 'front')!.visibility).toBe('PUBLIC');
    const imeiFile = ev.rows.find((x) => x.slot === 'imei')!;
    expect(imeiFile.visibility).toBe('PRIVATE');
    const buyer = await makeCustomer();
    const stranger = await makeCustomer();
    expect(await canReadPrivateFile(buyer.actor, imeiFile.file_id)).toBe(false);
    const { variantOf } = await import('../helpers/factory');
    const order = await checkout(buyer, [{ variantId: await variantOf(p.id), qty: 1 }]);
    const [so] = await sellerOrdersOf(order.id);
    const [snap] = await db.select().from(conditionSnapshots).where(eq(conditionSnapshots.sellerOrderId, so.id));
    expect(snap).toMatchObject({ status: 'ACCEPTED', version: 1 });
    expect(snapshotIntact(snap)).toBe(true);
    expect(JSON.stringify(snap.snapshot)).not.toContain(id);
    expect(await canReadPrivateFile(buyer.actor, imeiFile.file_id)).toBe(true);
    expect(await canReadPrivateFile(stranger.actor, imeiFile.file_id)).toBe(false);
    // Another seller cannot touch the report.
    const other = await makeSeller(admin);
    await expect(saveReportAnswers(other.actor, r.id, ANSWERS)).rejects.toThrow();
    await expect(ensureProductReport(other.actor, p.id)).rejects.toThrow();
  });
});

/* ───────────────────────── 7. Safety score, reputation, analytics ───────────────────────── */

describe('used commerce — explainable score, seller signals, privacy-safe analytics', () => {
  it('seller signals state their sample; the safety score explains every factor and follows admin-configured weights', async () => {
    const d = await joinedUsedDeal();
    const sig = await sellerSignals(d.sellerUser.id);
    expect(sig.identityApproved).toBe(true);
    expect(sig.signals.find((x) => x.key === 'disputeRate')!.value).toBe('لسه بيانات قليلة');
    const base = { sellerUserId: d.sellerUser.id, conditionCompleteness: 1, evidenceCompleteness: 1, level: 'PROTECTED' as const, inspected: false, shippingEvidence: null, returnPolicy: 'VOLUNTARY' as const };
    const a = await safetyFor(base);
    expect(a.score.factors.find((f) => f.factor === 'SHIPPING_EVIDENCE')!.applicable).toBe(false);
    expect(a.score.factors.every((f) => f.why.length > 0)).toBe(true);
    await updateSetting(admin, 'used.safetyScore', { weights: { SELLER_VERIFICATION: 0, ACCOUNT_HISTORY: 0, COMPLETED_DEALS: 0, DISPUTE_HISTORY: 0, CONDITION_COMPLETENESS: 10, EVIDENCE_COMPLETENESS: 10, INSPECTION: 0, SHIPPING_EVIDENCE: 0, RETURN_POLICY: 0, PROTECTION_LEVEL: 0 }, thresholds: { high: 90, medium: 50 }, fullAccountAgeDays: 180, fullCompletedDeals: 10 }, 'اختبار الأوزان');
    try {
      const b = await safetyFor(base);
      expect(b.score.score).toBe(100);
      expect(b.score.level).toBe('HIGH');
    } finally {
      await db.execute(sql`delete from system_settings where key = 'used.safetyScore'`);
    }
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    await expect(updateSetting(support, 'used.safetyScore', {}, 'x x')).rejects.toThrow();
  });

  it('analytics drop anything that is not a whitelisted coarse property, and never hold identifiers', async () => {
    expect(sanitizeProps({ profile: 'mobile_phone', level: 'VERIFIED', name: 'أحمد', phone: '01000000000', imei: '490154203237518', valueBucket: '5k-20k', amount: 1500000 })).toEqual({ profile: 'mobile_phone', level: 'VERIFIED', valueBucket: '5k-20k' });
    const d = await agreedUsedDeal();
    const rows = await db.select().from(usedAnalyticsEvents);
    expect(JSON.stringify(rows)).not.toContain(d.imei);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(['EXTERNAL_DEAL_CREATED', 'DEAL_INVITE_CLAIMED', 'SELLER_OFFER_SUBMITTED', 'CONDITION_FROZEN']));
    const view = await usedAnalytics(admin);
    expect(view.funnel.find((f) => f.stage === 'agreed')).toBeTruthy();
    await expect(usedAnalytics(customerActor(d.buyerUser.id))).rejects.toThrow();
  });
});
