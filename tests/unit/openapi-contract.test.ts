import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@/server/api/errors';
import { buildOpenApi } from '@/server/api/openapi';
import { ADMIN_API_ROUTES, ALL_API_ROUTES, MOBILE_API_ROUTES } from '@/server/api/routes';

/** The committed OpenAPI documents are the reviewed contract: they must equal what the route definitions generate. */
/** Seller fulfilment / inventory / catalog / store writes reviewed for the Customer App's Seller Center (no money movement). */
const SELLER_WRITES = new Set([
  'runSellerOrderStep', 'saveSellerShipment', 'setSellerVariantStock',
  'createSellerProduct', 'saveSellerProductDetails', 'saveSellerProductLogistics', 'addSellerProductImages', 'deleteSellerProductImage',
  'saveSellerProductVariants', 'submitSellerProduct', 'setSellerProductVisibility', 'saveSellerShippingRates', 'saveSellerStoreSettings',
  // Payout REQUESTS only (owner-approved). The request is a claim reviewed by EDMN Maker/Checker; nothing is transferred.
  'previewSellerPayoutRequest', 'createSellerPayoutRequest', 'cancelSellerPayoutRequest',
]);

/** Seller application / identity writes: the applicant is a customer (no store membership yet). */
const APPLICATION_WRITES = new Set([
  'submitMyIdentity', 'startSellerApplication', 'saveSellerApplicationIdentity', 'saveSellerApplicationBusiness', 'saveSellerApplicationStore',
  'uploadSellerApplicationDocument', 'addSellerPayoutAccount', 'submitSellerApplication',
]);

/** Protected Deal writes (buyer / seller of the deal, decided by the deal service). None releases or refunds money. */
const DEAL_WRITES = new Set([
  'createDeal', 'saveDealStep', 'addDealPhotos', 'inviteDealSeller', 'refreshDealInvitation', 'revokeDealInvitation', 'claimDealInvitation', 'declineDealInvitation',
  'submitDealOffer', 'respondDealOffer', 'respondDealChangeRequest', 'cancelDeal', 'startDealPayment', 'markDealShipped', 'regenerateDealDeliveryCode',
  'verifyDealDeliveryCode', 'confirmDealReceipt', 'reportDealNotReceived',
]);

/**
 * Messaging and support writes. Messages are evidence only (they change no order, deal, payment or balance); a
 * conversation can only be opened from an order or deal the caller is a party to. Store-side routes act as the
 * session user's store membership.
 */
const CUSTOMER_MESSAGE_WRITES = new Set([
  'sendMessage', 'markConversationSeen', 'reportMessage', 'openOrderConversation', 'openDealConversation',
  'openSupportTicket', 'replySupportTicket', 'reopenSupportTicket', 'rateSupportTicket',
]);
const STORE_MESSAGE_WRITES = new Set(['sendStoreMessage', 'markStoreConversationSeen', 'reportStoreMessage', 'openStoreOrderConversation']);

/** The only payout-related routes on the mobile API (request side). */
const PAYOUT_REQUEST_ROUTES = new Set(['listSellerPayoutRequests', 'previewSellerPayoutRequest', 'createSellerPayoutRequest', 'cancelSellerPayoutRequest', 'addSellerPayoutAccount', 'getSellerPayoutAccount']);
/** Account-level payout REQUESTS by the beneficiary (same owner decision §20; auth `customer`, own account only). */
const ACCOUNT_PAYOUT_ROUTES = new Set(['listAccountPayoutRequests', 'previewAccountPayoutRequest', 'createAccountPayoutRequest', 'cancelAccountPayoutRequest']);
/** Wallet writes: payout request / preview / cancel, and receiving accounts submitted for staff verification. */
/**
 * Post-purchase writes. A store ACCEPT or a dispute decision only REQUESTS a refund (EDMN finance approves and pays);
 * dispute decisions are never on the mobile API. Every one is idempotency-protected.
 */
