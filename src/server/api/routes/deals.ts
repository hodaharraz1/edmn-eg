import { z } from 'zod';
import { step1Schema } from '@/server/modules/deals/service';
import {
  addPhotos,
  answerChangeRequest,
  answerOffer,
  cancel,
  claim,
  confirmReceived,
  dealView,
  declineInvitation,
  deliveryCode,
  invite,
  myDeals,
  newDeal,
  newDeliveryCode,
  notReceived,
  offer,
  pay,
  refreshInvite,
  revokeInvite,
  saveStep,
  shipped,
  verifyCode,
} from '@/server/modules/mobile/deals';
import { defineRoute } from '../http';
import { isoDateTime, piastres, uuid } from '../schemas';

/**
 * Protected Deal routes. The caller's role (buyer / seller) is derived from the session and the deal; every action
 * is checked by the deal service and listed in `allowedActions` first. No route releases or refunds money.
 */
const tags = ['Protected Deal'];
const base = { api: 'mobile' as const, auth: 'customer' as const, tags };
const errors = ['forbidden' as const, 'not_found' as const, 'invalid_state' as const];

const deal = z
  .object({
    id: uuid,
    ref: z.string(),
    role: z.enum(['BUYER', 'SELLER']),
    status: z.string(),
    wizardStep: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
    condition: z.string().nullable(),
    quantity: z.number().int(),
    sourceUrl: z.string().nullable(),
    deliveryMethod: z.string().nullable(),
    deliveryDeadline: isoDateTime.nullable(),
    inspectionDays: z.number().int().nullable(),
    customTerms: z.string().nullable(),
    buyerName: z.string(),
    sellerName: z.string().nullable(),
    money: z.object({
      unitPricePiastres: piastres.nullable(),
      shippingFeePiastres: piastres.nullable(),
      totalPiastres: piastres.nullable(),
      buyerFeePiastres: piastres.nullable(),
      sellerFeePiastres: piastres.nullable(),
      buyerPaysPiastres: piastres.nullable(),
      sellerReceivesPiastres: piastres.nullable(),
    }),
    terms: z.object({
      currentVersion: z.number().int().nullable(),
      latestStatus: z.string().nullable(),
      latestProposedBy: z.string().nullable(),
      latestMessage: z.string().nullable(),
      history: z.array(z.object({ version: z.number().int(), proposedBy: z.string(), status: z.string(), message: z.string().nullable(), createdAt: isoDateTime, terms: z.record(z.string(), z.unknown()) })),
    }),
    payment: z.object({ id: uuid, status: z.string(), amountDuePiastres: piastres, isTest: z.boolean() }).nullable(),
    evidenceCount: z.number().int(),
    payout: z.object({ status: z.string() }).nullable(),
    buyerLocation: z.object({ governorateId: z.number().int(), city: z.string(), street: z.string(), building: z.string().nullable(), landmark: z.string().nullable() }).nullable(),
    sellerLocation: z.object({ governorateId: z.number().int(), city: z.string(), street: z.string(), building: z.string().nullable(), landmark: z.string().nullable() }).nullable(),
    handoverVerified: z.boolean(),
    buyerResponseDueAt: isoDateTime.nullable(),
    financialHold: z.boolean(),
    createdAt: isoDateTime,
    allowedActions: z.array(z.string()),
  })
  .meta({ id: 'ProtectedDeal' });

const dealsList = z.object({
  items: z.array(
    z.object({ id: uuid, ref: z.string(), title: z.string(), status: z.string(), role: z.enum(['BUYER', 'SELLER', 'NONE']), counterparty: z.string().nullable(), totalPiastres: piastres.nullable(), createdAt: isoDateTime }),
  ),
});
const id = z.object({ dealId: uuid });
const reason = z.object({ reason: z.string().trim().min(5).max(1000) });

export const listDeals = defineRoute({ ...base, id: 'listDeals', method: 'GET', path: '/api/v1/deals', summary: 'My protected deals (as buyer or seller)', rate: 'read', response: dealsList, handler: ({ actor }) => myDeals(actor!) });

export const createDealRoute = defineRoute({
  ...base,
  id: 'createDeal',
  method: 'POST',
  path: '/api/v1/deals',
  summary: 'Start a protected deal as the buyer (step 1: item)',
  description: 'Needs SMS delivery for the delivery code: when the server cannot send SMS the request is refused (invalid_state) instead of creating a deal that cannot complete.',
  rate: 'write',
  idempotency: 'required',
  status: 201,
  errors,
  body: step1Schema,
  response: deal,
  handler: ({ actor, body }) => newDeal(actor!, body),
});

export const getDeal = defineRoute({ ...base, id: 'getDeal', method: 'GET', path: '/api/v1/deals/{dealId}', summary: 'One deal (timeline, terms, money, allowed actions)', rate: 'read', errors, params: id, response: deal, handler: ({ actor, params }) => dealView(actor!, params.dealId) });

