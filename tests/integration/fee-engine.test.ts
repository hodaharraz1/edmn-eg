import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { adminActor, customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { auditLogs, externalDeals, journalEntries, journalLines, ledgerAccounts, orders, pricingVersions, refunds, sellerOrders, transactionCosts, withdrawalRequests } from '@/server/db/schema';
import type { Actor } from '@/server/core/actor';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { claimInvitation, createDeal, inviteSeller, respondToOffer, saveDealStep, startDealPayment, submitSellerOffer } from '@/server/modules/deals/service';
import { sellerBalances } from '@/server/modules/finance/ledger';
import { approveRefund, requestRefundTx } from '@/server/modules/finance/refunds';
import { sellerStatement } from '@/server/modules/finance/seller-statement';
import { approveWithdrawal, markWithdrawalPaid, previewWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { financialInvariants } from '@/server/modules/finance/controls';
import { activeChannelConfig, saveChannelVersion } from '@/server/modules/pricing/payout-costs';
import { economics, kpis, recordCost } from '@/server/modules/pricing/profitability';
import { activeVersionId, approveVersion, compareVersions, createDraft, loadVersion, publishVersion, submitVersion, updateDraft } from '@/server/modules/pricing/service';
import { checkout, ensurePaymentSetup, itemsOf, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, publishPricingVariant, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

let admin: Actor;
let checker: Actor;
let operator: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  checker = await makeAdmin(['FINANCE_CHECKER']);
  operator = await makeAdmin(['FINANCE_OPERATOR']);
  await ensurePaymentSetup();
});

async function paidOrder(price = 1000_00, qty = 1, category?: string) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 20, ...(category ? { category, attributes: category === 'mobile-phones' ? { model: ['T1'], storage: ['128GB'] } : undefined } : {}) });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  return { s, c, order, so, p };
}
const soOf = async (id: string) => (await db.select().from(sellerOrders).where(eq(sellerOrders.id, id)))[0];

