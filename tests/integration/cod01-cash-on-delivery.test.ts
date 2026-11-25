import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { inventoryReservations, journalEntries, journalLines, ledgerAccounts, orderItems, orders, productVariants, refunds } from '@/server/db/schema';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { cancelSellerOrder, confirmReceipt, recordShipmentException, resolveShipmentException } from '@/server/modules/commerce/fulfilment';
import { recordCodRemittance } from '@/server/modules/payments/service';
import { startDealPayment } from '@/server/modules/deals/service';
import { updateSetting } from '@/server/modules/settings';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makerRequest, paymentOf, sellerOrdersOf, shipIt } from '../helpers/factory';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

async function codCheckout(c: Awaited<ReturnType<typeof makeCustomer>>, items: { variantId: string; qty: number }[], fee = 0) {
  await ensurePaymentSetup();
  for (const i of items) await addToCart({ userId: c.user.id }, i.variantId, i.qty);
  const lines = await cartLines(db, { userId: c.user.id });
  const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
  const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'COD', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal + fee });
  return { order, priced };
}

async function journalOf(sourceType: string, sourceId: string) {
  return db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId)));
}

async function variantStock(variantId: string) {
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
  return v;
}

describe('COD-01 — placement guards', () => {
  it('COD is OFF by default: placement is refused in Arabic', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    await expect(placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'COD', checkoutKey: randomUUID(), expectedTotal: 0 })).rejects.toThrow(/الدفع عند الاستلام مش متاح/);
  });

  it('when enabled: order goes straight to the seller (PAID), stock stays reserved, no ledger entry, payment COD_PENDING', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 5 });
    const c = await makeCustomer();
    const before = await variantStock(p.variantId);
    const { order } = await codCheckout(c, [{ variantId: p.variantId, qty: 2 }]);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.status).toBe('PAID');
    const pay = await paymentOf(order.id);
    expect(pay.method).toBe('COD');
    expect(pay.status).toBe('COD_PENDING');
    expect(pay.destinationId).toBeNull();
    const sos = await sellerOrdersOf(order.id);
    expect(sos.map((x) => x.status)).toEqual(['PAID']);
    // Stock reserved, not committed yet.
    const after = await variantStock(p.variantId);
    expect(after.stockOnHand).toBe(before.stockOnHand);
    expect(after.reserved).toBe(before.reserved + 2);
    // No money: zero journal entries for the order and its payment.
    expect(await journalOf('seller_order', sos[0].id)).toHaveLength(0);
    expect(await journalOf('payment', pay.id)).toHaveLength(0);
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });

  it('refuses orders above the COD cap and applies the COD fee to the total', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
    await updateSetting(admin, 'orders.codFee', 50_00, 'رسوم تحصيل 50 ج.م للاختبار');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 100_00, stock: 10 });
    const c = await makeCustomer();
    await updateSetting(admin, 'orders.codMaxAmount', 150_00, 'حد أقصى 150 ج.م للاختبار');
    await expect(codCheckout(c, [{ variantId: p.variantId, qty: 1 }], 50_00)).rejects.toThrow(/متاح للطلبات حتى/);
    await updateSetting(admin, 'orders.codMaxAmount', 500_000, 'إعادة الحد الافتراضي');
    const { order, priced } = await codCheckout(c, [{ variantId: p.variantId, qty: 1 }], 50_00);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.codFee).toBe(50_00);
    expect(o.grandTotal).toBe(priced.grandTotal + 50_00);
    const pay = await paymentOf(order.id);
    expect(pay.amountDue).toBe(priced.grandTotal + 50_00);
    await updateSetting(admin, 'orders.codFee', 0, 'إعادة الرسم الافتراضي');
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });
});

describe('COD-01 — never for Protected Deals', () => {
  it('a Protected Deal payment refuses COD explicitly, even with COD enabled for market orders', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'اختبار');
    const c = await makeCustomer();
    await expect(startDealPayment(c.actor, randomUUID(), 'COD')).rejects.toThrow(/الدفع عند الاستلام مش متاح للصفقات المحمية/);
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });
});