export const saveDealStepRoute = defineRoute({
  ...base,
  id: 'saveDealStep',
  method: 'PUT',
  path: '/api/v1/deals/{dealId}/steps/{step}',
  summary: 'Save a draft step: 1 item · 2 price · 3 delivery · 4 terms · 5 buyer location (+ optional seller hints)',
  rate: 'write',
  errors,
  params: z.object({ dealId: uuid, step: z.coerce.number().int().min(1).max(5) }),
  body: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  response: deal,
  handler: ({ actor, params, body }) => saveStep(actor!, params.dealId, params.step, body),
});

export const addDealPhotosRoute = defineRoute({
  ...base,
  id: 'addDealPhotos',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/photos',
  summary: 'Add item photos (buyer, before the seller joins)',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: id,
  multipart: { files: { photos: { max: 8, required: true } } },
  response: deal,
  handler: ({ actor, params, files }) => addPhotos(actor!, params.dealId, files.photos!),
});

const inviteOut = z.object({ link: z.string().meta({ description: 'Bearer link for the seller — show / share it, never log it.' }), deal });

export const inviteDealSeller = defineRoute({
  ...base,
  id: 'inviteDealSeller',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/invitation',
  summary: 'Accept the protected-deal terms and create the invitation link for the seller',
  description: 'Not idempotency-cached on purpose: the response carries a bearer link that must never be stored server-side. A retry issues a new link and revokes the previous one.',
  rate: 'sensitive',
  errors,
  params: id,
  body: z.object({ acceptTerms: z.literal(true) }),
  response: inviteOut,
  handler: ({ actor, params }) => invite(actor!, params.dealId),
});

export const refreshDealInvitation = defineRoute({ ...base, id: 'refreshDealInvitation', method: 'POST', path: '/api/v1/deals/{dealId}/invitation/refresh', summary: 'Issue a new invitation link (old one stops working; never idempotency-cached)', rate: 'sensitive', errors, params: id, response: inviteOut, handler: ({ actor, params }) => refreshInvite(actor!, params.dealId) });

export const revokeDealInvitation = defineRoute({ ...base, id: 'revokeDealInvitation', method: 'POST', path: '/api/v1/deals/{dealId}/invitation/revoke', summary: 'Revoke the invitation link (deal returns to draft)', rate: 'write', idempotency: 'required', errors, params: id, response: deal, handler: ({ actor, params }) => revokeInvite(actor!, params.dealId) });

export const claimDealInvitation = defineRoute({
  ...base,
  id: 'claimDealInvitation',
  method: 'POST',
  path: '/api/v1/deal-invitations/claim',
  summary: 'Seller: join the deal from the invitation link token',
  rate: 'sensitive',
  errors,
  body: z.object({ token: z.string().min(20).max(200) }),
  response: deal,
  handler: ({ actor, body }) => claim(actor!, body.token),
});

export const declineDealInvitation = defineRoute({ ...base, id: 'declineDealInvitation', method: 'POST', path: '/api/v1/deals/{dealId}/decline', summary: 'Seller: decline the deal after joining', rate: 'write', idempotency: 'required', errors, params: id, body: reason, response: dealsList, handler: ({ actor, params, body }) => declineInvitation(actor!, params.dealId, body.reason) });

export const submitDealOffer = defineRoute({
  ...base,
  id: 'submitDealOffer',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/offer',
  summary: 'Seller: offer price, delivery, defects, return policy (first offer also needs details, pickup location and payout account)',
  description: 'Requires a verified phone and an approved identity (server-checked). The payout account is verified by EDMN before any payout.',
  rate: 'sensitive',
  idempotency: 'required',
  errors: [...errors, 'identity_required'],
  params: id,
  body: z.object({
    details: z.object({ fullName: z.string(), contactEmail: z.string().optional() }).optional(),
    location: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    payout: z.record(z.string(), z.string()).optional(),
    offer: z.record(z.string(), z.union([z.string(), z.number()])),
    returnPolicy: z.record(z.string(), z.unknown()),
    message: z.string().max(1000).optional(),
    acceptTerms: z.literal(true),
  }),
  response: deal,
  handler: ({ actor, params, body }) =>
    offer(actor!, params.dealId, {
      details: body.details,
      location: body.location,
      payout: body.payout as never,
      offer: body.offer as never,
      returnPolicy: body.returnPolicy,
      message: body.message,
    }),
});

export const respondDealOffer = defineRoute({
  ...base,
  id: 'respondDealOffer',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/offer-response',
  summary: 'Buyer: accept, request a change, or reject the seller offer (version = the terms version seen)',
  rate: 'write',
  idempotency: 'required',
  errors: [...errors, 'conflict', 'identity_required'],
  params: id,
  body: z.object({ version: z.number().int().min(1), decision: z.enum(['ACCEPT', 'REQUEST_CHANGE', 'REJECT']), change: z.object({ returnPolicy: z.record(z.string(), z.unknown()), message: z.string().max(1000) }).optional() }),
  response: deal,
  handler: ({ actor, params, body }) => answerOffer(actor!, params.dealId, body.version, body.decision, body.change),
});

