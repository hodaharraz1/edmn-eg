import { z } from 'zod';
import { receivingDestinationSchema } from '@/server/modules/identity/receiving';
import {
  accountPayoutRequests,
  addReceivingAccount,
  cancelAccountPayout,
  previewAccountPayout,
  receivingAccounts,
  removeReceivingAccount,
  requestAccountPayout,
  storePayoutAccount,
  storeStatement,
  walletActivity,
  walletActivityDetail,
  walletView,
} from '@/server/modules/mobile/wallet';
import { cancelTopup, myTopups, submitTopup } from '@/server/modules/finance/wallet-topups';
import { defineRoute } from '../http';
import { isoDateTime, piastres, uuid } from '../schemas';

/**
 * Wallet (account earnings, activity, payout REQUESTS, receiving accounts) and the store statement. Every amount is
 * computed by the finance services from the ledger; nothing here moves, reserves, releases or refunds money. A payout
 * request is a request only: approval (two people), reservation and the transfer happen in the admin console.
 */
const tags = ['Wallet'];
const base = { api: 'mobile' as const, auth: 'customer' as const, tags };
const errors = ['forbidden' as const, 'not_found' as const, 'invalid_state' as const];

const balances = z.object({
  pendingPiastres: piastres,
  heldPiastres: piastres,
  awaitingReleasePiastres: piastres,
  availablePiastres: z.number().int().meta({ description: 'Withdrawable now; holds, disputes and in-flight requests are already excluded.' }),
  reservedPiastres: piastres,
  debtPiastres: piastres,
  unsecuredClaimsPiastres: piastres,
  paidOutPiastres: piastres,
});

const walletOut = z.object({
  hasEarnings: z.boolean(),
  balances,
  sources: z.array(balances.extend({ source: z.enum(['MARKETPLACE', 'PROTECTED_DEAL']), storeName: z.string().nullable() })),
  items: z.array(z.object({ source: z.enum(['MARKETPLACE', 'PROTECTED_DEAL']), kind: z.enum(['SELLER_ORDER', 'DEAL']), entityId: uuid, ref: z.string(), bucket: z.enum(['pending', 'held', 'entitledAwaitingRelease', 'available']), amountPiastres: piastres })),
  payout: z.object({
    identityApproved: z.boolean(),
    destinations: z.array(z.object({ key: z.string(), label: z.string(), scope: z.enum(['STORE_AND_DEALS', 'DEALS_ONLY']) })),
    minimumPiastres: piastres,
    blockReason: z.enum(['IDENTITY', 'NO_DESTINATION', 'DEBT', 'NOTHING_AVAILABLE']).nullable(),
  }),
  topUp: z
    .object({
      enabled: z.boolean().meta({ description: 'wallet.topUpEnabled. false = hide every deposit control; the top-up endpoints answer feature_disabled.' }),
      balancePiastres: piastres,
      pending: z.array(z.object({ id: uuid, amountPiastres: piastres, method: z.enum(['BANK_TRANSFER', 'INSTAPAY']), createdAt: isoDateTime })),
      dailyLimitPiastres: piastres,
      usedTodayPiastres: piastres.meta({ description: 'Deposits plus order/deal receipts counted today (Africa/Cairo) against the one shared daily cap.' }),
    })
    .meta({ id: 'WalletTopUpSummary' }),
  realMoney: z.boolean(),
});

export const getWallet = defineRoute({ ...base, id: 'getWallet', method: 'GET', path: '/api/v1/wallet', summary: 'My wallet: earnings by source and bucket, what can be requested now, and where', rate: 'read', errors, response: walletOut, handler: ({ actor }) => walletView(actor!) });

