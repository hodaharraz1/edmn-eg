/**
 * PKG-E2E-02: رحلات كاملة مؤتمتة على قاعدة بيانات محلية — الفلوس 85 ← 100، UX 75 ← 90.
 * لم يتم التحقق: لم تعمل هنا (لا Postgres في بيئة العمل). التشغيل:
 *   docker compose up -d postgres && npm run migrate && DATABASE_URL=postgres://… npx vitest run tests/integration/journeys-e2e02.test.ts
 *
 * الرحلات الست من الموجز، وبعد كل خطوة فحص الدفتر (financialInvariants: كل الضوابط صفر):
 *  1) عميل يطلب من تاجرين ← تحويل ← موظف يأكد ← التاجر يأكد ويجهز ويشحن ← استلام ← فلوس التاجر بعد العمولة ← سحب بشخصين.
 *  2) COD كامل حتى تحصيل المندوب وتسويته (شخصان).
 *  3) إيداع محفظة بشخصين ← الدفع منها ← استرجاع للمحفظة.
 *  4) الصفقة المحمية كاملة.
 *  5) الإرجاع والنزاع والفلوس محجوزة حتى الحسم.
 *  6) إلغاء الطلب في كل حالة مسموحة.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { customerWalletEntries, externalDeals, refunds, sellerOrders, walletTopups, withdrawalRequests } from '@/server/db/schema';
import { placeOrder, cancelUnpaidOrder } from '@/server/modules/commerce/orders';
import { confirmReceipt, confirmSellerOrder, cancelSellerOrder, requestCancellation, releaseSellerOrder } from '@/server/modules/commerce/fulfilment';
import { cartLines, addToCart } from '@/server/modules/commerce/cart';
import { priceLines } from '@/server/modules/commerce/pricing';
import { confirmPayment, startReview, submitProof, recordCodRemittance } from '@/server/modules/payments/service';
import { accountBalance, reconcile } from '@/server/modules/finance/ledger';
import { sellerOrderPosition } from '@/server/modules/finance/postings';
import { financialInvariants } from '@/server/modules/finance/controls';
import { requestMovement } from '@/server/modules/finance/movements';
import { requestWithdrawal, approveWithdrawal, markWithdrawalProcessing, markWithdrawalPaid } from '@/server/modules/finance/withdrawals';
import { submitTopup, creditTopup } from '@/server/modules/finance/wallet-topups';
import { requestRefundTx, approveRefund } from '@/server/modules/finance/refunds';
import { openDispute, resolveDispute } from '@/server/modules/postpurchase/disputes';
import { createDeal, saveDealStep, inviteSeller, claimInvitation, submitSellerOffer, respondToOffer, startDealPayment, markDealDelivered, confirmDealReceipt, releaseDeal } from '@/server/modules/deals/service';
import { updateSetting } from '@/server/modules/settings';
import { customerActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, paymentOf, sellerOrdersOf, shipIt, itemsOf } from '../helpers/factory';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin(['SUPER_ADMIN']);
  await ensurePaymentSetup();
});

/** الدفتر متوازن بعد كل خطوة (ledger:check): كل ضابط اتساق = صفر. */
async function expectLedgerGreen() {
  const rec = await reconcile();
  expect(rec.mismatches).toEqual([]);
  expect(rec.trialBalanceOk).toBe(true);
  const inv = await financialInvariants(db);
  expect(inv.checks.filter((c) => c.count > 0)).toEqual([]);
}

/** عميل + سلة فيها منتج من كل تاجر، بوسيلة دفع واحدة. */
async function multiSellerCheckout(paymentMethod: 'INSTAPAY' | 'COD' | 'WALLET' = 'INSTAPAY') {
  const s1 = await makeSeller(admin);
  const s2 = await makeSeller(admin);
  const p1 = await makeProduct(s1.actor, admin, { price: 1000_00, stock: 5 });
  const p2 = await makeProduct(s2.actor, admin, { price: 2000_00, stock: 5 });
  const c = await makeCustomer();
  await addToCart({ userId: c.user.id }, p1.variantId, 1);
  await addToCart({ userId: c.user.id }, p2.variantId, 1);
  const lines = await cartLines(db, { userId: c.user.id });
  const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
  const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod, checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
  return { s1, s2, c, order };
}

const sellerActorOf = (s1: { actor: Actor }, s2: { actor: Actor }, sellerId: string) => (sellerId === s1.actor.sellerId ? s1.actor : s2.actor);

