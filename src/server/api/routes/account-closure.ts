import { z } from 'zod';
import { enforce } from '@/server/auth/rate-limit';
import { CLOSURE_BLOCKED_MESSAGE, closureBlockerLabel, latestClosureRequest, requestAccountClosure, withdrawAccountClosure } from '@/server/modules/customers/closure';
import { ApiError } from '../errors';
import { defineRoute } from '../http';
import { isoDateTime, uuid } from '../schemas';

/**
 * Account deletion REQUEST (C30). The customer asks EDMN to close the account; the closure service decides and records.
 * While anything is open (orders, deals, disputes, non-zero wallet, pending payout, active store) the request is
 * refused with clear Arabic reasons, and the BLOCKED attempt itself is recorded and audited. These routes never
 * delete or anonymize anything — completing a closure stays an operations decision on the admin side, and retention
 * is the owner's legal decision.
 */

const closureBlockerOut = z.object({
  code: z.string().meta({ description: 'Stable blocker code (e.g. OPEN_ORDERS).' }),
  label: z.string().meta({ description: 'Ready-to-show Arabic reason.' }),
  count: z.number().int(),
});

const closureRequestOut = z.object({
  id: uuid,
  status: z.enum(['BLOCKED', 'PENDING', 'COMPLETED', 'WITHDRAWN']),
  reason: z.string().nullable(),
  blockers: z.array(closureBlockerOut),
  createdAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
});

type ClosureRow = NonNullable<Awaited<ReturnType<typeof latestClosureRequest>>>;

const toOut = (r: ClosureRow) => ({
  id: r.id,
  status: r.status,
  reason: r.reason ?? null,
  blockers: (r.blockers ?? []).map((b) => ({ code: b.code, label: closureBlockerLabel(b.code), count: b.count })),
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt ? r.completedAt.toISOString() : null,
});

export const requestAccountDeletion = defineRoute({
  id: 'requestAccountDeletion',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/me/deletion-request',
  summary: 'Request account closure — recorded for EDMN to complete; refused with reasons while anything is open',
  description:
    'Creates a PENDING closure request. Nothing is deleted or anonymized by this call. While the account has open obligations ' +
    '(open orders, payments under review, returns, refunds, disputes, active protected deals, pending payouts, open withdrawals, ' +
    'a non-zero balance, a financial hold, or an active store) the request is refused 422 with the Arabic reasons, and the ' +
    'BLOCKED attempt is itself recorded and audited. A repeated request while one is PENDING returns the same request.',
  tags: ['Account'],
  auth: 'customer',
  rate: 'sensitive',
  idempotency: 'required',
  errors: ['validation_failed'],
  body: z.object({ reason: z.string().trim().max(500).optional() }),
  response: z.object({ request: closureRequestOut }),
  handler: async ({ actor, body }) => {
    // Closure attempts are rare by nature; a tight per-account ceiling sits on top of the `sensitive` tier.
    const userId = actor!.userId!;
    await enforce(`account-deletion:${userId}`, 5, 3600);
    const result = await requestAccountClosure(actor!, body.reason);
    if (result.status === 'BLOCKED') {
      throw new ApiError('validation_failed', CLOSURE_BLOCKED_MESSAGE, { fieldErrors: { blockers: result.blockers.map((b) => closureBlockerLabel(b.code)) } });
    }
    const row = await latestClosureRequest(userId);
    return { request: toOut(row!) };
  },
});

export const getAccountDeletionRequest = defineRoute({
  id: 'getAccountDeletionRequest',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/me/deletion-request',
  summary: 'My latest account-closure request, if any',
  tags: ['Account'],
  auth: 'customer',
  rate: 'read',
  response: z.object({ request: closureRequestOut.nullable() }),
  handler: async ({ actor }) => {
    const row = await latestClosureRequest(actor!.userId!);
    return { request: row ? toOut(row) : null };
  },
});

export const cancelAccountDeletionRequest = defineRoute({
  id: 'cancelAccountDeletionRequest',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/me/deletion-request/cancel',
  summary: 'Withdraw my pending account-closure request',
  tags: ['Account'],
  auth: 'customer',
  rate: 'write',
  idempotency: 'required',
  errors: ['invalid_state'],
  response: z.object({ request: closureRequestOut.nullable() }),
  handler: async ({ actor }) => {
    const userId = actor!.userId!;
    const current = await latestClosureRequest(userId);
    if (!current || current.status !== 'PENDING') throw new ApiError('invalid_state', 'مفيش طلب إغلاق حساب قيد التنفيذ عشان يتلغي');
    await withdrawAccountClosure(actor!);
    const row = await latestClosureRequest(userId);
    return { request: row ? toOut(row) : null };
  },
});

export const accountClosureRoutes = [requestAccountDeletion, getAccountDeletionRequest, cancelAccountDeletionRequest];
