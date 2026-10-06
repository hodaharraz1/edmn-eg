import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { inventoryReservations, journalEntries, orderItems, orders, paymentSubmissions, payments, productVariants, products, sellerOrders } from '@/server/db/schema';
import { addToCart, cartLines, cartView } from '@/server/modules/commerce/cart';
import { expireOrder, placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { confirmPayment, rejectPayment, submitProof } from '@/server/modules/payments/service';
import { decideSeller } from '@/server/modules/sellers/service';
import { setListingActive } from '@/server/modules/catalog/products';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, paymentOf, png, sellerOrdersOf } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

describe('multi-seller checkout', () => {
  it('creates one parent order with one sub-order per seller, server-priced, with immutable snapshots', async () => {
    const s1 = await makeSeller(admin);
    const s2 = await makeSeller(admin);
    const p1 = await makeProduct(s1.actor, admin, { price: 100_00, stock: 5 });
    const p2 = await makeProduct(s2.actor, admin, { price: 250_00, stock: 5, category: 'mobile-phones', attributes: { model: ['T1'], storage: ['128GB'] } });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p1.variantId, qty: 2 }, { variantId: p2.variantId, qty: 1 }]);
    const sos = await sellerOrdersOf(order.id);
    expect(sos).toHaveLength(2);
    expect(sos.map((s) => s.suffix)).toEqual(['A', 'B']);
    expect(order.merchandiseTotal).toBe(450_00);
    expect(order.shippingTotal).toBe(100_00); // 50 EGP per seller
    expect(order.grandTotal).toBe(550_00);
    for (const so of sos) expect(so.sellerNet).toBe(so.grossTotal - so.commissionTotal);
    const items = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, sos[1].id));
    expect(items[0].commissionBps).toBe(450); // mobile-phones benchmark
    expect(items[0].commissionAmount).toBe(1125); // 250 EGP × 4.5%
    // reserved, not yet sold
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p1.variantId));
    expect(v.reserved).toBe(2);
    expect(v.stockOnHand).toBe(5);
  });

  it('checkout is idempotent on its key (double submit = one order)', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 5 });
    const c = await makeCustomer();
    const key = randomUUID();
    const o1 = await checkout(c, [{ variantId: p.variantId, qty: 1 }], key);
    const again = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: key, expectedTotal: o1.grandTotal });
    expect(again.created).toBe(false);
    expect(again.order.id).toBe(o1.id);
  });

  it('EDGE 1 — two buyers race for the last unit: exactly one wins', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 1 });
    const a = await makeCustomer();
    const b = await makeCustomer();
    for (const c of [a, b]) await addToCart({ userId: c.user.id }, p.variantId, 1);
    const attempt = async (c: typeof a) => {
      const lines = await cartLines(db, { userId: c.user.id });
      const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), 1);
      return placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
    };
    const results = await Promise.allSettled([attempt(a), attempt(b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.reserved).toBe(1);
    expect(v.stockOnHand - v.reserved).toBe(0);
  });

  it('EDGE 5 — price changed while in cart: checkout refuses until the customer reviews the new total', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00 });
    const c = await makeCustomer();
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    const oldTotal = (await cartView({ userId: c.user.id }, 1)).grandTotal;
    await db.update(productVariants).set({ price: 120_00 }).where(eq(productVariants.id, p.variantId));
    const view = await cartView({ userId: c.user.id }, 1);
    expect(view.groups[0].lines[0].issues).toContain('PRICE_CHANGED');
    await expect(placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: oldTotal })).rejects.toThrow(/السعر اتغير/);
    const fresh = await cartView({ userId: c.user.id }, 1);
    const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: fresh.grandTotal });
    expect(order.merchandiseTotal).toBe(120_00);
  });

  it('EDGE 6 — product deactivated before checkout is refused', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin);
    const c = await makeCustomer();
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    await setListingActive(s.actor, p.productId, false);
    const view = await cartView({ userId: c.user.id }, 1);
    await expect(placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: view.grandTotal })).rejects.toThrow(/مبقاش متاح/);
  });

  it('EDGE 7 — suspended seller: new checkout blocked, existing paid orders remain intact', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    const { submission } = await submitProof(c.actor, pay.id, { claimedAmount: String(pay.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await confirmPayment(admin, pay.id, submission.id);
    await decideSeller(admin, s.actor.sellerId!, 'SUSPEND', 'مخالفة سياسة الشحن');
    const c2 = await makeCustomer();
    await expect(addToCart({ userId: c2.user.id }, p.variantId, 1)).rejects.toThrow(/غير متاح/);
    const [so] = await sellerOrdersOf(order.id);
    expect(so.status).toBe('PAID'); // still visible/handled by operations
  });
});