const activityKind = z.enum(['PAYMENT', 'REFUND', 'PAYOUT']);
const activityItem = z.object({
  kind: activityKind, id: uuid, direction: z.enum(['OUT', 'IN']), amountPiastres: piastres, status: z.string(),
  ref: z.string(), method: z.string().nullable(), reference: z.string().nullable(), note: z.string().nullable(),
  isTest: z.boolean().nullable().meta({ description: 'null when a legacy refund has no original payment; never inferred from current money mode.' }),
  createdAt: isoDateTime, link: z.object({ kind: z.enum(['ORDER', 'DEAL', 'PAYMENT']), id: uuid }).nullable(),
});
export const listWalletActivity = defineRoute({
  ...base, id: 'listWalletActivity', method: 'GET', path: '/api/v1/wallet/activity',
  summary: 'My money activity: search all owned records, newest first, paginated', rate: 'read', errors,
  query: z.object({ kind: activityKind.optional(), q: z.string().trim().max(40).optional(), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }),
  response: z.object({ items: z.array(activityItem), page: z.number().int(), pageSize: z.number().int(), hasMore: z.boolean() }),
  handler: ({ actor, query }) => walletActivity(actor!, query.kind, query.q, query.page, query.pageSize),
});
export const getWalletActivity = defineRoute({
  ...base, id: 'getWalletActivity', method: 'GET', path: '/api/v1/wallet/activity/{activityId}',
  summary: 'Fresh details of one of my money activities', rate: 'read', errors,
  params: z.object({ activityId: uuid }), response: activityItem,
  handler: ({ actor, params }) => walletActivityDetail(actor!, params.activityId),
});

const requestOut = z.object({
  id: uuid,
  number: z.string(),
  amountPiastres: piastres,
  status: z.string().meta({ description: 'TRANSFER_UNCERTAIN = not confirmed either way; never retried or resolved by the app.' }),
  destination: z.string(),
  createdAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
  reference: z.string().nullable(),
  reasonAr: z.string().nullable(),
  isTest: z.boolean(),
  sources: z.array(z.object({ source: z.enum(['MARKETPLACE', 'PROTECTED_DEAL']), amountPiastres: piastres, status: z.string() })),
  cancellable: z.boolean(),
});

export const listAccountPayoutRequests = defineRoute({ ...base, id: 'listAccountPayoutRequests', method: 'GET', path: '/api/v1/wallet/payout-requests', summary: 'My payout requests and their status', rate: 'read', errors, response: z.object({ items: z.array(requestOut) }), handler: ({ actor }) => accountPayoutRequests(actor!) });

export const previewAccountPayoutRequest = defineRoute({
  ...base,
  id: 'previewAccountPayoutRequest',
  method: 'POST',
  path: '/api/v1/wallet/payout-requests/preview',
  summary: 'Read-only: would this amount fit, and from which sources (moves nothing)',
  rate: 'read',
  errors: [...errors, 'validation_failed' as const],
  body: z.object({ amountPiastres: z.number().int().positive(), destination: z.string().min(1).max(60) }),
  response: z.object({ amountPiastres: piastres, availablePiastres: piastres, fits: z.boolean(), transferCostPiastres: piastres, netPiastres: z.number().int(), violations: z.array(z.string()), warnings: z.array(z.string()), destination: z.string(), sources: z.array(z.object({ source: z.enum(['MARKETPLACE', 'PROTECTED_DEAL']), amountPiastres: piastres })) }),
  handler: ({ actor, body }) => previewAccountPayout(actor!, body.amountPiastres, body.destination),
});

export const createAccountPayoutRequest = defineRoute({
  ...base,
  id: 'createAccountPayoutRequest',
  method: 'POST',
  path: '/api/v1/wallet/payout-requests',
  summary: 'Request a payout of available earnings to a verified account (request only — nothing moves until EDMN approves)',
  description: 'clientKey is the idempotency key: a retried submit returns the original request with created=false.',
  rate: 'sensitive',
  errors: [...errors, 'validation_failed' as const, 'conflict' as const],
  body: z.object({ amountPiastres: z.number().int().positive(), destination: z.string().min(1).max(60), clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) }),
  response: z.object({ created: z.boolean(), request: requestOut }),
  handler: ({ actor, body }) => requestAccountPayout(actor!, body.amountPiastres, body.destination, body.clientKey),
});

export const cancelAccountPayoutRequest = defineRoute({
  ...base,
  id: 'cancelAccountPayoutRequest',
  method: 'POST',
  path: '/api/v1/wallet/payout-requests/{requestId}/cancel',
  summary: 'Cancel my own request before EDMN approved it',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: z.object({ requestId: uuid }),
  response: z.object({ items: z.array(requestOut) }),
  handler: ({ actor, params }) => cancelAccountPayout(actor!, params.requestId),
});

