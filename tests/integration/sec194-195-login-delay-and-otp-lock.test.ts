/**
 * PKG-FOLLOWUP-01: SEC-194 (L3, escalating login delay + configurable CAPTCHA) and SEC-195 (L4, cumulative delivery-code lock).
 * لم يتم التحقق: لم تعمل هنا (لا Postgres في بيئة العمل). التشغيل:
 *   docker compose up -d postgres && npm run db:migrate && DATABASE_URL=postgres://… npx vitest run tests/integration/sec194-195-login-delay-and-otp-lock.test.ts
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { customerActor } from '@/server/auth/actors';
import { login } from '@/server/auth/service';
import { db } from '@/server/db/client';
import { auditLogs, dealDeliveryOtps, externalDeals, notifications, riskFlags, users } from '@/server/db/schema';
import { claimInvitation, createDeal, DEAL_OTP_LIFETIME_GUESSES, deliveryOtpForBuyer, inviteSeller, markDealDelivered, respondToOffer, saveDealStep, SELLER_OTP_DAILY_FAILURES, startDealPayment, submitSellerOffer, verifyDeliveryOtp } from '@/server/modules/deals/service';
import { confirmPayment, startReview, submitProof } from '@/server/modules/payments/service';
import { getSetting, updateSetting } from '@/server/modules/settings';
import type { Actor } from '@/server/core/actor';
import { resetSettings } from '../helpers/settings';
import { ensurePaymentSetup, makeAdmin, makeUser, pdf, png } from '../helpers/factory';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin(['SUPER_ADMIN']);
  await ensurePaymentSetup();
});
afterAll(() => resetSettings('auth.captchaMode', 'auth.loginDelayAfterFailures', 'auth.loginDelayMaxSeconds'));
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CAPTCHA_SECRET;
  delete process.env.CAPTCHA_PROVIDER;
});

const ip = () => ({ ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const wrongN = async (email: string, n: number, meta = ip()) => {
  for (let i = 0; i < n; i++) await expect(login(email, 'wrong-password', 'WEB', meta)).rejects.toThrow(/بيانات الدخول غير صحيحة/);
  return meta;
};
/** End the current delay window (as if the wait had passed) without touching the failure streak. */
const endDelay = (id: string) => db.update(users).set({ lockedUntil: null }).where(eq(users.id, id));

describe('SEC-194 (L3) — escalating login delay replaces the hard lock', () => {
  it('below the threshold: no delay, and a correct password resets the streak', async () => {
    const u = await makeUser();
    const meta = await wrongN(u.email!, 4);
    const r = await row(u.id);
    expect(r.failedLoginCount).toBe(4);
    expect(r.lockedUntil).toBeNull();
    await login(u.email!, 'Test@12345', 'WEB', meta);
    const after = await row(u.id);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastFailedLoginAt).toBeNull();
  });

  it('the 5th wrong password starts a 30s delay, alerts the owner and opens ONE risk flag', async () => {
    const u = await makeUser();
    const meta = await wrongN(u.email!, 5);
    const r = await row(u.id);
    const ms = r.lockedUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(20_000);
    expect(ms).toBeLessThanOrEqual(31_000);
    const alerts = await db.select().from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.event, 'ACCOUNT_SECURITY')));
    expect(alerts).toHaveLength(1);
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'auth.login_delayed')))).length).toBe(1);
    // a 6th failure (after the delay passed) doubles the delay and does NOT open a second flag or a second alert
    await endDelay(u.id);
    await wrongN(u.email!, 1, meta);
    const r6 = await row(u.id);
    const ms6 = r6.lockedUntil!.getTime() - Date.now();
    expect(ms6).toBeGreaterThan(50_000);
    expect(ms6).toBeLessThanOrEqual(61_000);
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityType, 'user'), eq(riskFlags.entityId, u.id), eq(riskFlags.code, 'LOGIN_BRUTE_FORCE')));
    expect(flags).toHaveLength(1);
    expect(flags[0].status).toBe('OPEN');
  });

  it('during the delay even the right password is refused with the generic error; after it, the right password works', async () => {
    const u = await makeUser();
    const meta = await wrongN(u.email!, 5);
    await expect(login(u.email!, 'Test@12345', 'WEB', meta)).rejects.toThrow(/بيانات الدخول غير صحيحة/);
    await endDelay(u.id);
    const ok = await login(u.email!, 'Test@12345', 'WEB', meta);
    expect(ok.user.id).toBe(u.id);
    expect((await row(u.id)).failedLoginCount).toBe(0);
  });

  it('a failure streak older than 24h restarts at 1 (no delay for the owner who mistyped last week)', async () => {
    const u = await makeUser();
    await db.update(users).set({ failedLoginCount: 7, lastFailedLoginAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(users.id, u.id));
    await wrongN(u.email!, 1);
    const r = await row(u.id);
    expect(r.failedLoginCount).toBe(1);
    expect(r.lockedUntil).toBeNull();
  });

  it('threshold and ceiling are settings: 3 failures, 60s ceiling', async () => {
    await updateSetting(admin, 'auth.loginDelayAfterFailures', 3, 'اختبار عتبة التأخير');
    await updateSetting(admin, 'auth.loginDelayMaxSeconds', 60, 'اختبار سقف التأخير');
    expect(await getSetting('auth.loginDelayAfterFailures')).toBe(3);
    const u = await makeUser();
    const meta = await wrongN(u.email!, 3);
    const ms = (await row(u.id)).lockedUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(20_000);
    expect(ms).toBeLessThanOrEqual(31_000);
    for (let i = 0; i < 4; i++) {
      await endDelay(u.id);
      await wrongN(u.email!, 1, meta);
    }
    expect((await row(u.id)).lockedUntil!.getTime() - Date.now()).toBeLessThanOrEqual(61_000); // capped at 60s
    await resetSettings('auth.loginDelayAfterFailures', 'auth.loginDelayMaxSeconds');
  });

  it('a delay never reveals whether an account exists: unknown and known identifiers fail identically', async () => {
    await expect(login(`nobody-${randomUUID()}@test.local`, 'wrong-password', 'WEB', ip())).rejects.toThrow(/بيانات الدخول غير صحيحة/);
  });
});

