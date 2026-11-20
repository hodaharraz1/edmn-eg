import { z } from 'zod';
import {
  AUDIT_ACTOR_TYPES,
  auditTrail,
  dealMonitor,
  disputeMonitor,
  identityReviewQueue,
  orderMonitor,
  sellerReviewQueue,
} from '@/server/modules/admin-mobile/monitoring';
import { dealDetail, disputeAssignees, disputeDetail, identityDetail, orderDetail, sellerDetail } from '@/server/modules/admin-mobile/details';
import { addDisputeMessage, assignDispute } from '@/server/modules/postpurchase/disputes';
import { ORDER_STATUSES } from '@/domain/machines';
import { defineRoute } from '../http';
import { isoDateTime, ok } from '../schemas';

/**
 * Admin App monitoring (read-only). Each route is `auth: 'admin'` (staff session with TOTP verified), and the
 * permission is enforced in the service (`src/server/modules/admin-mobile/monitoring.ts`) — the same permission as the
 * matching web console page. No route here changes state.
 */
const nullableIso = isoDateTime.nullable();
const piastres = z.number().int();

export const adminSellerQueue = defineRoute({
  id: 'adminListSellerApplications',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/sellers/applications',
  summary: 'Seller applications awaiting review (sellers.review)',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({ tab: z.enum(['pending', 'info']).optional() }),
  response: z.object({
    items: z.array(z.object({ id: z.uuid(), applicant: z.string().nullable(), storeName: z.string().nullable(), type: z.string(), status: z.string(), riskLevel: z.string().nullable(), submittedAt: nullableIso })),
  }),
  handler: async ({ actor, query }) => ({ items: await sellerReviewQueue(actor!, query.tab ?? 'pending') }),
});

export const adminIdentityQueue = defineRoute({
  id: 'adminListIdentityReviews',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/identity/reviews',
  summary: 'National ID (KYC) verifications by status (identity.view). No numbers or images',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({ tab: z.enum(['pending', 'action', 'approved', 'rejected']).optional() }),
  response: z.object({
    items: z.array(z.object({ id: z.uuid(), name: z.string().nullable(), status: z.string(), documentsComplete: z.boolean(), submittedAt: nullableIso, reviewedAt: nullableIso })),
  }),
  handler: async ({ actor, query }) => ({ items: await identityReviewQueue(actor!, query.tab ?? 'pending') }),
});

export const adminOrderMonitor = defineRoute({
  id: 'adminListOrders',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/orders',
  summary: 'Orders, or shipments without a receipt confirmation (orders.view)',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({
    tab: z.enum(['all', 'followup']).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    q: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
  }),
  response: z.object({
    items: z.array(z.object({ id: z.uuid(), orderId: z.uuid(), number: z.string(), customer: z.string().nullable(), store: z.string().nullable(), status: z.string(), total: piastres, at: nullableIso, sellerOrders: z.number().int().optional() })),
    page: z.number().int(),
    hasMore: z.boolean(),
  }),
  handler: ({ actor, query }) => orderMonitor(actor!, { tab: query.tab ?? 'all', status: query.status, q: query.q, page: query.page ?? 1 }),
});

export const adminDealMonitor = defineRoute({
  id: 'adminListDeals',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/deals',
  summary: 'Protected deals by stage (deals.view)',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({ tab: z.enum(['active', 'disputed', 'done']).optional() }),
  response: z.object({
    items: z.array(z.object({ id: z.uuid(), number: z.string(), title: z.string(), buyer: z.string().nullable(), seller: z.string().nullable(), sellerConfirmed: z.boolean(), status: z.string(), buyerPays: piastres.nullable(), updatedAt: nullableIso })),
  }),
  handler: async ({ actor, query }) => ({ items: await dealMonitor(actor!, query.tab ?? 'active') }),
});

export const adminDisputeMonitor = defineRoute({
  id: 'adminListDisputes',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/disputes',
  summary: 'Disputes: open, assigned to me, or closed (disputes.manage)',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({ tab: z.enum(['open', 'mine', 'closed']).optional() }),
  response: z.object({
    items: z.array(z.object({ id: z.uuid(), number: z.string(), kind: z.enum(['DEAL', 'RETURN', 'ORDER']), claimant: z.string().nullable(), reasonCode: z.string(), claimedAmount: piastres.nullable(), status: z.string(), assignedToMe: z.boolean(), createdAt: nullableIso })),
  }),
  handler: async ({ actor, query }) => ({ items: await disputeMonitor(actor!, query.tab ?? 'open') }),
});

