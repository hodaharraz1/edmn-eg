import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { adminActor, customerActor, sellerActor } from '@/server/auth/actors';
import { login, verifyTotpForUser } from '@/server/auth/service';
import { passwordProblems, CUSTOMER_POLICY } from '@/server/auth/password';
import { totpCode } from '@/server/auth/totp';
import { encrypt, encryptJson } from '@/server/core/crypto';
import { unsafeProductionConfig, type Env } from '@/server/core/env';
import { logger, redactForLog, safeErrorMessage, sanitizeError } from '@/server/core/logger';
import { SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { assertNotProductionDatabase, markDeploymentEnvironment } from '@/server/db/environment';
import {
  addresses,
  auditLogs,
  deploymentEnvironment,
  disputes,
  externalDeals,
  financialApprovals,
  journalEntries,
  paymentDestinations,
  refunds,
  roles,
  sellerPayoutMethods,
  systemSettings,
  userRoles,
  users,
  withdrawalRequests,
} from '@/server/db/schema';
import { assertDemoSeedAllowed, DEMO_TOTP_SECRET } from '@/server/db/seed/demo';
import { confirmReceipt, releaseBlockers } from '@/server/modules/commerce/fulfilment';
import { createDeal, claimInvitation, inviteSeller, respondToOffer, saveDealStep, setDealFinancialHold, startDealPayment, submitSellerOffer } from '@/server/modules/deals/service';
import { goLiveGate } from '@/server/modules/finance/controls';
import { accountBalance, reconcile } from '@/server/modules/finance/ledger';
import { approveRefund, overrideRefundDestination, reapproveRefundDestination, recordRefundPayout, rejectRefund, requestRefundTx } from '@/server/modules/finance/refunds';
import {
  approveWithdrawal,
  markWithdrawalFailedBeforeTransfer,
  markWithdrawalPaid,
  markWithdrawalProcessing,
  markWithdrawalTransferUncertain,
  recordWithdrawalReturned,
  rejectWithdrawal,
  requestWithdrawal,
} from '@/server/modules/finance/withdrawals';
import { confirmPayment, saveDestination, submitProof } from '@/server/modules/payments/service';
import { closeDispute, openDispute, resolveDispute, setDisputeStatus } from '@/server/modules/postpurchase/disputes';
import { activePayoutMethod, addPayoutMethod, assertVerifiedDestination, decideSeller, saveIdentity, saveStore, startApplication, submitApplication, uploadSellerDocument, verifyPayoutMethod } from '@/server/modules/sellers/service';
import { effectiveDualControlThreshold, realMoneyEnabled, updateSetting } from '@/server/modules/settings';
import { createStaffUser, setRolePermissions, setStaffRole, setStaffStatus } from '@/server/rbac/staff';
import { approveIdentity, checkout, makerRequest, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * PRODUCTION HARDENING — BATCH 1 (C1–C8 + operator wording) regression suite.
 * Every test pins a finding of the accepted Production Readiness Audit. Do not weaken these to get green.
 */
let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});
afterEach(() => vi.restoreAllMocks());
vi.mock('server-only', () => ({}));

const noStepUp = async (a: Actor) => adminActor(a.userId!, { stepUpAt: null });
const disputeOf = async (id: string) => (await db.select().from(disputes).where(eq(disputes.id, id)))[0];
const auditActions = async (entityId: string) => (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, entityId))).map((r) => r.a);
const journalsOf = async (sourceId: string, type: string) => db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, sourceId), eq(journalEntries.entryType, type)));

async function shippedOrder(price = 400_00, buyer?: Awaited<ReturnType<typeof makeCustomer>>) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 10 });
  const c = buyer ?? (await makeCustomer());
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  return { s, c, so, order };
}
const disputeText = 'المنتج المستلم مختلف تماماً عن الوصف المعروض في الإعلان';

