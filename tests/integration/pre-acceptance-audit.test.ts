import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { adminActor, customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { dealDeliveryOtps, dealInvitations, disputes, externalDeals, outboundMessages, payments, riskFlags, sellerMembers, sellerOrders } from '@/server/db/schema';
import {
  claimInvitation,
  confirmDealReceipt,
  createDeal,
  deliveryOtpForBuyer,
  expireDealInvitations,
  inviteSeller,
  markDealDelivered,
  regenerateDeliveryOtp,
  rejectInvitation,
  reportNotReceived,
  respondToOffer,
  saveDealStep,
  startDealPayment,
  submitSellerOffer,
  verifyDeliveryOtp,
} from '@/server/modules/deals/service';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { openDispute, resolveDispute } from '@/server/modules/postpurchase/disputes';
import { confirmReceipt, setFinancialHold } from '@/server/modules/commerce/fulfilment';
import { createAdjustment } from '@/server/modules/finance/withdrawals';
import { flushOutbound, REDACTED_BODY } from '@/server/jobs/worker';
import { assertDemoSeedAllowed } from '@/server/db/seed/demo';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

const OFFER = { shippingFee: '0', deliveryMethod: 'تسليم يد بيد', deliveryMinDays: 1, deliveryMaxDays: 2, processingDays: 1, defects: 'لا يوجد' };

async function joined() {
  const buyerUser = await makeUser();
  const buyer = customerActor(buyerUser.id);
  const deal = await createDeal(buyer, { title: 'جهاز للمراجعة النهائية', description: 'وصف كافٍ للمنتج قبل المراجعة', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '3000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'شحن', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع الاختبار' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const sellerUser = await makeUser();
  const seller = customerActor(sellerUser.id);
  await claimInvitation(seller, token);
  return { buyer, buyerUser, seller, sellerUser, dealId: deal.id, token };
}

async function agreed() {
  const d = await joined();
  const { version } = await submitSellerOffer(
    d.seller,
    d.dealId,
    { details: { fullName: 'بائع المراجعة' }, location: { governorateId: 2, city: 'الجيزة', street: 'شارع' }, payout: { type: 'INSTAPAY', holderName: 'بائع المراجعة', instapayAddress: 'audit@instapay' }, offer: OFFER, returnPolicy: { type: 'NONE' } },
    true,
  );
  await respondToOffer(d.buyer, d.dealId, version, 'ACCEPT');
  return d;
}

async function verifiedHandover() {
  const d = await agreed();
  const p = await startDealPayment(d.buyer, d.dealId, 'INSTAPAY');
  const { submission } = await submitProof(d.buyer, p.id, { claimedAmount: '3000', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  await confirmPayment(admin, p.id, submission.id);
  await markDealDelivered(d.seller, d.dealId, 'شحن');
  await verifyDeliveryOtp(d.seller, d.dealId, (await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode!);
  return d;
}

describe('pre-acceptance audit — protected deal fixes', () => {
  it('a "return/replace" decision after a delivery conflict reopens a clean delivery; a later verified handover can complete', async () => {
    const d = await verifiedHandover();
    await reportNotReceived(d.buyer, d.dealId, 'لم أستلم رغم الرمز');
    const [disp] = await db.select().from(disputes).where(eq(disputes.dealId, d.dealId));
    await resolveDispute(admin, disp.id, { decision: 'REPLACEMENT', reasonCode: 'REDELIVER', note: 'إعادة التسليم بإشراف العمليات' });
    let [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(deal.status).toBe('ACTIVE');
    expect(deal.handoverVerifiedAt).toBeNull();
    expect(deal.deliveryConflictAt).toBeNull();
    const open = await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, d.dealId), eq(riskFlags.status, 'OPEN')));
    expect(open).toHaveLength(0);
    // Re-ship → new code → verify → buyer confirms → completed.
    await markDealDelivered(d.seller, d.dealId, 'إعادة شحن');
    await verifyDeliveryOtp(d.seller, d.dealId, (await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode!);
    await confirmDealReceipt(d.buyer, d.dealId);
    [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(deal.status).toBe('COMPLETED');
  });

  it('an elapsed payment window is reopened instead of leaving the deal stuck', async () => {
    const d = await agreed();
    const p = await startDealPayment(d.buyer, d.dealId, 'INSTAPAY');
    await db.update(payments).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(payments.id, p.id));
    const again = await startDealPayment(d.buyer, d.dealId, 'INSTAPAY');
    expect(again.id).toBe(p.id);
    expect(again.dueAt.getTime()).toBeGreaterThan(Date.now());
    await submitProof(d.buyer, p.id, { claimedAmount: '3000', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  });

  it('an invitation already bound to the seller does not expire, and the bound seller can still reject', async () => {
    const d = await joined();
    await db.update(dealInvitations).set({ status: 'PENDING' }).where(eq(dealInvitations.dealId, d.dealId));
    // Simulate time passing beyond the TTL by checking the job with a future "now".
    await expireDealInvitations(new Date(Date.now() + 365 * 86400_000));
    const [inv] = await db.select().from(dealInvitations).where(eq(dealInvitations.dealId, d.dealId));
    expect(inv.status).toBe('PENDING');
    await rejectInvitation(d.seller, { dealId: d.dealId }, 'لم أعد أرغب في البيع');
    const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(deal.status).toBe('CANCELLED');
  });

  it('strangers cannot burn a deal’s OTP quotas (authorization happens before counting)', async () => {
    const d = await agreed();
    const stranger = customerActor((await makeUser()).id);
    for (let i = 0; i < 12; i++) {
      await expect(verifyDeliveryOtp(stranger, d.dealId, '123456')).rejects.toThrow(/صلاحية/);
      await expect(regenerateDeliveryOtp(stranger, d.dealId)).rejects.toThrow(/صلاحية/);
    }
  });

  it('the delivery OTP SMS body is redacted right after hand-off to any driver (including the log driver)', async () => {
    const d = await agreed();
    const p = await startDealPayment(d.buyer, d.dealId, 'INSTAPAY');
    const { submission } = await submitProof(d.buyer, p.id, { claimedAmount: '3000', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await confirmPayment(admin, p.id, submission.id);
    await markDealDelivered(d.seller, d.dealId, 'شحن');
    await flushOutbound(500);
    const rows = await db.select().from(outboundMessages).where(eq(outboundMessages.event, 'DEAL_DELIVERY_OTP'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((m) => m.status === 'SENT').every((m) => m.body === REDACTED_BODY)).toBe(true);
    // The buyer still sees their code through the staging test display (encrypted copy).
    expect((await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode).toMatch(/^\d{6}$/);
    const [otp] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(otp.testCodeEnc).not.toBeNull();
  });

  it('deal payment destinations carry the TEST flag so real-money destinations are never mislabelled', async () => {
    const d = await agreed();
    const p = await startDealPayment(d.buyer, d.dealId, 'INSTAPAY');
    const snap = p.destinationSnapshot as { isTest?: boolean }[];
    expect(snap.length).toBeGreaterThan(0);
    expect(snap.every((x) => typeof x.isTest === 'boolean')).toBe(true);
  });
});

describe('pre-acceptance audit — separation of duties on money', () => {
  async function storeWithStaffMember() {
    const s = await makeSeller(admin);
    const staff = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
    await db.insert(sellerMembers).values({ sellerId: s.actor.sellerId!, userId: staff.id, role: 'ORDER_MANAGER', isActive: true });
    return { s, insider: await adminActor(staff.id, { stepUpAt: new Date() }) };
  }

  it('staff who belong to the store cannot decide its dispute; dispute decisions need step-up and cannot be taken by a party', async () => {
    const { s, insider } = await storeWithStaffMember();
    const p = await makeProduct(s.actor, admin, { price: 300_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_RECEIVED', description: 'لم يصلني الطلب حتى الآن رغم الشحن' });
    await expect(resolveDispute(insider, d.id, { decision: 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'حكم لصالح متجري' })).rejects.toThrow(/متجر أنت مالكه/);
    const noStepUp = await adminActor((await makeUser({ staff: true, roles: ['SUPER_ADMIN'] })).id, {});
    await expect(resolveDispute(noStepUp, d.id, { decision: 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'بدون تحقق إضافي' })).rejects.toThrow();
  });

  it('staff of the store cannot confirm receipt on the buyer’s behalf, release a hold, or create an adjustment for it', async () => {
    const { s, insider } = await storeWithStaffMember();
    const p = await makeProduct(s.actor, admin, { price: 300_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await expect(confirmReceipt(insider, so.id, { onBehalfReason: 'العميل أكد هاتفيًا' })).rejects.toThrow(/متجر أنت مالكه/);
    await setFinancialHold(admin, so.id, true, 'مراجعة احتيال');
    await expect(setFinancialHold(insider, so.id, false, 'رفع الإيقاف')).rejects.toThrow(/متجر أنت مالكه/);
    const noStepUp = await adminActor((await makeUser({ staff: true, roles: ['SUPER_ADMIN'] })).id, {});
    await expect(setFinancialHold(noStepUp, so.id, false, 'رفع الإيقاف')).rejects.toThrow();
    await expect(createAdjustment(insider, { sellerId: s.actor.sellerId!, amount: '100', reasonCode: 'GOODWILL', reason: 'تعويض لمتجري' })).rejects.toThrow(/متجر أنت مالكه/);
    const [still] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id));
    expect(still.fundsReleasedAt).toBeNull();
  });
});

describe('pre-acceptance audit — environment safety', () => {
  it('demo data can only be seeded into a local database or an explicitly marked staging/development environment', () => {
    expect(() => assertDemoSeedAllowed({ EDMN_ENVIRONMENT: 'production', DATABASE_URL: 'postgresql://x@localhost/db' })).toThrow();
    expect(() => assertDemoSeedAllowed({ DATABASE_URL: 'postgresql://x@db.prod.example.com/edmn' })).toThrow();
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://x@ep-cool-1.neon.tech/edmn' })).toThrow();
    expect(() => assertDemoSeedAllowed({ EDMN_ENVIRONMENT: 'staging', DATABASE_URL: 'postgresql://x@ep-cool-1.neon.tech/edmn' })).not.toThrow();
    expect(() => assertDemoSeedAllowed({ DATABASE_URL: 'postgresql://edmn:edmn@localhost:5432/edmn_e2e' })).not.toThrow();
  });
});

describe('pre-acceptance audit — marketplace & seller center fixes', () => {
  it('a product cannot be submitted while the seller ships to no governorate', async () => {
    const { sellerShippingRates } = await import('@/server/db/schema');
    const { submitForReview } = await import('@/server/modules/catalog/products');
    const s = await makeSeller(admin);
    const { productId } = await makeProduct(s.actor, admin, { approve: false });
    await db.update(sellerShippingRates).set({ enabled: false }).where(eq(sellerShippingRates.sellerId, s.actor.sellerId!));
    await expect(submitForReview(s.actor, productId)).rejects.toThrow(/الشحن/);
  });

  it('store members without orders.manage cannot open order details (customer PII); evidence is readable by active store members', async () => {
    const { sellerActor } = await import('@/server/auth/actors');
    const { sellerOrderForSeller } = await import('@/server/modules/commerce/fulfilment');
    const { requestReturn } = await import('@/server/modules/postpurchase/returns');
    const { canReadPrivateFile } = await import('@/server/storage/access');
    const { returnEvidence, returns: returnsT, orderItems } = await import('@/server/db/schema');
    const s = await makeSeller(admin);
    const finUser = await makeUser();
    const opsUser = await makeUser();
    await db.insert(sellerMembers).values([
      { sellerId: s.actor.sellerId!, userId: finUser.id, role: 'FINANCE', isActive: true },
      { sellerId: s.actor.sellerId!, userId: opsUser.id, role: 'ORDER_MANAGER', isActive: true },
    ]);
    const fin = (await sellerActor(finUser.id))!;
    const ops = (await sellerActor(opsUser.id))!;
    const p = await makeProduct(s.actor, admin, { price: 200_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await expect(sellerOrderForSeller(fin, so.id)).rejects.toThrow(/صلاحية/);
    expect((await sellerOrderForSeller(ops, so.id)).so.id).toBe(so.id);
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    const ret = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'DAMAGED', description: 'وصل المنتج مكسورًا بالكامل', items: [{ orderItemId: item.id, quantity: 1 }] }, [{ data: await png(), name: 'd.png' }]);
    const [ev] = await db.select().from(returnEvidence).where(eq(returnEvidence.returnId, ret.id));
    expect(await canReadPrivateFile(ops, ev.fileId)).toBe(true);
    const stranger = customerActor((await makeUser()).id);
    expect(await canReadPrivateFile(stranger, ev.fileId)).toBe(false);
    void returnsT;
  });

  it('customers cannot reply to a closed support ticket', async () => {
    const { openTicket, replyToTicket, updateTicket } = await import('@/server/modules/support/service');
    const c = await makeCustomer();
    const t = await openTicket(c.actor, { type: 'ACCOUNT', subject: 'مشكلة في الحساب', body: 'لا أستطيع تعديل بيانات الحساب الخاصة بي' });
    await updateTicket(admin, t.id, { status: 'CLOSED' });
    await expect(replyToTicket(c.actor, t.id, 'رد بعد الإغلاق')).rejects.toThrow(/التذكرة دي اتقفلت/);
  });
});
