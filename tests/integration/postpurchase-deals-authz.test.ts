import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { externalDeals, files, orderItems, payments, productReviews, products, refunds, returns, sellerOrders, sellerDocuments, sellers } from '@/server/db/schema';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { orderForCustomer } from '@/server/modules/commerce/orders';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { acceptReturnRefund, approveReturn, customerShipsReturn, markReturnReceived, requestReturn, startInspection } from '@/server/modules/postpurchase/returns';
import { openDispute, resolveDispute } from '@/server/modules/postpurchase/disputes';
import { createProductReview, moderateReview } from '@/server/modules/reviews/service';
import { claimInvitation, confirmDealReceipt, createDeal, invitationByToken, inviteSeller, markDealDelivered, deliveryOtpForBuyer, verifyDeliveryOtp, respondToOffer, saveDealStep, startDealPayment, submitSellerOffer } from '@/server/modules/deals/service';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { canReadPrivateFile } from '@/server/storage/access';
import { checkout, ensurePaymentSetup, itemsOf, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

async function delivered(items: { price: number; qty: number }[]) {
  const s = await makeSeller(admin);
  const ps = [];
  for (const i of items) ps.push(await makeProduct(s.actor, admin, { price: i.price, stock: 10 }));
  const c = await makeCustomer();
  const order = await checkout(c, ps.map((p, idx) => ({ variantId: p.variantId, qty: items[idx].qty })));
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await confirmReceipt(c.actor, so.id);
  return { s, c, order, so };
}

describe('returns', () => {
  it('EDGE 9 — one item of a multi-item order is returned and refunded proportionally', async () => {
    const { s, c, so } = await delivered([{ price: 300_00, qty: 1 }, { price: 700_00, qty: 2 }]);
    const items = await itemsOf(so.id);
    const cheap = items.find((i) => i.unitPrice === 300_00)!;
    const availableBefore = (await sellerBalances(db, s.actor.sellerId!)).available;
    const ret = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'DEFECTIVE', description: 'المنتج لا يعمل منذ أول يوم', items: [{ orderItemId: cheap.id, quantity: 1 }] }, [{ data: await png('evidence'), name: 'e.png' }]);
    await approveReturn(s.actor, ret.id);
    await customerShipsReturn(c.actor, ret.id, 'بوسطة', 'R1');
    await markReturnReceived(s.actor, ret.id);
    await startInspection(s.actor, ret.id);
    await acceptReturnRefund(s.actor, ret.id, { restock: true });
    const [r] = await db.select().from(refunds).where(eq(refunds.sourceId, ret.id));
    expect(r.amount).toBe(300_00);
    expect(r.commissionReversal).toBeGreaterThan(0);
    const [it1] = await db.select().from(orderItems).where(eq(orderItems.id, cheap.id));
    expect(it1.returnedQuantity).toBe(1);
    const other = items.find((i) => i.id !== cheap.id)!;
    expect((await db.select().from(orderItems).where(eq(orderItems.id, other.id)))[0].returnedQuantity).toBe(0);
    const availableAfter = (await sellerBalances(db, s.actor.sellerId!)).available;
    expect(availableBefore - availableAfter).toBe(300_00 - r.commissionReversal);
    // cannot return the same unit twice
    await expect(requestReturn(c.actor, { sellerOrderId: so.id, reason: 'OTHER', description: 'إرجاع مكرر لنفس القطعة', items: [{ orderItemId: cheap.id, quantity: 1 }] })).rejects.toThrow(/أكبر من المتاح/);
  });

  it('defect claims require evidence', async () => {
    const { c, so } = await delivered([{ price: 100_00, qty: 1 }]);
    const [item] = await itemsOf(so.id);
    await expect(requestReturn(c.actor, { sellerOrderId: so.id, reason: 'DAMAGED', description: 'وصل مكسور تماماً', items: [{ orderItemId: item.id, quantity: 1 }] })).rejects.toThrow(/صور/);
  });
});

describe('disputes', () => {
  it('an open dispute holds seller funds at receipt; a full-refund decision reverses them', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 500_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج المستلم مختلف تماماً عن الصور المعروضة في الإعلان' });
    const res = await confirmReceipt(c.actor, so.id);
    expect(res.released).toBe(false);
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(0);
    await expect(resolveDispute(c.actor, d.id, { decision: 'FULL_REFUND', reasonCode: 'X', note: 'قرار من العميل نفسه' })).rejects.toThrow(/صلاحية/);
    const officer = await makeAdmin(['DISPUTE_OFFICER']);
    await resolveDispute(officer, d.id, { decision: 'FULL_REFUND', reasonCode: 'ITEM_NOT_AS_DESCRIBED', note: 'الأدلة تؤكد اختلاف المنتج عن الوصف' });
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(b.available).toBe(0);
    expect(b.pending).toBe(0);
    const [r] = await db.select().from(refunds).where(eq(refunds.sourceId, d.id));
    expect(r.amount).toBe(so.grossTotal);
  });

  it('a REJECT_CLAIM decision releases the held funds to the seller', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 400_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'OTHER', description: 'شكوى للاختبار بدون أدلة كافية من العميل' });
    await confirmReceipt(c.actor, so.id);
    await resolveDispute(admin, d.id, { decision: 'REJECT_CLAIM', reasonCode: 'NO_EVIDENCE', note: 'لم تقدم أدلة تدعم الشكوى' });
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(so.sellerNet);
  });
});

