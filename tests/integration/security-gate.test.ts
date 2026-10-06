import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { authTokens, journalEntries, journalLines, outboundMessages, paymentSubmissions, products, sellerOrders, userRoles, users, withdrawalRequests } from '@/server/db/schema';
import { adminActor } from '@/server/auth/actors';
import { beginTotpEnrollment, login, sendVerificationCode, verifyTotpForUser } from '@/server/auth/service';
import { totpCode } from '@/server/auth/totp';
import { sha256 } from '@/server/core/crypto';
import { confirmReceipt, confirmSellerOrder, markShipped, saveShipment } from '@/server/modules/commerce/fulfilment';
import { placeOrder } from '@/server/modules/commerce/orders';
import { addToCart, mergeGuestCart } from '@/server/modules/commerce/cart';
import { setListingActive, moderateProduct } from '@/server/modules/catalog/products';
import { accountBalance, postEntry, reconcile } from '@/server/modules/finance/ledger';
import { approveWithdrawal, markWithdrawalPaid, markWithdrawalProcessing, rejectWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { blockDataSchemas } from '@/server/modules/cms/service';
import { redactExpiredSecrets, REDACTED_BODY } from '@/server/jobs/worker';
import { clientIp } from '@/server/web/client-ip';
import { safeNext } from '@/server/web/safe-next';
import { SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, paymentOf, pdf, png, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm, testApproval } from '../helpers/factory';

/**
 * Security gate regression suite — one test per confirmed finding fixed in the pre-pilot audit
 * (docs/security/SECURITY_FINDINGS.md). Do not weaken these to get a green run.
 */
let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

async function releasedOrder(price = 1000_00) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await receiveAndRelease(c.actor, so.id);
  return { s, c, p, order, so };
}

describe('payments (FIN-P1-2, AUTHZ-F2)', () => {
  it('SEC-PAY-1: a proof whose declared amount differs from the amount due cannot be confirmed', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 500_00, stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    const { submission } = await submitProof(c.actor, pay.id, { claimedAmount: '1', clientKey: randomUUID() }, { data: await png('p'), name: 'p.png' });
    await expect(confirmPayment(admin, pay.id, submission.id)).rejects.toThrow(/لا يطابق/);
    expect((await paymentOf(order.id)).status).not.toBe('CONFIRMED');
  });

  it('SEC-PAY-2: non-positive declared amounts are rejected at submission', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    await expect(submitProof(c.actor, pay.id, { claimedAmount: '-5', clientKey: randomUUID() }, { data: await png('p'), name: 'p.png' })).rejects.toThrow();
  });

  it('SEC-PAY-3: staff cannot confirm a payment to a store they own (separation of duties)', async () => {
    const s = await makeSeller(admin);
    await db.update(users).set({ isStaff: true }).where(eq(users.id, s.user.id));
    await db.insert(userRoles).values({ userId: s.user.id, roleCode: 'PAYMENT_REVIEWER' });
    const insider = await adminActor(s.user.id, { stepUpAt: new Date() });
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    const { submission } = await submitProof(c.actor, pay.id, { claimedAmount: String(pay.amountDue / 100), clientKey: randomUUID() }, { data: await png('p'), name: 'p.png' });
    await expect(confirmPayment(insider, pay.id, submission.id)).rejects.toThrow(/طرف فيها/);
  });

  it('SEC-PAY-4: confirming needs a fresh 2FA step-up', async () => {
    const stale = await makeAdmin(['PAYMENT_REVIEWER']);
    const noStepUp = { ...stale, stepUpAt: new Date(Date.now() - 60 * 60_000) };
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    const { submission } = await submitProof(c.actor, pay.id, { claimedAmount: String(pay.amountDue / 100), clientKey: randomUUID() }, { data: await png('p'), name: 'p.png' });
    await expect(confirmPayment(noStepUp, pay.id, submission.id)).rejects.toThrow();
  });

  it('SEC-PAY-5: replayed and concurrent confirmations post the payment exactly once', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    const { submission } = await submitProof(c.actor, pay.id, { claimedAmount: String(pay.amountDue / 100), clientKey: randomUUID() }, { data: await png('p'), name: 'p.png' });
    await Promise.allSettled([confirmPayment(admin, pay.id, submission.id), confirmPayment(admin, pay.id, submission.id)]);
    expect(await confirmPayment(admin, pay.id, submission.id)).toEqual({ alreadyConfirmed: true });
    const entries = await db.select().from(journalEntries).where(sql`${journalEntries.idempotencyKey} like ${`payment:${pay.id}:%`}`);
    expect(entries).toHaveLength(1);
  });

  it("SEC-PAY-6: a customer cannot submit proof for someone else's payment", async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const other = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    await expect(submitProof(other.actor, pay.id, { claimedAmount: String(pay.amountDue / 100), clientKey: randomUUID() }, { data: await png('p'), name: 'p.png' })).rejects.toThrow();
    expect(await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.submittedBy, other.user.id))).toHaveLength(0);
  });
});

