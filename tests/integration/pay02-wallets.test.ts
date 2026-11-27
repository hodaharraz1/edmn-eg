import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { paymentMethods, payments } from '@/server/db/schema';
import { saveDestination } from '@/server/modules/payments/service';
import { placeOrder } from '@/server/modules/commerce/orders';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { priceLines } from '@/server/modules/commerce/pricing';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller } from '../helpers/factory';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

describe('PAY-02 — Egyptian wallet payment methods', () => {
  it('Orange Cash, e& cash, WE Pay and Banque Misr wallet are seeded; a disabled method refuses checkout', async () => {
    const rows = await db.select().from(paymentMethods).where(inArray(paymentMethods.code, ['ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY', 'BM_WALLET']));
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.nameAr.length).toBeGreaterThan(1);
    // Methods stay disabled until an admin configures them in payment settings; a disabled method refuses checkout.
    await db.update(paymentMethods).set({ isEnabled: false }).where(eq(paymentMethods.code, 'ORANGE_CASH'));
    const s = await makeSeller(admin);
    const prod = await makeProduct(s.actor, admin, { stock: 5 });
    const c = await makeCustomer();
    await addToCart({ userId: c.user.id }, prod.variantId, 1);
    const lines = await cartLines(db, { userId: c.user.id });
    const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
    await expect(placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'ORANGE_CASH', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal })).rejects.toThrow();
  });

  it.each(['ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY', 'BM_WALLET'] as const)('checkout works with %s once enabled with a destination', async (code) => {
    await db.update(paymentMethods).set({ isEnabled: true }).where(eq(paymentMethods.code, code));
    await saveDestination(admin, null, { methodCode: code, label: 'وجهة اختبار', details: { walletNumber: '01000000000', accountName: 'EDMN TEST' }, isEnabled: true, isTest: true, sortOrder: 10 }, 'اختبار محافظ');
    const s = await makeSeller(admin);
    const prod = await makeProduct(s.actor, admin, { stock: 5 });
    const c = await makeCustomer();
    await addToCart({ userId: c.user.id }, prod.variantId, 1);
    const lines = await cartLines(db, { userId: c.user.id });
    const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
    const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: code, checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
    const [p] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(p.method).toBe(code);
    expect(p.isTest).toBe(true); // real money stays OFF — every destination is a labelled TEST/DEMO one
  });
});