export const adminAuditTrail = defineRoute({
  id: 'adminListAuditLog',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/audit',
  summary: 'Audit trail, newest first, keyset-paged (audit.view). No before/after values, IP or user agent',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({
    action: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(40).regex(/^[a-z_.]*$/i).optional(),
    actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
    before: z.coerce.number().int().min(1).optional(),
  }),
  response: z.object({
    items: z.array(z.object({ id: z.number().int(), at: isoDateTime, actorType: z.string(), actor: z.string().nullable(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(), channel: z.string().nullable(), hasReason: z.boolean() })),
    nextBefore: z.number().int().nullable(),
  }),
  handler: ({ actor, query }) => auditTrail(actor!, query),
});

/* ───────────── Detail views (read-only) and the two safe dispute actions ───────────── */
const id = z.uuid();
const historyItem = z.object({ entityType: z.string(), from: z.string().nullable(), to: z.string(), actorType: z.string().nullable(), actor: z.string().nullable(), note: z.string().nullable(), at: isoDateTime });

export const adminSellerDetail = defineRoute({
  id: 'adminGetSeller',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/sellers/{sellerId}',
  summary: 'Seller application: checklist, document metadata, status history (sellers.view). No IDs, contacts or payout data',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ sellerId: id }),
  response: z.object({
    id,
    applicant: z.string().nullable(),
    type: z.string(),
    status: z.string(),
    riskLevel: z.string().nullable(),
    governorate: z.string().nullable(),
    storeName: z.string().nullable(),
    submittedAt: nullableIso,
    checklist: z.array(z.object({ key: z.string(), label: z.string(), ok: z.boolean() })),
    documents: z.array(z.object({ kind: z.string(), status: z.string(), uploadedAt: nullableIso })).nullable(),
    history: z.array(historyItem),
  }),
  handler: ({ actor, params }) => sellerDetail(actor!, params.sellerId),
});

export const adminIdentityDetail = defineRoute({
  id: 'adminGetIdentityReview',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/identity/reviews/{verificationId}',
  summary: 'KYC case summary (identity.view): status, review trail. Never the number, its digits or the images',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ verificationId: id }),
  response: z.object({
    id,
    name: z.string().nullable(),
    status: z.string(),
    documentsComplete: z.boolean(),
    rejectionReason: z.string().nullable(),
    submittedAt: nullableIso,
    reviewedAt: nullableIso,
    reviewedBy: z.string().nullable(),
    events: z.array(z.object({ action: z.string(), from: z.string().nullable(), to: z.string().nullable(), by: z.string().nullable(), reason: z.string().nullable(), at: isoDateTime })),
  }),
  handler: ({ actor, params }) => identityDetail(actor!, params.verificationId),
});

export const adminOrderDetail = defineRoute({
  id: 'adminGetOrder',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/orders/{orderId}',
  summary: 'Order with seller orders, shipments, tracking events and status history (orders.view). No address or contacts',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ orderId: id }),
  response: z.object({
    id,
    number: z.string(),
    status: z.string(),
    customer: z.string().nullable(),
    placedAt: nullableIso,
    paidAt: nullableIso,
    totals: z.object({ merchandise: piastres, shipping: piastres, grand: piastres }),
    payment: z.object({ method: z.string(), status: z.string(), amount: piastres }).nullable(),
    sellerOrders: z.array(
      z.object({
        id,
        number: z.string(),
        store: z.string().nullable(),
        status: z.string(),
        total: piastres,
        items: z.array(z.object({ title: z.string(), quantity: z.number().int(), lineTotal: piastres })),
        shipment: z
          .object({
            status: z.string(),
            carrier: z.string().nullable(),
            trackingNumber: z.string().nullable(),
            shippedAt: nullableIso,
            expectedAt: nullableIso,
            exception: z.string().nullable(),
            events: z.array(z.object({ status: z.string(), description: z.string().nullable(), at: isoDateTime })),
          })
          .nullable(),
        followUpFlaggedAt: nullableIso,
      }),
    ),
    history: z.array(historyItem),
  }),
  handler: ({ actor, params }) => orderDetail(actor!, params.orderId),
});