describe('seller balance & withdrawals (FIN-P1-1, FIN-P1-2, FIN-P2)', () => {
  it('SEC-WD-1: concurrent withdrawals can never spend the same available balance twice', async () => {
    const { s } = await releasedOrder(1000_00);
    const available = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    const amount = String(Math.floor(available / 100) - 1);
    // Requests promise nothing; the Admin approval re-checks and reserves under the account lock.
    const [w1, w2] = await Promise.all([requestWithdrawal(s.actor, { amount, clientKey: randomUUID() }), requestWithdrawal(s.actor, { amount, clientKey: randomUUID() })]);
    const r = await Promise.allSettled([approveWithdrawal(admin, w1.withdrawal.id), approveWithdrawal(admin, w2.withdrawal.id)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! })).toBeGreaterThanOrEqual(0);
  });

  it('SEC-WD-2: dual control uses a rolling 24h total, so split requests still need a second person', async () => {
    const { s } = await releasedOrder(2000_00);
    const before = await db.execute(sql`select value from system_settings where key = 'withdrawals.dualControlThreshold'`);
    await db.execute(sql`insert into system_settings (key, value) values ('withdrawals.dualControlThreshold', '150000'::jsonb) on conflict (key) do update set value = '150000'::jsonb`);
    try {
      const w1 = await requestWithdrawal(s.actor, { amount: '1000', clientKey: randomUUID() });
      const w2 = await requestWithdrawal(s.actor, { amount: '600', clientKey: randomUUID() });
      expect(w1.withdrawal.requiresDualControl).toBe(false);
      expect(w2.withdrawal.requiresDualControl).toBe(true); // 1,000 + 600 ≥ 1,500 within 24h
      await approveWithdrawal(admin, w2.withdrawal.id);
      await expect(markWithdrawalPaid(admin, w2.withdrawal.id, 'TRX-SPLIT')).rejects.toThrow(/شخصاً مختلفاً/);
    } finally {
      if (before.rows.length) await db.execute(sql`update system_settings set value = ${JSON.stringify(before.rows[0].value)}::jsonb where key = 'withdrawals.dualControlThreshold'`);
      else await db.execute(sql`delete from system_settings where key = 'withdrawals.dualControlThreshold'`);
    }
  });

  it('SEC-WD-3: a seller with a negative available balance (debt after a post-release refund) cannot be paid out', async () => {
    const { s } = await releasedOrder(1000_00);
    const w = await requestWithdrawal(s.actor, { amount: '500', clientKey: randomUUID() });
    await approveWithdrawal(admin, w.withdrawal.id);
    const available = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! });
    // Simulate a refund approved after release that exceeds what is left (the debt case).
    const ap1 = await testApproval(['REFUND_DECISION'], available + 10_000);
    await db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, {
      approvalId: ap1,
      entryType: 'REFUND_DECISION',
      sourceType: 'test',
      sourceId: randomUUID(),
      idempotencyKey: `test-debt:${w.withdrawal.id}`,
      description: 'test debt',
      lines: [
        { account: { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! }, debit: available + 10_000 },
        { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' }, credit: available + 10_000 },
      ],
    }));
    await expect(markWithdrawalPaid(admin, w.withdrawal.id, 'TRX-DEBT')).rejects.toThrow(/مديونية/);
    await expect(requestWithdrawal(s.actor, { amount: '100', clientKey: randomUUID() })).rejects.toThrow();
    // Reverse the synthetic debt so the shared refunds-payable account is left as other suites expect.
    const ap2 = await testApproval(['REFUND_DECISION'], available + 10_000);
    await db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, {
      approvalId: ap2,
      entryType: 'REFUND_DECISION',
      sourceType: 'test',
      sourceId: randomUUID(),
      idempotencyKey: `test-debt-reversal:${w.withdrawal.id}`,
      description: 'test debt reversal',
      lines: [
        { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' }, debit: available + 10_000 },
        { account: { code: 'SELLER_AVAILABLE', sellerId: s.actor.sellerId! }, credit: available + 10_000 },
      ],
    }));
  });

  it('SEC-WD-4: a withdrawal in transfer can only be rejected by a different, re-authenticated person', async () => {
    const { s } = await releasedOrder(1000_00);
    const w = await requestWithdrawal(s.actor, { amount: '300', clientKey: randomUUID() });
    await approveWithdrawal(admin, w.withdrawal.id);
    await markWithdrawalProcessing(admin, w.withdrawal.id);
    await expect(rejectWithdrawal(admin, w.withdrawal.id, 'لم يتم التحويل')).rejects.toThrow(/غير منفذ التحويل/);
    const other = await makeAdmin();
    await rejectWithdrawal(other, w.withdrawal.id, 'تعذر التحويل — تم التحقق مع البنك');
    const [row] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w.withdrawal.id));
    expect(row.status).toBe('REJECTED');
  });

  it('SEC-WD-5: suspended sellers are not paid out even after approval', async () => {
    const { s } = await releasedOrder(1000_00);
    const w = await requestWithdrawal(s.actor, { amount: '300', clientKey: randomUUID() });
    await approveWithdrawal(admin, w.withdrawal.id);
    await db.execute(sql`update sellers set status = 'SUSPENDED' where id = ${s.actor.sellerId!}`);
    await expect(markWithdrawalPaid(admin, w.withdrawal.id, 'TRX-SUSP')).rejects.toThrow(/موقوف/);
  });

  it('SEC-WD-6: staff cannot approve a withdrawal of a store they own', async () => {
    const { s } = await releasedOrder(1000_00);
    await db.update(users).set({ isStaff: true }).where(eq(users.id, s.user.id));
    await db.insert(userRoles).values({ userId: s.user.id, roleCode: 'FINANCE_CHECKER' });
    const insider = await adminActor(s.user.id, { stepUpAt: new Date() });
    const w = await requestWithdrawal(s.actor, { amount: '300', clientKey: randomUUID() });
    await expect(approveWithdrawal(insider, w.withdrawal.id)).rejects.toThrow(/مالكه أو عضو/);
  });

  it('SEC-WD-7: a seller cannot mark their own withdrawal paid or approve it', async () => {
    const { s } = await releasedOrder(1000_00);
    const w = await requestWithdrawal(s.actor, { amount: '300', clientKey: randomUUID() });
    await expect(approveWithdrawal(s.actor, w.withdrawal.id)).rejects.toThrow();
    await expect(markWithdrawalPaid(s.actor, w.withdrawal.id, 'SELF-PAY')).rejects.toThrow();
  });
});