/* ═══════════════════════════ C1 — dispute resolution & holds ═══════════════════════════ */
describe('C1 — a dispute (financial hold) leaves the open states only through a formal decision', () => {
  it('a generic status edit can never resolve or close an open dispute, and the hold stays', async () => {
    const { c, so } = await shippedOrder();
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: disputeText });
    for (const to of ['RESOLVED', 'CLOSED']) {
      await expect(setDisputeStatus(admin, d.id, to as 'UNDER_REVIEW', 'x')).rejects.toThrow(/قرار رسمي/);
    }
    await expect(closeDispute(admin, d.id)).rejects.toThrow(/بدون قرار رسمي/);
    expect((await disputeOf(d.id)).status).toBe('OPEN');
    const [fresh] = await sellerOrdersOf(so.orderId);
    expect(await releaseBlockers(db, fresh)).toContain('نزاع مفتوح');
    // workflow-only states are still fine and keep the hold
    await setDisputeStatus(admin, d.id, 'UNDER_REVIEW', 'مراجعة الأدلة');
    expect(await releaseBlockers(db, (await sellerOrdersOf(so.orderId))[0])).toContain('نزاع مفتوح');
  });

  it('resolution requires the permission, fresh 2FA, an outcome and a reason', async () => {
    const { c, so } = await shippedOrder();
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: disputeText });
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    await expect(resolveDispute(support, d.id, { decision: 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'لا توجد أدلة كافية على الشكوى' })).rejects.toThrow(/صلاحية/);
    const officer = await makeAdmin(['DISPUTE_OFFICER']);
    await expect(resolveDispute(await noStepUp(officer), d.id, { decision: 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'لا توجد أدلة كافية على الشكوى' })).rejects.toThrow(/تأكيد هويتك/);
    await expect(resolveDispute(officer, d.id, { decision: 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'قصير' })).rejects.toThrow();
    await expect(resolveDispute(officer, d.id, { decision: 'NOTHING' as 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'لا توجد أدلة كافية على الشكوى' })).rejects.toThrow();
    expect((await disputeOf(d.id)).status).toBe('OPEN');
  });

  it('conflict of interest: a staff member who is the claimant cannot decide the dispute', async () => {
    const staff = await makeUser({ staff: true, roles: ['DISPUTE_OFFICER'] });
    const [address] = await db.insert(addresses).values({ userId: staff.id, recipientName: staff.fullName, phone: staff.phone!, governorateId: 1, city: 'القاهرة', street: 'شارع الاختبار', isDefault: true }).returning();
    await approveIdentity(staff.id); // Batch 1.5: a staff member buying as a customer verifies identity like anyone
    const buyer = { user: staff, actor: customerActor(staff.id), address };
    const { so } = await shippedOrder(300_00, buyer);
    const d = await openDispute(buyer.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: disputeText });
    const self = await adminActor(staff.id, { stepUpAt: new Date() });
    await expect(resolveDispute(self, d.id, { decision: 'FULL_REFUND', reasonCode: 'SELF', note: 'قرار لصالح نفسي في النزاع' })).rejects.toThrow(/طرف فيه/);
    expect((await disputeOf(d.id)).status).toBe('OPEN');
  });

  it('a decision is audited, transactional and happens once; closing afterwards is archival only', async () => {
    const { c, so } = await shippedOrder();
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: disputeText });
    const officer = await makeAdmin(['DISPUTE_OFFICER']);
    await resolveDispute(officer, d.id, { decision: 'FULL_REFUND', reasonCode: 'ITEM_NOT_AS_DESCRIBED', note: 'الأدلة تؤكد اختلاف المنتج عن الوصف' });
    await expect(resolveDispute(officer, d.id, { decision: 'FULL_REFUND', reasonCode: 'ITEM_NOT_AS_DESCRIBED', note: 'الأدلة تؤكد اختلاف المنتج عن الوصف' })).rejects.toThrow(/تم حسم/);
    expect(await db.select().from(refunds).where(eq(refunds.sourceId, d.id))).toHaveLength(1);
    expect(await auditActions(d.id)).toContain('dispute.resolved');
    await closeDispute(admin, d.id);
    await closeDispute(admin, d.id); // idempotent
    expect((await disputeOf(d.id)).status).toBe('CLOSED');
    expect(await auditActions(d.id)).toContain('dispute.closed');
  });

  it('receipt confirmation while the buyer\'s dispute is open is refused (fail closed) and creates no entitlement', async () => {
    const { c, so } = await shippedOrder();
    await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: disputeText });
    await expect(confirmReceipt(c.actor, so.id)).rejects.toThrow(/نزاع مفتوح/);
    const [after] = await sellerOrdersOf(so.orderId);
    expect(after.status).toBe('SHIPPED');
    expect(after.receiptBasis).toBeNull();
  });

  it('a party to a protected deal can neither place nor lift its financial hold', async () => {
    const staff = await makeUser({ staff: true, roles: ['OPERATIONS_MANAGER'] });
    const buyer = customerActor(staff.id);
    const deal = await createDeal(buyer, { title: 'جهاز للاختبار', description: 'جهاز بحالة جيدة جداً للاختبار', condition: 'NEW', quantity: 1 });
    const self = await adminActor(staff.id, { stepUpAt: new Date() });
    await expect(setDealFinancialHold(self, deal.id, true, 'تجميد صفقتي الخاصة')).rejects.toThrow(/طرف فيها/);
    const ops = await makeAdmin(['OPERATIONS_MANAGER']);
    await setDealFinancialHold(ops, deal.id, true, 'مراجعة احترازية');
    expect((await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id)))[0].financialHold).toBe(true);
    await expect(setDealFinancialHold(self, deal.id, false, 'فك تجميد صفقتي')).rejects.toThrow(/طرف فيها/);
  });
});

