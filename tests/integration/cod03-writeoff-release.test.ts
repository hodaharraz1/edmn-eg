import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { codRemittanceShortfalls } from '@/server/db/schema';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { recordCodRemittance, resolveCodShortfall } from '@/server/modules/payments/service';
import { updateSetting } from '@/server/modules/settings';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makerRequest, paymentOf, sellerOrdersOf, shipIt } from '../helpers/factory';

/**
 * PKG-COD-03 (owner optional item 6): writing a COD shortfall off needs finance.release on BOTH people. The old rule was payments.verify for the approver and finance.movement.request for the maker.
 * (Header kept from COD-02.) The staff records the ACTUAL amount on the courier company's statement (not the assumed expected).
 * A shortfall posts to COD_SHORTAGE_RECEIVABLE and stays OPEN for review until a two-person resolution
 * (RECOVERED = cash in later, WRITTEN_OFF = expense). Sellers always get their full pending amount.
 */
let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

async function deliveredCodOrder() {
  await updateSetting(admin, 'orders.codEnabled', true, 'تفعيل الدفع عند الاستلام للاختبار');
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { stock: 4 });
  const c = await makeCustomer();
  await addToCart({ userId: c.user.id }, p.variantId, 1);
  const lines = await cartLines(db, { userId: c.user.id });
  const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
  const { order } = await placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'COD', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await confirmReceipt(c.actor, so.id);
  const pay = await paymentOf(order.id);
  return { order, so, pay };
}

describe('COD-03 — write-off of a courier shortfall needs finance.release on both parties', () => {
  async function openShortfall(gap: number) {
    const { pay } = await deliveredCodOrder();
    await makerRequest('COD_REMITTANCE', pay.id, pay.amountDue, { maker: await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']) });
    await recordCodRemittance(admin, pay.id, { reason: 'تسجيل كشف شركة الشحن رقم ٢٠٠', actualAmount: pay.amountDue - gap, statementRef: 'ST-200' });
    const [sf] = await db.select().from(codRemittanceShortfalls).where(eq(codRemittanceShortfalls.paymentId, pay.id));
    return sf;
  }

  it('a maker without finance.release cannot REQUEST a write-off, but can still request a recovery', async () => {
    const sf = await openShortfall(300);
    const operator = await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']); // has request + verify, no release
    await expect(makerRequest('COD_SHORTAGE_RESOLUTION', sf.id, 300, { maker: operator, params: { mode: 'WRITTEN_OFF' } })).rejects.toThrow(/صلاحية|forbidden|غير مصرح/i);
    const ok = await makerRequest('COD_SHORTAGE_RESOLUTION', sf.id, 300, { maker: operator, params: { mode: 'RECOVERED' } });
    expect(ok.status).toBe('PENDING');
  });

  it('an approver with payments.verify but WITHOUT finance.release cannot execute a write-off; one with it can', async () => {
    const sf = await openShortfall(400);
    await makerRequest('COD_SHORTAGE_RESOLUTION', sf.id, 400, { maker: await makeAdmin(['FINANCE_CHECKER']), params: { mode: 'WRITTEN_OFF' } });
    const verifyOnly = await makeAdmin(['PAYMENT_REVIEWER']); // payments.verify, no finance.release
    await expect(resolveCodShortfall(verifyOnly, sf.id, { reason: 'محاولة شطب بدون صلاحية الإفراج' })).rejects.toThrow(/صلاحية|forbidden|غير مصرح/i);
    const [still] = await db.select().from(codRemittanceShortfalls).where(eq(codRemittanceShortfalls.id, sf.id));
    expect(still.status).toBe('OPEN'); // nothing moved
    const both = await makeAdmin(['FINANCE_CHECKER', 'PAYMENT_REVIEWER']);
    const r = await resolveCodShortfall(both, sf.id, { reason: 'شطب معتمد من صاحب صلاحية الإفراج' });
    expect(r).toMatchObject({ alreadyResolved: false, resolution: 'WRITTEN_OFF' });
  });

  it('a recovery is unchanged: payments.verify is enough for the approver', async () => {
    const sf = await openShortfall(250);
    await makerRequest('COD_SHORTAGE_RESOLUTION', sf.id, 250, { maker: await makeAdmin(['FINANCE_OPERATOR']), params: { mode: 'RECOVERED' } });
    const r = await resolveCodShortfall(await makeAdmin(['PAYMENT_REVIEWER']), sf.id, { reason: 'شركة الشحن سددت العجز لاحقًا' });
    expect(r).toMatchObject({ alreadyResolved: false, resolution: 'RECOVERED' });
  });
});
