import { z } from 'zod';
import {
  createDispute,
  createReturn,
  disputeReply,
  disputeView,
  DISPUTE_REASONS,
  escalate,
  myDisputes,
  myReturns,
  RETURN_REASONS,
  returnOptions,
  returnView,
  reviewOptions,
  reviewProduct,
  reviewSeller,
  shipBack,
  storeDisputes,
  storeReturns,
  storeReturnStep,
} from '@/server/modules/mobile/postpurchase';
import { defineRoute } from '../http';
import { isoDateTime, piastres, uuid } from '../schemas';

/**
 * Returns, disputes and reviews. Buyer routes run as the session customer; store routes as the session user's store
 * membership (returns.manage / orders.manage). A return acceptance or a dispute decision only REQUESTS a refund — EDMN
 * finance approves and pays it in the admin console; dispute decisions are made only there.
 */
const errors = ['forbidden' as const, 'not_found' as const, 'invalid_state' as const];
const customer = { api: 'mobile' as const, auth: 'customer' as const };
const store = { api: 'mobile' as const, auth: 'seller' as const };

const refundOut = z.object({ id: uuid, status: z.string(), amountPiastres: piastres, reference: z.string().nullable() });

/* ───────── Returns ───────── */

const returnOut = z.object({
  id: uuid,
  number: z.string(),
  status: z.string(),
  side: z.enum(['BUYER', 'STORE']),
  reason: z.string(),
  description: z.string(),
  orderLabel: z.string(),
  orderId: uuid,
  sellerOrderId: uuid,
  storeName: z.string().nullable(),
  createdAt: isoDateTime,
  items: z.array(z.object({ orderItemId: uuid, title: z.string(), variantLabel: z.string(), quantity: z.number().int(), unitPricePiastres: piastres })),
  evidence: z.array(z.object({ fileId: uuid, mimeType: z.string() })),
  decisionReason: z.string().nullable(),
  returnCarrier: z.string().nullable(),
  returnTracking: z.string().nullable(),
  shipBackTo: z.object({ address: z.string(), governorateId: z.number().int().nullable(), shippingPayer: z.string() }).nullable(),
  refundAmountPiastres: piastres.nullable(),
  refunds: z.array(refundOut),
  disputeId: uuid.nullable(),
  allowedActions: z.array(z.string()),
}).meta({ id: 'ReturnCase' });
const returnRow = z.object({ id: uuid, number: z.string(), status: z.string(), reason: z.string(), refundAmountPiastres: piastres.nullable(), createdAt: isoDateTime }).meta({ id: 'ReturnSummary' });
const rid = z.object({ returnId: uuid });
const soid = z.object({ sellerOrderId: uuid });

export const getReturnOptions = defineRoute({
  ...customer,
  tags: ['Returns'],
  id: 'getReturnOptions',
  method: 'GET',
  path: '/api/v1/seller-orders/{sellerOrderId}/return-options',
  summary: 'What can be returned now: returnable units, the policy windows and deadline, reasons and which need photos',
  rate: 'read',
  errors,
  params: soid,
  response: z.object({
    eligible: z.boolean(),
    blockReason: z.enum(['NOT_DELIVERED', 'WINDOW_CLOSED', 'NOTHING_RETURNABLE']).nullable(),
    window: z.object({ statutoryDays: z.number().int(), voluntaryDays: z.number().int(), effectiveDays: z.number().int(), disputeDays: z.number().int(), deliveredAt: isoDateTime.nullable(), deadline: isoDateTime.nullable(), protectedDeadline: isoDateTime.nullable() }),
    reasons: z.array(z.object({ code: z.enum(RETURN_REASONS), requiresEvidence: z.boolean(), protected: z.boolean(), available: z.boolean() })),
    items: z.array(z.object({ orderItemId: uuid, title: z.string(), variantLabel: z.string(), unitPricePiastres: piastres, quantity: z.number().int(), returnableQuantity: z.number().int() })),
    returnShippingPayer: z.string(),
  }),
  handler: ({ actor, params }) => returnOptions(actor!, params.sellerOrderId),
});

