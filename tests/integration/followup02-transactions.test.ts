/**
 * PKG-FOLLOWUP-02: /admin/transactions shows a wallet-paid order (WALLET_SPEND), a deposit (WALLET_TOPUP) and a refund to the wallet
 * (REFUND + SPEND_REVERSAL) with the right type, method and status; deposits are hidden without payments.view.
 * لم يتم التحقق: لم تعمل هنا (لا Postgres). التشغيل:
 *   docker compose up -d postgres && npm run migrate && DATABASE_URL=postgres://… npx vitest run tests/integration/followup02-transactions.test.ts
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetSettings } from '../helpers/settings';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { refunds, walletTopups } from '@/server/db/schema';
import { placeOrder } from '@/server/modules/commerce/orders';
import { cartLines, addToCart } from '@/server/modules/commerce/cart';
import { priceLines } from '@/server/modules/commerce/pricing';
import { submitTopup, creditTopup } from '@/server/modules/finance/wallet-topups';
import { requestMovement } from '@/server/modules/finance/movements';
import { listTransactions } from '@/server/modules/finance/transactions';
import { approveRefund } from '@/server/modules/finance/refunds';
import { openDispute, resolveDispute } from '@/server/modules/postpurchase/disputes';
import { claimInvitation, createDeal, inviteSeller, respondToOffer, saveDealStep, startDealPayment, submitSellerOffer } from '@/server/modules/deals/service';
import { customerActor } from '@/server/auth/actors';
import { updateSetting } from '@/server/modules/settings';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, paymentOf } from '../helpers/factory';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin(['SUPER_ADMIN']);
  await ensurePaymentSetup();
  await updateSetting(admin, 'wallet.topUpEnabled', true, 'تفعيل الفلاج للاختبار');
});
// The flag is a shared setting: always close it again so other test files see the default (off).
afterAll(async () => {
  await updateSetting(admin, 'wallet.topUpEnabled', false, 'إعادة الفلاج للوضع الافتراضي بعد الاختبار');
});

/** محفظة مموّلة بمبلغ `egp` جنيه عبر الإيداع الثنائي (maker/checker). */
async function fundedWallet(egp: string) {
  const c = await makeCustomer();
  const { topup } = await submitTopup(c.actor, { amount: egp, method: 'INSTAPAY', clientKey: `ck${randomUUID()}` }, { data: await png('receipt'), name: 'receipt.png' });
  const [t] = await db.select().from(walletTopups).where(eq(walletTopups.id, topup.id));
  await requestMovement(await makeAdmin(['FINANCE_OPERATOR']), 'WALLET_TOPUP_CREDIT', { entityId: topup.id, amount: t.amount, reason: 'طلب قيد الإيداع في الاختبار' });
  await creditTopup(await makeAdmin(['PAYMENT_REVIEWER']), topup.id, 'قيد الإيداع'); // the checker needs payments.verify
  return c;
}

async function walletCheckout(c: Awaited<ReturnType<typeof makeCustomer>>, variantId: string, key = randomUUID()) {
  await addToCart({ userId: c.user.id }, variantId, 1);
  const lines = await cartLines(db, { userId: c.user.id });
  const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
  return placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'WALLET', checkoutKey: key, expectedTotal: priced.grandTotal });
}

const LOC = { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 };