/* ═══════════════════════════ C2 — SUPER_ADMIN escalation ═══════════════════════════ */
describe('C2 — roles.manage alone can never mint SUPER_ADMIN (or any privileged role)', () => {
  const email = () => `staff-${randomUUID().slice(0, 8)}@test.local`;
  const phone = () => `+2011${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  let manager: Actor;
  let superAdmin: Actor;
  beforeAll(async () => {
    superAdmin = await makeAdmin(['SUPER_ADMIN']);
    // A custom role carrying roles.manage — only a SUPER_ADMIN may create/grant it (privileged).
    const code = `RBAC_MGR_${randomUUID().slice(0, 6).toUpperCase()}`;
    await db.insert(roles).values({ code, nameAr: 'مدير صلاحيات', nameEn: 'RBAC manager', isSystem: false });
    await expect(setRolePermissions(superAdmin, { role: code, permissions: ['dashboard.view', 'roles.manage'], reason: 'إنشاء دور إدارة صلاحيات' })).rejects.toThrow(/أكّد/);
    await setRolePermissions(superAdmin, { role: code, permissions: ['dashboard.view', 'roles.manage'], reason: 'إنشاء دور إدارة صلاحيات', confirmPrivileged: true });
    const u = await makeUser({ staff: true });
    await setStaffRole(superAdmin, 'grant', { userId: u.id, role: code, reason: 'منح دور إدارة الصلاحيات', confirmPrivileged: true });
    manager = await adminActor(u.id, { stepUpAt: new Date() });
    expect(manager.permissions.has('roles.manage')).toBe(true);
  });

  it('a non-super roles.manage holder cannot create a SUPER_ADMIN account — nothing is written', async () => {
    const e = email();
    await expect(createStaffUser(manager, { email: e, phone: phone(), fullName: 'محاولة تصعيد', role: 'SUPER_ADMIN', reason: 'محاولة إنشاء مدير عام', confirmPrivileged: true })).rejects.toThrow(/للمدير العام فقط/);
    expect(await db.select().from(users).where(eq(users.email, e))).toHaveLength(0);
  });

  it('nor grant SUPER_ADMIN, nor make an ordinary role privileged, nor disable a SUPER_ADMIN', async () => {
    const target = await makeUser({ staff: true, roles: ['CATALOG_REVIEWER'] });
    await expect(setStaffRole(manager, 'grant', { userId: target.id, role: 'SUPER_ADMIN', reason: 'محاولة منح المدير العام', confirmPrivileged: true })).rejects.toThrow(/للمدير العام فقط/);
    await expect(setRolePermissions(manager, { role: 'CATALOG_REVIEWER', permissions: ['dashboard.view', 'roles.manage'], reason: 'محاولة تصعيد عبر دور', confirmPrivileged: true })).rejects.toThrow(/للمدير العام فقط/);
    await expect(setStaffStatus(manager, { userId: superAdmin.userId!, status: 'DISABLED', reason: 'محاولة تعطيل المدير العام', confirmPrivileged: true })).rejects.toThrow(/للمدير العام فقط/);
    expect((await db.select().from(userRoles).where(and(eq(userRoles.userId, target.id), eq(userRoles.roleCode, 'SUPER_ADMIN'))))).toHaveLength(0);
  });

  it('ordinary staff creation still works for the manager (transactional, role validated first)', async () => {
    const e = email();
    await createStaffUser(manager, { email: e, phone: phone(), fullName: 'مراجع منتجات', role: 'CATALOG_REVIEWER' });
    expect(await db.select().from(users).where(eq(users.email, e))).toHaveLength(1);
    const bad = email();
    await expect(createStaffUser(manager, { email: bad, phone: phone(), fullName: 'دور غير موجود', role: 'NO_SUCH_ROLE' })).rejects.toThrow(/دور غير صالح/);
    expect(await db.select().from(users).where(eq(users.email, bad))).toHaveLength(0); // no orphan staff account
  });

  it('a SUPER_ADMIN creates another SUPER_ADMIN only with fresh 2FA, explicit confirmation and a reason (audited)', async () => {
    const base = { phone: phone(), fullName: 'مدير عام جديد', role: 'SUPER_ADMIN' };
    await expect(createStaffUser(await noStepUp(superAdmin), { ...base, email: email(), reason: 'سبب إنشاء مدير عام جديد', confirmPrivileged: true })).rejects.toThrow(/تأكيد هويتك/);
    await expect(createStaffUser(superAdmin, { ...base, email: email(), reason: 'سبب إنشاء مدير عام جديد' })).rejects.toThrow(/أكّد/);
    await expect(createStaffUser(superAdmin, { ...base, email: email(), reason: 'قصير', confirmPrivileged: true })).rejects.toThrow(/سبب/);
    const u = await createStaffUser(superAdmin, { ...base, email: email(), reason: 'تعيين مدير عام ثانٍ بقرار المالك', confirmPrivileged: true });
    expect(await auditActions(u.id)).toContain('rbac.privileged_staff_created');
  });

  it('no alternate write path: staff roles are only assigned inside src/server/rbac/staff.ts (and dev seeds)', async () => {
    const offenders: string[] = [];
    async function walk(dir: string) {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /insert\(userRoles\)|delete\(userRoles\)|insert\(rolePermissions\)|delete\(rolePermissions\)/.test(await readFile(p, 'utf8'))) offenders.push(path.relative(process.cwd(), p));
      }
    }
    await walk(path.resolve('src'));
    expect(offenders.sort()).toEqual(['src/server/db/seed/demo.ts', 'src/server/db/seed/reference.ts', 'src/server/rbac/staff.ts']);
  });
});

/* ═══════════════════════════ C3 — payout destination verification ═══════════════════════════ */
async function approvedSellerWithPendingPayout() {
  const u = await makeUser({ name: 'بائع اختبار' });
  const a = customerActor(u.id);
  await startApplication(a, 'INDIVIDUAL');
  await saveIdentity(a, { type: 'INDIVIDUAL', legalName: 'بائع اختبار كامل', nationalId: '29001011234567', mobile: u.phone!, email: u.email!, addressLine: 'عنوان اختبار طويل', city: 'القاهرة', governorateId: 1 });
  await saveStore(a, { name: `متجر ${randomUUID().slice(0, 8)}`, description: 'متجر اختبار', returnAddress: 'عنوان الإرجاع للاختبار', returnGovernorateId: 1 });
  await uploadSellerDocument(a, 'NATIONAL_ID_FRONT', { data: await png('f'), name: 'f.png' });
  await uploadSellerDocument(a, 'NATIONAL_ID_BACK', { data: await png('b'), name: 'b.png' });
  await addPayoutMethod(a, { type: 'INSTAPAY', holderName: 'بائع اختبار', instapayAddress: `s${randomUUID().slice(0, 6)}@instapay` });
  await submitApplication(a, true);
  const sellerId = (await sellerActor(u.id))!.sellerId!;
  const ops = await makeAdmin(['OPERATIONS_MANAGER']); // has sellers.review, NOT sellers.payout.verify
  await decideSeller(ops, sellerId, 'APPROVE');
  const [pm] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.sellerId, sellerId));
  return { u, sellerId, pm, ops, seller: (await sellerActor(u.id))! };
}

describe('C3 — SELLER APPROVED ≠ PAYOUT DESTINATION VERIFIED', () => {
  it('approving the seller does not activate or verify the payout destination', async () => {
    const { sellerId, pm } = await approvedSellerWithPendingPayout();
    expect(pm.status).toBe('PENDING_VERIFICATION');
    expect(pm.verifiedAt).toBeNull();
    expect(await activePayoutMethod(db, sellerId)).toBeNull();
  });

  it('verification needs sellers.payout.verify and fresh 2FA; it records verifier, time, fingerprint and audit', async () => {
    const { sellerId, pm, ops } = await approvedSellerWithPendingPayout();
    await expect(verifyPayoutMethod(ops, pm.id, true)).rejects.toThrow(/صلاحية/);
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    await expect(verifyPayoutMethod(await noStepUp(reviewer), pm.id, true)).rejects.toThrow(/تأكيد هويتك/);
    await verifyPayoutMethod(reviewer, pm.id, true, 'مطابقة الاسم مع البطاقة');
    const [after] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, pm.id));
    expect(after.status).toBe('ACTIVE');
    expect(after.verifiedBy).toBe(reviewer.userId);
    expect(after.verifiedAt).not.toBeNull();
    expect(after.verifiedFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, sellerId), eq(auditLogs.action, 'seller.payout_method_verified')));
    expect((log.newValues as { fingerprint: string }).fingerprint).toBe(after.verifiedFingerprint);
    expect(() => assertVerifiedDestination(after)).not.toThrow();
  });

  it('a changed destination needs a new verification; tampered details are no longer "verified"', async () => {
    const { pm, seller } = await approvedSellerWithPendingPayout();
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    await verifyPayoutMethod(reviewer, pm.id, true);
    const next = await addPayoutMethod(seller, { type: 'INSTAPAY', holderName: 'بائع اختبار', instapayAddress: 'changed@instapay' });
    expect(next.status).toBe('PENDING_VERIFICATION');
    expect((await activePayoutMethod(db, pm.sellerId))!.id).toBe(pm.id); // the verified one stays in force
    expect(() => assertVerifiedDestination(next)).toThrow();
    // tampering the stored details of the verified destination breaks the verification
    await db.update(sellerPayoutMethods).set({ detailsEnc: encryptJson({ type: 'INSTAPAY', holderName: 'بائع اختبار', instapayAddress: 'attacker@instapay' }) }).where(eq(sellerPayoutMethods.id, pm.id));
    const [tampered] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, pm.id));
    expect(() => assertVerifiedDestination(tampered)).toThrow(/لا تطابق/);
  });
});

/* ═══════════════════════════ C4 — refund destination ═══════════════════════════ */
async function requestedRefund() {
  const { c, so } = await shippedOrder(500_00);
  const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), principalAmount: 100_00, reason: 'تعويض جزئي في الاختبار' }));
  return { c, so, r };
}
const refundOf = async (id: string) => (await db.select().from(refunds).where(eq(refunds.id, id)))[0];

describe('C4 — refund destination is frozen at approval', () => {
  it('approval freezes the original destination; payout goes only there', async () => {
    const { r } = await requestedRefund();
    expect(r.destinationSnapshot).toMatchObject({ method: 'INSTAPAY' });
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await makerRequest('REFUND_APPROVAL', r.id, r.amount); // Batch 1.5: universal Maker/Checker
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    const a = await refundOf(r.id);
    expect(a.approvedDestination).toEqual(a.destinationSnapshot);
    expect(a.destinationApprovedBy).toBe(checker.userId);
  });

  it('an exceptional change needs the dedicated permission, suspends payout until a DIFFERENT person re-approves, and the changer can neither re-approve nor pay', async () => {
    const { r } = await requestedRefund();
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    const operator = await makeAdmin(['FINANCE_OPERATOR']);
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    await expect(overrideRefundDestination(checker, r.id, { method: 'VODAFONE_CASH', details: '01000000001' }, 'المحفظة الأصلية مغلقة بحسب العميل')).rejects.toThrow(/صلاحية/);
    const changer = await makeAdmin(['SUPER_ADMIN']);
    await expect(overrideRefundDestination(await noStepUp(changer), r.id, { method: 'VODAFONE_CASH', details: '01000000001' }, 'المحفظة الأصلية مغلقة بحسب العميل')).rejects.toThrow(/تأكيد هويتك/);
    await overrideRefundDestination(changer, r.id, { method: 'VODAFONE_CASH', details: '01000000001' }, 'المحفظة الأصلية مغلقة بحسب العميل');
    let x = await refundOf(r.id);
    expect(x.destinationReapprovalRequired).toBe(true);
    expect(x.approvedDestination).not.toEqual(x.destinationSnapshot); // the approval still names the original
    await expect(recordRefundPayout(operator, r.id, 'REF-123')).rejects.toThrow(/اعتماد الوجهة الجديدة/);
    await expect(reapproveRefundDestination(changer, r.id, 'اعتماد الوجهة البديلة')).rejects.toThrow(/لا يمكنه اعتمادها/);
    await reapproveRefundDestination(checker, r.id, 'تم التحقق من الوجهة البديلة مع العميل');
    x = await refundOf(r.id);
    expect(x.destinationReapprovalRequired).toBe(false);
    expect(x.approvedDestination).toEqual(x.destinationSnapshot);
    await expect(recordRefundPayout(changer, r.id, 'REF-124')).rejects.toThrow(/لا يمكنه تنفيذ صرفه/);
    await recordRefundPayout(operator, r.id, 'REF-125');
    const paid = await refundOf(r.id);
    expect(paid.status).toBe('COMPLETED');
    const [approval] = await db.select().from(financialApprovals).where(eq(financialApprovals.id, paid.payoutApprovalId!));
    expect(approval.destinationSnapshot).toEqual(paid.approvedDestination);
    expect(await auditActions(r.id)).toEqual(expect.arrayContaining(['refund.destination_overridden', 'refund.destination_reapproved']));
  });

  it('rejecting a refund requires fresh 2FA and a reason, and is audited with the state change', async () => {
    const { r } = await requestedRefund();
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await expect(rejectRefund(await noStepUp(checker), r.id, 'لا يستحق الاسترداد')).rejects.toThrow(/تأكيد هويتك/);
    await expect(rejectRefund(checker, r.id, 'لا')).rejects.toThrow(/سبب/);
    await rejectRefund(checker, r.id, 'لا يستحق الاسترداد وفق السياسة');
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, r.id), eq(auditLogs.action, 'refund.rejected')));
    expect(log.oldValues).toMatchObject({ status: 'REQUESTED' });
    expect(log.newValues).toMatchObject({ status: 'REJECTED' });
    expect(log.actorUserId).toBe(checker.userId);
  });

  it('protected-deal refunds carry the original deal payment as authoritative destination', async () => {
    const buyer = customerActor((await makeUser()).id);
    const deal = await createDeal(buyer, { title: 'جهاز مستعمل', description: 'جهاز بحالة جيدة جداً مع الشاحن', condition: 'NEW', quantity: 1 });
    await saveDealStep(buyer, deal.id, 2, { unitPrice: '3000' });
    await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
    await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
    const { token } = await inviteSeller(buyer, deal.id, true);
    const seller = customerActor((await makeUser()).id);
    await claimInvitation(seller, token);
    const { version } = await submitSellerOffer(
      seller,
      deal.id,
      { details: { fullName: 'بائع الصفقة' }, location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 }, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'deal@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
      true,
    );
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
    const { submission } = await submitProof(buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await confirmPayment(admin, p.id, submission.id);
    const d = await openDispute(buyer, { dealId: deal.id, reasonCode: 'NOT_RECEIVED', description: 'لم يتم تسليم المنتج حتى الآن رغم الدفع' });
    await resolveDispute(admin, d.id, { decision: 'FULL_REFUND', reasonCode: 'NOT_DELIVERED', note: 'لم يثبت التسليم — استرداد كامل' });
    const [r] = await db.select().from(refunds).where(eq(refunds.dealId, deal.id));
    expect(r.destinationSnapshot).toMatchObject({ method: 'INSTAPAY', paymentId: p.id });
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await approveRefund(await makeAdmin(['FINANCE_CHECKER']), r.id, { expectedAmount: r.amount, reason: 'اعتماد استرداد الصفقة' });
    expect((await refundOf(r.id)).approvedDestination).toEqual(r.destinationSnapshot);
  });
});

/* ═══════════════════════════ C5 — withdrawal processing & returned payouts ═══════════════════════════ */
async function processingWithdrawal(amount = '300') {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await receiveAndRelease(c.actor, so.id);
  const checker = await makeAdmin(['FINANCE_CHECKER']);
  const executor = await makeAdmin(['FINANCE_OPERATOR']);
  const { withdrawal } = await requestWithdrawal(s.actor, { amount, clientKey: randomUUID() });
  await approveWithdrawal(checker, withdrawal.id);
  await markWithdrawalProcessing(executor, withdrawal.id);
  const sellerId = s.actor.sellerId!;
  const bal = async () => ({
    available: await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId }),
    reserved: await accountBalance(db, { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId }),
  });
  return { s, w: withdrawal, checker, executor, bal };
}
const wdOf = async (id: string) => (await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)))[0];

describe('C5 — once a transfer may have left EDMN, money is never assumed back', () => {
  it('a PROCESSING withdrawal cannot be rejected and nothing returns to the balance', async () => {
    const { w, checker, bal } = await processingWithdrawal();
    const before = await bal();
    await expect(rejectWithdrawal(checker, w.id, 'تراجع عن التحويل')).rejects.toThrow(/بدأ التحويل بالفعل/);
    expect(await bal()).toEqual(before);
    expect((await wdOf(w.id)).status).toBe('PROCESSING');
  });

  it('an uncertain result keeps the amount reserved; only evidence from a second person releases it, exactly once', async () => {
    const { w, checker, executor, bal } = await processingWithdrawal();
    await markWithdrawalTransferUncertain(executor, w.id, 'انقطع الاتصال بالبنك أثناء التحويل');
    await markWithdrawalTransferUncertain(executor, w.id, 'تكرار'); // idempotent
    const held = await bal();
    expect(held.reserved).toBe(w.amount);
    await expect(rejectWithdrawal(checker, w.id, 'غير مؤكد')).rejects.toThrow(/بدأ التحويل بالفعل/);
    await expect(markWithdrawalFailedBeforeTransfer(executor, w.id, { reason: 'لم يخرج التحويل', evidence: 'STMT-9' })).rejects.toThrow(/صلاحية|غير منفذ التحويل/);
    await expect(markWithdrawalFailedBeforeTransfer(checker, w.id, { reason: 'لم يخرج التحويل', evidence: '' })).rejects.toThrow(/دليل/);
    // Batch 1.5: the reversal is a movement — a Maker request first, executed by a different Checker.
    await expect(markWithdrawalFailedBeforeTransfer(checker, w.id, { reason: 'كشف الحساب يؤكد عدم خروج التحويل', evidence: 'STMT-9' })).rejects.toThrow(/منشئ/);
    await makerRequest('WITHDRAWAL_REVERSAL', w.id, w.amount, { params: { mode: 'FAILED_BEFORE_TRANSFER' } });
    await markWithdrawalFailedBeforeTransfer(checker, w.id, { reason: 'كشف الحساب يؤكد عدم خروج التحويل', evidence: 'STMT-9' });
    await markWithdrawalFailedBeforeTransfer(checker, w.id, { reason: 'إعادة المحاولة', evidence: 'STMT-9' }); // retry: no double credit
    const after = await bal();
    expect(after.reserved).toBe(held.reserved - w.amount);
    expect(after.available).toBe(held.available + w.amount);
    expect(await journalsOf(w.id, 'WITHDRAWAL_REVERSAL')).toHaveLength(1);
    expect((await wdOf(w.id)).status).toBe('FAILED_BEFORE_TRANSFER');
    await expect(markWithdrawalPaid(executor, w.id, 'REF-LATE')).rejects.toThrow(); // terminal: never paid afterwards
  });

  it('PAID cannot be rejected; a returned payout is a compensating approved entry (original untouched), exactly once', async () => {
    const { w, checker, executor, bal } = await processingWithdrawal();
    await markWithdrawalPaid(executor, w.id, 'REF-PAID-1');
    await markWithdrawalPaid(executor, w.id, 'REF-PAID-1'); // retry: no double payout
    expect(await journalsOf(w.id, 'WITHDRAWAL_PAID')).toHaveLength(1);
    const [paidJournal] = await journalsOf(w.id, 'WITHDRAWAL_PAID');
    await expect(rejectWithdrawal(checker, w.id, 'رفض بعد الصرف')).rejects.toThrow();
    const paid = await wdOf(w.id);
    const before = await bal();
    await expect(recordWithdrawalReturned(executor, w.id, { amount: paid.netTransferAmount!, reference: 'RET-1', reason: 'الحساب مغلق' })).rejects.toThrow(/صلاحية|غير منفذ الصرف/);
    await expect(recordWithdrawalReturned(await noStepUp(checker), w.id, { amount: paid.netTransferAmount!, reference: 'RET-1', reason: 'الحساب مغلق' })).rejects.toThrow(/تأكيد هويتك/);
    await expect(recordWithdrawalReturned(checker, w.id, { amount: paid.netTransferAmount! + 1, reference: 'RET-1', reason: 'الحساب مغلق' })).rejects.toThrow(/أكبر من المبلغ المحوّل/);
    await makerRequest('WITHDRAWAL_RETURN', w.id, paid.netTransferAmount!); // Batch 1.5: Maker first
    await recordWithdrawalReturned(checker, w.id, { amount: paid.netTransferAmount!, reference: 'RET-1', reason: 'الحساب مغلق لدى البنك' });
    await recordWithdrawalReturned(checker, w.id, { amount: paid.netTransferAmount!, reference: 'RET-1', reason: 'تكرار' }); // idempotent
    expect((await bal()).available).toBe(before.available + paid.netTransferAmount!);
    expect(await journalsOf(w.id, 'WITHDRAWAL_RETURNED')).toHaveLength(1);
    expect((await journalsOf(w.id, 'WITHDRAWAL_PAID'))[0]).toEqual(paidJournal); // history untouched
    const returned = await wdOf(w.id);
    expect(returned.status).toBe('RETURNED');
    expect(returned.returnApprovalId).not.toBeNull();
    const [pm] = await db.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, returned.payoutMethodId!));
    expect(pm.status).toBe('PENDING_VERIFICATION'); // the bounced destination must be verified again
    await markWithdrawalPaid(executor, w.id, 'REF-PAID-2'); // no second payout after a return
    expect(await journalsOf(w.id, 'WITHDRAWAL_PAID')).toHaveLength(1);
    const rec = await reconcile(db);
    expect(rec.trialBalanceOk).toBe(true);
  });
});

/* ═══════════════════════════ C6 — go-live gate ═══════════════════════════ */
async function setSettings(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) await db.insert(systemSettings).values({ key, value: value as object }).onConflictDoUpdate({ target: systemSettings.key, set: { value: value as object } });
}
async function clearSettings(keys: string[]) {
  await db.delete(systemSettings).where(inArray(systemSettings.key, keys));
}

describe('C6 — the real-money gate enforces owner fee approval and the production maker/checker value', () => {
  const KEYS = ['payments.realMoneyEnabled', 'fees.ownerApproved', 'fees.buyerShareBps', 'withdrawals.dualControlThreshold'];
  afterEach(() => clearSettings(KEYS));

  it('the gate fails while fees.ownerApproved is false, and while the threshold is not 0', async () => {
    await clearSettings(KEYS);
    let codes = (await goLiveGate()).blockers.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['FEES_OWNER_APPROVAL', 'MAKER_CHECKER']));
    await setSettings({ 'fees.ownerApproved': true, 'fees.buyerShareBps': 0, 'withdrawals.dualControlThreshold': 0 });
    codes = (await goLiveGate()).blockers.map((b) => b.code);
    expect(codes).not.toContain('FEES_OWNER_APPROVAL');
    expect(codes).not.toContain('MAKER_CHECKER');
    await setSettings({ 'withdrawals.dualControlThreshold': 1 });
    expect((await goLiveGate()).blockers.map((b) => b.code)).toContain('MAKER_CHECKER');
  });

  it('configuration drift after go-live never weakens maker/checker and re-closes the gate', async () => {
    const prev = process.env.EDMN_ENVIRONMENT;
    delete process.env.EDMN_ENVIRONMENT;
    try {
      await setSettings({ 'payments.realMoneyEnabled': true, 'fees.ownerApproved': true, 'fees.buyerShareBps': 0, 'withdrawals.dualControlThreshold': 0 });
      expect(await realMoneyEnabled()).toBe(true);
      expect(await effectiveDualControlThreshold()).toBe(0);
      // drift written straight into the database: real money is treated as OFF (fail closed)
      await setSettings({ 'withdrawals.dualControlThreshold': 5_000_000 });
      expect(await realMoneyEnabled()).toBe(false);
      await setSettings({ 'withdrawals.dualControlThreshold': 0, 'fees.ownerApproved': false });
      expect(await realMoneyEnabled()).toBe(false);
      // through the settings screen: raising the threshold re-closes the gate in the same transaction
      await setSettings({ 'fees.ownerApproved': true });
      await updateSetting(admin, 'withdrawals.dualControlThreshold', 1_000_000, 'رفع حد الرقابة المزدوجة');
      const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, 'payments.realMoneyEnabled'));
      expect(row.value).toBe(false);
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'settings.real_money_gate_reclosed'));
      expect(log).toBeTruthy();
    } finally {
      process.env.EDMN_ENVIRONMENT = prev;
      if (prev === undefined) delete process.env.EDMN_ENVIRONMENT;
    }
  });
});

/* ═══════════════════════════ C7 — log redaction ═══════════════════════════ */
describe('C7 — logs never carry secrets, even inside database errors', () => {
  const SECRET_EMAIL = 'victim.person@example.com';
  const SECRET_TOKEN = 'S3cr3tSessionToken_abcdefghijklmnopqrstuvwxyz0123456789';

  function captured(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
  }

  it('a real Drizzle/pg error with sensitive parameters is logged without them (runAction + logger)', async () => {
    let err: unknown;
    try {
      await db.select().from(users).where(and(eq(users.email, SECRET_EMAIL), eq(users.id, `not-a-uuid-${SECRET_TOKEN}`)));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message) + String((err as { cause?: Error }).cause?.message ?? '')).toContain(SECRET_EMAIL); // the raw error DOES carry it
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runAction } = await import('@/server/web/action');
    const res = await runAction(async () => {
      throw err;
    });
    expect(res.ok).toBe(false);
    logger.error('direct', { error: err });
    const out = captured(spy);
    expect(out).toContain('action.failed');
    expect(out).not.toContain(SECRET_EMAIL);
    expect(out).not.toContain(SECRET_TOKEN);
    expect(safeErrorMessage(err)).not.toContain(SECRET_EMAIL);
  });

  it('OTPs, tokens, connection strings and nested Error causes are redacted', () => {
    const nested = new Error('outer failure', { cause: Object.assign(new Error(`duplicate key value; code 482913 for 01012345678 Bearer ${SECRET_TOKEN}`), { code: '23505', detail: `Key (email)=(${SECRET_EMAIL}) already exists.` }) });
    const out = JSON.stringify(
      redactForLog({
        otp: '482913',
        message: `connect postgres://edmn:SuperSecretPw@db.example.com/edmn failed`,
        auth: `Bearer ${SECRET_TOKEN}`,
        jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl',
        error: nested,
        params: ['x', SECRET_EMAIL],
        vapidPrivateKey: 'priv',
      }),
    );
    for (const leak of ['482913', 'SuperSecretPw', SECRET_TOKEN, SECRET_EMAIL, '01012345678', 'eyJhbGciOiJIUzI1NiJ9', '"priv"']) expect(out).not.toContain(leak);
    const safe = sanitizeError(nested);
    expect(safe.cause?.code).toBe('23505'); // useful, safe diagnostics survive
    expect(JSON.stringify(safe)).not.toContain('already exists.'); // pg `detail` (row values) is dropped
  });

  it('the dev log provider never echoes secret messages (codes, reset links)', async () => {
    process.env.LOG_IN_TESTS = '1';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { providerFor } = await import('@/server/modules/notifications/providers');
      const p = await providerFor('SMS');
      await p.send({ recipient: '01012345678', body: 'رمز الاستلام 482913', secret: true });
      expect(captured(spy)).not.toContain('482913');
    } finally {
      delete process.env.LOG_IN_TESTS;
    }
  });
});

