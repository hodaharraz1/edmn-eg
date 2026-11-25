import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { codRemittanceShortfalls, journalEntries, journalLines, ledgerAccounts } from '@/server/db/schema';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { recordCodRemittance, resolveCodShortfall } from '@/server/modules/payments/service';
import { updateSetting } from '@/server/modules/settings';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makerRequest, paymentOf, sellerOrdersOf, shipIt } from '../helpers/factory';

/**
 * PKG-COD-02: the staff records the ACTUAL amount on the courier company's statement (not the assumed expected).
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

async function linesOf(entryId: string) {
  return db.select({ code: ledgerAccounts.code, debit: journalLines.debit, credit: journalLines.credit }).from(journalLines).innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId)).where(eq(journalLines.entryId, entryId));
}

async function balanceOf(code: string) {
  const [a] = await db.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.code, code), isNull(ledgerAccounts.sellerId)));
  return a?.balance ?? 0;
}

describe('COD-02 — courier statement remittance and shortfall', () => {
  it('short statement: cash debited by the ACTUAL amount, the gap is a tracked receivable, sellers get full pending', async () => {
    const { pay, so } = await deliveredCodOrder();
    const actual = pay.amountDue - 500; // courier remitted 5.00 EGP less than collected
    await makerRequest('COD_REMITTANCE', pay.id, pay.amountDue, { maker: await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']) });

    // Over-expected and invalid inputs are refused before anything posts.
    await expect(recordCodRemittance(admin, pay.id, { reason: 'كشف شركة الشحن رقم ٩٩', actualAmount: pay.amountDue + 1, statementRef: 'ST-99' })).rejects.toThrow(/أكبر من المستحق/);
    await expect(recordCodRemittance(admin, pay.id, { reason: 'كشف شركة الشحن رقم ٩٩', actualAmount: -1, statementRef: 'ST-99' })).rejects.toThrow(/غير صحيح/);
    await expect(recordCodRemittance(admin, pay.id, { reason: 'كشف شركة الشحن رقم ٩٩', actualAmount: actual, statementRef: ' ' })).rejects.toThrow(/مرجع/);

    const res = await recordCodRemittance(admin, pay.id, { reason: 'تسجيل كشف شركة الشحن رقم ٩٩', actualAmount: actual, statementRef: 'ST-99' });
    expect(res.alreadyConfirmed).toBe(false);
    expect(res.shortfall).toBe(500);

    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'payment'), eq(journalEntries.sourceId, pay.id)));
    const lines = await linesOf(entry.id);
    expect(lines.find((l) => l.code === 'PLATFORM_CASH')?.debit).toBe(actual);
    expect(lines.find((l) => l.code === 'COD_SHORTAGE_RECEIVABLE')?.debit).toBe(500);
    expect(lines.find((l) => l.code === 'SELLER_PENDING')?.credit).toBe(so.sellerNet); // sellers are NOT penalized
    expect(lines.reduce((a, l) => a + (l.debit ?? 0), 0)).toBe(lines.reduce((a, l) => a + (l.credit ?? 0), 0)); // balanced

    const [sf] = await db.select().from(codRemittanceShortfalls).where(eq(codRemittanceShortfalls.paymentId, pay.id));
    expect(sf).toMatchObject({ status: 'OPEN', expectedAmount: pay.amountDue, actualAmount: actual, shortfallAmount: 500, statementRef: 'ST-99' });

    // RECOVERED: maker requests (mode RECOVERED), a different checker executes → cash in, receivable cleared.
    await expect(resolveCodShortfall(admin, sf.id, { reason: 'استرداد من شركة الشحن' })).rejects.toThrow(); // no maker request yet
    const maker = await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']);
    await makerRequest('COD_SHORTAGE_RESOLUTION', sf.id, 500, { maker, params: { mode: 'RECOVERED' } });
    await expect(resolveCodShortfall(maker, sf.id, { reason: 'استرداد من شركة الشحن' })).rejects.toThrow(/نفس الشخص|شخصين/);
    const before = await balanceOf('COD_SHORTAGE_RECEIVABLE');
    const r = await resolveCodShortfall(admin, sf.id, { reason: 'شركة الشحن حولت العجز بكشف لاحق' });
    expect(r).toMatchObject({ alreadyResolved: false, resolution: 'RECOVERED' });
    const [re] = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'cod_remittance_shortfall'), eq(journalEntries.sourceId, sf.id)));
    const rlines = await linesOf(re.id);
    expect(rlines.find((l) => l.code === 'PLATFORM_CASH')?.debit).toBe(500);
    expect(rlines.find((l) => l.code === 'COD_SHORTAGE_RECEIVABLE')?.credit).toBe(500);
    expect(await balanceOf('COD_SHORTAGE_RECEIVABLE')).toBe(before - 500);
    expect((await db.select().from(codRemittanceShortfalls).where(eq(codRemittanceShortfalls.id, sf.id)))[0]).toMatchObject({ status: 'RESOLVED', resolution: 'RECOVERED' });
    expect((await resolveCodShortfall(admin, sf.id, { reason: 'تكرار التسوية' })).alreadyResolved).toBe(true);
  });

  it('WRITTEN_OFF settles the receivable as an adjustments expense', async () => {
    const { pay } = await deliveredCodOrder();
    const actual = pay.amountDue - 700;
    await makerRequest('COD_REMITTANCE', pay.id, pay.amountDue, { maker: await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']) });
    await recordCodRemittance(admin, pay.id, { reason: 'تسجيل كشف شركة الشحن رقم ١٠٠', actualAmount: actual, statementRef: 'ST-100' });
    const [sf] = await db.select().from(codRemittanceShortfalls).where(eq(codRemittanceShortfalls.paymentId, pay.id));

    await makerRequest('COD_SHORTAGE_RESOLUTION', sf.id, 700, { maker: await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']), params: { mode: 'WRITTEN_OFF' } });
    const r = await resolveCodShortfall(admin, sf.id, { reason: 'شركة الشحن رفضت السداد — شطب معتمد' });
    expect(r).toMatchObject({ alreadyResolved: false, resolution: 'WRITTEN_OFF' });
    const [re] = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'cod_remittance_shortfall'), eq(journalEntries.sourceId, sf.id)));
    const rlines = await linesOf(re.id);
    expect(rlines.find((l) => l.code === 'ADJUSTMENTS_EXPENSE')?.debit).toBe(700);
    expect(rlines.find((l) => l.code === 'COD_SHORTAGE_RECEIVABLE')?.credit).toBe(700);
  });

  it('exact statement: no shortfall row, same posting as COD-01', async () => {
    const { pay } = await deliveredCodOrder();
    await makerRequest('COD_REMITTANCE', pay.id, pay.amountDue, { maker: await makeAdmin(['FINANCE_OPERATOR', 'PAYMENT_REVIEWER']) });
    const res = await recordCodRemittance(admin, pay.id, { reason: 'تسجيل كشف شركة الشحن كامل المبلغ', actualAmount: pay.amountDue, statementRef: 'ST-101' });
    expect(res.shortfall).toBe(0);
    expect(await db.select().from(codRemittanceShortfalls).where(eq(codRemittanceShortfalls.paymentId, pay.id))).toHaveLength(0);
    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'payment'), eq(journalEntries.sourceId, pay.id)));
    expect((await linesOf(entry.id)).find((l) => l.code === 'COD_SHORTAGE_RECEIVABLE')).toBeUndefined();
    await updateSetting(admin, 'orders.codEnabled', false, 'إعادة الإعداد الافتراضي');
  });
});

describe('COD-02 — shortfall settlement is two-person at the database too', () => {
  it('a single-person COD_SHORTAGE_RESOLUTION approval can never be inserted (trigger)', async () => {
    const admin = await makeAdmin(['PAYMENT_REVIEWER']);
    const err = await db
      .execute(sql`insert into financial_approvals (action, entity_type, entity_id, amount, economic_version, entry_types, reason, status, dual_control, requested_by, approved_by, idempotency_key)
        values ('COD_SHORTAGE_RESOLUTION', 'cod_shortfall', ${randomUUID()}, 100, 'v1', array['COD_SHORTAGE_RESOLUTION'], 'اختبار اختراق', 'APPROVED', false, ${admin.userId!}, ${admin.userId!}, ${`pentest-${randomUUID()}`})`)
      .then(() => null, (e: { message?: string; cause?: { message?: string } }) => e);
    expect(err?.cause?.message ?? err?.message).toMatch(/requires a maker and a different checker/);
  });
});
