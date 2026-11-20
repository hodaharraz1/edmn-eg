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
import { ORDER_STATUSES } from '@/domain/machines';
import { defineRoute } from '../http';
import { isoDateTime } from '../schemas';

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

export const adminMonitoringRoutes = [adminSellerQueue, adminIdentityQueue, adminOrderMonitor, adminDealMonitor, adminDisputeMonitor, adminAuditTrail];