export const adminDealDetail = defineRoute({
  id: 'adminGetDeal',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/deals/{dealId}',
  summary: 'Protected deal summary and timeline (deals.view). No locations, payout data or delivery codes',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ dealId: id }),
  response: z.object({
    id,
    number: z.string(),
    ref: z.string(),
    title: z.string(),
    condition: z.string(),
    status: z.string(),
    buyer: z.string().nullable(),
    seller: z.string().nullable(),
    sellerConfirmed: z.boolean(),
    financialHold: z.boolean(),
    money: z.object({ total: piastres.nullable(), buyerPays: piastres.nullable(), sellerReceives: piastres.nullable() }),
    payment: z.object({ status: z.string(), method: z.string() }).nullable(),
    payout: z.object({ status: z.string() }).nullable(),
    evidenceCount: z.number().int(),
    disputes: z.array(z.object({ id, number: z.string(), status: z.string() })),
    createdAt: nullableIso,
    updatedAt: nullableIso,
    history: z.array(historyItem),
  }),
  handler: ({ actor, params }) => dealDetail(actor!, params.dealId),
});

const disputeDetailSchema = z.object({
  id,
  number: z.string(),
  status: z.string(),
  reasonCode: z.string(),
  description: z.string(),
  claimedAmount: piastres.nullable(),
  claimant: z.string().nullable(),
  respondent: z.string().nullable(),
  assignee: z.object({ id, name: z.string().nullable(), isMe: z.boolean() }).nullable(),
  subject: z.object({ kind: z.enum(['ORDER', 'DEAL', 'RETURN']), number: z.string().nullable(), id: id.nullable() }),
  createdAt: nullableIso,
  messages: z.array(z.object({ id, authorRole: z.string(), author: z.string().nullable(), internal: z.boolean(), body: z.string(), at: isoDateTime })),
  evidence: z.array(z.object({ uploadedBy: z.string().nullable(), note: z.string().nullable(), at: isoDateTime })),
  history: z.array(historyItem),
});

export const adminDisputeDetail = defineRoute({
  id: 'adminGetDispute',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/disputes/{disputeId}',
  summary: 'Dispute with messages (internal notes included), evidence metadata, assignee and history (disputes.manage)',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ disputeId: id }),
  response: disputeDetailSchema,
  handler: ({ actor, params }) => disputeDetail(actor!, params.disputeId),
});

export const adminDisputeAssignees = defineRoute({
  id: 'adminListDisputeAssignees',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/disputes/assignees',
  summary: 'Active staff who may be assigned a dispute (holders of disputes.manage)',
  tags: ['Admin Monitoring'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  response: z.object({ items: z.array(z.object({ id, name: z.string().nullable(), isMe: z.boolean() })) }),
  handler: async ({ actor }) => ({ items: await disputeAssignees(actor!) }),
});

export const adminAssignDispute = defineRoute({
  id: 'adminAssignDispute',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/disputes/{disputeId}/assign',
  summary: 'Assign an open dispute to an eligible staff member (disputes.manage). Audited; no financial effect',
  tags: ['Admin Actions'],
  auth: 'admin',
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'validation_failed', 'invalid_state'],
  params: z.object({ disputeId: id }),
  body: z.object({ assigneeId: id }),
  response: ok,
  handler: async ({ actor, params, body }) => {
    await assignDispute(actor!, params.disputeId, body.assigneeId);
    return { ok: true as const };
  },
});

export const adminAddDisputeNote = defineRoute({
  id: 'adminAddDisputeNote',
  api: 'admin',
  method: 'POST',
  path: '/api/v1/admin/disputes/{disputeId}/notes',
  summary: 'Add an INTERNAL staff note (never shown to the parties, no notification) (disputes.manage)',
  tags: ['Admin Actions'],
  auth: 'admin',
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'validation_failed'],
  params: z.object({ disputeId: id }),
  body: z.object({ body: z.string().trim().min(2).max(4000) }),
  response: ok,
  handler: async ({ actor, params, body }) => {
    // Always internal: this route cannot post a message the parties see (that stays in the console).
    await addDisputeMessage(actor!, params.disputeId, body.body, true);
    return { ok: true as const };
  },
});

export const adminMonitoringRoutes = [
  adminSellerQueue,
  adminIdentityQueue,
  adminOrderMonitor,
  adminDealMonitor,
  adminDisputeMonitor,
  adminAuditTrail,
  adminSellerDetail,
  adminIdentityDetail,
  adminOrderDetail,
  adminDealDetail,
  adminDisputeAssignees,
  adminDisputeDetail,
  adminAssignDispute,
  adminAddDisputeNote,
];