const accountOut = z.object({ id: uuid, type: z.string(), label: z.string(), holderName: z.string(), status: z.string(), reviewNote: z.string().nullable(), createdAt: isoDateTime });
const accountsOut = z.object({ items: z.array(accountOut) });

export const listReceivingAccounts = defineRoute({ ...base, id: 'listReceivingAccounts', method: 'GET', path: '/api/v1/wallet/receiving-accounts', summary: 'My accounts for receiving money (masked; verified by EDMN before use)', rate: 'read', errors, response: accountsOut, handler: ({ actor }) => receivingAccounts(actor!) });

export const addReceivingAccountRoute = defineRoute({
  ...base,
  id: 'addReceivingAccount',
  method: 'POST',
  path: '/api/v1/wallet/receiving-accounts',
  summary: 'Add (or replace) an account for receiving money — it is reviewed by EDMN before it can be used',
  rate: 'sensitive',
  idempotency: 'required',
  errors: [...errors, 'validation_failed' as const],
  body: z.object({ account: receivingDestinationSchema, replacesId: uuid.optional() }),
  response: accountsOut,
  handler: ({ actor, body }) => addReceivingAccount(actor!, body.account, body.replacesId),
});

export const archiveReceivingAccount = defineRoute({
  ...base,
  id: 'archiveReceivingAccount',
  method: 'POST',
  path: '/api/v1/wallet/receiving-accounts/{accountId}/archive',
  summary: 'Stop using one of my receiving accounts',
  rate: 'write',
  idempotency: 'required',
  errors,
  params: z.object({ accountId: uuid }),
  response: accountsOut,
  handler: ({ actor, params }) => removeReceivingAccount(actor!, params.accountId),
});

/* ───────── Store (auth `seller`, finance.view) ───────── */

const store = { api: 'mobile' as const, auth: 'seller' as const, tags: ['Wallet', 'Seller'] };

export const getStoreStatement = defineRoute({
  ...store,
  id: 'getSellerStatement',
  method: 'GET',
  path: '/api/v1/seller/statement',
  summary: 'Store financial statement from the ledger (finance.view): totals and one row per journal entry',
  rate: 'read',
  errors,
  response: z.object({
    totals: z.object({ grossSalesPiastres: z.number().int(), edmnFeesPiastres: z.number().int(), refundsPiastres: z.number().int(), pendingPiastres: z.number().int(), ledgerAvailablePiastres: z.number().int(), reservedPiastres: z.number().int(), debtPiastres: z.number().int() }),
    rows: z.array(
      z.object({
        id: z.string(),
        date: z.string(),
        type: z.string(),
        description: z.string(),
        reference: z.string(),
        orderRef: z.string().nullable(),
        netEffectPiastres: z.number().int(),
        pendingDeltaPiastres: z.number().int(),
        availableDeltaPiastres: z.number().int(),
        reservedDeltaPiastres: z.number().int(),
        payoutCostPiastres: z.number().int(),
      }),
    ),
  }),
  handler: ({ actor }) => storeStatement(actor!),
});

export const getStorePayoutAccount = defineRoute({
  ...store,
  id: 'getSellerPayoutAccount',
  method: 'GET',
  path: '/api/v1/seller/payout-account',
  summary: "The store's verified payout account (masked)",
  rate: 'read',
  errors,
  response: z.object({ account: z.object({ label: z.string(), type: z.string() }).nullable() }),
  handler: ({ actor }) => storePayoutAccount(actor!),
});