const BUYER_POSTPURCHASE_WRITES = new Set(['createReturn', 'shipBackReturn', 'escalateMyReturn', 'openDispute', 'replyDispute', 'reviewProduct', 'reviewSeller']);
const STORE_POSTPURCHASE_WRITES = new Set(['runStoreReturnStep', 'escalateStoreReturn', 'replyStoreDispute']);
/** Notification center writes: mark my notifications read, change my own preferences. Naturally idempotent. */
const NOTIFICATION_WRITES = new Set(['markNotificationsRead', 'saveNotificationPreferences']);
const WALLET_WRITES = new Set(['previewAccountPayoutRequest', 'createAccountPayoutRequest', 'cancelAccountPayoutRequest', 'addReceivingAccount', 'archiveReceivingAccount']);

/** Buyer writes (cart, addresses, checkout, order actions, payment proof) reviewed for the Customer App. */
const BUYER_WRITES = new Set([
  'updateMe', 'changePassword', 'forgotPassword', 'resetPassword', 'sendVerificationCode', 'confirmVerificationCode',
  'createAddress', 'updateAddress', 'deleteAddress',
  'addCartItem', 'setCartItemQuantity', 'acknowledgeCartPrices',
  'placeOrder', 'cancelUnpaidOrder', 'confirmReceipt', 'requestCancellation', 'reportOrderProblem',
  'submitPaymentProof',
]);