export const createReturnRoute = defineRoute({
  ...customer,
  tags: ['Returns'],
  id: 'createReturn',
  method: 'POST',
  path: '/api/v1/returns',
  summary: 'Request a return of delivered units (photos required for damaged / defective / wrong / not-as-described)',
  rate: 'sensitive',
  idempotency: 'required',
  errors: [...errors, 'validation_failed' as const],
  multipart: { files: { evidence: { max: 6 } } },
  body: z.object({
    sellerOrderId: uuid,
    reason: z.enum(RETURN_REASONS),
    description: z.string().trim().min(10).max(2000),
    items: z
      .string()
      .max(4000)
      .meta({ description: 'JSON array of {orderItemId, quantity}' }),
  }),
  response: returnOut,
  handler: ({ actor, body, files }) => {
    let items: { orderItemId: string; quantity: number }[];
    try {
      items = z.array(z.object({ orderItemId: uuid, quantity: z.number().int().positive() })).min(1).max(50).parse(JSON.parse(body.items));
    } catch {
      items = [];
    }
    return createReturn(actor!, { sellerOrderId: body.sellerOrderId, reason: body.reason, description: body.description, items }, files.evidence ?? []);
  },
});

export const listMyReturns = defineRoute({ ...customer, tags: ['Returns'], id: 'listMyReturns', method: 'GET', path: '/api/v1/returns', summary: 'My return requests', rate: 'read', errors, response: z.object({ items: z.array(returnRow) }), handler: ({ actor }) => myReturns(actor!) });

export const getMyReturn = defineRoute({ ...customer, tags: ['Returns'], id: 'getMyReturn', method: 'GET', path: '/api/v1/returns/{returnId}', summary: 'One of my returns: status, store decision, ship-back address, refund state', rate: 'read', errors, params: rid, response: returnOut, handler: ({ actor, params }) => returnView(actor!, params.returnId) });

export const shipBackReturn = defineRoute({
  ...customer,
  tags: ['Returns'],
  id: 'shipBackReturn',
  method: 'POST',
  path: '/api/v1/returns/{returnId}/ship-back',
  summary: 'I sent the item back (carrier and tracking)',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: rid,
  body: z.object({ carrier: z.string().trim().min(2).max(80), tracking: z.string().trim().max(80).optional().default('') }),
  response: returnOut,
  handler: ({ actor, params, body }) => shipBack(actor!, params.returnId, body.carrier, body.tracking),
});

export const escalateMyReturn = defineRoute({
  ...customer,
  tags: ['Returns', 'Disputes'],
  id: 'escalateMyReturn',
  method: 'POST',
  path: '/api/v1/returns/{returnId}/escalate',
  summary: 'Escalate a rejected return to an EDMN dispute',
  rate: 'sensitive',
  idempotency: 'required',
  errors: [...errors, 'conflict' as const],
  params: rid,
  body: z.object({ description: z.string().trim().min(10).max(2000) }),
  response: z.object({ disputeId: uuid }).meta({ id: 'EscalatedReturn' }),
  handler: ({ actor, params, body }) => escalate(actor!, params.returnId, body.description),
});

export const listStoreReturns = defineRoute({ ...store, tags: ['Returns', 'Seller'], id: 'listStoreReturns', method: 'GET', path: '/api/v1/seller/returns', summary: "The store's return requests (returns.manage)", rate: 'read', errors, response: z.object({ items: z.array(returnRow) }), handler: ({ actor }) => storeReturns(actor!) });

export const getStoreReturn = defineRoute({ ...store, tags: ['Returns', 'Seller'], id: 'getStoreReturn', method: 'GET', path: '/api/v1/seller/returns/{returnId}', summary: 'One return of the store with the steps allowed now', rate: 'read', errors, params: rid, response: returnOut, handler: ({ actor, params }) => returnView(actor!, params.returnId) });

export const storeReturnStepRoute = defineRoute({
  ...store,
  tags: ['Returns', 'Seller'],
  id: 'runStoreReturnStep',
  method: 'POST',
  path: '/api/v1/seller/returns/{returnId}/steps',
  summary: 'Store step on a return (must be in allowedActions). ACCEPT only REQUESTS the refund for the returned units.',
  rate: 'write',
  idempotency: 'required',
  errors: [...errors, 'validation_failed' as const],
  params: rid,
  body: z.object({
    step: z.enum(['APPROVE', 'REJECT', 'MARK_RECEIVED', 'START_INSPECTION', 'ACCEPT']),
    note: z.string().trim().max(1000).optional(),
    reason: z.string().trim().max(1000).optional(),
    includeShipping: z.boolean().optional(),
    restock: z.boolean().optional(),
  }),
  response: returnOut,
  handler: ({ actor, params, body }) => storeReturnStep(actor!, params.returnId, body.step, body),
});

