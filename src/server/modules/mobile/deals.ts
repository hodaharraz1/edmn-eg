import { asc, eq } from 'drizzle-orm';
import { requireUser, type Actor } from '@/server/core/actor';
import { forbidden } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { dealTermsVersions } from '@/server/db/schema';
import { dealAllowedActions, type DealRole } from '@/server/modules/allowed-actions';
import {
  addDealPhotos,
  cancelDeal,
  claimInvitation,
  confirmDealReceipt,
  createDeal,
  dealGraph,
  dealRef,
  dealsForUser,
  inviteSeller,
  markDealDelivered,
  refreshInvitation,
  regenerateDeliveryOtp,
  rejectInvitation,
  reportNotReceived,
  respondToChangeRequest,
  respondToOffer,
  revealDeliveryOtpForBuyer,
  revokeInvitation,
  saveDealStep,
  startDealPayment,
  submitSellerOffer,
  verifyDeliveryOtp,
} from '@/server/modules/deals/service';

type Upload = { data: Buffer; name: string };

/**
 * Protected Deal (أضمن صفقة) for the Customer App — an escrow between two parties OUTSIDE the marketplace. The buyer
 * creates the deal and invites the seller by link; the seller joins, makes an offer; both agree; the buyer pays
 * (manual transfer reviewed by EDMN); the seller ships; the buyer gives the delivery code / confirms receipt; EDMN
 * releases or refunds. The app never releases or refunds money — those are staff (Maker/Checker) actions.
 */

