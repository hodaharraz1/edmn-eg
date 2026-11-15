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
  walletView,
} from '@/server/modules/mobile/wallet';
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
  topUpAvailable: z.boolean().meta({ description: 'Always false: EDMN keeps no prepaid balance and has no top-up service.' }),
  realMoney: z.boolean(),
});

export const getWallet = defineRoute({ ...base, id: 'getWallet', method: 'GET', path: '/api/v1/wallet', summary: 'My wallet: earnings by source and bucket, what can be requested now, and where', rate: 'read', errors, response: walletOut, handler: ({ actor }) => walletView(actor!) });

const activityKind = z.enum(['PAYMENT', 'REFUND', 'PAYOUT']);
export const listWalletActivity = defineRoute({
  ...base,
  id: 'listWalletActivity',
  method: 'GET',
  path: '/api/v1/wallet/activity',
  summary: 'My money activity: payments I made, refunds to me, my payout requests (newest first)',
  rate: 'read',
  errors,
  query: z.object({ kind: activityKind.optional(), q: z.string().trim().max(40).optional() }),
  response: z.object({
    items: z.array(
      z.object({
        kind: activityKind,
        id: uuid,
        direction: z.enum(['OUT', 'IN']),
        amountPiastres: piastres,
        status: z.string(),
        ref: z.string(),
        method: z.string().nullable(),
        reference: z.string().nullable(),
        note: z.string().nullable(),
        isTest: z.boolean(),
        createdAt: isoDateTime,
        link: z.object({ kind: z.enum(['ORDER', 'DEAL', 'PAYMENT']), id: uuid }).nullable(),
      }),
    ),
  }),
  handler: ({ actor, query }) => walletActivity(actor!, query.kind, query.q),
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
  errors,
  body: z.object({ amountPiastres: z.number().int().positive(), destination: z.string().min(1).max(60) }),
  response: z.object({ amountPiastres: piastres, availablePiastres: piastres, fits: z.boolean(), destination: z.string(), sources: z.array(z.object({ source: z.enum(['MARKETPLACE', 'PROTECTED_DEAL']), amountPiastres: piastres })) }),
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
  errors: [...errors, 'validation_failed' as const],
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

export const walletRoutes = [
  getWallet, listWalletActivity, listAccountPayoutRequests, previewAccountPayoutRequest, createAccountPayoutRequest, cancelAccountPayoutRequest,
  listReceivingAccounts, addReceivingAccountRoute, archiveReceivingAccount, getStoreStatement, getStorePayoutAccount,
];