export const escalateStoreReturn = defineRoute({
  ...store,
  tags: ['Returns', 'Disputes', 'Seller'],
  id: 'escalateStoreReturn',
  method: 'POST',
  path: '/api/v1/seller/returns/{returnId}/escalate',
  summary: 'Store: the inspection failed / the claim is contested — escalate to an EDMN dispute',
  rate: 'sensitive',
  idempotency: 'required',
  errors: [...errors, 'conflict' as const],
  params: rid,
  body: z.object({ description: z.string().trim().min(10).max(2000) }),
  response: z.object({ disputeId: uuid }).meta({ id: 'EscalatedReturn' }),
  handler: ({ actor, params, body }) => escalate(actor!, params.returnId, body.description),
});

/* ───────── Disputes ───────── */

const disputeOut = z.object({
  id: uuid,
  number: z.string(),
  status: z.string(),
  role: z.enum(['CLAIMANT', 'RESPONDENT']),
  context: z.object({ kind: z.enum(['ORDER', 'DEAL']), id: uuid, orderId: uuid.nullable(), ref: z.string() }),
  reasonCode: z.string(),
  description: z.string(),
  claimedAmountPiastres: piastres.nullable(),
  createdAt: isoDateTime,
  returnId: uuid.nullable(),
  messages: z.array(z.object({ id: uuid, from: z.enum(['CLAIMANT', 'RESPONDENT', 'EDMN']), mine: z.boolean(), body: z.string(), createdAt: isoDateTime })),
  evidence: z.array(z.object({ fileId: uuid, mimeType: z.string(), mine: z.boolean(), note: z.string().nullable(), createdAt: isoDateTime })),
  decision: z.object({ code: z.string(), amountPiastres: piastres.nullable(), note: z.string().nullable(), decidedAt: isoDateTime.nullable() }).nullable(),
  refunds: z.array(refundOut),
  fundsFrozen: z.boolean(),
  allowedActions: z.array(z.enum(['REPLY', 'ADD_EVIDENCE'])),
}).meta({ id: 'DisputeCase' });
const disputeRow = z.object({ id: uuid, number: z.string(), status: z.string(), role: z.enum(['CLAIMANT', 'RESPONDENT']), kind: z.enum(['ORDER', 'DEAL']), reasonCode: z.string(), decision: z.string().nullable(), createdAt: isoDateTime }).meta({ id: 'DisputeSummary' });
const did = z.object({ disputeId: uuid });
const replyBody = z.object({ body: z.string().trim().min(2).max(4000) });

export const openDisputeRoute = defineRoute({
  ...customer,
  tags: ['Disputes'],
  id: 'openDispute',
  method: 'POST',
  path: '/api/v1/disputes',
  summary: 'Open a dispute on one of my seller orders or protected deals (the related funds stay frozen until EDMN decides)',
  rate: 'sensitive',
  idempotency: 'required',
  errors: [...errors, 'conflict' as const, 'validation_failed' as const],
  multipart: { files: { evidence: { max: 8 } } },
  body: z.object({
    sellerOrderId: uuid.optional(),
    dealId: uuid.optional(),
    reasonCode: z.enum(DISPUTE_REASONS),
    description: z.string().trim().min(20).max(4000),
    claimedAmountPiastres: z.coerce.number().int().positive().optional(),
  }),
  response: disputeOut,
  handler: ({ actor, body, files }) => createDispute(actor!, body, files.evidence ?? []),
});

export const listMyDisputes = defineRoute({ ...customer, tags: ['Disputes'], id: 'listMyDisputes', method: 'GET', path: '/api/v1/disputes', summary: 'Disputes I opened or that concern me', rate: 'read', errors, response: z.object({ items: z.array(disputeRow) }), handler: ({ actor }) => myDisputes(actor!) });

export const getMyDispute = defineRoute({ ...customer, tags: ['Disputes'], id: 'getMyDispute', method: 'GET', path: '/api/v1/disputes/{disputeId}', summary: 'One dispute: messages, evidence, EDMN decision and refunds', rate: 'read', errors, params: did, response: disputeOut, handler: ({ actor, params }) => disputeView(actor!, params.disputeId) });

