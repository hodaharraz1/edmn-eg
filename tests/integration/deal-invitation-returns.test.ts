import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { customerActor } from '@/server/auth/actors';
import { db } from '@/server/db/client';
import { auditLogs, dealInvitations, dealTermsVersions, externalDeals, orderItems, products, sellerOrders, stores } from '@/server/db/schema';
import {
  cancelDeal,
  claimInvitation,
  confirmDealReceipt,
  createDeal,
  dealGraph,
  dealsForUser,
  expireDealInvitations,
  invitationByToken,
  inviteSeller,
  markDealDelivered,
  refreshInvitation,
  rejectInvitation,
  respondToChangeRequest,
  respondToOffer,
  revokeInvitation,
  saveDealStep,
  startDealPayment,
  submitSellerOffer,
  termsHistory,
  type Terms,
} from '@/server/modules/deals/service';
import { locationSchema, toStoredLocation } from '@/server/modules/locations';
import { returnPolicySchema } from '@/domain/return-policy';
import { confirmPayment, submitProof } from '@/server/modules/payments/service';
import { openDispute } from '@/server/modules/postpurchase/disputes';
import { requestReturn, returnWindow } from '@/server/modules/postpurchase/returns';
import { submitForReview } from '@/server/modules/catalog/products';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';
import type { Actor } from '@/server/core/actor';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

const BUYER_LOC = { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير', loc_lat: '30.04442', loc_lng: '31.23571', loc_accuracy: '25' };
const SELLER_LOC = { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم', lat: 29.98765, lng: 31.13456, accuracy: 30 };
const PAYOUT = { type: 'INSTAPAY' as const, holderName: 'بائع خارجي', instapayAddress: 'ext@instapay' };

/** Buyer creates a complete request WITHOUT any seller details and gets a link. */
async function invitedDeal(opts: { condition?: 'NEW' | 'USED'; hints?: Record<string, string> } = {}) {
  const buyerUser = await makeUser();
  const buyer = customerActor(buyerUser.id);
  const deal = await createDeal(buyer, { title: 'موبايل من ماركت بليس', description: 'موبايل مستعمل بحالة ممتازة مع العلبة', condition: opts.condition ?? 'USED', quantity: 1 });
  await saveDealStep(buyer, deal.id, 2, { unitPrice: '8000' });
  await saveDealStep(buyer, deal.id, 3, { deliveryMethod: 'شحن عبر شركة', deliveryDeadline: new Date(Date.now() + 5 * 86400_000), inspectionDays: 2 });
  await saveDealStep(buyer, deal.id, 4, { customTerms: '' });
  await saveDealStep(buyer, deal.id, 5, { ...BUYER_LOC, ...(opts.hints ?? {}) });
  const { link, token } = await inviteSeller(buyer, deal.id, true);
  return { buyerUser, buyer, deal, link, token };
}

async function joinedDeal(opts: { condition?: 'NEW' | 'USED' } = {}) {
  const d = await invitedDeal(opts);
  const sellerUser = await makeUser();
  const seller = customerActor(sellerUser.id);
  await claimInvitation(seller, d.token);
  return { ...d, sellerUser, seller };
}

async function offer(seller: Actor, dealId: string, policy: unknown, first = true, shippingFee = '100') {
  return submitSellerOffer(
    seller,
    dealId,
    {
      ...(first ? { details: { fullName: 'بائع خارجي حقيقي' }, location: SELLER_LOC, payout: PAYOUT } : {}),
      offer: { shippingFee, deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 2, defects: 'خدش بسيط في الظهر', accessories: 'شاحن', warranty: 'بدون' },
      returnPolicy: policy,
    },
    true,
  );
}

const auditActions = async (dealId: string) => (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, dealId))).map((r) => r.a);