describe('SEC-194 (L3) — CAPTCHA is configurable (default off, fails closed)', () => {
  it('is off by default and refuses to be turned on without provider keys in the environment', async () => {
    expect(await getSetting('auth.captchaMode')).toBe('off');
    delete process.env.CAPTCHA_SECRET;
    await expect(updateSetting(admin, 'auth.captchaMode', 'always', 'اختبار')).rejects.toThrow(/CAPTCHA_SECRET/);
    expect(await getSetting('auth.captchaMode')).toBe('off');
  });

  it("'always': no token or a failed token is refused; a verified token logs in", async () => {
    process.env.CAPTCHA_SECRET = 'test-secret';
    await updateSetting(admin, 'auth.captchaMode', 'always', 'اختبار CAPTCHA');
    const u = await makeUser();
    const meta = ip();
    await expect(login(u.email!, 'Test@12345', 'WEB', meta)).rejects.toMatchObject({ code: 'VALIDATION' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    await expect(login(u.email!, 'Test@12345', 'WEB', meta, { captchaToken: 'bad' })).rejects.toMatchObject({ code: 'VALIDATION' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    const ok = await login(u.email!, 'Test@12345', 'WEB', meta, { captchaToken: 'good' });
    expect(ok.user.id).toBe(u.id);
    await resetSettings('auth.captchaMode');
  });

  it("'after_failures': the first N attempts on an identifier need no token, the next one does", async () => {
    process.env.CAPTCHA_SECRET = 'test-secret';
    await updateSetting(admin, 'auth.captchaMode', 'after_failures', 'اختبار CAPTCHA بعد الفشل');
    const u = await makeUser();
    const meta = ip();
    await wrongN(u.email!, 5, meta); // within the free budget (default 5): ordinary wrong-password answers
    await endDelay(u.id);
    await expect(login(u.email!, 'wrong-password', 'WEB', meta)).rejects.toMatchObject({ code: 'VALIDATION' }); // the 6th needs the token
    await resetSettings('auth.captchaMode');
  });
});

/* ───────────── SEC-195 (L4) ───────────── */
const LOC = { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 };

async function shippedDeal(seller?: Actor) {
  const buyer = customerActor((await makeUser({ identity: true })).id);
  const deal = await createDeal(buyer, { title: 'لابتوب لاختبار القفل التراكمي', description: 'لابتوب بحالة جيدة جداً مع الشاحن', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '5000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const sellerActor = seller ?? customerActor((await makeUser({ identity: true })).id);
  await claimInvitation(sellerActor, token);
  const { version } = await submitSellerOffer(
    sellerActor,
    deal.id,
    { details: { fullName: 'بائع القفل' }, location: LOC, payout: { type: 'INSTAPAY', holderName: 'بائع القفل', instapayAddress: 'lock@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
    true,
  );
  await respondToOffer(buyer, deal.id, version, 'ACCEPT');
  const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
  const { submission } = await submitProof(buyer, p.id, { claimedAmount: String(p.amountDue / 100), clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  await startReview(await makeAdmin(['PAYMENT_REVIEWER']), p.id);
  await confirmPayment(admin, p.id, submission.id);
  await markDealDelivered(sellerActor, deal.id, 'تم الشحن مع المندوب', [{ data: pdf(), name: 'waybill.pdf' }]);
  const code = (await deliveryOtpForBuyer(buyer, deal.id))!.testCode!;
  return { buyer, seller: sellerActor, dealId: deal.id, code };
}
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
const dealRow = async (id: string) => (await db.select().from(externalDeals).where(eq(externalDeals.id, id)))[0];

describe('SEC-195 (L4) — cumulative delivery-code lock', () => {
  it('per deal: when the lifetime guess budget is spent the code is closed, the deal goes to Operations review (hold + risk flag)', async () => {
    const d = await shippedDeal();
    // 29 guesses already spent on earlier codes of this deal (the 15-minute limiter is bypassed on purpose: it is not what is tested).
    await db.update(dealDeliveryOtps).set({ attempts: DEAL_OTP_LIFETIME_GUESSES - 1, maxAttempts: 100 }).where(eq(dealDeliveryOtps.dealId, d.dealId));
    await expect(verifyDeliveryOtp(d.seller, d.dealId, wrong(d.code))).rejects.toThrow(/غير صحيح|تم تجاوز/);
    const [otp] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(otp.attempts).toBe(DEAL_OTP_LIFETIME_GUESSES);
    expect(otp.invalidReason).toBe('CLOSED');
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityType, 'external_deal'), eq(riskFlags.entityId, d.dealId)));
    expect(flags.map((f) => f.code)).toContain('DELIVERY_EXCEPTION');
    expect(flags.find((f) => f.code === 'DELIVERY_EXCEPTION')!.status).toBe('OPEN');
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, d.dealId), eq(auditLogs.action, 'deal.delivery_otp_budget_exhausted')))).length).toBe(1);
    // the CORRECT code can no longer complete the handover, and the deal is out of the normal flow
    await expect(verifyDeliveryOtp(d.seller, d.dealId, d.code)).rejects.toThrow();
    expect((await dealRow(d.dealId)).status).not.toBe('DELIVERY_HANDOVER_VERIFIED');
  });

  it('per seller account: failed guesses are counted across ALL deals in 24h and the account is flagged and refused', async () => {
    const d1 = await shippedDeal();
    // 39 failed guesses on other deals in the last 24h (persisted audit rows, the same rows the real failures write).
    await db.insert(auditLogs).values(
      Array.from({ length: SELLER_OTP_DAILY_FAILURES - 1 }, () => ({ actorUserId: d1.seller.userId!, actorType: 'CUSTOMER', action: 'deal.delivery_otp_failed', entityType: 'external_deal', entityId: randomUUID() })),
    );
    await expect(verifyDeliveryOtp(d1.seller, d1.dealId, wrong(d1.code))).rejects.toThrow(/غير صحيح/); // the 40th failure
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityType, 'user'), eq(riskFlags.entityId, d1.seller.userId!), eq(riskFlags.code, 'DELIVERY_CODE_GUESSING')));
    expect(flags).toHaveLength(1);
    // the next attempt, even with the right code, is refused for this seller account
    await expect(verifyDeliveryOtp(d1.seller, d1.dealId, d1.code)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await dealRow(d1.dealId)).status).toBe('DELIVERED');
    // another seller account is not affected
    const d2 = await shippedDeal();
    await expect(verifyDeliveryOtp(d2.seller, d2.dealId, d2.code)).resolves.toMatchObject({ status: 'DELIVERY_HANDOVER_VERIFIED' });
  });

  it('a seller below both budgets still completes the handover with the right code (no regression)', async () => {
    const d = await shippedDeal();
    await expect(verifyDeliveryOtp(d.seller, d.dealId, wrong(d.code))).rejects.toThrow(/غير صحيح/);
    await expect(verifyDeliveryOtp(d.seller, d.dealId, d.code)).resolves.toMatchObject({ status: 'DELIVERY_HANDOVER_VERIFIED' });
  });
});