describe('A. marketplace checkout with the fee engine', () => {
  it('#5/#6 multi-seller, mixed classes: one fee unit per seller sub-order, line-level classes, exact sums', async () => {
    const a = await makeSeller(admin);
    const b = await makeSeller(admin);
    const phone = await makeProduct(a.actor, admin, { price: 6000_00, category: 'mobile-phones', attributes: { model: ['T1'], storage: ['128GB'] } });
    const acc = await makeProduct(a.actor, admin, { price: 1000_00 });
    const other = await makeProduct(b.actor, admin, { price: 2000_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: phone.variantId, qty: 1 }, { variantId: acc.variantId, qty: 1 }, { variantId: other.variantId, qty: 1 }]);
    const sos = await sellerOrdersOf(order.id);
    const soA = sos.find((x) => x.sellerId === a.actor.sellerId)!;
    const soB = sos.find((x) => x.sellerId === b.actor.sellerId)!;
    // A: LOW 6,000 → 400 + 65 = 465 ; STANDARD 1,000 → 120 ⇒ 585 (classes not blended)
    expect(soA.commissionTotal).toBe(585_00);
    // B: STANDARD 2,000 → 240
    expect(soB.commissionTotal).toBe(240_00);
    const itemsA = await itemsOf(soA.id);
    expect(itemsA.map((i) => i.economicClass).sort()).toEqual(['LOW_MARGIN', 'STANDARD']);
    expect(itemsA.reduce((x, i) => x + i.commissionAmount, 0)).toBe(soA.commissionTotal);
    expect(order.buyerFeeTotal).toBe(soA.buyerFeeTotal + soB.buyerFeeTotal);
    expect(order.grandTotal).toBe(order.merchandiseTotal + order.shippingTotal + order.buyerFeeTotal);
  });

  it('#7 shipping excluded from the fee base; shipping snapshotted separately', async () => {
    const { so } = await paidOrder(1000_00);
    expect(so.shippingFee).toBeGreaterThan(0);
    expect(so.commissionTotal).toBe(120_00);
    const snap = so.pricingSnapshot as { feeBase: number; shipping: number; shippingExcludedFromBase: boolean };
    expect(snap.feeBase).toBe(1000_00);
    expect(snap.shipping).toBe(so.shippingFee);
    expect(snap.shippingExcludedFromBase).toBe(true);
  });

  it('#15/#27 stale quote: a version published between quote and commit forces re-confirmation', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00 });
    const c = await makeCustomer();
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    const lines = await cartLines(db, { userId: c.user.id });
    const quoted = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
    const v = await publishPricingVariant('MARKETPLACE', (ts) => ts.map((t) => (t.economicClass === 'STANDARD' && t.lowerBound === 0 ? { ...t, buyerBps: 400, sellerBps: 900, totalBps: 1300 } : t)));
    try {
      await expect(placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: quoted.grandTotal, expectedPricingVersionId: quoted.pricingVersionId! })).rejects.toMatchObject({ code: 'CONFLICT' });
      const fresh = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
      expect(fresh.pricingVersionId).toBe(v);
      const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: fresh.grandTotal, expectedPricingVersionId: v });
      expect(order.buyerFeeTotal).toBe(40_00);
    } finally {
      await publishPricingVariant('MARKETPLACE');
    }
  });

  it('#14/#51/#69 committed fees and invoices never change when a new version is published', async () => {
    const { so, order } = await paidOrder(1000_00);
    await publishPricingVariant('MARKETPLACE', (ts) => ts.map((t) => ({ ...t, buyerBps: t.buyerBps + 100, totalBps: t.totalBps + 100 })));
    await publishPricingVariant('MARKETPLACE');
    const after = await soOf(so.id);
    expect(after.commissionTotal).toBe(so.commissionTotal);
    expect(after.pricingSnapshot).toEqual(so.pricingSnapshot);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.buyerFeeTotal).toBe(order.buyerFeeTotal);
    expect(o.grandTotal).toBe(order.grandTotal);
  });

  it('#50/#52 the buyer fee quoted before commitment is exactly the fee committed', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 2500_00 });
    const c = await makeCustomer();
    await addToCart({ userId: c.user.id }, p.variantId, 2);
    const lines = await cartLines(db, { userId: c.user.id });
    const quoted = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
    const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: quoted.grandTotal, expectedPricingVersionId: quoted.pricingVersionId! });
    expect(order.buyerFeeTotal).toBe(quoted.buyerFeeTotal);
    expect(order.grandTotal).toBe(quoted.grandTotal);
    expect(quoted.buyerFeeTotal).toBe(175_00); // 5,000 STANDARD: 3.5%
  });
});

describe('B. protected deal snapshot', () => {
  it('#28 the agreed deal freezes its guarantee fee snapshot (immutable; later versions do not change it)', async () => {
    const buyerUser = await makeUser();
    const buyer = customerActor(buyerUser.id);
    const deal = await createDeal(buyer, { title: 'جهاز لابتوب للصفقة', description: 'لابتوب بحالة ممتازة مع الشاحن الأصلي', condition: 'NEW', quantity: 1 });
    await saveDealStep(buyer, deal.id, 2, { unitPrice: '10000' });
    await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
    await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير' });
    const { token } = await inviteSeller(buyer, deal.id, true);
    const seller = customerActor((await makeUser()).id);
    await claimInvitation(seller, token);
    const { version } = await submitSellerOffer(seller, deal.id, { details: { fullName: 'بائع الصفقة' }, location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم' }, payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: 'fee@instapay' }, offer: { shippingFee: '75', deliveryMethod: 'شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } }, true);
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    let [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    // 10,000: 700 total → buyer 350 / seller 350 ; shipping 75 excluded from the base
    expect(d.feeAmount).toBe(700_00);
    expect(d.buyerFeeAmount).toBe(350_00);
    expect(d.sellerFeeAmount).toBe(350_00);
    expect(d.buyerPays).toBe(10000_00 + 75_00 + 350_00);
    expect(d.sellerReceives).toBe(10000_00 + 75_00 - 350_00);
    expect(d.pricingSource).toBe('ENGINE');
    const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
    expect(p.amountDue).toBe(d.buyerPays);
    await expect(db.execute(sql`update external_deals set pricing_snapshot = '{}'::jsonb where id = ${deal.id}`)).rejects.toThrow();
    await publishPricingVariant('PROTECTED_DEAL', (ts) => ts.map((t) => ({ ...t, buyerBps: t.buyerBps * 2, sellerBps: t.sellerBps * 2, totalBps: t.totalBps * 2 })));
    await publishPricingVariant('PROTECTED_DEAL');
    [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.feeAmount).toBe(700_00);
  });
});