/** إثبات + مراجعة + تأكيد (شخصان) للدفعة. */
async function confirmTransfer(c: { actor: Actor }, orderId: string) {
  const p = await paymentOf(orderId);
  const { submission } = await submitProof(c.actor, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png('proof'), name: 'proof.png' });
  await startReview(await makeAdmin(['PAYMENT_REVIEWER']), p.id);
  await confirmPayment(admin, p.id, submission.id);
  return p;
}

/** تأكيد الاستلام + إتاحة فلوس التاجر (شخصان). */
async function releaseToSeller(buyer: Actor, soId: string) {
  await confirmReceipt(buyer, soId);
  const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, soId));
  const pos = await sellerOrderPosition(db, so);
  await requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'SELLER_RELEASE', { entityId: soId, amount: pos.pending, reason: 'طلب إتاحة في الاختبار' });
  await releaseSellerOrder(await makeAdmin(['FINANCE_CHECKER']), soId, { expectedSellerAmount: pos.pending, reason: 'اعتماد الإتاحة في الاختبار' });
}

describe('PKG-E2E-02 (1) — رحلة السوق الكاملة: تاجرين ← تأكيد ← شحن ← استلام ← إتاحة ← سحب', () => {
  it('تمشي من الطلب لحد السحب بموافقة شخصين، والدفتر متوازن في كل خطوة', async () => {
    const { s1, s2, c, order } = await multiSellerCheckout();
    await expectLedgerGreen();

    await confirmTransfer(c, order.id);
    expect((await paymentOf(order.id)).status).toBe('CONFIRMED');
    await expectLedgerGreen();

    const sos = await sellerOrdersOf(order.id);
    expect(sos.length).toBe(2); // طلب واحد من تاجرين = طلبان فرعيان
    for (const so of sos) {
      await shipIt(sellerActorOf(s1, s2, so.sellerId), so.id); // يأكد ويجهز ويشحن
      await releaseToSeller(c.actor, so.id); // استلام ← الفلوس لرصيد التاجر بعد العمولة
      expect(await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: so.sellerId })).toBe(so.sellerNet); // بعد العمولة بالظبط
      await expectLedgerGreen();
    }

    // سحب بموافقة موظفين اتنين لكل تاجر
    for (const s of [s1, s2]) {
      const sellerId = s.actor.sellerId!;
      const available = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId });
      const { withdrawal } = await requestWithdrawal(s.actor, { amount: available / 100, clientKey: randomUUID() });
      await approveWithdrawal(await makeAdmin(['FINANCE_CHECKER']), withdrawal.id);
      await markWithdrawalProcessing(await makeAdmin(['FINANCE_OPERATOR']), withdrawal.id);
      await markWithdrawalPaid(await makeAdmin(['FINANCE_OPERATOR']), withdrawal.id, `REF-${randomUUID().slice(0, 8)}`);
      const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id));
      expect(w.status).toBe('PAID');
      expect(await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId })).toBe(0);
      await expectLedgerGreen();
    }
  }, 120_000);
});

describe('PKG-E2E-02 (2) — الدفع عند الاستلام كاملًا حتى التحصيل والتسوية', () => {
  it('COD: طلب ← شحن ← تسليم ← تحصيل المندوب ← تسوية بشخصين', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل COD لرحلة الاختبار');
    const { s1, s2, c, order } = await multiSellerCheckout('COD');
    const sos = await sellerOrdersOf(order.id);
    for (const so of sos) await shipIt(sellerActorOf(s1, s2, so.sellerId), so.id);
    for (const so of sos) await confirmReceipt(c.actor, so.id);
    // التسليم حوّل الدفعة لـCOD_COLLECTED (المندوب حصّل المبلغ عند التسليم)
    const p = await paymentOf(order.id);
    expect(p.status).toBe('COD_COLLECTED');
    // تسوية شركة الشحن: المبلغ الفعلي من الكشف + مرجع الكشف (maker ثم checker)
    await requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'COD_REMITTANCE', { entityId: p.id, amount: p.amountDue, reason: 'طلب تسوية تحصيل في الاختبار' });
    await recordCodRemittance(admin, p.id, { reason: 'تسوية تحويل شركة الشحن في الاختبار', actualAmount: p.amountDue, statementRef: `STM-${randomUUID().slice(0, 8)}` });
    expect((await paymentOf(order.id)).status).toBe('CONFIRMED');
    await expectLedgerGreen();
  }, 120_000);
});