describe('manual payments', () => {
  async function freshOrder() {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    return { c, order, payment: await paymentOf(order.id), s, p };
  }

  it('uploading proof never marks the order paid', async () => {
    const { c, order, payment } = await freshOrder();
    await submitProof(c.actor, payment.id, { claimedAmount: String(payment.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).toBe('PAYMENT_UNDER_REVIEW');
    expect(o.paidAt).toBeNull();
  });

  it('EDGE 2 — submitting proof twice: same key is idempotent, a different second proof is refused while under review', async () => {
    const { c, payment } = await freshOrder();
    const key = randomUUID();
    const first = await submitProof(c.actor, payment.id, { claimedAmount: '10', clientKey: key }, { data: await png(), name: 'p.png' });
    const retry = await submitProof(c.actor, payment.id, { claimedAmount: '10', clientKey: key }, { data: await png(), name: 'p.png' });
    expect(retry.created).toBe(false);
    expect(retry.submission.id).toBe(first.submission.id);
    await expect(submitProof(c.actor, payment.id, { claimedAmount: '10', clientKey: randomUUID() }, { data: await png(), name: 'p.png' })).rejects.toThrow(/قيد المراجعة/);
    expect(await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.paymentId, payment.id))).toHaveLength(1);
  });

  it('EDGE 3/4 — double-click and retried confirmation post money exactly once', async () => {
    const { c, payment, order } = await freshOrder();
    const { submission } = await submitProof(c.actor, payment.id, { claimedAmount: String(payment.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    const results = await Promise.allSettled([confirmPayment(admin, payment.id, submission.id), confirmPayment(admin, payment.id, submission.id)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const flags = results.map((r) => (r as PromiseFulfilledResult<{ alreadyConfirmed: boolean }>).value.alreadyConfirmed).sort();
    expect(flags).toEqual([false, true]);
    expect((await confirmPayment(admin, payment.id, submission.id)).alreadyConfirmed).toBe(true); // later retry
    const [so] = await sellerOrdersOf(order.id);
    const entries = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id));
    expect(entries.filter((e) => e.entryType === 'ORDER_PAYMENT')).toHaveLength(1);
    const [res] = await db.select().from(inventoryReservations).where(eq(inventoryReservations.orderItemId, (await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id)))[0].id));
    expect(res.status).toBe('COMMITTED');
  });

  it('EDGE 20 — rejected proof can be resubmitted and then confirmed', async () => {
    const { c, payment, order } = await freshOrder();
    const first = await submitProof(c.actor, payment.id, { claimedAmount: '1', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await rejectPayment(admin, payment.id, first.submission.id, 'المبلغ المحوّل أقل من المطلوب', true);
    let [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(p.status).toBe('REJECTED');
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).toBe('PENDING_PAYMENT');
    const second = await submitProof(c.actor, payment.id, { claimedAmount: String(payment.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p2.png' });
    await confirmPayment(admin, payment.id, second.submission.id);
    [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(p.status).toBe('CONFIRMED');
  });

  it('only payment reviewers can confirm; customers cannot confirm their own payment', async () => {
    const { c, payment } = await freshOrder();
    const { submission } = await submitProof(c.actor, payment.id, { claimedAmount: '1', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await expect(confirmPayment(c.actor, payment.id, submission.id)).rejects.toThrow(/صلاحية/);
    const catalog = await makeAdmin(['CATALOG_REVIEWER']);
    await expect(confirmPayment(catalog, payment.id, submission.id)).rejects.toThrow(/صلاحية/);
  });

  it('unpaid orders expire and release reserved stock', async () => {
    const { order, p } = await freshOrder();
    await db.update(payments).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(payments.orderId, order.id));
    expect(await expireOrder(order.id)).toBe(true);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).toBe('CANCELLED');
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.reserved).toBe(0);
    const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));
    expect(so.status).toBe('CANCELLED');
    void products;
  });
});