describe('C. Admin pricing workflow (maker/checker, 2FA, immutability, margin guard)', () => {
  it('#29/#30/#31 draft create + edit; a published version cannot be edited (service + DB)', async () => {
    const active = (await activeVersionId(db, 'MARKETPLACE'))!;
    const d = await createDraft(operator, 'MARKETPLACE', active, 'مسودة اختبار');
    const base = await loadVersion(db, d.id);
    await updateDraft(operator, d.id, { minFee: 30_00, tiers: Object.entries(base.tiersByClass).flatMap(([c, ts]) => ts.map((t) => ({ economicClass: c, ...t }))) }, 'رفع الحد الأدنى');
    expect((await loadVersion(db, d.id)).minFee).toBe(30_00);
    await expect(updateDraft(operator, active, { minFee: 1 })).rejects.toThrow(/مش مسودة/);
    await expect(db.execute(sql`update pricing_tiers set total_bps = 1 where version_id = ${active}`)).rejects.toThrow();
    await expect(db.execute(sql`update pricing_versions set min_fee = 1 where id = ${active}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from pricing_versions where id = ${d.id}`)).rejects.toThrow();
  });

  it('#36/#37/#38 publication needs authorization, a different checker and fresh 2FA', async () => {
    const active = (await activeVersionId(db, 'MARKETPLACE'))!;
    const d = await createDraft(operator, 'MARKETPLACE', active);
    await submitVersion(operator, d.id);
    const c = await makeCustomer();
    await expect(approveVersion(c.actor, d.id, { reason: 'عميل يحاول' })).rejects.toThrow();
    await expect(approveVersion(operator, d.id, { reason: 'المنشئ يعتمد نفسه' })).rejects.toThrow();
    const noStepUp = await adminActor(checker.userId!, {});
    await expect(approveVersion(noStepUp, d.id, { reason: 'بدون تحقق' })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await approveVersion(checker, d.id, { reason: 'اعتماد سليم' });
    await expect(publishVersion(operator, d.id, { reason: 'المنشئ ينشر' })).rejects.toThrow();
    // DB check: approver can never equal the submitter.
    await expect(db.execute(sql`update pricing_versions set approved_by = validated_by where id = ${d.id}`)).rejects.toThrow();
    await db.update(pricingVersions).set({ status: 'CANCELLED', cancelledAt: new Date() }).where(eq(pricingVersions.id, d.id));
  });

  it('#39 version comparison is computed on representative amounts without touching history', async () => {
    const active = (await activeVersionId(db, 'PROTECTED_DEAL'))!;
    const d = await createDraft(operator, 'PROTECTED_DEAL', active);
    const base = await loadVersion(db, d.id);
    await updateDraft(operator, d.id, { tiers: base.tiersByClass.DEAL.map((t) => ({ economicClass: 'DEAL', ...t, buyerBps: t.buyerBps + 50, totalBps: t.totalBps + 50 })) });
    const diff = await compareVersions(active, d.id);
    const at10k = diff.find((x) => x.amount === 10000_00)!;
    expect(at10k.buyerDiff).toBe(50_00); // +0.5% on 10,000
    expect(at10k.sellerDiff).toBe(0);
    await db.update(pricingVersions).set({ status: 'CANCELLED', cancelledAt: new Date() }).where(eq(pricingVersions.id, d.id));
  });

  it('#41/#42 below-target margin blocks approval; an authorized override is recorded with reason and audit', async () => {
    const active = (await activeVersionId(db, 'MARKETPLACE'))!;
    const d = await createDraft(operator, 'MARKETPLACE', active);
    await updateDraft(operator, d.id, { assumptions: { refundReserveBps: 500, fraudReserveBps: 400, operationalReserveBps: 300 } });
    const sub = await submitVersion(operator, d.id);
    expect(sub.belowTarget).toBe(true);
    await expect(approveVersion(checker, d.id, { reason: 'اعتماد عادي' })).rejects.toThrow(/أقل من المستهدف/);
    await expect(approveVersion(checker, d.id, { reason: 'تجاوز', overrideMarginGuard: true, overrideReason: 'قرار إداري موثق للاختبار' })).rejects.toThrow(); // checker lacks override permission
    const superAdmin = await makeAdmin();
    const r = await approveVersion(superAdmin, d.id, { reason: 'اعتماد باستثناء', overrideMarginGuard: true, overrideReason: 'قرار إداري موثق للاختبار' });
    expect(r.override).toBe(true);
    const [row] = await db.select().from(pricingVersions).where(eq(pricingVersions.id, d.id));
    expect(row.marginOverride).toBe(true);
    expect(row.marginOverrideReason).toMatch(/قرار إداري/);
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, d.id), eq(auditLogs.action, 'pricing.approved_with_margin_override')));
    expect(logs).toHaveLength(1);
    await db.update(pricingVersions).set({ status: 'CANCELLED', cancelledAt: new Date() }).where(eq(pricingVersions.id, d.id));
  });

  it('#63/#64 concurrent publication is serialized; a checkout racing an activation commits one consistent version', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00 });
    const c = await makeCustomer();
    const before = (await activeVersionId(db, 'MARKETPLACE'))!;
    const [order, published] = await Promise.allSettled([
      checkout(c, [{ variantId: p.variantId, qty: 1 }]),
      publishPricingVariant('MARKETPLACE', (ts) => ts.map((t) => (t.economicClass === 'STANDARD' && t.lowerBound === 0 ? { ...t, buyerBps: 450, sellerBps: 850, totalBps: 1300 } : t))),
    ]);
    expect(published.status).toBe('fulfilled');
    if (order.status === 'fulfilled') {
      const [so] = await sellerOrdersOf(order.value.id);
      const snap = so.pricingSnapshot as { pricingVersionId: string; totalFee: number };
      expect([before, (published as PromiseFulfilledResult<string>).value]).toContain(so.pricingVersionId);
      expect(snap.pricingVersionId).toBe(so.pricingVersionId);
      expect(so.commissionTotal).toBe(so.pricingVersionId === before ? 120_00 : 130_00);
    } else {
      expect(String(order.reason)).toMatch(/اتغير|اتحدثت/); // stale total → re-confirmation, never a mixed fee
    }
    await publishPricingVariant('MARKETPLACE');
    // Two publications of the same approved version: exactly one wins.
    const active = (await activeVersionId(db, 'MARKETPLACE'))!;
    const d = await createDraft(operator, 'MARKETPLACE', active);
    await submitVersion(operator, d.id);
    await approveVersion(checker, d.id, { reason: 'اعتماد' });
    const both = await Promise.allSettled([publishVersion(checker, d.id, { reason: 'نشر 1' }), publishVersion(checker, d.id, { reason: 'نشر 2' })]);
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    await publishPricingVariant('MARKETPLACE');
  });
});