describe('catalog / onboarding authorization (AUTHZ-F1, F3, F4)', () => {
  it('SEC-AZ-1: a seller cannot lift an admin suspension on their own product', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    await moderateProduct(admin, p.productId, 'SUSPEND', 'منتج مقلد — قرار الإدارة');
    await expect(setListingActive(s.actor, p.productId, false)).rejects.toThrow();
    await expect(setListingActive(s.actor, p.productId, true)).rejects.toThrow();
    const [row] = await db.select().from(products).where(eq(products.id, p.productId));
    expect(row.status).toBe('SUSPENDED');
  });

  it('SEC-AZ-2: a buyer cannot purchase from their own store (even via a merged guest cart)', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const [address] = await db.execute<{ id: string }>(sql`insert into addresses (user_id, recipient_name, phone, governorate_id, city, street, is_default)
      values (${s.user.id}, 'x', ${s.user.phone}, 1, 'القاهرة', 'شارع', true) returning id`).then((r) => r.rows);
    // The guest-cart merge path skips addToCart's own-product check: add as a guest, then log in (merge).
    const guestToken = randomUUID();
    await addToCart({ guestToken }, p.variantId, 1);
    await mergeGuestCart(guestToken, s.user.id);
    await expect(placeOrder(s.actor, { addressId: address.id, paymentMethod: 'INSTAPAY', checkoutKey: randomUUID(), expectedTotal: 0 })).rejects.toThrow(/متجرك/);
  });

  it("SEC-AZ-3: a dispute cannot be opened after the dispute window closes", async () => {
    const { c, so } = await releasedOrder(1000_00);
    await db.update(sellerOrders).set({ deliveredAt: new Date(Date.now() - 365 * 86_400_000) }).where(eq(sellerOrders.id, so.id));
    await expect(openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج غير مطابق للوصف المعروض' })).rejects.toThrow(/انتهت مدة/);
  });
});

