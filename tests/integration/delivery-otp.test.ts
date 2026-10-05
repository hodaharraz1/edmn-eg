import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { auditLogs, dealDeliveryOtps, dealPayouts, externalDeals, journalEntries, notifications, outboundMessages, riskFlags } from '@/server/db/schema';
import {
  claimInvitation,
  confirmDealReceipt,
  createDeal,
  dealGraph,
  deliveryOtpEvents,
  deliveryOtpForBuyer,
  inviteSeller,
  markDealDelivered,
  regenerateDeliveryOtp,
  reportDeliveryException,
  reportNotReceived,
  respondToOffer,
  saveDealStep,
  setDealFinancialHold,
  startDealPayment,
  submitSellerOffer,
  termsHistory,
  verifyDeliveryOtp,
} from '@/server/modules/deals/service';
import { deliveryOtpTestMode, generateDeliveryCode } from '@/server/modules/deals/delivery-otp';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { reconcile, sellerBalances } from '@/server/modules/finance/ledger';
import { flushOutbound } from '@/server/jobs/worker';
import { addTrackingEvent } from '@/server/modules/commerce/fulfilment';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, pdf, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LOC = { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 20 };

/** A deal that is paid and confirmed by Operations (ACTIVE), optionally reusing an existing seller. */
async function activeDeal(opts: { seller?: Actor } = {}) {
  const buyerUser = await makeUser();
  const buyer = customerActor(buyerUser.id);
  const deal = await createDeal(buyer, { title: 'لابتوب مستعمل للتسليم', description: 'لابتوب بحالة جيدة جداً مع الشاحن', condition: 'NEW', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '5000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '15' });
  const { token } = await inviteSeller(buyer, deal.id, true);
  const seller = opts.seller ?? customerActor((await makeUser()).id);
  await claimInvitation(seller, token);
  const { version } = await submitSellerOffer(
    seller,
    deal.id,
    { details: { fullName: 'بائع التسليم' }, location: LOC, payout: { type: 'INSTAPAY', holderName: 'بائع التسليم', instapayAddress: 'otp@instapay' }, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } },
    true,
  );
  await respondToOffer(buyer, deal.id, version, 'ACCEPT');
  const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
  const { submission } = await submitProof(buyer, p.id, { claimedAmount: '5000', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
  await confirmPayment(admin, p.id, submission.id);
  return { buyer, buyerUser, seller, dealId: deal.id };
}

/** ACTIVE → seller ships (OTP issued to the buyer). Returns the buyer's test code (test mode only). */
async function shippedDeal(opts: { seller?: Actor } = {}) {
  const d = await activeDeal(opts);
  await markDealDelivered(d.seller, d.dealId, 'تم الشحن مع المندوب', [{ data: pdf(), name: 'waybill.pdf' }]);
  const view = await deliveryOtpForBuyer(d.buyer, d.dealId);
  return { ...d, code: view!.testCode! };
}

const status = async (id: string) => (await db.select({ s: externalDeals.status }).from(externalDeals).where(eq(externalDeals.id, id)))[0].s;
const payouts = (id: string) => db.select().from(dealPayouts).where(eq(dealPayouts.dealId, id));
const settlements = (id: string) => db.select().from(journalEntries).where(and(eq(journalEntries.sourceId, id), eq(journalEntries.entryType, 'DEAL_SETTLEMENT')));
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

describe('delivery OTP — generation, storage, lifecycle', () => {
  it('codes are 6 CSPRNG digits; only an HMAC is stored; shipping issues one code for the buyer', async () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateDeliveryCode()));
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
    const d = await shippedDeal();
    expect(deliveryOtpTestMode()).toBe(true);
    const rows = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(rows).toHaveLength(1);
    expect(rows[0].buyerId).toBe(d.buyerUser.id);
    expect(JSON.stringify(rows[0])).not.toContain(d.code);
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await status(d.dealId)).toBe('DELIVERED');
  });

  it('production keeps no recoverable copy of the code', async () => {
    const prev = process.env.EDMN_ENVIRONMENT;
    process.env.EDMN_ENVIRONMENT = 'production';
    try {
      expect(deliveryOtpTestMode()).toBe(false);
      const d = await activeDeal();
      await markDealDelivered(d.seller, d.dealId, 'شحن');
      const [row] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
      expect(row.testCodeEnc).toBeNull();
      expect((await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode).toBeNull();
    } finally {
      process.env.EDMN_ENVIRONMENT = prev;
    }
  });

  it('1 — a wrong code is rejected and counted', async () => {
    const d = await shippedDeal();
    await expect(verifyDeliveryOtp(d.seller, d.dealId, wrong(d.code))).rejects.toThrow(/غير صحيح/);
    const [row] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(row.attempts).toBe(1);
    expect(await status(d.dealId)).toBe('DELIVERED');
    expect((await auditLogs$(d.dealId)).includes('deal.delivery_otp_failed')).toBe(true);
  });

  it('2 — an expired code is rejected (and recorded as expired)', async () => {
    const d = await shippedDeal();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 73 * 3600_000);
    await expect(verifyDeliveryOtp(d.seller, d.dealId, d.code)).rejects.toThrow(/انتهت صلاحية/);
    vi.useRealTimers();
    const [row] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(row.invalidReason).toBe('EXPIRED');
    expect(await status(d.dealId)).toBe('DELIVERED');
    expect(await auditLogs$(d.dealId)).toContain('deal.delivery_otp_expired');
  });

  it('3 + 12 — a correct code works exactly once; reuse is rejected', async () => {
    const d = await shippedDeal();
    expect((await verifyDeliveryOtp(d.seller, d.dealId, d.code)).status).toBe('DELIVERY_HANDOVER_VERIFIED');
    await expect(verifyDeliveryOtp(d.seller, d.dealId, d.code)).rejects.toThrow(/مسبقًا/);
    const [row] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(row.usedAt).not.toBeNull();
    // The database itself refuses to re-activate a used code.
    await expect(db.update(dealDeliveryOtps).set({ usedAt: null }).where(eq(dealDeliveryOtps.id, row.id))).rejects.toThrow();
    await expect(db.delete(dealDeliveryOtps).where(eq(dealDeliveryOtps.id, row.id))).rejects.toThrow();
  });

  it('4 — regeneration invalidates the previous code', async () => {
    const d = await shippedDeal();
    await regenerateDeliveryOtp(d.buyer, d.dealId);
    const fresh = (await deliveryOtpForBuyer(d.buyer, d.dealId))!.testCode!;
    if (fresh !== d.code) await expect(verifyDeliveryOtp(d.seller, d.dealId, d.code)).rejects.toThrow();
    const rows = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId)).orderBy(dealDeliveryOtps.createdAt);
    expect(rows[0].invalidReason).toBe('REGENERATED');
    expect(await status(d.dealId)).toBe('DELIVERED');
    await verifyDeliveryOtp(d.seller, d.dealId, fresh);
    expect(await auditLogs$(d.dealId)).toContain('deal.delivery_otp_regenerated');
  });

  it('6 — the attempt limit locks the code (even the right code then fails)', async () => {
    const d = await shippedDeal();
    for (let i = 0; i < 5; i++) await expect(verifyDeliveryOtp(d.seller, d.dealId, wrong(d.code))).rejects.toThrow();
    await expect(verifyDeliveryOtp(d.seller, d.dealId, d.code)).rejects.toThrow(/لا يوجد رمز صالح/);
    const [row] = await db.select().from(dealDeliveryOtps).where(eq(dealDeliveryOtps.dealId, d.dealId));
    expect(row.invalidReason).toBe('LOCKED');
    expect(row.attempts).toBe(5);
  });

  it('5 — brute force across regenerations is rate-limited per deal', async () => {
    const d = await shippedDeal();
    let rateLimited = false;
    for (let i = 0; i < 12 && !rateLimited; i++) {
      try {
        await verifyDeliveryOtp(d.seller, d.dealId, wrong(d.code));
      } catch (e) {
        if ((e as { code?: string }).code === 'RATE_LIMITED') rateLimited = true;
        else if (/تجاوز|لا يوجد/.test((e as Error).message)) await regenerateDeliveryOtp(d.buyer, d.dealId);
      }
    }
    expect(rateLimited).toBe(true);
    expect(await status(d.dealId)).toBe('DELIVERED');
  });

  it('13 — concurrent submissions of the right code verify exactly once', async () => {
    const d = await shippedDeal();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => verifyDeliveryOtp(d.seller, d.dealId, d.code)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const verified = (await auditLogs$(d.dealId)).filter((a) => a === 'deal.delivery_otp_verified');
    expect(verified).toHaveLength(1);
  });
});