const topupOut = z.object({
  id: uuid,
  amountPiastres: piastres,
  method: z.enum(['BANK_TRANSFER', 'INSTAPAY']),
  status: z.enum(['PENDING_REVIEW', 'CREDITED', 'REJECTED', 'CANCELLED']),
  payerReference: z.string().nullable(),
  rejectReasonAr: z.string().nullable(),
  createdAt: isoDateTime,
  decidedAt: isoDateTime.nullable(),
  cancellable: z.boolean(),
});
const topupView = (t: Awaited<ReturnType<typeof submitTopup>>['topup'], open = false) => ({
  id: t.id,
  amountPiastres: t.amount,
  method: t.method,
  status: t.status,
  payerReference: t.payerReference,
  rejectReasonAr: t.status === 'REJECTED' ? t.rejectReason : null,
  createdAt: t.createdAt.toISOString(),
  decidedAt: t.decidedAt?.toISOString() ?? null,
  cancellable: t.status === 'PENDING_REVIEW' && !open,
});
const topupErrors = [...errors, 'feature_disabled' as const, 'validation_failed' as const];

export const listWalletTopups = defineRoute({
  ...base,
  id: 'listWalletTopups',
  method: 'GET',
  path: '/api/v1/wallet/topups',
  summary: 'My wallet deposits (newest first), where to transfer to, and today\'s remaining daily limit',
  description: 'feature_disabled while wallet.topUpEnabled is off.',
  rate: 'read',
  errors: topupErrors,
  response: z.object({
    items: z.array(topupOut),
    methods: z.array(z.object({ code: z.enum(['BANK_TRANSFER', 'INSTAPAY']), nameAr: z.string(), nameEn: z.string(), instructionsAr: z.string().nullable(), destinations: z.array(z.object({ label: z.string(), details: z.record(z.string(), z.string()), instructionsAr: z.string().nullable(), isTest: z.boolean() })) })),
    balancePiastres: piastres,
    dailyLimitPiastres: piastres,
    usedTodayPiastres: piastres,
  }),
  handler: async ({ actor }) => {
    const r = await myTopups(actor!);
    return { items: r.items.map((t) => topupView(t)), methods: r.methods, balancePiastres: r.balancePiastres, dailyLimitPiastres: r.dailyLimitPiastres, usedTodayPiastres: r.usedTodayPiastres };
  },
});

export const createWalletTopup = defineRoute({
  ...base,
  id: 'createWalletTopup',
  method: 'POST',
  path: '/api/v1/wallet/topups',
  summary: 'Upload the transfer receipt of a deposit (queues it for two-person staff review; never credits by itself)',
  description: 'multipart/form-data. clientKey is the idempotency key: a retry with the same key returns the first deposit with created=false. feature_disabled while wallet.topUpEnabled is off. Refused over the shared daily cap.',
  rate: 'write',
  status: 201,
  errors: [...topupErrors, 'conflict' as const],
  multipart: { files: { proof: { max: 1, required: true } } },
  body: z.object({
    amount: z.string().trim().min(1).max(20).meta({ description: 'Amount transferred in EGP as typed by the customer, e.g. "1250.50".' }),
    method: z.enum(['BANK_TRANSFER', 'INSTAPAY']),
    payerReference: z.string().trim().max(100).optional(),
    clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  }),
  response: z.object({ created: z.boolean(), topup: topupOut }),
  handler: async ({ actor, body, files }) => {
    const r = await submitTopup(actor!, { amount: body.amount, method: body.method, payerReference: body.payerReference ?? '', clientKey: body.clientKey }, files.proof?.[0] ?? null);
    return { created: r.created, topup: topupView(r.topup) };
  },
});

export const cancelWalletTopup = defineRoute({
  ...base,
  id: 'cancelWalletTopup',
  method: 'POST',
  path: '/api/v1/wallet/topups/{topupId}/cancel',
  summary: 'Cancel my deposit while it is pending and staff have not started reviewing it',
  rate: 'write',
  idempotency: 'required',
  errors: topupErrors,
  params: z.object({ topupId: uuid }),
  response: topupOut,
  handler: async ({ actor, params }) => topupView(await cancelTopup(actor!, params.topupId)),
});

export const walletRoutes = [
  getWallet, listWalletActivity, getWalletActivity, listAccountPayoutRequests, previewAccountPayoutRequest, createAccountPayoutRequest, cancelAccountPayoutRequest,
  listWalletTopups, createWalletTopup, cancelWalletTopup,
  listReceivingAccounts, addReceivingAccountRoute, archiveReceivingAccount, getStoreStatement, getStorePayoutAccount,
];