/** A Protected Deal whose offer the buyer accepted (payment not started). The buyer is the given (wallet-funded) customer. */
async function protectedDealOffered(buyer: Actor): Promise<string> {
  const deal = await createDeal(buyer, { title: 'صفقة مدفوعة من المحفظة', description: 'جهاز بحالة جيدة جداً لاختبار الدفع من المحفظة', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '3000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const seller = customerActor((await makeUser({ identity: true })).id);
  await claimInvitation(seller, token);
  const { version } = await submitSellerOffer(
    seller,
    deal.id,
    { details: { fullName: 'بائع الصفقة' }, location: LOC, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'wallet-deal@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
    true,
  );
  await respondToOffer(buyer, deal.id, version, 'ACCEPT');
  return deal.id;
}

// Shared settings this file changes go back to their defaults, even when a test fails midway (Q3, PKG-FOLLOWUP-01).
afterAll(() => resetSettings('wallet.topUpEnabled'));

afterAll(() => resetSettings('wallet.topUpEnabled'));

const find = (rows: Awaited<ReturnType<typeof listTransactions>>, kind: string, ref?: string) => rows.filter((r) => r.kind === kind && (!ref || r.href.includes(ref) || r.id === ref));

describe('PKG-FOLLOWUP-02 transactions page data (لم يتم التحقق — يحتاج Postgres)', () => {
  it('a wallet-paid order, a deposit and a refund to the wallet each show with the right type', async () => {
    const c = await fundedWallet('5000');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    const { order } = await walletCheckout(c, p.variantId);
    const pay = await paymentOf(order.id);
    const [topup] = await db.select().from(walletTopups).where(eq(walletTopups.userId, c.user.id));

    const all = await listTransactions(db, { canViewPayments: true, limit: 500 });
    const spend = all.find((r) => r.kind === 'WALLET_SPEND' && r.id === pay.id);
    expect(spend).toMatchObject({ amount: pay.amountDue, method: 'WALLET' });
    const dep = all.find((r) => r.kind === 'WALLET_TOPUP' && r.id === topup.id);
    expect(dep).toMatchObject({ amount: topup.amount, status: 'CREDITED', method: 'INSTAPAY' });

    // refund to the wallet (Protected Deal dispute, two-person approval)
    const dealId = await protectedDealOffered(c.actor);
    await startDealPayment(c.actor, dealId, 'WALLET');
    const d = await openDispute(c.actor, { dealId, reasonCode: 'NOT_RECEIVED', description: 'لم يتم تسليم المنتج حتى الآن رغم الدفع من المحفظة' });
    await resolveDispute(admin, d.id, { decision: 'FULL_REFUND', reasonCode: 'NOT_DELIVERED', note: 'لم يثبت التسليم — استرداد كامل للمحفظة' });
    const [r] = await db.select().from(refunds).where(eq(refunds.dealId, dealId));
    const maker = await makeAdmin(['FINANCE_OPERATOR']);
    const checker = await makeAdmin(['FINANCE_CHECKER']);
    await requestMovement(maker, 'REFUND_APPROVAL', { entityId: r.id, amount: r.amount, reason: 'طلب اعتماد استرداد للمحفظة' });
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد استرداد للمحفظة' });

    const after = await listTransactions(db, { canViewPayments: true, limit: 500 });
    expect(after.find((x) => x.kind === 'REFUND' && x.id === r.id)).toMatchObject({ amount: r.amount });
    const reversals = after.filter((x) => x.kind === 'SPEND_REVERSAL' && x.amount === r.amount);
    expect(reversals.length).toBeGreaterThanOrEqual(1);
    expect(reversals[0].method).toBe('WALLET');

    // method filter: wallet group keeps wallet-paid rows and drops instapay/bank ones
    const walletOnly = await listTransactions(db, { canViewPayments: true, method: 'WALLET', limit: 500 });
    expect(walletOnly.some((x) => x.id === pay.id)).toBe(true);
    expect(walletOnly.some((x) => x.method === 'INSTAPAY')).toBe(false);
    // kind filter
    const onlyTopups = await listTransactions(db, { canViewPayments: true, kind: 'WALLET_TOPUP', limit: 500 });
    expect(onlyTopups.every((x) => x.kind === 'WALLET_TOPUP')).toBe(true);
  }, 180_000);

  it('without payments.view the deposits are not listed', async () => {
    const c = await fundedWallet('1000');
    const [topup] = await db.select().from(walletTopups).where(eq(walletTopups.userId, c.user.id));
    const hidden = await listTransactions(db, { canViewPayments: false, limit: 500 });
    expect(find(hidden, 'WALLET_TOPUP').length).toBe(0);
    expect(hidden.some((x) => x.id === topup.id)).toBe(false);
    const shown = await listTransactions(db, { canViewPayments: true, limit: 500 });
    expect(shown.some((x) => x.id === topup.id)).toBe(true);
  }, 120_000);
});