describe('PKG-E2E-02 (3) — إيداع المحفظة بشخصين ← الدفع منها ← الاسترجاع للمحفظة', () => {
  it('top-up ← spend ← refund-to-wallet، والرصيد لا يصبح سالبًا أبدًا', async () => {
    await updateSetting(admin, 'wallet.topUpEnabled', true, 'تفعيل المحفظة لرحلة الاختبار');
    const c = await makeCustomer();
    // إيداع بموظفين اتنين
    const { topup } = await submitTopup(c.actor, { amount: '5000', method: 'INSTAPAY', clientKey: `ck${randomUUID()}` }, { data: await png('receipt'), name: 'receipt.png' });
    const [t0] = await db.select().from(walletTopups).where(eq(walletTopups.id, topup.id));
    expect(t0.status).toBe('PENDING_REVIEW');
    await requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'WALLET_TOPUP_CREDIT', { entityId: topup.id, amount: t0.amount, reason: 'طلب قيد الإيداع في الاختبار' });
    await creditTopup(await makeAdmin(['FINANCE_CHECKER']), topup.id, 'قيد الإيداع بعد مطابقة الإيصال');
    await expectLedgerGreen();
    const bal = async () => (await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id))).reduce((s, e) => s + e.amount, 0);
    expect(await bal()).toBe(5000_00);

    // الدفع من المحفظة لطلب من تاجر (يُسوّى فورًا في نفس ترانزاكشن الـcheckout)
    const s1 = await makeSeller(admin);
    const p1 = await makeProduct(s1.actor, admin, { price: 1000_00, stock: 5 });
    await addToCart({ userId: c.user.id }, p1.variantId, 1);
    const lines = await cartLines(db, { userId: c.user.id });
    const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
    const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'WALLET', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
    const pay = await paymentOf(order.id);
    expect(pay.status).toBe('CONFIRMED');
    expect(pay.method).toBe('WALLET');
    expect(await bal()).toBe(5000_00 - pay.amountDue);
    await expectLedgerGreen();

    // استرجاع للمحفظة: طلب استرداد ← اعتماد الإدارة (شخصان) ← المبلغ يرجع للمحفظة ويكتمل فورًا
    const [so] = await sellerOrdersOf(order.id);
    const items = await itemsOf(so.id);
    const refund = await requestRefundTx(db, admin, {
      sourceType: 'ORDER_CANCELLATION', sourceId: `e2e02-${randomUUID()}`, sellerOrderId: so.id,
      reason: 'استرجاع رحلة المحفظة في الاختبار — سبب طويل كافٍ',
      items: [{ orderItemId: items[0].id, quantity: items[0].quantity }],
    });
    await requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'REFUND_APPROVAL', { entityId: refund.id, amount: refund.amount, reason: 'طلب اعتماد الاسترداد في الاختبار' });
    await approveRefund(await makeAdmin(['FINANCE_CHECKER']), refund.id, { expectedAmount: refund.amount, reason: 'اعتماد الاسترداد للمحفظة' });
    const [r] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
    expect(r.status).toBe('COMPLETED'); // بلا تحويل خارجي — رجّع للمحفظة مباشرة
    expect(await bal()).toBe(5000_00 - pay.amountDue + refund.amount);
    const entries = await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id));
    expect(entries.some((e) => e.kind === 'SPEND')).toBe(true);
    expect(entries.some((e) => e.kind === 'SPEND_REVERSAL')).toBe(true);
    await expectLedgerGreen();
  }, 120_000);
});

describe('PKG-E2E-02 (4) — الصفقة المحمية كاملة', () => {
  it('إنشاء ← دعوة ← عرض ← قبول ← دفع ← تسليم ← تأكيد استلام ← إتاحة ← اكتمال', async () => {
    const buyer = customerActor((await makeUser({ identity: true })).id);
    const deal = await createDeal(buyer, { title: 'جهاز رحلة E2E', description: 'جهاز بحالة جيدة جداً لرحلة الاختبار', condition: 'NEW', quantity: 1 });
    await saveDealStep(buyer, deal.id, 2, { unitPrice: '3000' });
    await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
    await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
    const { token } = await inviteSeller(buyer, deal.id, true);
    const seller = customerActor((await makeUser({ identity: true })).id);
    await claimInvitation(seller, token);
    const { version } = await submitSellerOffer(
      seller, deal.id,
      { details: { fullName: 'بائع الصفقة' }, location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 }, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'deal@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
      true,
    );
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
    const { submission } = await submitProof(buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await startReview(await makeAdmin(['PAYMENT_REVIEWER']), p.id);
    await confirmPayment(admin, p.id, submission.id); // ACTIVE — الفلوس محجوزة في DEAL_FUNDS_HELD
    await expectLedgerGreen();

    await markDealDelivered(seller, deal.id, 'تم التسليم يد بيد');
    await confirmDealReceipt(buyer, deal.id);
    const [fresh] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    const remaining = fresh.buyerPays! - fresh.pendingBuyerRefund;
    const expectedPayout = remaining - Math.min(fresh.feeAmount, remaining);
    await requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'DEAL_RELEASE', { entityId: deal.id, amount: expectedPayout, reason: 'طلب إتاحة الصفقة في الاختبار' });
    await releaseDeal(await makeAdmin(['FINANCE_CHECKER']), deal.id, { expectedPayout, reason: 'اعتماد إتاحة الصفقة' });
    expect((await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id)))[0].status).toBe('COMPLETED');
    await expectLedgerGreen();
  }, 120_000);
});