describe('delivery OTP — isolation and visibility', () => {
  it('7 + 15 — the seller can never retrieve the code (service, deal view, history, notifications)', async () => {
    const d = await shippedDeal();
    await expect(deliveryOtpForBuyer(d.seller, d.dealId)).rejects.toThrow();
    const sellerView = JSON.stringify(await dealGraph(d.seller, d.dealId));
    const history = JSON.stringify(await termsHistory(d.seller, d.dealId));
    const events = JSON.stringify(await deliveryOtpEvents(d.dealId));
    for (const blob of [sellerView, history, events]) {
      expect(blob).not.toContain(d.code);
      expect(blob).not.toMatch(/codeHash|testCodeEnc/);
    }
    const sellerNotes = await db.select().from(notifications).where(eq(notifications.userId, d.seller.userId!));
    expect(JSON.stringify(sellerNotes)).not.toContain(d.code);
    // In-app notifications (even the buyer's) never carry the code; only the buyer's SMS does.
    const buyerNotes = await db.select().from(notifications).where(eq(notifications.userId, d.buyerUser.id));
    expect(JSON.stringify(buyerNotes)).not.toContain(d.code);
    const sms = await db.select().from(outboundMessages).where(eq(outboundMessages.event, 'DEAL_DELIVERY_OTP'));
    expect(sms.every((m) => m.recipient === d.buyerUser.phone || !m.body.includes(d.code))).toBe(true);
    // Audit entries record ids / counters, never the code.
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, d.dealId));
    expect(JSON.stringify(audits)).not.toContain(d.code);
  });

  it('8 — another seller cannot use seller A’s code on deal A', async () => {
    const d = await shippedDeal();
    const sellerB = (await activeDeal()).seller;
    await expect(verifyDeliveryOtp(sellerB, d.dealId, d.code)).rejects.toThrow(/لبائع الصفقة فقط/);
    expect(await status(d.dealId)).toBe('DELIVERED');
  });

  it('9 — customer B cannot read or use customer A’s code', async () => {
    const d = await shippedDeal();
    const other = customerActor((await makeUser()).id);
    await expect(deliveryOtpForBuyer(other, d.dealId)).rejects.toThrow();
    await expect(verifyDeliveryOtp(other, d.dealId, d.code)).rejects.toThrow();
    await expect(regenerateDeliveryOtp(other, d.dealId)).rejects.toThrow();
    // Even the buyer cannot self-verify their own handover.
    await expect(verifyDeliveryOtp(d.buyer, d.dealId, d.code)).rejects.toThrow();
  });

  it('10 — a code for deal A cannot verify deal B (same seller)', async () => {
    const a = await shippedDeal();
    const b = await shippedDeal({ seller: a.seller });
    let codeB = b.code;
    while (codeB === a.code) {
      await regenerateDeliveryOtp(b.buyer, b.dealId);
      codeB = (await deliveryOtpForBuyer(b.buyer, b.dealId))!.testCode!;
    }
    await expect(verifyDeliveryOtp(a.seller, b.dealId, a.code)).rejects.toThrow(/غير صحيح/);
    expect(await status(b.dealId)).toBe('DELIVERED');
    await verifyDeliveryOtp(a.seller, b.dealId, codeB);
  });

  it('11 — an anonymous caller cannot retrieve, verify or regenerate', async () => {
    const d = await shippedDeal();
    const anon = { type: 'ANONYMOUS', userId: null, roles: [], permissions: new Set() } as unknown as Actor;
    await expect(deliveryOtpForBuyer(anon, d.dealId)).rejects.toThrow();
    await expect(verifyDeliveryOtp(anon, d.dealId, d.code)).rejects.toThrow();
    await expect(regenerateDeliveryOtp(anon, d.dealId)).rejects.toThrow();
  });

  it('14 — the code never appears in server logs (issue, SMS log driver, verify)', async () => {
    const lines: string[] = [];
    for (const m of ['log', 'info', 'error', 'warn', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const d = await shippedDeal();
    await flushOutbound(500);
    await verifyDeliveryOtp(d.seller, d.dealId, wrong(d.code)).catch(() => {});
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    vi.restoreAllMocks();
    expect(lines.join('\n')).not.toContain(d.code);
  });
});