describe('D. seller economics, statement and withdrawals', () => {
  async function released(price = 1000_00) {
    const o = await paidOrder(price);
    await shipIt(o.s.actor, o.so.id);
    await receiveAndRelease(o.c.actor, o.so.id, checker);
    return o;
  }

  it('#43/#44/#45 statement shows the seller fee once, the net, and reconciles exactly with the ledger', async () => {
    const { s, so } = await released(1000_00);
    const st = await sellerStatement(s.actor.sellerId!);
    const sale = st.rows.find((r) => r.type === 'ORDER_PAYMENT')!;
    expect(sale.grossSale).toBe(so.merchandiseSubtotal + so.shippingFee);
    expect(sale.sellerFee).toBe(85_00);
    expect(sale.netEffect).toBe(so.sellerNet);
    expect(so.sellerNet).toBe(1000_00 + so.shippingFee - 85_00);
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(st.totals.pending).toBe(b.pending);
    expect(st.totals.available).toBe(b.available);
    expect(st.totals.reserved).toBe(b.reserved);
  });

  it('#46/#47/#48/#68 withdrawal: transfer cost previewed and frozen; seller fee NOT charged again; balanced', async () => {
    const { s, so } = await released(2000_00);
    const avail = (await sellerBalances(db, s.actor.sellerId!)).available;
    const preview = await previewWithdrawal(s.actor, '1000');
    expect(preview.transferCost).toBe(100); // InstaPay 0.1% of 1,000 = 1.00 (min 0.50, max 20.00)
    expect(preview.net).toBe(1000_00 - 100);
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '1000', clientKey: randomUUID() });
    expect(withdrawal.transferCost).toBe(100);
    expect(withdrawal.payoutChannel).toBe('INSTAPAY');
    await approveWithdrawal(checker, withdrawal.id);
    await expect(db.execute(sql`update withdrawal_requests set transfer_cost = 0 where id = ${withdrawal.id}`)).rejects.toThrow();
    await markWithdrawalPaid(operator, withdrawal.id, 'TRX-FEE-1');
    const b = await sellerBalances(db, s.actor.sellerId!);
    expect(avail - b.available).toBe(1000_00); // exactly the withdrawal — no second EDMN fee
    const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id));
    expect(w.netTransferAmount).toBe(1000_00 - 100);
    const lines = await db
      .select({ code: ledgerAccounts.code, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(eq(journalEntries.sourceId, withdrawal.id));
    expect(lines.some((l) => l.code.startsWith('COMMISSION'))).toBe(false);
    expect(lines.reduce((a, l) => a + l.debit, 0)).toBe(lines.reduce((a, l) => a + l.credit, 0));
    // the sale fee is still exactly the one assessed on the order
    expect((await soOf(so.id)).sellerFeeTotal).toBe(170_00);
    const costs = await db.select().from(transactionCosts).where(eq(transactionCosts.entityId, withdrawal.id));
    expect(costs.map((x) => [x.borneBy, x.amount])).toEqual([['SELLER', 100]]);
  });

  it('actual transfer cost above the quote: the seller pays the quote, EDMN books the excess as an expense', async () => {
    const { s } = await released(2000_00);
    const { withdrawal } = await requestWithdrawal(s.actor, { amount: '500', clientKey: randomUUID() });
    await approveWithdrawal(checker, withdrawal.id);
    await markWithdrawalPaid(operator, withdrawal.id, 'TRX-FEE-2', null, 300);
    const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawal.id));
    expect(w.transferCost).toBe(50); // min 0.50
    expect(w.actualTransferCost).toBe(300);
    expect(w.netTransferAmount).toBe(500_00 - 50);
    const costs = await db.select().from(transactionCosts).where(eq(transactionCosts.entityId, withdrawal.id));
    expect(Object.fromEntries(costs.map((x) => [x.borneBy, x.amount]))).toEqual({ SELLER: 50, EDMN: 250 });
  });

  it('#49 channel limits: a payout above the per-transaction limit is refused at request and approval (never split)', async () => {
    const { s } = await released(5000_00);
    const cfg = (await activeChannelConfig(db, 'INSTAPAY'))!;
    const superAdmin = await makeAdmin();
    const base = { channel: 'INSTAPAY' as const, name: cfg.name, isActive: true, costBps: cfg.costBps, costFixed: cfg.costFixed, costMin: cfg.costMin, costMax: cfg.costMax, payerPolicy: cfg.payerPolicy, maxPerDay: cfg.maxPerDay, maxPerMonth: cfg.maxPerMonth, recipientMaxPerDay: null, recipientMaxPerMonth: null, warningThresholdBps: 8000 };
    await saveChannelVersion(superAdmin, { ...base, maxPerTransaction: 1000_00 }, 'حد اختبار');
    try {
      await expect(requestWithdrawal(s.actor, { amount: '2000', clientKey: randomUUID() })).rejects.toThrow(/الحد الأقصى للعملية/);
      const { withdrawal } = await requestWithdrawal(s.actor, { amount: '900', clientKey: randomUUID() });
      expect(withdrawal.amount).toBe(900_00);
    } finally {
      await saveChannelVersion(superAdmin, { ...base, maxPerTransaction: cfg.maxPerTransaction }, 'إرجاع الحد');
    }
    await expect(db.execute(sql`update payout_channel_configs set cost_bps = 0 where id = ${cfg.id}`)).rejects.toThrow();
  });
});