/* ═══════════════════════════ C8 — production fail-closed against demo / E2E fixtures ═══════════════════════════ */
class Rollback extends Error {}
/** Drizzle wraps the database error: assert on the root cause raised by the trigger. */
async function rejectsWithCause(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err as Error & { cause?: Error });
  expect(e, 'expected the database to refuse').not.toBeNull();
  expect(`${e!.message} ${e!.cause?.message ?? ''}`).toMatch(re);
}

describe('C8 — a PRODUCTION database / deployment refuses demo, E2E and test fixtures', () => {
  it('database triggers refuse .local accounts and TEST destinations, and the marker cannot be downgraded', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.delete(deploymentEnvironment);
        await tx.insert(deploymentEnvironment).values({ id: true, environment: 'PRODUCTION' });
        for (const email of ['x@demo.edmn.local', 'y@e2e.local', 'admin@edmn.local', 'z@test.local']) {
          await rejectsWithCause(tx.transaction((t) => t.insert(users).values({ email, fullName: 'fixture', passwordHash: 'x' })), /refused on a PRODUCTION database/);
        }
        await rejectsWithCause(tx.transaction((t) => t.insert(paymentDestinations).values({ methodCode: 'INSTAPAY', label: 'TEST', details: {}, isTest: true })), /TEST payment destinations/);
        await rejectsWithCause(tx.transaction((t) => t.update(deploymentEnvironment).set({ environment: 'STAGING' })), /cannot be re-marked/);
        await expect(assertNotProductionDatabase(tx, 'seed demo data')).rejects.toThrow(/marked PRODUCTION/);
        await expect(markDeploymentEnvironment(tx, 'STAGING')).rejects.toThrow(/refusing to use it as STAGING/);
        // a real customer is still accepted
        await tx.insert(users).values({ email: `real-${randomUUID().slice(0, 6)}@example.com`, fullName: 'عميل حقيقي', passwordHash: 'x' });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    // nothing leaked out of the rolled-back transaction
    expect(await db.select().from(deploymentEnvironment).where(eq(deploymentEnvironment.environment, 'PRODUCTION'))).toHaveLength(0);
  });

  it('a database that already holds demo/test accounts can never be marked PRODUCTION', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.delete(deploymentEnvironment);
        await expect(markDeploymentEnvironment(tx, 'PRODUCTION')).rejects.toThrow(/demo\/test accounts|fresh database/);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it('the demo seed refuses production, NODE_ENV=production outside staging, and public credentials on remote databases', () => {
    expect(() => assertDemoSeedAllowed({ EDMN_ENVIRONMENT: 'production', DATABASE_URL: 'postgresql://x@localhost/db' })).toThrow();
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production', EDMN_ENVIRONMENT: 'development', DATABASE_URL: 'postgresql://x@localhost/db' })).toThrow();
    expect(() => assertDemoSeedAllowed({ EDMN_ENVIRONMENT: 'development', DATABASE_URL: 'postgresql://x@ep-cool-1.neon.tech/edmn' })).toThrow();
    expect(() => assertDemoSeedAllowed({ EDMN_ENVIRONMENT: 'development', DATABASE_URL: 'postgresql://x@localhost:5432/edmn' })).not.toThrow();
  });

  it('a production build refuses staging fixture secrets, SEED_DEMO and EDMN_ENVIRONMENT=development', () => {
    const base = { NODE_ENV: 'production', EDMN_ENVIRONMENT: 'production', SESSION_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: 'y'.repeat(40), APP_URL: 'https://edmn.example', MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.example', SMS_DRIVER: 'http', SMS_HTTP_URL: 'https://sms.example' } as unknown as Env;
    expect(unsafeProductionConfig(base, {})).toEqual([]);
    expect(unsafeProductionConfig(base, { STAGING_TOTP_SECRET: 'ABC' }).join()).toMatch(/STAGING_TOTP_SECRET/);
    expect(unsafeProductionConfig(base, { STAGING_ADMIN_PASSWORD: 'x', STAGING_DEMO_PASSWORD: 'y' })).toHaveLength(2);
    expect(unsafeProductionConfig(base, { SEED_DEMO: 'true' }).join()).toMatch(/SEED_DEMO/);
    expect(unsafeProductionConfig({ ...base, EDMN_ENVIRONMENT: 'development' } as Env, {}).join()).toMatch(/development is not allowed/);
  });

  it('in production, public fixture passwords and the known demo TOTP secret are refused; TEST destinations cannot be created', async () => {
    const u = await makeUser(); // password Test@12345 (a public fixture credential)
    const prev = process.env.EDMN_ENVIRONMENT;
    const totp = await makeUser({ staff: true });
    await db.update(users).set({ totpSecretEnc: encrypt(DEMO_TOTP_SECRET) }).where(eq(users.id, totp.id));
    try {
      expect((await login(u.email!, 'Test@12345', 'WEB', { ip: '10.9.8.7' })).user.id).toBe(u.id); // outside production: works
      process.env.EDMN_ENVIRONMENT = 'production';
      await expect(login(u.email!, 'Test@12345', 'WEB', { ip: '10.9.8.7' })).rejects.toThrow(/بيانات الدخول غير صحيحة/);
      expect(passwordProblems('Demo@12345', CUSTOMER_POLICY)).toMatch(/معروفة/);
      expect(await verifyTotpForUser(totp.id, totpCode(DEMO_TOTP_SECRET), {})).toBe(false);
      await expect(saveDestination(admin, null, { methodCode: 'INSTAPAY', label: 'TEST', details: { instapayAddress: 'x@instapay' }, isEnabled: true, isTest: true }, 'وجهة تجريبية')).rejects.toThrow(/غير مسموحة في بيئة الإنتاج/);
    } finally {
      process.env.EDMN_ENVIRONMENT = prev;
      if (prev === undefined) delete process.env.EDMN_ENVIRONMENT;
    }
  });
});

/* ═══════════════════════════ Operator wording ═══════════════════════════ */
describe('operator wording — money states are never ambiguous', async () => {
  const { statusLabel, sellerOrderStatusLabel } = await import('@/lib/i18n/labels');
  it('approved / processing / failed never read as paid; delivered names its basis', () => {
    expect(statusLabel('APPROVED', 'refund')).toMatch(/لم يُحوَّل/);
    expect(statusLabel('COMPLETED', 'refund')).toMatch(/تم تحويل/);
    expect(statusLabel('FAILED', 'refund')).toMatch(/تعذّر تحويل الاسترداد/);
    expect(statusLabel('FAILED', 'refund')).not.toMatch(/التسليم/);
    expect(statusLabel('PROCESSING', 'withdrawal')).toMatch(/لم يكتمل/);
    expect(statusLabel('APPROVED', 'withdrawal')).toMatch(/لم يُحوَّل/);
    expect(statusLabel('DELIVERED')).not.toBe('تم الاستلام');
    expect(sellerOrderStatusLabel('DELIVERED', 'BUYER_CONFIRMED')).toMatch(/أكّد المشتري/);
    expect(sellerOrderStatusLabel('DELIVERED', 'TIMEOUT_ENTITLEMENT')).toMatch(/مهلة المشتري/);
    expect(sellerOrderStatusLabel('DELIVERED', null)).toBe('تم تسجيل التسليم');
    expect(statusLabel('REFUND_PENDING')).not.toMatch(/اتقبل/);
  });
});

void SYSTEM_ACTOR;
void sql;