describe('COD-01 — delivery, remittance (two-person), refusal', () => {
  it('delivery marks the payment COD_COLLECTED and commits the stock', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 4 });
    const c = await makeCustomer();
    const before = await variantStock(p.variantId);
    const { order } = await codCheckout(c, [{ variantId: p.variantId, qty: 1 }]);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const pay = await paymentOf(order.id);
    expect(pay.status).toBe('COD_COLLECTED');
    const after = await variantStock(p.variantId);
    expect(after.stockOnHand).toBe(before.stockOnHand - 1);
    expect(after.reserved).toBe(before.reserved);
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });

  it('remittance needs a maker request and a different checker; it posts cash → seller pending + deferred fees', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 4 });
    const c = await makeCustomer();
    const { order } = await codCheckout(c, [{ variantId: p.variantId, qty: 1 }]);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const pay = await paymentOf(order.id);
    // No open movement request → refused.
    await expect(recordCodRemittance(admin, pay.id, { reason: 'كشف تحصيل شركة الشحن اليومي' })).rejects.toThrow();
    // The maker cannot execute their own request.
    const maker = await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']);
    await makerRequest('COD_REMITTANCE', pay.id, pay.amountDue, { maker });
    await expect(recordCodRemittance(maker, pay.id, { reason: 'كشف تحصيل شركة الشحن اليومي' })).rejects.toThrow(/شخصين|نفس الشخص/);
    // A different checker records it.
    const res = await recordCodRemittance(admin, pay.id, { reason: 'كشف تحصيل شركة الشحن اليومي رقم ٤٤' });
    expect(res.alreadyConfirmed).toBe(false);
    const pay2 = await paymentOf(order.id);
    expect(pay2.status).toBe('CONFIRMED');
    // Journal: DR PLATFORM_CASH gross / CR SELLER_PENDING sellerNet / CR COMMISSION_DEFERRED the rest.
    const [entry] = await journalOf('payment', pay.id);
    expect(entry.entryType).toBe('COD_REMITTANCE');
    const lines = await db.select({ code: ledgerAccounts.code, sellerId: ledgerAccounts.sellerId, debit: journalLines.debit, credit: journalLines.credit }).from(journalLines).innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId)).where(eq(journalLines.entryId, entry.id));
    const cash = lines.find((l) => l.code === 'PLATFORM_CASH');
    const pending = lines.find((l) => l.code === 'SELLER_PENDING');
    const deferred = lines.find((l) => l.code === 'COMMISSION_DEFERRED');
    expect(cash?.debit).toBe(pay.amountDue);
    expect(pending?.credit).toBe(so.sellerNet);
    expect(pending?.sellerId).toBe(so.sellerId);
    expect((deferred?.credit ?? 0) + (pending?.credit ?? 0)).toBe(pay.amountDue);
    // Idempotent: a second record is a no-op.
    expect((await recordCodRemittance(admin, pay.id, { reason: 'تكرار نفس كشف التحصيل' })).alreadyConfirmed).toBe(true);
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });

  it('cancellation before shipment: stock released, payment voided, NO refund, NO ledger entry', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 4 });
    const c = await makeCustomer();
    const before = await variantStock(p.variantId);
    const { order } = await codCheckout(c, [{ variantId: p.variantId, qty: 2 }]);
    const [so] = await sellerOrdersOf(order.id);
    await cancelSellerOrder(s.actor, so.id, 'البائع لا يستطيع التوفير');
    const [so2] = await sellerOrdersOf(order.id);
    expect(so2.status).toBe('CANCELLED');
    const pay = await paymentOf(order.id);
    expect(pay.status).toBe('CANCELLED');
    const after = await variantStock(p.variantId);
    expect(after.stockOnHand).toBe(before.stockOnHand);
    expect(after.reserved).toBe(before.reserved);
    expect(await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id))).toHaveLength(0);
    expect(await journalOf('seller_order', so.id)).toHaveLength(0);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    const [r] = await db.select().from(inventoryReservations).where(eq(inventoryReservations.orderItemId, item.id));
    expect(r.status).toBe('RELEASED');
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });

  it('refusal at the door (shipment failed → returned): stock released, payment voided, NO refund', async () => {
    await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 4 });
    const c = await makeCustomer();
    const before = await variantStock(p.variantId);
    const { order } = await codCheckout(c, [{ variantId: p.variantId, qty: 1 }]);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await recordShipmentException(admin, so.id, 'BUYER_REFUSED', 'العميل رفض الاستلام');
    await resolveShipmentException(admin, so.id, 'RETURNED_TO_SELLER', 'رفض الاستلام — الشحنة راجعة للبائع');
    const [so2] = await sellerOrdersOf(order.id);
    expect(so2.status).toBe('DELIVERY_FAILED');
    const pay = await paymentOf(order.id);
    expect(pay.status).toBe('CANCELLED');
    const after = await variantStock(p.variantId);
    expect(after.stockOnHand).toBe(before.stockOnHand);
    expect(after.reserved).toBe(before.reserved);
    expect(await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id))).toHaveLength(0);
    expect(await journalOf('seller_order', so.id)).toHaveLength(0);
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });
});
