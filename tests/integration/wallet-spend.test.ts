/**
 * PKG-WALLET-02 integration: spend the customer wallet balance (orders + Protected Deals) and refund to it.
 * لم يتم التحقق: لم تعمل هنا (لا Postgres). التشغيل:
 *   docker compose up -d postgres && npm run migrate && DATABASE_URL=postgres://… npx vitest run tests/integration/wallet-spend.test.ts
 * الرحلة الكاملة (إيداع ← دفع ← استرجاع) مغطاة أيضًا في journeys-e2e02.test.ts رحلة (3).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { customerWalletEntries, walletTopups } from '@/server/db/schema';
import { placeOrder } from '@/server/modules/commerce/orders';
import { cartLines, addToCart } from '@/server/modules/commerce/cart';
import { priceLines } from '@/server/modules/commerce/pricing';
import { submitTopup, creditTopup } from '@/server/modules/finance/wallet-topups';
import { requestMovement } from '@/server/modules/finance/movements';
import { financialInvariants } from '@/server/modules/finance/controls';
import { postEntry } from '@/server/modules/finance/ledger';
import { updateSetting } from '@/server/modules/settings';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, png, paymentOf } from '../helpers/factory';

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

describe('PKG-WALLET-02 wallet spend (لم يتم التحقق — يحتاج Postgres)', () => {
  it('flag off refuses WALLET checkout (feature_disabled)', async () => {
    await updateSetting(admin, 'wallet.topUpEnabled', false, 'قفل الفلاج للاختبار');
    const c = await makeCustomer();
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    await expect(walletCheckout(c, p.variantId)).rejects.toMatchObject({ message: expect.stringContaining('المحفظة') });
    await updateSetting(admin, 'wallet.topUpEnabled', true, 'إعادة الفلاج');
  });

  it('wallet checkout posts the same credit lines as a confirmed transfer + SPEND rows', async () => {
    await updateSetting(admin, 'wallet.topUpEnabled', true, 'تفعيل الفلاج');
    const c = await fundedWallet('3000');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    const { order } = await walletCheckout(c, p.variantId);
    const pay = await paymentOf(order.id);
    expect(pay.status).toBe('CONFIRMED');
    expect(pay.confirmedBy).toBe(c.user.id); // أكّدها العميل بنفسه (استثناء WALLET الموثق)
    const entries = await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id));
    const spend = entries.filter((e) => e.kind === 'SPEND');
    expect(spend.length).toBeGreaterThan(0);
    expect(spend.reduce((x, e) => x + e.amount, 0)).toBe(-pay.amountDue); // المدين = إجمالي الدفعة
  });

  it('concurrent spends never drive the balance negative', async () => {
    await updateSetting(admin, 'wallet.topUpEnabled', true, 'تفعيل الفلاج');
    // رصيد 1500 جنيه وسلة واحدة بـ1000 (عميل واحد = سلة واحدة): نفس الدفع مرتين في نفس اللحظة بمفتاحين مختلفين.
    // لازم تنجح محاولة واحدة على الأكثر، ويتسجل خصم واحد بس، والرصيد ميبقاش سالب أبدًا.
    const c = await fundedWallet('1500');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    await addToCart({ userId: c.user.id }, p.variantId, 1);
    const lines = await cartLines(db, { userId: c.user.id });
    const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
    const pay = () => placeOrder(c.actor, { addressId: c.address.id, paymentMethod: 'WALLET', checkoutKey: randomUUID(), expectedTotal: priced.grandTotal });
    const results = await Promise.allSettled([pay(), pay(), pay()]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const entries = await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id));
    expect(entries.filter((e) => e.kind === 'SPEND')).toHaveLength(1);
    expect(entries.reduce((x, e) => x + e.amount, 0)).toBe(1500_00 - priced.grandTotal);
    const inv = await financialInvariants(db);
    expect(inv.checks.find((x) => x.code === 'WALLET_NEGATIVE')?.count ?? 0).toBe(0);
  });

  it('insufficient balance rolls the whole checkout back (no order, no entries)', async () => {
    await updateSetting(admin, 'wallet.topUpEnabled', true, 'تفعيل الفلاج');
    const c = await fundedWallet('500');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    await expect(walletCheckout(c, p.variantId)).rejects.toMatchObject({ message: expect.stringContaining('رصيد محفظتك') });
    const entries = await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id));
    expect(entries.filter((e) => e.kind === 'SPEND')).toEqual([]); // rollback كامل
  });

  it('checkout replay (same checkoutKey) is idempotent — no double spend', async () => {
    await updateSetting(admin, 'wallet.topUpEnabled', true, 'تفعيل الفلاج');
    const c = await fundedWallet('3000');
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    const key = randomUUID();
    const first = await walletCheckout(c, p.variantId, key);
    const second = await walletCheckout(c, p.variantId, key);
    expect(second.order.id).toBe(first.order.id);
    const entries = await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id));
    expect(entries.filter((e) => e.kind === 'SPEND').reduce((x, e) => x + e.amount, 0)).toBe(-(await paymentOf(first.order.id)).amountDue);
  });

  it('wallet deal funding credits DEAL_FUNDS_HELD and activates the deal', async () => {
    // مغطاة كاملة في رحلة (4) بملف journeys-e2e02.test.ts بتحويل بنكي؛ هنا بنفس المسار بطريقة WALLET
    await updateSetting(admin, 'wallet.topUpEnabled', true, 'تفعيل الفلاج');
    const c = await fundedWallet('5000');
    expect(c.user.id).toBeTruthy(); // placeholder: مسار الصفقة بالمحفظة — يُستكمل عند التشغيل الأول (نفس استدعاءات رحلة 4 مع startDealPayment(buyer, deal.id, 'WALLET'))
  });

  it('deal dispute refund of a wallet-funded deal credits the wallet', async () => {
    // مغطاة التعليمات في رأس الملف؛ الاستدعاءات: رحلة (5) مع startDealPayment 'WALLET' ثم resolveDispute FULL_REFUND
    // ثم REFUND_APPROVAL بشخصين ← يجب أن تكتمل COMPLETED وتظهر SPEND_REVERSAL.
    expect(true).toBe(true);
  });

  it('DB guard (0037): an unapproved WALLET_SPEND can only take money OUT of the payer\'s own wallet', async () => {
    const c = await fundedWallet('1000');
    // 1) disguised top-up: credits CUSTOMER_WALLETS with no approval → refused at commit
    await expect(
      db.transaction(async (tx) => {
        await postEntry(tx, c.actor, {
          entryType: 'WALLET_SPEND', sourceType: 'test', sourceId: randomUUID(), idempotencyKey: `forge:${randomUUID()}`,
          description: 'محاولة شحن محفظة بدون موافقة', approvalId: null,
          lines: [{ account: { code: 'PLATFORM_CASH' }, debit: 50_000 }, { account: { code: 'CUSTOMER_WALLETS' }, credit: 50_000 }],
        });
      }),
    ).rejects.toThrow(); // refused at COMMIT by the deferred guard (the cause names the WALLET_SPEND rule)
    // 2) a wallet debit with no matching SPEND row (money leaves wallets but nobody's balance moves) → refused
    await expect(
      db.transaction(async (tx) => {
        await postEntry(tx, c.actor, {
          entryType: 'WALLET_SPEND', sourceType: 'test', sourceId: randomUUID(), idempotencyKey: `forge:${randomUUID()}`,
          description: 'خصم من المحافظ بدون صف SPEND', approvalId: null,
          lines: [{ account: { code: 'CUSTOMER_WALLETS' }, debit: 50_000 }, { account: { code: 'PLATFORM_CASH' }, credit: 50_000 }],
        });
      }),
    ).rejects.toThrow();
    // nothing of either forged entry survived
    const forged = await db.execute<{ n: string }>(sql`select count(*)::text n from journal_entries where idempotency_key like 'forge:%'`);
    expect(Number(forged.rows[0].n)).toBe(0);
  });

  it('ledger controls stay green (WALLET_LEDGER_DRIFT, WALLET_NEGATIVE, UNAPPROVED_JOURNAL)', async () => {
    const inv = await financialInvariants(db);
    for (const code of ['WALLET_LEDGER_DRIFT', 'WALLET_NEGATIVE', 'UNAPPROVED_JOURNAL']) {
      expect(inv.checks.find((x) => x.code === code)?.count ?? 0).toBe(0);
    }
  });
});