describe('mobile API contract (OpenAPI 3.1)', () => {
  for (const api of ['mobile', 'admin'] as const) {
    it(`openapi/${api}.v1.json is up to date (run: npx tsx scripts/openapi.ts)`, () => {
      const committed = JSON.parse(readFileSync(join(process.cwd(), 'openapi', `${api}.v1.json`), 'utf8'));
      expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi(api))));
      expect(committed.openapi).toBe('3.1.0');
    });
  }

  it('every route definition is mounted by a src/app/api/v1 route file exporting its method', () => {
    for (const r of ALL_API_ROUTES) {
      const file = join(process.cwd(), 'src/app', r.path.replace(/\{(\w+)\}/g, '[$1]'), 'route.ts');
      expect(existsSync(file), `${r.id}: ${file}`).toBe(true);
      expect(readFileSync(file, 'utf8'), r.id).toMatch(new RegExp(`export const ${r.method} = toHandler\\(\\w+\\)`));
    }
  });

  it('operation ids are unique, and admin routes live only under /api/v1/admin', () => {
    const ids = ALL_API_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ADMIN_API_ROUTES) expect(r.path.startsWith('/api/v1/admin/')).toBe(true);
    for (const r of MOBILE_API_ROUTES) expect(r.path.startsWith('/api/v1/admin/')).toBe(false);
  });

  it('admin routes use admin auth modes; customer routes never do', () => {
    for (const r of ADMIN_API_ROUTES) expect(['none', 'admin', 'admin-pre-mfa']).toContain(r.auth);
    for (const r of MOBILE_API_ROUTES) expect(['admin', 'admin-pre-mfa']).not.toContain(r.auth);
  });

  it('credential-returning endpoints are never idempotency-cached; session mutations are', () => {
    for (const r of ALL_API_ROUTES) {
      const returnsTokens = /login|register|refresh|invite|invitation/i.test(r.id) && r.method !== 'GET' && !/revoke|claim|decline/i.test(r.id);
      if (returnsTokens) expect(r.idempotency, r.id).toBeUndefined();
      if (r.method === 'DELETE' || /revoke/i.test(r.id)) expect(r.idempotency, r.id).toBe('required');
    }
  });

  it('Phase 1 exposes no money-moving or privileged financial operation', () => {
    // Money EXECUTION (release, settlement, refunds, ledger, transfers) never exists on the mobile API.
    for (const r of ALL_API_ROUTES) expect(r.path, r.id).not.toMatch(/withdraw|settle|refund|release|ledger|journal|real-?money|kill-?switch|transfer|paid/i);
    // Payout paths: ONLY the owner-approved REQUEST routes (spec §20 — "request only; transfer execution stays blocked").
    for (const r of ALL_API_ROUTES.filter((x) => /payout/i.test(x.path))) {
      expect(PAYOUT_REQUEST_ROUTES.has(r.id) || ACCOUNT_PAYOUT_ROUTES.has(r.id), `unreviewed payout route ${r.id}`).toBe(true);
      if (PAYOUT_REQUEST_ROUTES.has(r.id)) expect(r.auth === 'seller' || r.id === 'addSellerPayoutAccount', r.id).toBe(true);
      else expect(r.auth, r.id).toBe('customer');
    }
    // An account payout request names an amount, one of MY verified destinations and its idempotency key — nothing else.
    const acc = ALL_API_ROUTES.find((r) => r.id === 'createAccountPayoutRequest')!;
    expect(Object.keys((acc.body as unknown as { shape: Record<string, unknown> }).shape).sort()).toEqual(['amountPiastres', 'clientKey', 'destination']);
    const create = ALL_API_ROUTES.find((r) => r.id === 'createSellerPayoutRequest')!;
    expect(Object.keys((create.body as unknown as { shape: Record<string, unknown> }).shape).sort()).toEqual(['amountPiastres', 'clientKey']);
    // Every state-changing operation is listed here BY ID: a new write route fails this test until it is reviewed
    // and added on purpose. None of them moves money: proof upload only queues a TEST payment for staff review,
    // confirm-receipt only records the buyer's confirmation (release stays Maker/Checker in the admin console).
    const ALLOWED_WRITES = new Set([
      // auth / account / security (Phase 1)
      ...ALL_API_ROUTES.filter((r) => r.method !== 'GET' && /Auth|Account|Security/.test(r.tags.join(' ')) && !BUYER_WRITES.has(r.id)).map((r) => r.id),
      ...BUYER_WRITES,
      ...SELLER_WRITES,
      ...APPLICATION_WRITES,
      ...DEAL_WRITES,
      ...CUSTOMER_MESSAGE_WRITES,
      ...STORE_MESSAGE_WRITES,
      ...WALLET_WRITES,
      ...BUYER_POSTPURCHASE_WRITES,
      ...STORE_POSTPURCHASE_WRITES,
      ...NOTIFICATION_WRITES,
    ]);
    const writes = ALL_API_ROUTES.filter((r) => r.method !== 'GET');
    for (const r of writes) expect(ALLOWED_WRITES.has(r.id), `unreviewed write route ${r.id}`).toBe(true);
    for (const r of writes.filter((w) => BUYER_WRITES.has(w.id))) {
      expect(r.api, r.id).toBe('mobile');
      // Identity always comes from the session, never from the client.
      expect(['customer', 'none'], r.id).toContain(r.auth);
      if (r.auth === 'none') expect(r.tags, r.id).toContain('Auth');
      const body = r.body as { shape?: Record<string, unknown> } | undefined;
      for (const f of Object.keys(body?.shape ?? {})) expect(f, `${r.id} accepts a client-supplied identity`).not.toMatch(/^(userId|customerId|sellerId|storeId|buyerId|ownerId|actorId)$/i);
    }
    for (const r of writes.filter((w) => SELLER_WRITES.has(w.id))) {
      // Seller writes act for the session user's own store only (auth `seller`), never for a client-named store.
      expect(r.auth, r.id).toBe('seller');
      const body = r.body as { shape?: Record<string, unknown> } | undefined;
      for (const f of Object.keys(body?.shape ?? {})) expect(f, `${r.id} accepts a client-supplied identity`).not.toMatch(/^(userId|customerId|sellerId|storeId|buyerId|ownerId|actorId)$/i);
    }
    for (const r of writes.filter((w) => APPLICATION_WRITES.has(w.id) || DEAL_WRITES.has(w.id))) {
      expect(r.auth, r.id).toBe('customer');
      const body = r.body as { shape?: Record<string, unknown> } | undefined;
      for (const f of Object.keys(body?.shape ?? {})) expect(f, `${r.id} accepts a client-supplied identity`).not.toMatch(/^(userId|customerId|sellerId|storeId|buyerId|ownerId|actorId)$/i);
    }
    for (const r of writes.filter((w) => CUSTOMER_MESSAGE_WRITES.has(w.id) || STORE_MESSAGE_WRITES.has(w.id))) {
      expect(r.auth, r.id).toBe(STORE_MESSAGE_WRITES.has(r.id) ? 'seller' : 'customer');
      const body = r.body as { shape?: Record<string, unknown> } | undefined;
      // Never a free-form recipient: the counterparty always comes from the order / deal the conversation is bound to.
      for (const f of Object.keys(body?.shape ?? {})) expect(f, `${r.id} accepts a client-supplied identity or recipient`).not.toMatch(/^(userId|customerId|sellerId|storeId|buyerId|ownerId|actorId|recipient\w*|to)$/i);
    }
    for (const r of writes.filter((w) => WALLET_WRITES.has(w.id))) {
      expect(r.auth, r.id).toBe('customer');
      const body = r.body as { shape?: Record<string, unknown> } | undefined;
      for (const f of Object.keys(body?.shape ?? {})) expect(f, `${r.id} accepts a client-supplied identity`).not.toMatch(/^(userId|customerId|sellerId|storeId|buyerId|ownerId|actorId)$/i);
    }
    for (const r of writes.filter((w) => BUYER_POSTPURCHASE_WRITES.has(w.id) || STORE_POSTPURCHASE_WRITES.has(w.id))) {
      expect(r.auth, r.id).toBe(STORE_POSTPURCHASE_WRITES.has(r.id) ? 'seller' : 'customer');
      expect(r.idempotency, r.id).toBe('required');
      const body = r.body as { shape?: Record<string, unknown> } | undefined;
      for (const f of Object.keys(body?.shape ?? {})) expect(f, `${r.id} accepts a client-supplied identity or decision`).not.toMatch(/^(userId|customerId|sellerId|storeId|buyerId|ownerId|actorId|decision|amount|refundAmount)$/i);
    }
    for (const r of writes.filter((w) => NOTIFICATION_WRITES.has(w.id))) {
      expect(r.auth, r.id).toBe('customer');
      const body = r.body as { shape?: Record<string, unknown> } | undefined;
      for (const f of Object.keys(body?.shape ?? {})) expect(f, `${r.id} accepts a client-supplied identity`).not.toMatch(/^(userId|customerId|sellerId|storeId|buyerId|ownerId|actorId)$/i);
    }
    // No dispute DECISION and no refund execution on the mobile API.
    for (const r of ALL_API_ROUTES) expect(r.id, r.id).not.toMatch(/resolveDispute|decideDispute|closeDispute|approveRefund|payRefund/i);
    for (const r of writes) expect(r.auth, r.id).not.toBe('optional-customer');
  });

  it('every documented error code is a stable snake_case code from the catalogue', () => {
    const doc = buildOpenApi('mobile') as { components: { schemas: { ErrorCode: { enum: string[] } } } };
    expect(doc.components.schemas.ErrorCode.enum).toEqual([...API_ERROR_CODES]);
    for (const c of API_ERROR_CODES) expect(c).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('API routes and their mounts never import the database layer (services own data access)', () => {
    for (const r of ALL_API_ROUTES) {
      const file = join(process.cwd(), 'src/app', r.path.replace(/\{(\w+)\}/g, '[$1]'), 'route.ts');
      expect(readFileSync(file, 'utf8')).not.toMatch(/@\/server\/db|drizzle-orm/);
    }
    for (const f of ['public', 'customer', 'admin', 'index']) {
      expect(readFileSync(join(process.cwd(), 'src/server/api/routes', `${f}.ts`), 'utf8')).not.toMatch(/@\/server\/db|drizzle-orm/);
    }
  });

  it('the Flutter models in packages/edmn_api are generated from the committed contract (run: npx tsx scripts/generate-dart-api.ts)', () => {
    expect(() => execFileSync('npx', ['tsx', 'scripts/generate-dart-api.ts', '--check'], { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow();
  }, 60_000);
});