describe('delivery OTP — money', () => {
  it('16 + 17 + 19 — shipping with a waybill, GPS locations and a verified handover release nothing', async () => {
    const d = await shippedDeal();
    expect((await dealGraph(d.seller, d.dealId)).buyerLocation?.gps).not.toBeNull();
    expect(await payouts(d.dealId)).toHaveLength(0);
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    expect(await status(d.dealId)).toBe('DELIVERY_HANDOVER_VERIFIED');
    expect(await payouts(d.dealId)).toHaveLength(0);
    expect(await settlements(d.dealId)).toHaveLength(0);
  });

  it('18 — marketplace tracking / shipping status alone does not make the seller balance available', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 200_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await addTrackingEvent(s.actor, so.id, { status: 'IN_TRANSIT', description: 'خرج للتوصيل' });
    expect((await sellerBalances(db, s.actor.sellerId!)).available).toBe(0);
  });

  it('confirmation is impossible before a verified handover; the seller has no "buyer received" path', async () => {
    const d = await shippedDeal();
    await expect(confirmDealReceipt(d.buyer, d.dealId)).rejects.toThrow(/رمز الاستلام/);
    await expect(confirmDealReceipt(d.seller, d.dealId)).rejects.toThrow();
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    await expect(confirmDealReceipt(d.seller, d.dealId)).rejects.toThrow();
    expect(await payouts(d.dealId)).toHaveLength(0);
  });

  it('20 + 23 — the buyer’s explicit confirmation after OTP releases the eligible amount exactly once', async () => {
    const d = await shippedDeal();
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    const results = await Promise.allSettled([confirmDealReceipt(d.buyer, d.dealId), confirmDealReceipt(d.buyer, d.dealId), confirmDealReceipt(d.buyer, d.dealId)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await confirmDealReceipt(d.buyer, d.dealId)).toEqual({ alreadyCompleted: true });
    const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(deal.status).toBe('COMPLETED');
    expect(deal.buyerConfirmedAt).not.toBeNull();
    const po = await payouts(d.dealId);
    expect(po).toHaveLength(1);
    expect(po[0].amount).toBe(deal.sellerReceives);
    expect(await settlements(d.dealId)).toHaveLength(1);
    const hist = await db.execute<{ to_status: string }>(sql`select to_status from status_history where entity_id = ${d.dealId} order by created_at`);
    expect(hist.rows.map((r) => r.to_status)).toEqual(expect.arrayContaining(['DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMED_RECEIPT', 'COMPLETED']));
  });

  it('21 — "received but there is a problem" after OTP keeps funds held', async () => {
    const d = await shippedDeal();
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    await openDispute(d.buyer, { dealId: d.dealId, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج به عيب لم يُذكر في العرض المتفق عليه' });
    expect(await status(d.dealId)).toBe('DISPUTED');
    await expect(confirmDealReceipt(d.buyer, d.dealId)).rejects.toThrow();
    expect(await payouts(d.dealId)).toHaveLength(0);
    // Agreed terms, OTP evidence and the shipment proof are all preserved.
    const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(deal.agreedTerms).not.toBeNull();
    expect(deal.handoverOtpId).not.toBeNull();
    expect((await deliveryOtpEvents(d.dealId))[0].usedAt).not.toBeNull();
  });

  it('22 — "not actually received" after a verified OTP is a DELIVERY_CONFLICT; funds stay held', async () => {
    const d = await shippedDeal();
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    const r = await reportNotReceived(d.buyer, d.dealId, 'لم أستلم أي شيء والمندوب طلب الرمز فقط');
    expect(r.conflict).toBe(true);
    const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, d.dealId));
    expect(deal.status).toBe('DISPUTED');
    expect(deal.deliveryConflictAt).not.toBeNull();
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, d.dealId), eq(riskFlags.code, 'DELIVERY_CONFLICT')));
    expect(flags).toHaveLength(1);
    await expect(confirmDealReceipt(d.buyer, d.dealId)).rejects.toThrow();
    expect(await payouts(d.dealId)).toHaveLength(0);
    expect(await auditLogs$(d.dealId)).toContain('deal.delivery_conflict');
  });

  it('no-OTP exception goes to Operations review and never releases funds', async () => {
    const d = await shippedDeal();
    await reportDeliveryException(d.seller, d.dealId, 'المشتري لا يستطيع استقبال الرسائل');
    expect(await status(d.dealId)).toBe('DISPUTED');
    const flags = await db.select().from(riskFlags).where(and(eq(riskFlags.entityId, d.dealId), eq(riskFlags.code, 'DELIVERY_EXCEPTION')));
    expect(flags).toHaveLength(1);
    await expect(verifyDeliveryOtp(d.seller, d.dealId, d.code)).rejects.toThrow();
    expect(await payouts(d.dealId)).toHaveLength(0);
  });

  it('an Operations hold blocks the release even after OTP + buyer confirmation attempt', async () => {
    const d = await shippedDeal();
    await verifyDeliveryOtp(d.seller, d.dealId, d.code);
    await setDealFinancialHold(admin, d.dealId, true, 'مراجعة احتيال محتمل');
    await expect(confirmDealReceipt(d.buyer, d.dealId)).rejects.toThrow(/مراجعة/);
    expect(await payouts(d.dealId)).toHaveLength(0);
    const plain = customerActor(d.buyerUser.id);
    await expect(setDealFinancialHold(plain, d.dealId, false, 'x x x')).rejects.toThrow();
    await setDealFinancialHold(admin, d.dealId, false, 'تمت المراجعة');
    await confirmDealReceipt(d.buyer, d.dealId);
    expect(await payouts(d.dealId)).toHaveLength(1);
  });

  it('24 — the ledger stays balanced with zero projection drift', async () => {
    const r = await reconcile();
    expect(r.trialBalanceOk).toBe(true);
    expect(r.mismatches).toEqual([]);
  });
});

async function auditLogs$(dealId: string) {
  return (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, dealId))).map((r) => r.a);
}