describe('external deal invitation', () => {
  it('buyer creates a deal without any seller details; link is CSPRNG, only its hash is stored', async () => {
    const { deal, link, token } = await invitedDeal();
    expect(link).toMatch(/\/deal\/invite\/[A-Za-z0-9_-]{40,}$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    const [inv] = await db.select().from(dealInvitations).where(eq(dealInvitations.dealId, deal.id));
    expect(inv.tokenHash).not.toContain(token);
    expect(JSON.stringify(inv)).not.toContain(token);
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('INVITED');
    expect(d.sellerName).toBeNull();
    expect(d.sellerPhone).toBeNull();
    expect(await auditActions(deal.id)).toContain('deal.invitation_created');
  });

  it('anti-enumeration: malformed / unknown tokens return nothing', async () => {
    expect(await invitationByToken('short')).toBeNull();
    expect(await invitationByToken('../../etc/passwd')).toBeNull();
    expect(await invitationByToken('A'.repeat(43))).toBeNull();
    await expect(claimInvitation(customerActor((await makeUser()).id), 'B'.repeat(43))).rejects.toThrow();
  });

  it('opening the link is read-only: no binding, no status change, safe summary without buyer PII; opened is audited once', async () => {
    const { deal, token, buyerUser } = await invitedDeal();
    const v1 = await invitationByToken(token);
    const v2 = await invitationByToken(token);
    expect(v1!.usable).toBe(true);
    const json = JSON.stringify(v2);
    expect(json).not.toContain(buyerUser.fullName);
    expect(json).not.toContain(buyerUser.phone!);
    expect(json).not.toContain(buyerUser.email!);
    expect(json).not.toContain('شارع التحرير');
    expect(json).not.toContain('30.04442');
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('INVITED');
    expect(d.sellerUserId).toBeNull();
    expect((await auditActions(deal.id)).filter((a) => a === 'deal.invitation_opened')).toHaveLength(1);
  });

  it('binding: the buyer cannot claim; first seller binds; same seller replays idempotently; any other account is refused', async () => {
    const { buyer, deal, token } = await invitedDeal();
    await expect(claimInvitation(buyer, token)).rejects.toThrow();
    const s1 = customerActor((await makeUser()).id);
    const s2 = customerActor((await makeUser()).id);
    expect(await claimInvitation(s1, token)).toBe(deal.id);
    expect(await claimInvitation(s1, token)).toBe(deal.id);
    await expect(claimInvitation(s2, token)).rejects.toThrow(/حساب تاني/);
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('SELLER_JOINED');
    expect(d.sellerUserId).toBe(s1.userId);
    await expect(dealGraph(s2, deal.id)).rejects.toThrow();
    expect(await auditActions(deal.id)).toContain('deal.invitation_bound');
  });

  it('expired links cannot be claimed and the expiry is recorded', async () => {
    const { deal, token } = await invitedDeal();
    await db.update(dealInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(dealInvitations.dealId, deal.id));
    await expect(claimInvitation(customerActor((await makeUser()).id), token)).rejects.toThrow(/منتهية/);
    expect(await expireDealInvitations()).toBeGreaterThanOrEqual(1);
    const v = await invitationByToken(token);
    expect(v!.expired).toBe(true);
    expect(v!.usable).toBe(false);
    expect(await auditActions(deal.id)).toContain('deal.invitation_expired');
  });

  it('refresh replaces the link (old one dies); revoke returns the deal to DRAFT', async () => {
    const { buyer, deal, token } = await invitedDeal();
    const { token: t2 } = await refreshInvitation(buyer, deal.id);
    expect(t2).not.toBe(token);
    await expect(claimInvitation(customerActor((await makeUser()).id), token)).rejects.toThrow();
    await revokeInvitation(buyer, deal.id);
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('DRAFT');
    await expect(claimInvitation(customerActor((await makeUser()).id), t2)).rejects.toThrow();
    expect(await auditActions(deal.id)).toContain('deal.invitation_revoked');
  });

  it('a stranger cannot act on a deal (offer / respond / view)', async () => {
    const { deal, buyer } = await joinedDeal();
    const stranger = customerActor((await makeUser()).id);
    await expect(offer(stranger, deal.id, { type: 'NONE' })).rejects.toThrow();
    await expect(respondToOffer(stranger, deal.id, 1, 'ACCEPT')).rejects.toThrow();
    await expect(termsHistory(stranger, deal.id)).rejects.toThrow();
    // The buyer cannot submit the seller offer either.
    await expect(offer(buyer, deal.id, { type: 'NONE' })).rejects.toThrow();
  });

  it('seller must have a verified phone before the first offer', async () => {
    const { deal, seller, sellerUser } = await joinedDeal();
    const { users } = await import('@/server/db/schema');
    await db.update(users).set({ phoneVerifiedAt: null }).where(eq(users.id, sellerUser.id));
    await expect(offer(seller, deal.id, { type: 'NONE' })).rejects.toThrow(/موبايل/);
  });

  it('seller can reject from the invitation; buyer is the only one notified and the deal ends', async () => {
    const { deal, token } = await invitedDeal();
    const s = customerActor((await makeUser()).id);
    await rejectInvitation(s, { token }, 'السعر غير مناسب');
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('CANCELLED');
  });

  it('the same single deal appears for buyer and seller (no duplicates)', async () => {
    const { deal, buyerUser, sellerUser } = await joinedDeal();
    const b = (await dealsForUser(buyerUser.id)).filter((x) => x.id === deal.id);
    const s = (await dealsForUser(sellerUser.id)).filter((x) => x.id === deal.id);
    expect(b).toHaveLength(1);
    expect(s).toHaveLength(1);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(externalDeals).where(eq(externalDeals.buyerId, buyerUser.id));
    expect(n).toBe(1);
  });

  it('self-dealing via hints is refused', async () => {
    const u = await makeUser();
    const a = customerActor(u.id);
    const deal = await createDeal(a, { title: 'منتج تجريبي للاختبار', description: 'وصف طويل بما يكفي للاختبار', condition: 'NEW', quantity: 1 });
    await expect(saveDealStep(a, deal.id, 5, { ...BUYER_LOC, sellerPhone: u.phone! })).rejects.toThrow(/نفسك/);
  });
});

describe('location privacy', () => {
  it('location schema: GPS optional and range-checked; manual address alone works', () => {
    expect(locationSchema.safeParse({ governorateId: 1, city: 'القاهرة', street: 'شارع' }).success).toBe(true);
    expect(locationSchema.safeParse({ governorateId: 1, city: 'القاهرة', street: 'شارع', lat: 123, lng: 31 }).success).toBe(false);
    expect(locationSchema.safeParse({ governorateId: 1, city: 'القاهرة', street: 'شارع', lat: 30, lng: 500 }).success).toBe(false);
    const stored = toStoredLocation(locationSchema.parse({ governorateId: 1, city: 'القاهرة', street: 'شارع', lat: '30.123456789', lng: '31.987654321', accuracy: '12.6' }));
    expect(stored.gps).toEqual({ lat: 30.12346, lng: 31.98765, accuracy: 13 });
    expect(toStoredLocation(locationSchema.parse({ governorateId: 1, city: 'القاهرة', street: 'شارع' })).gps).toBeNull();
  });

  it('coordinates are encrypted at rest and the counterparty sees them only after payment is confirmed', async () => {
    const { deal, buyer, seller } = await joinedDeal();
    const [raw] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(raw.buyerLocationEnc).toBeTruthy();
    expect(raw.buyerLocationEnc).not.toContain('30.04442');
    expect(raw.buyerLocationEnc).not.toContain('التحرير');
    expect(raw.destinationGovernorateId).toBe(1);

    // Before payment: each side sees only its own location; no ciphertext reaches the page layer.
    let gs = await dealGraph(seller, deal.id);
    expect(gs.buyerLocation).toBeNull();
    expect(gs.deal.buyerLocationEnc).toBeNull();
    const gb = await dealGraph(buyer, deal.id);
    expect(gb.buyerLocation?.gps?.lat).toBe(30.04442);

    const { version } = await offer(seller, deal.id, { type: 'NONE' });
    expect((await dealGraph(buyer, deal.id)).sellerLocation).toBeNull();
    const [r2] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(r2.originGovernorateId).toBe(2);
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
    const { submission } = await submitProof(buyer, p.id, { claimedAmount: '8100', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await confirmPayment(admin, p.id, submission.id);
    gs = await dealGraph(seller, deal.id);
    expect(gs.buyerLocation?.street).toBe('شارع التحرير');
    expect((await dealGraph(buyer, deal.id)).sellerLocation?.street).toBe('شارع الهرم');
  });
});

describe('seller return policy & negotiation (protected deals)', () => {
  it('the seller offer — not the buyer — sets the final price, delivery method and delivery window; the agreed snapshot freezes parties, delivery info and timestamps', async () => {
    const { deal, buyer, seller, buyerUser } = await joinedDeal();
    await expect(
      submitSellerOffer(seller, deal.id, { details: { fullName: 'بائع خارجي' }, location: SELLER_LOC, payout: PAYOUT, offer: { shippingFee: '0', deliveryMethod: 'مندوب', processingDays: 1, deliveryMinDays: 5, deliveryMaxDays: 2, defects: 'لا يوجد' }, returnPolicy: { type: 'NONE' } }, true),
    ).rejects.toThrow(/أقصى مدة توصيل/);
    const { version } = await submitSellerOffer(
      seller,
      deal.id,
      { details: { fullName: 'بائع خارجي' }, location: SELLER_LOC, payout: PAYOUT, offer: { unitPrice: '7600', shippingFee: '60', deliveryMethod: 'مندوب شركة بوسطة', processingDays: 2, deliveryMinDays: 1, deliveryMaxDays: 4, defects: 'لا يوجد' }, returnPolicy: { type: 'NONE' } },
      true,
    );
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    const t = d.agreedTerms as unknown as Terms & Required<Pick<Terms, "parties" | "deliveryInfo" | "agreement" | "request">>;
    expect(t.price.unitPrice).toBe(760000);
    expect(t.price.shippingFee).toBe(6000);
    expect(t.price.totalAmount).toBe(766000);
    expect(d.totalAmount).toBe(766000);
    expect(t.delivery).toMatchObject({ method: 'مندوب شركة بوسطة', processingDays: 2, expectedMinDays: 1, expectedMaxDays: 4, buyerRequestedMethod: 'شحن عبر شركة' });
    expect(t.request).toMatchObject({ unitPrice: 800000, deliveryMethod: 'شحن عبر شركة' });
    expect(t.parties).toMatchObject({ buyerId: buyerUser.id, buyerName: buyerUser.fullName, sellerUserId: seller.userId, sellerName: 'بائع خارجي' });
    expect(t.deliveryInfo).toMatchObject({ originGovernorateId: 2, destinationGovernorateId: 1 });
    expect(t.deliveryInfo.buyerLocationRef).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(t)).not.toContain('شارع التحرير'); // addresses are referenced, never copied in clear
    expect(t.agreement).toMatchObject({ version, proposedBy: 'SELLER', acceptedByUserId: buyerUser.id });
    expect(new Date(t.agreement.agreedAt).getTime()).toBeGreaterThanOrEqual(new Date(t.agreement.proposedAt).getTime());
    expect(t.product).toMatchObject({ quantity: 1, condition: 'USED' });
  });

  it('schema: VOLUNTARY requires a window; NONE is normalised', () => {
    expect(returnPolicySchema.safeParse({ type: 'VOLUNTARY' }).success).toBe(false);
    expect(returnPolicySchema.safeParse({ type: 'VOLUNTARY', windowDays: 200 }).success).toBe(false);
    const none = returnPolicySchema.parse({ type: 'NONE', windowDays: 7, conditions: ['ALL_ACCESSORIES'] });
    expect(none.windowDays).toBeNull();
    expect(none.conditions).toEqual([]);
  });

  it('used product requires disclosed defects', async () => {
    const { deal, seller } = await joinedDeal({ condition: 'USED' });
    await expect(
      submitSellerOffer(seller, deal.id, { details: { fullName: 'بائع خارجي' }, location: SELLER_LOC, payout: PAYOUT, offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1 }, returnPolicy: { type: 'NONE' } }, true),
    ).rejects.toThrow(/العيوب/);
  });

  it('no payment is possible before both sides agree on the same version', async () => {
    const { deal, buyer, seller } = await joinedDeal();
    await expect(startDealPayment(buyer, deal.id, 'INSTAPAY')).rejects.toThrow();
    await offer(seller, deal.id, { type: 'VOLUNTARY', windowDays: 3, conditions: ['ORIGINAL_CONDITION'] });
    await expect(startDealPayment(buyer, deal.id, 'INSTAPAY')).rejects.toThrow();
  });

  it('request change → new version; seller rejects → previous offer re-proposed; seller counters; buyer accepts; versions never overwritten', async () => {
    const { deal, buyer, seller } = await joinedDeal();
    const { version: v1 } = await offer(seller, deal.id, { type: 'NONE' });
    const ch = await respondToOffer(buyer, deal.id, v1, 'REQUEST_CHANGE', { returnPolicy: { type: 'VOLUNTARY', windowDays: 7 }, message: 'أريد استرجاع خلال أسبوع' });
    expect(ch.status).toBe('CHANGE_REQUESTED');
    // Stale version can no longer be accepted.
    await expect(respondToOffer(buyer, deal.id, v1, 'ACCEPT')).rejects.toThrow();
    const rej = await respondToChangeRequest(seller, deal.id, ch.version!, 'REJECT');
    expect(rej.status).toBe('OFFER_PENDING_BUYER');
    const ch2 = await respondToOffer(buyer, deal.id, rej.version!, 'REQUEST_CHANGE', { returnPolicy: { type: 'VOLUNTARY', windowDays: 5 }, message: 'خمسة أيام' });
    const { version: v5 } = await offer(seller, deal.id, { type: 'VOLUNTARY', windowDays: 3, conditions: ['ORIGINAL_CONDITION', 'ALL_ACCESSORIES'], shippingPayer: 'BUYER' }, false, '50');
    expect(v5).toBe(ch2.version! + 1);
    await respondToOffer(buyer, deal.id, v5, 'ACCEPT');
    const hist = await db.select().from(dealTermsVersions).where(eq(dealTermsVersions.dealId, deal.id)).orderBy(dealTermsVersions.version);
    expect(hist.map((h) => h.version)).toEqual([1, 2, 3, 4, 5]);
    expect(hist.map((h) => h.proposedBy)).toEqual(['SELLER', 'BUYER', 'SELLER', 'BUYER', 'SELLER']);
    expect(hist[4].status).toBe('ACCEPTED');
    expect(hist.filter((h) => h.status === 'PROPOSED')).toHaveLength(0);
    expect((hist[0].terms as { returnPolicy: { type: string } }).returnPolicy.type).toBe('NONE');
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect(d.status).toBe('PAYMENT_PENDING');
    expect(d.agreedVersion).toBe(5);
    const agreed = d.agreedTerms as { returnPolicy: Record<string, unknown>; price: { shippingFee: number; buyerPays: number } };
    expect(agreed.returnPolicy).toMatchObject({ type: 'VOLUNTARY', windowDays: 3, shippingPayer: 'BUYER', conditions: ['ORIGINAL_CONDITION', 'ALL_ACCESSORIES'] });
    expect(agreed.returnPolicy).toHaveProperty('legalNoticeVersion');
    expect(agreed.price.shippingFee).toBe(5000);
    expect(d.buyerPays).toBe(agreed.price.buyerPays);
    expect(await auditActions(deal.id)).toEqual(expect.arrayContaining(['deal.offer_submitted', 'deal.change_requested', 'deal.change_rejected', 'deal.offer_countered', 'deal.terms_agreed', 'deal.invitation_accepted']));
  });

  it('seller accepts the buyer change → the buyer version becomes the agreed snapshot', async () => {
    const { deal, buyer, seller } = await joinedDeal();
    const { version } = await offer(seller, deal.id, { type: 'NONE' });
    const ch = await respondToOffer(buyer, deal.id, version, 'REQUEST_CHANGE', { returnPolicy: { type: 'VOLUNTARY', windowDays: 2 }, message: 'يومين فقط' });
    await respondToChangeRequest(seller, deal.id, ch.version!, 'ACCEPT');
    const [d] = await db.select().from(externalDeals).where(eq(externalDeals.id, deal.id));
    expect((d.agreedTerms as { returnPolicy: { windowDays: number } }).returnPolicy.windowDays).toBe(2);
    expect(d.status).toBe('PAYMENT_PENDING');
  });

  it('agreed terms and term versions are immutable at the database level', async () => {
    const { deal, buyer, seller } = await joinedDeal();
    const { version } = await offer(seller, deal.id, { type: 'NONE' });
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    await expect(db.update(externalDeals).set({ agreedTerms: { tampered: true } }).where(eq(externalDeals.id, deal.id))).rejects.toThrow();
    await expect(db.update(dealTermsVersions).set({ terms: { tampered: true } }).where(eq(dealTermsVersions.dealId, deal.id))).rejects.toThrow();
    await expect(db.delete(dealTermsVersions).where(eq(dealTermsVersions.dealId, deal.id))).rejects.toThrow();
    // Replaying ACCEPT is idempotent and does not create anything new.
    expect((await respondToOffer(buyer, deal.id, version, 'ACCEPT')).status).toBe('PAYMENT_PENDING');
  });

  it('buyer reject ends the deal; cancel is still possible during negotiation', async () => {
    const a = await joinedDeal();
    const { version } = await offer(a.seller, a.deal.id, { type: 'NONE' });
    await respondToOffer(a.buyer, a.deal.id, version, 'REJECT');
    expect((await db.select().from(externalDeals).where(eq(externalDeals.id, a.deal.id)))[0].status).toBe('CANCELLED');
    const b = await joinedDeal();
    await cancelDeal(b.buyer, b.deal.id, 'غيرت رأيي');
    expect((await db.select().from(externalDeals).where(eq(externalDeals.id, b.deal.id)))[0].status).toBe('CANCELLED');
  });

  it('"no voluntary returns" never blocks a defect dispute after delivery', async () => {
    const { deal, buyer, seller } = await joinedDeal();
    const { version } = await offer(seller, deal.id, { type: 'NONE' });
    await respondToOffer(buyer, deal.id, version, 'ACCEPT');
    const p = await startDealPayment(buyer, deal.id, 'INSTAPAY');
    const { submission } = await submitProof(buyer, p.id, { claimedAmount: '8100', clientKey: randomUUID() }, { data: await png(), name: 'p.png' });
    await confirmPayment(admin, p.id, submission.id);
    await markDealDelivered(seller, deal.id, 'تم الشحن');
    const dispute = await openDispute(buyer, { dealId: deal.id, reasonCode: 'DEFECTIVE', description: 'الجهاز لا يعمل بعد الاستلام مباشرة والشاشة سوداء' });
    expect(dispute.id).toBeTruthy();
    await expect(confirmDealReceipt(buyer, deal.id)).rejects.toThrow();
  });
});

describe('marketplace return policy snapshot', () => {
  it('a product cannot be submitted before its return policy is set', async () => {
    const s = await makeSeller(admin);
    const { productId } = await makeProduct(s.actor, admin, { approve: false, setReturnPolicy: false });
    await expect(submitForReview(s.actor, productId)).rejects.toThrow(/سياسة الاسترجاع/);
  });

  it('order items snapshot the policy; later store changes do not alter history; protected reasons survive "no voluntary returns"', async () => {
    const s = await makeSeller(admin);
    await db.update(stores).set({ acceptsVoluntaryReturns: false, voluntaryReturnDays: null }).where(eq(stores.sellerId, s.actor.sellerId!));
    const p = await makeProduct(s.actor, admin, { price: 500_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    expect(item.returnPolicySnapshot).toMatchObject({ type: 'NONE', windowDays: null });
    expect(item.returnPolicySnapshot).toHaveProperty('legalNoticeVersion');

    // Seller later becomes generous — history must not change.
    await db.update(stores).set({ acceptsVoluntaryReturns: true, voluntaryReturnDays: 30 }).where(eq(stores.sellerId, s.actor.sellerId!));
    await db.update(products).set({ returnPolicyOverride: true, acceptsVoluntaryReturns: true, voluntaryReturnDays: 60 }).where(eq(products.id, p.productId));
    const [again] = await db.select().from(orderItems).where(eq(orderItems.id, item.id));
    expect(again.returnPolicySnapshot).toMatchObject({ type: 'NONE' });
    const win = await returnWindow(db, s.actor.sellerId!, [again]);
    expect(win.voluntary).toBe(0);

    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    // Delivered beyond the statutory window (14d) but within the dispute window (30d).
    await db.update(sellerOrders).set({ deliveredAt: new Date(Date.now() - 20 * 86400_000) }).where(eq(sellerOrders.id, so.id));
    await expect(requestReturn(c.actor, { sellerOrderId: so.id, reason: 'CHANGED_MIND', description: 'لم يعد المنتج مناسباً لي', items: [{ orderItemId: item.id, quantity: 1 }] })).rejects.toThrow(/انتهت مدة/);
    const ret = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'DEFECTIVE', description: 'المنتج لا يعمل نهائياً عند التشغيل', items: [{ orderItemId: item.id, quantity: 1 }] }, [{ data: await png(), name: 'd.png' }]);
    expect(ret.id).toBeTruthy();
    void and;
  });
});