export async function myDeals(actor: Actor) {
  const userId = requireUser(actor);
  const rows = await dealsForUser(userId);
  return {
    items: rows.map((d) => ({
      id: d.id,
      ref: dealRef(d.number),
      title: d.title,
      status: d.status,
      role: (d.buyerId === userId ? 'BUYER' : 'SELLER') as DealRole,
      counterparty: d.buyerId === userId ? (d.sellerFullName ?? d.sellerName ?? null) : null,
      totalPiastres: d.buyerPays ?? d.totalAmount ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

/** Full deal view for one party: terms, money breakdown (server), timeline data and allowed actions. */
export async function dealView(actor: Actor, dealId: string) {
  const g = await dealGraph(actor, dealId);
  if (g.role === 'ADMIN') throw forbidden(); // staff use the admin console, not the Customer App
  const d = g.deal;
  const role = g.role as 'BUYER' | 'SELLER';
  const versions = await db.select().from(dealTermsVersions).where(eq(dealTermsVersions.dealId, d.id)).orderBy(asc(dealTermsVersions.version));
  const latest = versions.at(-1) ?? null;
  const loc = (l: typeof g.buyerLocation) => (l ? { governorateId: l.governorateId, city: l.city, street: l.street, building: l.building ?? null, landmark: l.landmark ?? null } : null);
  return {
    id: d.id,
    ref: g.ref,
    role,
    status: d.status,
    wizardStep: d.wizardStep,
    title: d.title,
    description: d.description,
    condition: d.condition,
    quantity: d.quantity,
    sourceUrl: d.sourceUrl,
    deliveryMethod: d.deliveryMethod,
    deliveryDeadline: d.deliveryDeadline?.toISOString() ?? null,
    inspectionDays: d.inspectionDays,
    customTerms: d.customTerms,
    buyerName: g.buyerName,
    sellerName: d.sellerFullName ?? null,
    /** Server-computed money (piastres). Null until the seller's offer sets the price. */
    money: {
      unitPricePiastres: d.unitPrice ?? null,
      shippingFeePiastres: d.shippingFee ?? null,
      totalPiastres: d.totalAmount ?? null,
      buyerFeePiastres: d.buyerFeeAmount ?? null,
      sellerFeePiastres: d.sellerFeeAmount ?? null,
      buyerPaysPiastres: d.buyerPays ?? null,
      sellerReceivesPiastres: d.sellerReceives ?? null,
    },
    terms: {
      currentVersion: latest?.version ?? null,
      latestStatus: latest?.status ?? null,
      latestProposedBy: latest?.proposedBy ?? null,
      latestMessage: latest?.message ?? null,
      history: versions.map((v) => ({ version: v.version, proposedBy: v.proposedBy, status: v.status, message: v.message, createdAt: v.createdAt.toISOString(), terms: (v.terms ?? {}) as Record<string, unknown> })),
    },
    payment: g.payment ? { id: g.payment.id, status: g.payment.status, amountDuePiastres: g.payment.amountDue, isTest: g.payment.isTest } : null,
    evidenceCount: g.evidence.length,
    payout: g.payout && role === 'SELLER' ? { status: g.payout.status } : null,
    buyerLocation: loc(g.buyerLocation),
    sellerLocation: loc(g.sellerLocation),
    handoverVerified: !!d.handoverVerifiedAt,
    buyerResponseDueAt: d.buyerResponseDueAt?.toISOString() ?? null,
    financialHold: !!d.financialHold,
    createdAt: d.createdAt.toISOString(),
    allowedActions: dealAllowedActions({ status: d.status, role, handoverVerified: !!d.handoverVerifiedAt }),
  };
}

export async function newDeal(actor: Actor, input: Parameters<typeof createDeal>[1]) {
  const d = await createDeal(actor, input);
  return dealView(actor, d.id);
}

export async function saveStep(actor: Actor, dealId: string, step: number, input: Record<string, unknown>) {
  await saveDealStep(actor, dealId, step, input);
  return dealView(actor, dealId);
}

export async function addPhotos(actor: Actor, dealId: string, photos: Upload[]) {
  await addDealPhotos(actor, dealId, photos);
  return dealView(actor, dealId);
}

/** The invitation link is a bearer secret the BUYER shares with the seller; returned once, to the buyer only. */
export async function invite(actor: Actor, dealId: string) {
  const r = await inviteSeller(actor, dealId, true);
  return { link: r.link, deal: await dealView(actor, dealId) };
}

export async function refreshInvite(actor: Actor, dealId: string) {
  const r = await refreshInvitation(actor, dealId);
  return { link: r.link, deal: await dealView(actor, dealId) };
}

export async function revokeInvite(actor: Actor, dealId: string) {
  await revokeInvitation(actor, dealId);
  return dealView(actor, dealId);
}

/** The seller opens the link and joins the deal (token from the link; never stored by the app). */
export async function claim(actor: Actor, token: string) {
  const r = (await claimInvitation(actor, token)) as { id?: string; dealId?: string } | string | undefined;
  const dealId = typeof r === 'string' ? r : (r?.dealId ?? r?.id);
  if (!dealId) throw forbidden();
  return dealView(actor, dealId);
}

export async function declineInvitation(actor: Actor, dealId: string, reason: string) {
  await rejectInvitation(actor, { dealId }, reason);
  return myDeals(actor);
}

export async function offer(actor: Actor, dealId: string, input: Parameters<typeof submitSellerOffer>[2]) {
  await submitSellerOffer(actor, dealId, input, true);
  return dealView(actor, dealId);
}

export async function answerOffer(actor: Actor, dealId: string, version: number, decision: 'ACCEPT' | 'REQUEST_CHANGE' | 'REJECT', change?: { returnPolicy: unknown; message: string }) {
  await respondToOffer(actor, dealId, version, decision, change);
  return dealView(actor, dealId);
}

export async function answerChangeRequest(actor: Actor, dealId: string, version: number, decision: 'ACCEPT' | 'REJECT') {
  await respondToChangeRequest(actor, dealId, version, decision);
  return dealView(actor, dealId);
}

export async function cancel(actor: Actor, dealId: string, reason: string) {
  await cancelDeal(actor, dealId, reason);
  return dealView(actor, dealId);
}

/** Opens (or returns) the deal's manual payment; the app then uses the shared payment screen / receipt upload. */
export async function pay(actor: Actor, dealId: string, method: 'BANK_TRANSFER' | 'INSTAPAY' | 'VODAFONE_CASH') {
  const p = await startDealPayment(actor, dealId, method);
  return { paymentId: (p as { id: string }).id, deal: await dealView(actor, dealId) };
}

export async function shipped(actor: Actor, dealId: string, note: string, proof: Upload[]) {
  await markDealDelivered(actor, dealId, note, proof);
  return dealView(actor, dealId);
}

/** Buyer-only: the current delivery code to give the seller at handover (expiry and attempts from the server). */
export async function deliveryCode(actor: Actor, dealId: string) {
  const r = await revealDeliveryOtpForBuyer(actor, dealId);
  return r ? { available: true, code: r.code, expiresAt: r.expiresAt.toISOString(), attemptsLeft: r.attemptsLeft } : { available: false, code: null, expiresAt: null, attemptsLeft: null };
}

export async function newDeliveryCode(actor: Actor, dealId: string) {
  await regenerateDeliveryOtp(actor, dealId);
  return dealView(actor, dealId);
}

/** Seller enters the code the buyer gives at handover (expiry, attempt limit and single use enforced by the service). */
export async function verifyCode(actor: Actor, dealId: string, code: string) {
  await verifyDeliveryOtp(actor, dealId, code);
  return dealView(actor, dealId);
}

export async function confirmReceived(actor: Actor, dealId: string) {
  await confirmDealReceipt(actor, dealId);
  return dealView(actor, dealId);
}

export async function notReceived(actor: Actor, dealId: string, description: string) {
  await reportNotReceived(actor, dealId, description);
  return dealView(actor, dealId);
}