describe('F. refunds with the fee engine', () => {
  it('#54-#58/#60 partial refund: components from the original snapshot (not today’s rates), no blind shipping proration, balanced', async () => {
    const { so } = await paidOrder(1000_00, 2);
    const [it0] = await itemsOf(so.id);
    // a new version with very different rates is published in between
    await publishPricingVariant('MARKETPLACE', (ts) => ts.map((t) => ({ ...t, buyerBps: t.buyerBps * 2, sellerBps: t.sellerBps * 2, totalBps: t.totalBps * 2 })));
    try {
      const r = await db.transaction((tx) => requestRefundTx(tx, admin, { sellerOrderId: so.id, sourceType: 'ADMIN', sourceId: randomUUID(), items: [{ orderItemId: it0.id, quantity: 1 }], reason: 'وحدة معيبة', reasonCode: 'DAMAGED_ITEM', responsibleParty: 'SELLER' }));
      // 2,000 STANDARD: F = 240 (buyer 70 / seller 170) → one unit = half of each
      expect(r.buyerFeeRefund).toBe(35_00);
      expect(r.sellerFeeReversal).toBe(85_00);
      expect(r.shippingAmount).toBe(0);
      expect(r.amount).toBe(1000_00 + 35_00);
      expect(r.reasonCode).toBe('DAMAGED_ITEM');
      expect(r.responsibleParty).toBe('SELLER');
      expect(r.lifecycleStage).toBe('BEFORE_SHIPMENT');
      expect(r.feePolicySource).toBe('UNPUBLISHED_SAFE_DEFAULT');
      await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
      const [e] = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, `refund:${r.id}`));
      const ls = await db.select().from(journalLines).where(eq(journalLines.entryId, e.id));
      expect(ls.reduce((a, l) => a + l.debit, 0)).toBe(ls.reduce((a, l) => a + l.credit, 0));
      const [after] = await db.select().from(refunds).where(eq(refunds.id, r.id));
      expect(after.status).toBe('APPROVED');
    } finally {
      await publishPricingVariant('MARKETPLACE');
    }
  });
});