describe('reviews', () => {
  it('only verified purchases can review; moderation recomputes ratings', async () => {
    const { c, so } = await delivered([{ price: 100_00, qty: 1 }]);
    const [item] = await itemsOf(so.id);
    const stranger = await makeCustomer();
    await expect(createProductReview(stranger.actor, { orderItemId: item.id, rating: 1 })).rejects.toThrow(/صلاحية/);
    const r = await createProductReview(c.actor, { orderItemId: item.id, rating: 4, body: 'جيد' });
    await expect(createProductReview(c.actor, { orderItemId: item.id, rating: 5 })).rejects.toThrow(/قيّمت المنتج ده قبل كده/);
    let [p] = await db.select().from(products).where(eq(products.id, item.productId));
    expect(Number(p.ratingAvg)).toBe(4);
    await moderateReview(admin, 'PRODUCT', r.id, 'HIDDEN', 'محتوى مخالف لسياسة التقييمات');
    [p] = await db.select().from(products).where(eq(products.id, item.productId));
    expect(p.ratingCount).toBe(0);
    void productReviews;
  });
});

describe('external protected deals', () => {
  it('full flow: wizard → invite → accept → payment → active → delivered → confirmed → payout payable', async () => {
    await ensurePaymentSetup();
    const buyerUser = await makeUser();
    const sellerUser = await makeUser();
    const buyer = customerActor(buyerUser.id);
    const seller = customerActor(sellerUser.id);
    const deal = await createDeal(buyer, { title: 'لابتوب مستعمل من فيسبوك', description: 'لابتوب ديل مستعمل بحالة جيدة جداً', condition: 'USED', quantity: 1 });
    await expect(inviteSeller(buyer, deal.id, true)).rejects.toThrow(/أكمل/);
    await saveDealStep(buyer, deal.id, 2, { unitPrice: '15000' });
    await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 3 * 86400_000), inspectionDays: 2 });
    await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير' });
    const { link } = await inviteSeller(buyer, deal.id, true);
    const token = link.split('/').pop()!;
    expect(await invitationByToken('wrong-token-wrong-token-wrong-token')).toBeNull();
    await expect(claimInvitation(buyer, token)).rejects.toThrow();
    await claimInvitation(seller, token);
    const { version } = await submitSellerOffer(
      seller,
      deal.id,
      {
        details: { fullName: 'بائع خارجي' },
        location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم' },
        payout: { type: 'INSTAPAY', holderName: 'بائع خارجي', instapayAddress: 'ext@instapay' },
        offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1, defects: 'لا يوجد' },
        returnPolicy: { type: 'NONE' },
      },
      true,
    );
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
    const { submission } = await submitProof(buyer, p.id, { claimedAmount: '15000', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await expect(markDealDelivered(seller, deal.id, 'تم')).rejects.toThrow(); // not active yet
    await confirmPayment(admin, p.id, submission.id);
    let [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('ACTIVE');
    await expect(markDealDelivered(buyer, deal.id, 'تم')).rejects.toThrow(/صلاحية/);
    await markDealDelivered(seller, deal.id, 'تم التسليم يداً بيد');
    await expect(confirmDealReceipt(buyer, deal.id)).rejects.toThrow(/رمز الاستلام/); // handover not verified yet
    await verifyDeliveryOtp(seller, deal.id, (await deliveryOtpForBuyer(buyer, deal.id))!.testCode!);
    await confirmDealReceipt(buyer, deal.id);
    const again = await confirmDealReceipt(buyer, deal.id);
    expect(again.alreadyCompleted).toBe(true);
    [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('COMPLETED');
    void payments;
  });
});

describe('authorization & privacy', () => {
  it('EDGE 16 — a customer cannot read another customer’s order', async () => {
    const { order } = await delivered([{ price: 100_00, qty: 1 }]);
    const other = await makeCustomer();
    await expect(orderForCustomer(other.actor, order.id)).rejects.toThrow(/صلاحية/);
  });

  it('EDGE 18 — guessing a private document id does not grant access', async () => {
    const { s } = await delivered([{ price: 100_00, qty: 1 }]);
    const [doc] = await db.select().from(sellerDocuments).innerJoin(sellers, eq(sellers.id, sellerDocuments.sellerId)).where(eq(sellers.id, s.actor.sellerId!));
    const fileId = doc.seller_documents.fileId;
    const [f] = await db.select().from(files).where(eq(files.id, fileId));
    expect(f.visibility).toBe('PRIVATE');
    const stranger = await makeCustomer();
    expect(await canReadPrivateFile(stranger.actor, fileId)).toBe(false);
    expect(await canReadPrivateFile({ type: 'ANONYMOUS', userId: null, permissions: new Set() }, fileId)).toBe(false);
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    expect(await canReadPrivateFile(support, fileId)).toBe(false);
    const reviewer = await makeAdmin(['SELLER_REVIEWER']);
    expect(await canReadPrivateFile(reviewer, fileId)).toBe(true);
    expect(await canReadPrivateFile(s.actor, fileId)).toBe(true);
    void returns;
    void sellerOrders;
  });
});
