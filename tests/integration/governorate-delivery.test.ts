import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { governorates, orders, sellerOrders, stores } from '@/server/db/schema';
import { addToCart, cartView } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { saveAddress } from '@/server/modules/customers/addresses';
import { setShippingRates } from '@/server/modules/sellers/service';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

/**
 * Governorate / delivery-location regression suite. The header governorate is browsing context only;
 * every shipping amount that reaches an order is computed on the server from the checkout address's
 * canonical governorate id and the seller's own per-governorate rate.
 */
const CAIRO = 1;
const DAKAHLIA = 6;
const DAMIETTA = 11;
const EGP = (n: number) => n * 100;

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

/** Seller whose shipping is configured ONLY for the given governorates (everything else disabled). */
async function sellerWithRates(rates: Record<number, number>) {
  const s = await makeSeller(admin);
  const all = await db.select({ id: governorates.id }).from(governorates);
  await setShippingRates(
    s.actor,
    all.map((g) => ({ governorateId: g.id, enabled: g.id in rates, fee: rates[g.id] ?? 0, etaMinDays: 1, etaMaxDays: 3 })),
  );
  await db.update(stores).set({ freeShippingThreshold: null }).where(eq(stores.sellerId, s.actor.sellerId!));
  return s;
}

async function customerIn(governorateId: number) {
  const c = await makeCustomer();
  const id = await saveAddress(c.actor, c.address.id, { recipientName: c.user.fullName, phone: c.user.phone!, governorateId, city: 'المدينة', street: 'شارع الاختبار', isDefault: true });
  return { ...c, addressId: id };
}

async function addAddress(c: Awaited<ReturnType<typeof customerIn>>, governorateId: number) {
  return saveAddress(c.actor, null, { recipientName: c.user.fullName, phone: c.user.phone!, governorateId, city: 'مدينة أخرى', street: 'شارع آخر', isDefault: false });
}

describe('canonical governorate dataset', () => {
  it('has exactly the 27 Egyptian governorates with stable ids, unique codes and Arabic names', async () => {
    const rows = await db.select().from(governorates).orderBy(asc(governorates.sortOrder));
    expect(rows).toHaveLength(27);
    expect(rows.every((g) => g.isActive)).toBe(true);
    expect(new Set(rows.map((g) => g.id)).size).toBe(27);
    expect(new Set(rows.map((g) => g.code)).size).toBe(27);
    expect(new Set(rows.map((g) => g.nameAr)).size).toBe(27);
    expect(rows.find((g) => g.id === CAIRO)).toMatchObject({ code: 'CAI', nameAr: 'القاهرة' });
    expect(rows.find((g) => g.id === DAMIETTA)).toMatchObject({ code: 'DMT', nameAr: 'دمياط' });
    expect(rows.find((g) => g.id === DAKAHLIA)).toMatchObject({ code: 'DKH', nameAr: 'الدقهلية' });
    for (const name of ['الجيزة', 'الإسكندرية', 'القليوبية', 'الشرقية', 'البحيرة', 'الغربية', 'المنوفية', 'كفر الشيخ', 'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد', 'مطروح', 'شمال سيناء', 'جنوب سيناء']) {
      expect(rows.some((g) => g.nameAr === name), name).toBe(true);
    }
  });
});

describe('governorate-aware shipping (server-side)', () => {
  it('applies the seller-specific rate of the selected governorate', async () => {
    const s = await sellerWithRates({ [CAIRO]: EGP(80), [DAMIETTA]: EGP(120), [DAKAHLIA]: EGP(100) });
    const p = await makeProduct(s.actor, admin, { price: EGP(500) });
    const c = await customerIn(CAIRO);
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    expect((await cartView({ userId: c.user.id }, CAIRO)).shippingTotal).toBe(EGP(80));
    expect((await cartView({ userId: c.user.id }, DAMIETTA)).shippingTotal).toBe(EGP(120));
    expect((await cartView({ userId: c.user.id }, DAKAHLIA)).shippingTotal).toBe(EGP(100));
  });

  it('prices a multi-seller cart per seller for the same governorate (no collapsing)', async () => {
    const a = await sellerWithRates({ [DAMIETTA]: EGP(100) });
    const b = await sellerWithRates({ [DAMIETTA]: EGP(140) });
    const pa = await makeProduct(a.actor, admin, { price: EGP(200) });
    const pb = await makeProduct(b.actor, admin, { price: EGP(300) });
    const c = await customerIn(DAMIETTA);
    await addToCart({ userId: c.user.id }, pa.variantId, 1);
    await addToCart({ userId: c.user.id }, pb.variantId, 1);
    const view = await cartView({ userId: c.user.id }, DAMIETTA);
    const fee = (sid: string) => view.groups.find((g) => g.sellerId === sid)!.shippingFee;
    expect(fee(a.actor.sellerId!)).toBe(EGP(100));
    expect(fee(b.actor.sellerId!)).toBe(EGP(140));
    expect(view.shippingTotal).toBe(EGP(240));

    const { order } = await placeOrder(c.actor, { addressId: c.addressId, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: view.grandTotal });
    const sos = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));
    expect(sos.find((so) => so.sellerId === a.actor.sellerId)!.shippingFee).toBe(EGP(100));
    expect(sos.find((so) => so.sellerId === b.actor.sellerId)!.shippingFee).toBe(EGP(140));
    expect(order.shippingTotal).toBe(EGP(240));
  });

  it('a seller that does not ship to the governorate shows no price and blocks checkout', async () => {
    const s = await sellerWithRates({ [CAIRO]: EGP(80) });
    const p = await makeProduct(s.actor, admin, { price: EGP(150) });
    const c = await customerIn(DAMIETTA);
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    const view = await cartView({ userId: c.user.id }, DAMIETTA);
    expect(view.shippingResolved).toBe(false);
    expect(view.groups[0].shippingFee).toBeNull();
    expect(view.groups[0].lines[0].issues).toContain('NO_SHIPPING');
    await expect(placeOrder(c.actor, { addressId: c.addressId, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: view.grandTotal })).rejects.toThrow(/لا يشحن إلى دمياط/);
    expect(await db.select().from(orders).where(eq(orders.customerId, c.user.id))).toHaveLength(0);
  });

  it('a disabled rate row is treated as unavailable even if it still carries a fee', async () => {
    const s = await sellerWithRates({ [DAMIETTA]: EGP(120) });
    const p = await makeProduct(s.actor, admin);
    await setShippingRates(s.actor, [{ governorateId: DAMIETTA, enabled: false, fee: EGP(120), etaMinDays: 1, etaMaxDays: 3 }]);
    const c = await customerIn(DAMIETTA);
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    expect((await cartView({ userId: c.user.id }, DAMIETTA)).groups[0].shippingFee).toBeNull();
  });
});

