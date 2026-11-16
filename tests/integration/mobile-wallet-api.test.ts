import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as storeFundsRoute } from '@/app/api/v1/seller/funds/route';
import { GET as storePayoutAccountRoute } from '@/app/api/v1/seller/payout-account/route';
import { GET as statementRoute } from '@/app/api/v1/seller/statement/route';
import { GET as activityDetailRoute } from '@/app/api/v1/wallet/activity/[activityId]/route';
import { GET as activityRoute } from '@/app/api/v1/wallet/activity/route';
import { POST as cancelRoute } from '@/app/api/v1/wallet/payout-requests/[requestId]/cancel/route';
import { POST as previewRoute } from '@/app/api/v1/wallet/payout-requests/preview/route';
import { GET as requestsRoute, POST as requestRoute } from '@/app/api/v1/wallet/payout-requests/route';
import { POST as archiveRoute } from '@/app/api/v1/wallet/receiving-accounts/[accountId]/archive/route';
import { GET as accountsRoute, POST as addAccountRoute } from '@/app/api/v1/wallet/receiving-accounts/route';
import { GET as walletRoute } from '@/app/api/v1/wallet/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { journalEntries, sellerMembers, withdrawalRequests, orders, payments, refunds } from '@/server/db/schema';
import { financialInvariants } from '@/server/modules/finance/controls';
import { approveWithdrawal, markWithdrawalProcessing, markWithdrawalTransferUncertain } from '@/server/modules/finance/withdrawals';
import { identityStatus } from '@/server/modules/identity/service';
import { approveIdentity, checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * Flow G — the wallet through the REAL mobile routes. Balances come from the ledger (holds and in-flight requests are
 * never withdrawable); a payout is a REQUEST only (one per clientKey, posts nothing, reserved only by a two-person
 * approval in the admin console); TRANSFER_UNCERTAIN stays uncertain; receiving accounts need staff verification;
 * the store statement needs finance.view. The ledger stays balanced throughout.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, opts: { method?: string; body?: unknown; token?: string; params?: Record<string, string>; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email: string) {
  const r = await call(loginRoute, '/auth/login', { body: { identifier: email, password: 'Test@12345', device: { installationId: key(), platform: 'ANDROID' } } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

describe('Flow G — wallet', () => {
  it('a buyer with no earnings: zero balances, no top-up flow, payments listed as activity (TEST)', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 120_00, stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const t = await login(c.user.email!);
    const w = await call(walletRoute, '/wallet', { token: t });
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    expect(w.body).toMatchObject({ hasEarnings: false, topUpAvailable: false, realMoney: false, sources: [] });
    expect(w.body.balances.availablePiastres).toBe(0);
    expect(w.body.payout.blockReason).not.toBeNull();
    const a = await call(activityRoute, '/wallet/activity', { token: t });
    const pay = a.body.items.find((x: { kind: string }) => x.kind === 'PAYMENT');
    expect(pay).toMatchObject({ direction: 'OUT', isTest: true, link: { kind: 'PAYMENT' } });
    expect(pay.ref).toBe(`#${order.number}`);
    // Filters run on the server.
    expect((await call(activityRoute, '/wallet/activity?kind=REFUND', { token: t })).body.items).toEqual([]);
    expect((await call(activityRoute, `/wallet/activity?q=${order.number}`, { token: t })).body.items).toHaveLength(1);
  });

  it('store owner: ledger balances, request-only payout (idempotent, posts nothing), approval reserves, TRANSFER_UNCERTAIN stays uncertain', async () => {
    const s = await makeSeller(admin);
    if ((await identityStatus(db, s.user.id)) !== 'APPROVED') await approveIdentity(s.user.id);
    const p = await makeProduct(s.actor, admin, { price: 1000_00, stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id);
    const t = await login(s.user.email!);

    const w = await call(walletRoute, '/wallet', { token: t });
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    expect(w.body.hasEarnings).toBe(true);
    expect(w.body.sources.map((x: { source: string }) => x.source)).toContain('MARKETPLACE');
    // Same number as the store funds endpoint (one source of truth: the finance service).
    const funds = await call(storeFundsRoute, '/seller/funds', { token: t });
    expect(w.body.balances.availablePiastres).toBe(funds.body.withdrawablePiastres);
    const available = w.body.balances.availablePiastres as number;
    expect(available).toBeGreaterThan(0);
    expect(w.body.payout.destinations[0]).toMatchObject({ key: 'STORE_PAYOUT_METHOD', scope: 'STORE_AND_DEALS' });
    expect(w.body.payout.blockReason).toBeNull();
    expect((await call(storePayoutAccountRoute, '/seller/payout-account', { token: t })).body.account.label).toBe(w.body.payout.destinations[0].label);

    // More than available → refused, nothing created.
    const big = await call(requestRoute, '/wallet/payout-requests', { token: t, body: { amountPiastres: available + 1, destination: 'STORE_PAYOUT_METHOD', clientKey: key() } });
    expect(big.status).toBeGreaterThanOrEqual(400);
    expect(big.status).toBeLessThan(500);
    // Someone else's destination id is refused.
    const strangerDest = await call(requestRoute, '/wallet/payout-requests', { token: t, body: { amountPiastres: 100_00, destination: '11111111-1111-4111-8111-111111111111', clientKey: key() } });
    expect(strangerDest.status).toBeGreaterThanOrEqual(400);

    const pv = await call(previewRoute, '/wallet/payout-requests/preview', { token: t, body: { amountPiastres: 100_00, destination: 'STORE_PAYOUT_METHOD' } });
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    expect(pv.body.fits).toBe(true);
    expect(pv.body).toHaveProperty('transferCostPiastres');
    expect(pv.body.netPiastres).toBe(pv.body.amountPiastres - pv.body.transferCostPiastres);
    const belowMinimum = await call(previewRoute, '/wallet/payout-requests/preview', { token: t, body: { amountPiastres: 1, destination: 'STORE_PAYOUT_METHOD' } });
    expect(belowMinimum.status).toBe(422);

    const entriesBefore = (await db.select().from(journalEntries)).length;
    const ck = key();
    const r1 = await call(requestRoute, '/wallet/payout-requests', { token: t, body: { amountPiastres: 100_00, destination: 'STORE_PAYOUT_METHOD', clientKey: ck } });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    // Store-destination requests belong to the store: cancelled from the Seller Center (finance.withdraw), as on the web.
    expect(r1.body).toMatchObject({ created: true, request: { status: 'REQUESTED', cancellable: false, isTest: true } });
    const r2 = await call(requestRoute, '/wallet/payout-requests', { token: t, body: { amountPiastres: 100_00, destination: 'STORE_PAYOUT_METHOD', clientKey: ck } });
    expect(r2.body).toMatchObject({ created: false, request: { id: r1.body.request.id } });
    const changed = await call(requestRoute, '/wallet/payout-requests', { token: t, body: { amountPiastres: 200_00, destination: 'STORE_PAYOUT_METHOD', clientKey: ck } });
    expect(changed.status).toBe(409);
    expect(await db.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.userId, s.user.id), eq(withdrawalRequests.clientKey, ck)))).toHaveLength(1);
    expect((await db.select().from(journalEntries)).length).toBe(entriesBefore); // a request posts nothing

    // Another customer can neither cancel nor see it.
    const other = await makeCustomer();
    const ot = await login(other.user.email!);
    expect((await call(cancelRoute, `/wallet/payout-requests/${r1.body.request.id}/cancel`, { token: ot, idem: key(), params: { requestId: r1.body.request.id } })).status).toBe(404);
    expect((await call(requestsRoute, '/wallet/payout-requests', { token: ot })).body.items).toEqual([]);

    expect((await call(cancelRoute, `/wallet/payout-requests/${r1.body.request.id}/cancel`, { token: t, idem: key(), params: { requestId: r1.body.request.id } })).status).toBe(404);

    // A second request is approved in the admin console (two-person): funds are reserved, not withdrawable, not cancellable.
    const r3 = await call(requestRoute, '/wallet/payout-requests', { token: t, body: { amountPiastres: 200_00, destination: 'STORE_PAYOUT_METHOD', clientKey: key() } });
    const id = r3.body.request.id as string;
    await approveWithdrawal(await makeAdmin(['FINANCE_CHECKER']), id);
    const after = await call(walletRoute, '/wallet', { token: t });
    expect(after.body.balances.reservedPiastres).toBe(200_00);
    expect(after.body.balances.availablePiastres).toBe(available - 200_00);
    const listed = (await call(requestsRoute, '/wallet/payout-requests', { token: t })).body.items.find((x: { id: string }) => x.id === id);
    expect(listed).toMatchObject({ status: 'APPROVED', cancellable: false });
    expect(listed.sources.length).toBeGreaterThan(0);
    expect((await call(cancelRoute, `/wallet/payout-requests/${id}/cancel`, { token: t, idem: key(), params: { requestId: id } })).status).toBeGreaterThanOrEqual(400);

    // Transfer uncertain: shown as such; the money stays reserved (neither returned nor treated as paid).
    const operator = await makeAdmin(['FINANCE_OPERATOR']);
    await markWithdrawalProcessing(operator, id);
    await markWithdrawalTransferUncertain(operator, id, 'مهلة مزود الدفع بدون نتيجة واضحة');
    const unc = (await call(requestsRoute, '/wallet/payout-requests', { token: t })).body.items.find((x: { id: string }) => x.id === id);
    expect(unc).toMatchObject({ status: 'TRANSFER_UNCERTAIN', cancellable: false, reference: null });
    const w3 = await call(walletRoute, '/wallet', { token: t });
    expect(w3.body.balances.reservedPiastres).toBe(200_00);
    expect(w3.body.balances.availablePiastres).toBe(available - 200_00);
    const act = await call(activityRoute, '/wallet/activity?kind=PAYOUT', { token: t });
    expect(act.body.items.find((x: { id: string }) => x.id === id)).toMatchObject({ status: 'TRANSFER_UNCERTAIN', direction: 'OUT' });

    // Statement (finance.view) — a catalog manager is refused.
    const st = await call(statementRoute, '/seller/statement', { token: t });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    expect(st.body.totals.grossSalesPiastres).toBeGreaterThan(0);
    expect(st.body.rows.length).toBeGreaterThan(0);
    const cat = await makeUser();
    await db.insert(sellerMembers).values({ sellerId: s.actor.sellerId!, userId: cat.id, role: 'CATALOG_MANAGER' });
    expect((await call(statementRoute, '/seller/statement', { token: await login(cat.email!) })).status).toBe(403);

    const inv = await financialInvariants(db);
    expect(inv.checks.find((x) => x.code === 'TRIAL_BALANCE')!.count).toBe(0);
    expect(inv.checks.find((x) => x.code === 'UNBALANCED_ENTRY')!.count).toBe(0);
  });

  it('receiving accounts: submitted for review (not usable until verified), owner-only archive, validation', async () => {
    const c = await makeCustomer();
    const t = await login(c.user.email!);
    const bad = await call(addAccountRoute, '/wallet/receiving-accounts', { token: t, idem: key(), body: { account: { type: 'INSTAPAY', holderName: 'منى السيد أحمد', instapayAddress: 'x' } } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const ok = await call(addAccountRoute, '/wallet/receiving-accounts', { token: t, idem: key(), body: { account: { type: 'INSTAPAY', holderName: 'منى السيد أحمد', instapayAddress: 'mona.sayed@instapay' } } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const acc = ok.body.items[0];
    expect(acc).toMatchObject({ type: 'INSTAPAY', status: 'PENDING_REVIEW' });
    expect(acc.label).not.toContain('mona.sayed@instapay'); // masked
    const w = await call(walletRoute, '/wallet', { token: t });
    expect(w.body.payout.destinations).toEqual([]); // not verified → not offered
    const other = await makeCustomer();
    expect((await call(archiveRoute, `/wallet/receiving-accounts/${acc.id}/archive`, { token: await login(other.user.email!), idem: key(), params: { accountId: acc.id } })).status).toBe(404);
    const ar = await call(archiveRoute, `/wallet/receiving-accounts/${acc.id}/archive`, { token: t, idem: key(), params: { accountId: acc.id } });
    expect(ar.status).toBe(200);
    expect((await call(accountsRoute, '/wallet/receiving-accounts', { token: t })).body.items).toEqual([]);
  });
  it('searches older records before pagination, supports provider text, refreshes details, isolates owners and derives refund mode from payment', async () => {
    const c = await makeCustomer();
    const t = await login(c.user.email!);
    const batch = Array.from({ length: 105 }, () => ({ id: randomUUID(), customerId: c.user.id, status: 'PENDING_PAYMENT' as const,
      merchandiseTotal: 10000, shippingTotal: 0, discountTotal: 0, grandTotal: 10000,
      shippingAddress: {}, governorateId: 1, paymentMethod: 'INSTAPAY' as const, paymentDueAt: new Date(), checkoutKey: key() }));
    await db.insert(orders).values(batch);
    const ps = await db.insert(payments).values(batch.map((o, i) => ({ orderId: o.id, payerUserId: c.user.id, method: 'INSTAPAY' as const,
      amountDue: 10000, dueAt: new Date(), createdAt: new Date(Date.now() - (i + 1) * 1000), providerReference: i === 104 ? 'old-ABC-reference' : null, isTest: i !== 104 }))).returning();
    const old = ps.find((p) => p.providerReference)!;
    const found = await call(activityRoute, '/wallet/activity?q=ABC', { token: t });
    expect(found.body.items.map((r: {id: string}) => r.id)).toEqual([old.id]);
    const page1 = await call(activityRoute, '/wallet/activity?pageSize=100', { token: t });
    const page2 = await call(activityRoute, '/wallet/activity?pageSize=100&page=2', { token: t });
    expect(page1.body.hasMore).toBe(true);
    expect(page2.body.items).toHaveLength(5);
    expect(page2.body.hasMore).toBe(false);
    expect(new Set([...page1.body.items, ...page2.body.items].map((x: {id: string}) => x.id)).size).toBe(105);
    const detail = await call(activityDetailRoute, `/wallet/activity/${old.id}`, { token: t, params: { activityId: old.id } });
    expect(detail.body.id).toBe(old.id);
    const other = await makeCustomer();
    expect((await call(activityDetailRoute, `/wallet/activity/${old.id}`, { token: await login(other.user.email!), params: { activityId: old.id } })).status).toBe(404);
    await db.insert(refunds).values({ sourceType: 'ADMIN', sourceId: old.id, customerId: c.user.id, amount: 1000, originalPaymentId: old.id, reason: 'اختبار سجل الاسترداد' });
    const rs = await call(activityRoute, '/wallet/activity?kind=REFUND', { token: t });
    // The platform is in TEST mode, but this payment's immutable snapshot is real.
    expect(rs.body.items[0].isTest).toBe(false);
    await db.insert(refunds).values({ sourceType: 'ADMIN', sourceId: randomUUID(), customerId: c.user.id, amount: 1000, reason: 'سجل قديم بلا دفعة أصلية' });
    const legacy = await call(activityRoute, '/wallet/activity?kind=REFUND', { token: t });
    expect(legacy.body.items.some((r: {isTest: boolean | null}) => r.isTest === null)).toBe(true);
  });

});
