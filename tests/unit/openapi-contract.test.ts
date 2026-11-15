import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@/server/api/errors';
import { buildOpenApi } from '@/server/api/openapi';
import { ADMIN_API_ROUTES, ALL_API_ROUTES, MOBILE_API_ROUTES } from '@/server/api/routes';

/** The committed OpenAPI documents are the reviewed contract: they must equal what the route definitions generate. */
/** Seller fulfilment / inventory writes reviewed for the Customer App's Seller Center (no money movement). */
const SELLER_WRITES = new Set(['runSellerOrderStep', 'saveSellerShipment', 'setSellerVariantStock']);

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
      const returnsTokens = /login|register|refresh/i.test(r.id);
      if (returnsTokens) expect(r.idempotency, r.id).toBeUndefined();
      if (r.method === 'DELETE' || /revoke/i.test(r.id)) expect(r.idempotency, r.id).toBe('required');
    }
  });

  it('Phase 1 exposes no money-moving or privileged financial operation', () => {
    for (const r of ALL_API_ROUTES) expect(r.path).not.toMatch(/withdraw|settle|payout|refund|release|ledger|journal|real-?money|kill-?switch/i);
    // Every state-changing operation is listed here BY ID: a new write route fails this test until it is reviewed
    // and added on purpose. None of them moves money: proof upload only queues a TEST payment for staff review,
    // confirm-receipt only records the buyer's confirmation (release stays Maker/Checker in the admin console).
    const ALLOWED_WRITES = new Set([
      // auth / account / security (Phase 1)
      ...ALL_API_ROUTES.filter((r) => r.method !== 'GET' && /Auth|Account|Security/.test(r.tags.join(' ')) && !BUYER_WRITES.has(r.id)).map((r) => r.id),
      ...BUYER_WRITES,
      ...SELLER_WRITES,
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