describe('ledger integrity', () => {
  it('SEC-LG-1: journal rows are append-only at the database layer', async () => {
    const [line] = await db.select().from(journalLines).limit(1);
    await expect(db.execute(sql`update journal_lines set debit = debit + 1 where id = ${line.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from journal_lines where id = ${line.id}`)).rejects.toThrow();
    const [entry] = await db.select().from(journalEntries).limit(1);
    await expect(db.execute(sql`delete from journal_entries where id = ${entry.id}`)).rejects.toThrow();
  });

  it('SEC-LG-2: an unbalanced entry cannot be posted, and a duplicate idempotency key posts nothing new', async () => {
    const key = `test-unbalanced:${randomUUID()}`;
    const ap = await testApproval(['ADJUSTMENT'], 100);
    await expect(
      db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, { approvalId: ap, entryType: 'ADJUSTMENT', sourceType: 'test', sourceId: randomUUID(), idempotencyKey: key, description: 'x', lines: [{ account: { code: 'PLATFORM_CASH' }, debit: 100 }, { account: { code: 'COMMISSION_REVENUE' }, credit: 99 }] })),
    ).rejects.toThrow();
    const okKey = `test-dup:${randomUUID()}`;
    const e: Parameters<typeof postEntry>[2] = { approvalId: await testApproval(['ADJUSTMENT'], 100), entryType: 'ADJUSTMENT', sourceType: 'test', sourceId: randomUUID(), idempotencyKey: okKey, description: 'x', lines: [{ account: { code: 'PLATFORM_CASH' }, debit: 100 }, { account: { code: 'COMMISSION_REVENUE' }, credit: 100 }] };
    await db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, e));
    await db.transaction((tx) => postEntry(tx, SYSTEM_ACTOR, e)).catch(() => undefined);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, okKey))).toHaveLength(1);
  });

  it('SEC-LG-3: after all of the above the books still balance with zero projection drift', async () => {
    const r = await reconcile(db);
    expect(r.totalDebits).toBe(r.totalCredits);
    expect(r.trialBalanceOk).toBe(true);
    expect(r.mismatches).toHaveLength(0);
  });
});