describe('G. profitability and ledger', () => {
  it('#70/#71 economics: revenue = buyer + seller fee; actual costs separate from estimates', async () => {
    const { so } = await paidOrder(1000_00);
    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    let row = (await economics({ from, to })).find((r) => r.id === so.id)!;
    expect(row.buyerFee).toBe(35_00);
    expect(row.sellerFee).toBe(85_00);
    expect(row.grossRevenue).toBe(120_00);
    expect(row.actualCosts).toBe(0);
    expect(row.estimatedReserves).toBe(15_00); // 1.5% of 1,000 (refund .5 + dispute .25 + ops .5 + fraud .25)
    expect(row.netContribution).toBe(120_00 - 15_00);
    await recordCost(admin, { entityType: 'seller_order', entityId: so.id, costType: 'DISPUTE_DIRECT', nature: 'ACTUAL', borneBy: 'EDMN', amount: 20_00, notes: 'تكلفة مكالمة شركة الشحن' });
    row = (await economics({ from, to })).find((r) => r.id === so.id)!;
    expect(row.actualCosts).toBe(20_00);
    expect(row.estimatedReserves).toBe(15_00);
    expect(row.netContribution).toBe(120_00 - 20_00 - 15_00);
    expect(row.marginBps).toBe(Math.round((85_00 * 10000) / 120_00));
    const k = kpis([row]);
    expect(k.grossRevenue).toBe(120_00);
    await expect(db.execute(sql`delete from transaction_costs where entity_id = ${so.id}`)).rejects.toThrow();
  });

  it('#61/#67 after all fee-engine flows: debits = credits, no drift, every new journal approved', async () => {
    const inv = await financialInvariants();
    expect(inv.checks.filter((c) => c.count > 0).map((c) => c.code)).toEqual([]);
    expect(inv.totals.difference).toBe(0);
  });
});