describe('checkout address is authoritative (never the header governorate)', () => {
  it('shipping is computed from the chosen checkout address and recalculates when it changes', async () => {
    const s = await sellerWithRates({ [DAMIETTA]: EGP(120), [DAKAHLIA]: EGP(100) });
    const p = await makeProduct(s.actor, admin, { price: EGP(400) });
    const c = await customerIn(DAMIETTA); // header/browsing context would also be Damietta
    const dakAddress = await addAddress(c, DAKAHLIA);
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    const damTotal = (await cartView({ userId: c.user.id }, DAMIETTA)).grandTotal;
    const dakTotal = (await cartView({ userId: c.user.id }, DAKAHLIA)).grandTotal;
    expect(damTotal).toBe(EGP(520));
    expect(dakTotal).toBe(EGP(500));

    // Customer switches the checkout address to Dakahlia but submits the stale (Damietta) total: refused.
    await expect(placeOrder(c.actor, { addressId: dakAddress, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: damTotal })).rejects.toMatchObject({ code: 'CONFLICT' });
    const { order } = await placeOrder(c.actor, { addressId: dakAddress, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: dakTotal });
    expect(order.governorateId).toBe(DAKAHLIA);
    expect(order.shippingTotal).toBe(EGP(100));
    expect((order.shippingAddress as { governorate: string }).governorate).toBe('الدقهلية');
  });

  it('a client-manipulated shipping amount is ignored / rejected — the server decides', async () => {
    const s = await sellerWithRates({ [DAMIETTA]: EGP(120) });
    const p = await makeProduct(s.actor, admin, { price: EGP(300) });
    const c = await customerIn(DAMIETTA);
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    // Tampered: total computed with a 1 EGP shipping fee, plus injected price fields.
    const tampered = { addressId: c.addressId, paymentMethod: 'INSTAPAY' as const, checkoutKey: randomUUID(), expectedTotal: EGP(301), shippingFee: EGP(1), shippingTotal: EGP(1), governorateId: CAIRO };
    await expect(placeOrder(c.actor, tampered as never)).rejects.toMatchObject({ code: 'CONFLICT' });
    // Even when the total matches, injected fields never reach the order.
    const ok = { ...tampered, checkoutKey: randomUUID(), expectedTotal: EGP(420) };
    const { order } = await placeOrder(c.actor, ok as never);
    expect(order.shippingTotal).toBe(EGP(120));
    expect(order.governorateId).toBe(DAMIETTA);
  });
});

describe('order destination snapshot is immutable', () => {
  it('later address, default-address and seller-rate changes do not touch a placed order', async () => {
    const s = await sellerWithRates({ [DAMIETTA]: EGP(120), [CAIRO]: EGP(80) });
    const p = await makeProduct(s.actor, admin, { price: EGP(250) });
    const c = await customerIn(DAMIETTA);
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    const view = await cartView({ userId: c.user.id }, DAMIETTA);
    const { order } = await placeOrder(c.actor, { addressId: c.addressId, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: view.grandTotal });
    const [soBefore] = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));

    // Customer edits the very same address to Cairo and adds a new default; seller re-prices Damietta.
    await saveAddress(c.actor, c.addressId, { recipientName: c.user.fullName, phone: c.user.phone!, governorateId: CAIRO, city: 'القاهرة', street: 'شارع جديد', isDefault: false });
    await addAddress(c, DAKAHLIA);
    await setShippingRates(s.actor, [{ governorateId: DAMIETTA, enabled: true, fee: EGP(999), etaMinDays: 1, etaMaxDays: 3 }]);

    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    const [soAfter] = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));
    expect(after.governorateId).toBe(DAMIETTA);
    expect(after.shippingTotal).toBe(EGP(120));
    expect(after.grandTotal).toBe(EGP(370));
    expect(after.shippingAddress).toEqual(order.shippingAddress);
    expect((after.shippingAddress as { governorate: string; governorateId: number })).toMatchObject({ governorate: 'دمياط', governorateId: DAMIETTA });
    expect(soAfter.shippingFee).toBe(soBefore.shippingFee);
    expect(soAfter.grossTotal).toBe(soBefore.grossTotal);
  });
});