describe('PKG-E2E-02 (5) — النزاع والفلوس محجوزة حتى الحسم', () => {
  it('نزاع على طلب مدفوع: الفلوس لا تتحرك قبل القرار، والاسترداد بعد الحسم بشخصين', async () => {
    const { c, order } = await multiSellerCheckout();
    await confirmTransfer(c, order.id);
    const [so] = await sellerOrdersOf(order.id);
    const before = await accountBalance(db, { code: 'SELLER_PENDING', sellerId: so.sellerId });
    expect(before).toBe(so.sellerNet); // محجوزة pending — لم تتحرك
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_RECEIVED', description: 'لم يصلني المنتج رغم تأكيد الدفع — وصف كافٍ' });
    expect(await accountBalance(db, { code: 'SELLER_PENDING', sellerId: so.sellerId })).toBe(before); // محجوزة طوال النزاع
    await resolveDispute(admin, d.id, { decision: 'FULL_REFUND', reasonCode: 'NOT_DELIVERED', note: 'لم يثبت التسليم — استرداد كامل للمشتري' });
    const [r] = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
    expect(r).toBeTruthy();
    await requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'REFUND_APPROVAL', { entityId: r.id, amount: r.amount, reason: 'طلب اعتماد استرداد النزاع' });
    await approveRefund(await makeAdmin(['FINANCE_CHECKER']), r.id, { expectedAmount: r.amount, reason: 'اعتماد استرداد النزاع' });
    await expectLedgerGreen();
  }, 120_000);
});

describe('PKG-E2E-02 (6) — الإلغاء في كل حالة مسموحة', () => {
  it('إلغاء قبل الدفع', async () => {
    const { c, order } = await multiSellerCheckout();
    await cancelUnpaidOrder(c.actor, order.id);
    await expectLedgerGreen(); // لا قيود لطلب غير مدفوع
  }, 60_000);

  it('طلب إلغاء المشتري أثناء مراجعة الإثبات يُحترم عند التأكيد (مع التزام استرداد)', async () => {
    const { c, order } = await multiSellerCheckout();
    const p = await paymentOf(order.id);
    const { submission } = await submitProof(c.actor, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png('proof'), name: 'proof.png' });
    const [so] = await sellerOrdersOf(order.id);
    await requestCancellation(c.actor, so.id, 'غيّرت رأيي قبل تأكيد الدفع — سبب كافٍ');
    await startReview(await makeAdmin(['PAYMENT_REVIEWER']), p.id);
    await confirmPayment(admin, p.id, submission.id);
    const rs = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
    expect(rs.length).toBeGreaterThan(0); // الإلغاء المعلّق طُبّق مع التزام استرداد
    await expectLedgerGreen();
  }, 120_000);

  it('إلغاء التاجر بعد التأكيد وقبل الشحن', async () => {
    const { s1, s2, c, order } = await multiSellerCheckout();
    await confirmTransfer(c, order.id);
    const sos = await sellerOrdersOf(order.id);
    const so = sos.find((x) => x.sellerId === s1.actor.sellerId) ?? sos[0];
    await confirmSellerOrder(sellerActorOf(s1, s2, so.sellerId), so.id);
    await cancelSellerOrder(sellerActorOf(s1, s2, so.sellerId), so.id, 'نفد المخزون عند التجهيز — سبب كافٍ للاختبار');
    const rs = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
    expect(rs.length).toBeGreaterThan(0); // التزام استرداد للمشتري
    await expectLedgerGreen();
  }, 120_000);
});