describe('authentication (AUTH-01, AUTH-02, AUTH-06, 2FA)', () => {
  it('SEC-AU-1: a spoofed left-most X-Forwarded-For is ignored; the trusted proxy entry is used', () => {
    const prev = process.env.VERCEL;
    delete process.env.VERCEL;
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 10.0.0.9' }))).toBe('10.0.0.9');
    expect(clientIp(h({ 'x-real-ip': '10.1.1.1', 'x-forwarded-for': '6.6.6.6' }))).toBe('10.1.1.1');
    expect(clientIp(h({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull();
    process.env.VERCEL = '1';
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6', 'x-vercel-forwarded-for': '41.33.1.2' }))).toBe('41.33.1.2');
    if (prev === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prev;
  });

  it('SEC-AU-2: parallel wrong passwords still lock the account (atomic counter); a lock looks like a wrong password', async () => {
    const u = await makeUser();
    const meta = { ip: `10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` };
    await Promise.allSettled(Array.from({ length: 8 }, () => login(u.email!, 'wrong-password', 'WEB', meta)));
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.lockedUntil && row.lockedUntil > new Date()).toBe(true);
    await expect(login(u.email!, 'Test@12345', 'WEB', meta)).rejects.toThrow(/بيانات الدخول غير صحيحة/);
  });

  it('SEC-AU-3: open-redirect payloads are neutralised', () => {
    for (const bad of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/%09/evil.com'.replace('%09', '\t'), 'https://evil.com', '/\n/evil.com', 'javascript:alert(1)', '\\\\evil.com']) {
      expect(safeNext(bad, '/')).toBe('/');
    }
    expect(safeNext('/account/orders?x=1', '/')).toBe('/account/orders?x=1');
  });

  it('SEC-AU-4: verification codes are stored keyed (not a plain sha256 of the code) and older codes are retired', async () => {
    const u = await makeUser();
    await sendVerificationCode(u.id, 'PHONE');
    await sendVerificationCode(u.id, 'PHONE');
    const rows = await db.select().from(authTokens).where(and(eq(authTokens.userId, u.id), eq(authTokens.purpose, 'PHONE_VERIFY')));
    expect(rows.filter((r) => !r.usedAt)).toHaveLength(1);
    const [msg] = await db.select().from(outboundMessages).where(eq(outboundMessages.recipient, u.phone!)).orderBy(sql`created_at desc`).limit(1);
    const code = msg.body.match(/\d{6}/)![0];
    expect(rows.some((r) => r.tokenHash === sha256(`${u.id}:PHONE_VERIFY:${code}`))).toBe(false);
  });

  it('SEC-AU-5: a TOTP code cannot be replayed', async () => {
    const u = await makeUser({ staff: true, roles: ['CUSTOMER_SUPPORT'] });
    const secret = await beginTotpEnrollment(u.id);
    const code = totpCode(secret);
    expect(await verifyTotpForUser(u.id, code, {})).toBe(true);
    expect(await verifyTotpForUser(u.id, code, {})).toBe(false);
  });

  it('SEC-AU-6: one-time codes and links are redacted from the outbox once expired', async () => {
    const [m] = await db
      .insert(outboundMessages)
      .values({ channel: 'SMS', recipient: '+201000000000', body: 'رمز التحقق الخاص بك في اضمن: 123456', event: 'ACCOUNT_SECURITY', status: 'SENT', createdAt: new Date(Date.now() - 2 * 3600_000) })
      .returning();
    await redactExpiredSecrets();
    const [after] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, m.id));
    expect(after.body).toBe(REDACTED_BODY);
  });
});

describe('input validation', () => {
  it('SEC-IN-1: CMS links reject javascript:, data: and protocol-relative URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', '/\\evil.com', 'http://evil.com']) {
      expect(blockDataSchemas.BANNER.safeParse({ heading: 'x', href: bad }).success).toBe(false);
    }
    expect(blockDataSchemas.BANNER.safeParse({ heading: 'x', href: '/deals' }).success).toBe(true);
    expect(blockDataSchemas.HERO.safeParse({ heading: 'x', ctaHref: 'https://www.edmneg.com/x' }).success).toBe(true);
  });
});

// keep helpers referenced for future cases
void confirmSellerOrder;
void markShipped;
void saveShipment;
void pdf;