export const respondDealChange = defineRoute({
  ...base,
  id: 'respondDealChangeRequest',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/change-response',
  summary: "Seller: accept or reject the buyer's requested change (re-approval of material terms)",
  rate: 'write',
  idempotency: 'required',
  errors: [...errors, 'conflict'],
  params: id,
  body: z.object({ version: z.number().int().min(1), decision: z.enum(['ACCEPT', 'REJECT']) }),
  response: deal,
  handler: ({ actor, params, body }) => answerChangeRequest(actor!, params.dealId, body.version, body.decision),
});

export const cancelDealRoute = defineRoute({ ...base, id: 'cancelDeal', method: 'POST', path: '/api/v1/deals/{dealId}/cancel', summary: 'Buyer: cancel before the deal is paid', rate: 'write', idempotency: 'required', errors, params: id, body: reason, response: deal, handler: ({ actor, params, body }) => cancel(actor!, params.dealId, body.reason) });

export const startDealPaymentRoute = defineRoute({
  ...base,
  id: 'startDealPayment',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/payment',
  summary: 'Buyer: open the manual payment (then upload the receipt via /payments/{id}/proof)',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: id,
  body: z.object({ method: z.enum(['BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH']) }),
  response: z.object({ paymentId: uuid, deal }),
  handler: ({ actor, params, body }) => pay(actor!, params.dealId, body.method),
});

export const markDealShipped = defineRoute({
  ...base,
  id: 'markDealShipped',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/shipped',
  summary: 'Seller: mark as shipped / handed over with proof (issues the buyer delivery code)',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: id,
  multipart: { files: { proof: { max: 5 } } },
  body: z.object({ note: z.string().trim().min(3).max(1000) }),
  response: deal,
  handler: ({ actor, params, body, files }) => shipped(actor!, params.dealId, body.note, files.proof ?? []),
});

export const getDealDeliveryCode = defineRoute({
  ...base,
  id: 'getDealDeliveryCode',
  method: 'GET',
  path: '/api/v1/deals/{dealId}/delivery-code',
  summary: 'Buyer only: the current delivery code to give the seller at handover (single use, expiring)',
  rate: 'sensitive',
  errors,
  params: id,
  response: z.object({ available: z.boolean(), code: z.string().nullable(), expiresAt: isoDateTime.nullable(), attemptsLeft: z.number().int().nullable() }),
  handler: ({ actor, params }) => deliveryCode(actor!, params.dealId),
});

export const regenerateDealDeliveryCode = defineRoute({ ...base, id: 'regenerateDealDeliveryCode', method: 'POST', path: '/api/v1/deals/{dealId}/delivery-code/regenerate', summary: 'Issue a new delivery code (rate-limited; lifetime guess cap)', rate: 'sensitive', idempotency: 'required', errors: [...errors, 'rate_limited'], params: id, response: deal, handler: ({ actor, params }) => newDeliveryCode(actor!, params.dealId) });

export const verifyDealDeliveryCode = defineRoute({
  ...base,
  id: 'verifyDealDeliveryCode',
  method: 'POST',
  path: '/api/v1/deals/{dealId}/delivery-code/verify',
  summary: 'Seller: enter the code the buyer gave at handover',
  rate: 'sensitive',
  errors: [...errors, 'rate_limited'],
  params: id,
  body: z.object({ code: z.string().regex(/^\d{4,8}$/) }),
  response: deal,
  handler: ({ actor, params, body }) => verifyCode(actor!, params.dealId, body.code),
});

export const confirmDealReceiptRoute = defineRoute({ ...base, id: 'confirmDealReceipt', method: 'POST', path: '/api/v1/deals/{dealId}/confirm-receipt', summary: 'Buyer: I received and accept the item (release is then decided by EDMN)', rate: 'write', idempotency: 'required', errors, params: id, response: deal, handler: ({ actor, params }) => confirmReceived(actor!, params.dealId) });

export const reportDealNotReceived = defineRoute({ ...base, id: 'reportDealNotReceived', method: 'POST', path: '/api/v1/deals/{dealId}/not-received', summary: 'Buyer: report the item was not received (opens a case; funds stay held)', rate: 'write', idempotency: 'required', errors, params: id, body: z.object({ description: z.string().trim().min(10).max(2000) }), response: deal, handler: ({ actor, params, body }) => notReceived(actor!, params.dealId, body.description) });

export const dealRoutes = [
  listDeals, createDealRoute, getDeal, saveDealStepRoute, addDealPhotosRoute, inviteDealSeller, refreshDealInvitation, revokeDealInvitation, claimDealInvitation, declineDealInvitation,
  submitDealOffer, respondDealOffer, respondDealChange, cancelDealRoute, startDealPaymentRoute, markDealShipped, getDealDeliveryCode, regenerateDealDeliveryCode, verifyDealDeliveryCode,
  confirmDealReceiptRoute, reportDealNotReceived,
];