export const replyMyDispute = defineRoute({
  ...customer,
  tags: ['Disputes'],
  id: 'replyDispute',
  method: 'POST',
  path: '/api/v1/disputes/{disputeId}/messages',
  summary: 'Reply in a dispute, optionally with one evidence file',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: did,
  multipart: { files: { attachment: { max: 1 } } },
  body: replyBody,
  response: disputeOut,
  handler: ({ actor, params, body, files }) => disputeReply(actor!, params.disputeId, body.body, files.attachment?.[0] ?? null),
});

export const listStoreDisputes = defineRoute({ ...store, tags: ['Disputes', 'Seller'], id: 'listStoreDisputes', method: 'GET', path: '/api/v1/seller/disputes', summary: 'Disputes against the store (orders.manage or returns.manage)', rate: 'read', errors, response: z.object({ items: z.array(disputeRow) }), handler: ({ actor }) => storeDisputes(actor!) });

export const getStoreDispute = defineRoute({ ...store, tags: ['Disputes', 'Seller'], id: 'getStoreDispute', method: 'GET', path: '/api/v1/seller/disputes/{disputeId}', summary: 'One dispute against the store', rate: 'read', errors, params: did, response: disputeOut, handler: ({ actor, params }) => disputeView(actor!, params.disputeId) });

export const replyStoreDispute = defineRoute({
  ...store,
  tags: ['Disputes', 'Seller'],
  id: 'replyStoreDispute',
  method: 'POST',
  path: '/api/v1/seller/disputes/{disputeId}/messages',
  summary: 'Store reply in a dispute, optionally with one evidence file',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: did,
  multipart: { files: { attachment: { max: 1 } } },
  body: replyBody,
  response: disputeOut,
  handler: ({ actor, params, body, files }) => disputeReply(actor!, params.disputeId, body.body, files.attachment?.[0] ?? null),
});

/* ───────── Reviews ───────── */

const reviewOptionsOut = z.object({
  eligible: z.boolean(),
  storeName: z.string().nullable(),
  sellerReviewed: z.boolean(),
  items: z.array(z.object({ orderItemId: uuid, title: z.string(), variantLabel: z.string(), reviewed: z.boolean() })),
}).meta({ id: 'ReviewOptions' });

export const getReviewOptions = defineRoute({ ...customer, tags: ['Reviews'], id: 'getReviewOptions', method: 'GET', path: '/api/v1/seller-orders/{sellerOrderId}/review-options', summary: 'What I can still review on a delivered order (verified purchase only, once each)', rate: 'read', errors, params: soid, response: reviewOptionsOut, handler: ({ actor, params }) => reviewOptions(actor!, params.sellerOrderId) });

export const reviewProductRoute = defineRoute({
  ...customer,
  tags: ['Reviews'],
  id: 'reviewProduct',
  method: 'POST',
  path: '/api/v1/reviews/products',
  summary: 'Review a product I received (once per order item; up to 4 photos)',
  rate: 'write',
  idempotency: 'required',
  errors: [...errors, 'conflict' as const],
  multipart: { files: { photos: { max: 4 } } },
  body: z.object({ orderItemId: uuid, rating: z.coerce.number().int().min(1).max(5), title: z.string().trim().max(120).optional(), body: z.string().trim().max(3000).optional() }),
  response: reviewOptionsOut,
  handler: ({ actor, body, files }) => reviewProduct(actor!, body, files.photos ?? []),
});

const sub = z.number().int().min(1).max(5).optional();
export const reviewSellerRoute = defineRoute({
  ...customer,
  tags: ['Reviews'],
  id: 'reviewSeller',
  method: 'POST',
  path: '/api/v1/reviews/sellers',
  summary: 'Review the store of a delivered seller order (once per seller order)',
  rate: 'write',
  idempotency: 'required',
  errors: [...errors, 'conflict' as const],
  body: z.object({ sellerOrderId: uuid, rating: z.number().int().min(1).max(5), deliveryRating: sub, packagingRating: sub, accuracyRating: sub, communicationRating: sub, body: z.string().trim().max(3000).optional() }),
  response: reviewOptionsOut,
  handler: ({ actor, body }) => reviewSeller(actor!, body),
});

export const postPurchaseRoutes = [
  getReturnOptions, createReturnRoute, listMyReturns, getMyReturn, shipBackReturn, escalateMyReturn, listStoreReturns, getStoreReturn, storeReturnStepRoute, escalateStoreReturn,
  openDisputeRoute, listMyDisputes, getMyDispute, replyMyDispute, listStoreDisputes, getStoreDispute, replyStoreDispute,
  getReviewOptions, reviewProductRoute, reviewSellerRoute,
];
