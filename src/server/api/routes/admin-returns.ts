import { z } from 'zod';
import { returnDetailForStaff, returnsMonitor } from '@/server/modules/admin-mobile/returns';
import { defineRoute } from '../http';
import { isoDateTime } from '../schemas';

/**
 * Admin App — returns MONITORING (PKG-I02-01 v2, read-only by the owner's decision): queue and detail
 * for staff, with workflow state and the next required action shown for monitoring only. Mutations
 * (approve / reject / receive / inspect / accept-refund) are deliberately NOT exposed here; they stay
 * on the approved web console routes behind ADMIN_SAFE_WRITES.
 */
const id = z.uuid();
const nullableIso = isoDateTime.nullable();
const piastres = z.number().int();

const listItem = z.object({
  id,
  number: z.string(),
  status: z.string(),
  nextAction: z.string(),
  reason: z.string(),
  store: z.string().nullable(),
  customer: z.string().nullable(),
  refundAmount: piastres.nullable(),
  createdAt: nullableIso,
});

export const adminListReturns = defineRoute({
  id: 'adminListReturns',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/returns',
  summary: 'Returns monitoring queue by tab (returns.manage). Search by number; masked customer names; read-only',
  tags: ['Admin Returns'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({
    tab: z.enum(['pending', 'action', 'done']).optional(),
    q: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
  }),
  response: z.object({ items: z.array(listItem), page: z.number().int(), hasMore: z.boolean() }),
  handler: async ({ actor, query }) => returnsMonitor(actor!, { tab: query.tab ?? 'pending', q: query.q, page: query.page ?? 1 }),
});

export const adminReturnDetail = defineRoute({
  id: 'adminReturnDetail',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/returns/{returnId}',
  summary: 'Return detail for monitoring (returns.manage): status, workflow state, next action; evidence counted, never embedded; read-only',
  tags: ['Admin Returns'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ returnId: id }),
  response: z.object({
    id,
    number: z.string(),
    status: z.string(),
    nextAction: z.string(),
    reason: z.string(),
    description: z.string(),
    isStatutory: z.boolean(),
    decisionReason: z.string().nullable(),
    returnCarrier: z.string().nullable(),
    returnTracking: z.string().nullable(),
    inspectionNote: z.string().nullable(),
    refundAmount: piastres.nullable(),
    includeShipping: z.boolean(),
    items: z.array(z.object({ orderItemId: id, quantity: z.number().int(), unitPrice: piastres })),
    evidenceCount: z.number().int(),
    createdAt: nullableIso,
    updatedAt: nullableIso,
  }),
  handler: ({ actor, params }) => returnDetailForStaff(actor!, params.returnId),
});

export const adminReturnsRoutes = [adminListReturns, adminReturnDetail];
