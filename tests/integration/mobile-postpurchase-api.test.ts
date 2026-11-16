import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as reviewsPublicRoute } from '@/app/api/v1/catalog/products/[slug]/reviews/route';
import { POST as replyRoute } from '@/app/api/v1/disputes/[disputeId]/messages/route';
import { GET as disputeRoute } from '@/app/api/v1/disputes/[disputeId]/route';
import { GET as disputesRoute, POST as openDisputeRoute } from '@/app/api/v1/disputes/route';
import { GET as fileRoute } from '@/app/api/v1/files/[fileId]/route';
import { GET as orderRoute } from '@/app/api/v1/orders/[orderId]/route';
import { POST as escalateRoute } from '@/app/api/v1/returns/[returnId]/escalate/route';
import { GET as returnRoute } from '@/app/api/v1/returns/[returnId]/route';
import { POST as shipBackRoute } from '@/app/api/v1/returns/[returnId]/ship-back/route';
import { GET as myReturnsRoute, POST as createReturnRoute } from '@/app/api/v1/returns/route';
import { POST as reviewProductRoute } from '@/app/api/v1/reviews/products/route';
import { POST as reviewSellerRoute } from '@/app/api/v1/reviews/sellers/route';
import { GET as returnOptionsRoute } from '@/app/api/v1/seller-orders/[sellerOrderId]/return-options/route';
import { GET as reviewOptionsRoute } from '@/app/api/v1/seller-orders/[sellerOrderId]/review-options/route';
import { POST as storeReplyRoute } from '@/app/api/v1/seller/disputes/[disputeId]/messages/route';
import { GET as storeDisputeRoute } from '@/app/api/v1/seller/disputes/[disputeId]/route';
import { GET as storeDisputesRoute } from '@/app/api/v1/seller/disputes/route';
import { GET as storeReturnRoute } from '@/app/api/v1/seller/returns/[returnId]/route';
import { POST as storeStepRoute } from '@/app/api/v1/seller/returns/[returnId]/steps/route';
import { GET as storeReturnsRoute } from '@/app/api/v1/seller/returns/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { journalEntries, products, refunds, sellerMembers } from '@/server/db/schema';
import { confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { financialInvariants } from '@/server/modules/finance/controls';
import { resolveDispute } from '@/server/modules/postpurchase/disputes';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, png, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * Phase 5 journeys through the REAL mobile routes: return request → store handling → refund REQUEST (finance approves);
 * dispute → store reply with evidence → EDMN decision in the admin console → both parties see it; reviews (verified,
 * once); strangers get uniform 404s, including on private evidence; a replayed refund step creates no second refund.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, opts: { method?: string; body?: unknown; form?: FormData; token?: string; params?: Record<string, string>; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) }), { params: Promise.resolve(opts.params ?? {}) });
  if (!(res.headers.get('content-type') ?? '').includes('json')) return { status: res.status, body: null };
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

/** A delivered (buyer-confirmed, not yet released) seller order. */
async function deliveredOrder(qty = 2) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price: 400_00, stock: 10 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  await shipIt(s.actor, so.id);
  await confirmReceipt(c.actor, so.id);
  return { s, p, c, order, so, bt: await login(c.user.email!), st: await login(s.user.email!) };
}

describe('Returns (journeys 1, 2, 7, 10)', () => {
  it('buyer requests a return; the store approves, receives and accepts; one refund REQUEST only; finance approves it', async () => {
    const { s, order, so, bt, st } = await deliveredOrder(2);
    const sop = { sellerOrderId: so.id };
    const acts = (await call(orderRoute, `/orders/${order.id}`, { token: bt, params: { orderId: order.id } })).body.sellerOrders[0].allowedActions;
    expect(acts).toEqual(expect.arrayContaining(['REQUEST_RETURN', 'WRITE_REVIEW', 'OPEN_DISPUTE']));

    const opt = await call(returnOptionsRoute, `/seller-orders/${so.id}/return-options`, { token: bt, params: sop });
    expect(opt.status, JSON.stringify(opt.body)).toBe(200);
    expect(opt.body.eligible).toBe(true);
    expect(opt.body.items[0].returnableQuantity).toBe(2);
    expect(opt.body.reasons.find((r: { code: string }) => r.code === 'DAMAGED')).toMatchObject({ requiresEvidence: true, protected: true });
    expect(opt.body.window.protectedDeadline).toBeTruthy();
    const itemId = opt.body.items[0].orderItemId as string;

    // Damaged without photos → refused by the service.
    const noPhoto = new FormData();
    noPhoto.set('sellerOrderId', so.id);
    noPhoto.set('reason', 'DAMAGED');
    noPhoto.set('description', 'الشاشة وصلت مكسورة من الزاوية');
    noPhoto.set('items', JSON.stringify([{ orderItemId: itemId, quantity: 1 }]));
    expect((await call(createReturnRoute, '/returns', { token: bt, idem: key(), form: noPhoto })).status).toBeGreaterThanOrEqual(400);

    const form = () => {
      const f = new FormData();
      f.set('sellerOrderId', so.id);
      f.set('reason', 'DAMAGED');
      f.set('description', 'الشاشة وصلت مكسورة من الزاوية');
      f.set('items', JSON.stringify([{ orderItemId: itemId, quantity: 1 }]));
      return f;
    };
    const photo = async () => {
      const f = form();
      f.append('evidence', new Blob([new Uint8Array(await png('broken'))], { type: 'image/png' }), 'broken.png');
      return f;
    };
    const idem = key();
    const r1 = await call(createReturnRoute, '/returns', { token: bt, idem, form: await photo() });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body).toMatchObject({ status: 'REQUESTED', side: 'BUYER', allowedActions: [] });
    const replay = await call(createReturnRoute, '/returns', { token: bt, idem, form: await photo() });
    expect(replay.body.id).toBe(r1.body.id); // one return per intent
    expect((await call(myReturnsRoute, '/returns', { token: bt })).body.items).toHaveLength(1);
    const id = r1.body.id as string;
    const rp = { returnId: id };

    // Store side: visible, steps from the server.
    const list = await call(storeReturnsRoute, '/seller/returns', { token: st });
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(id);
    const sv = await call(storeReturnRoute, `/seller/returns/${id}`, { token: st, params: rp });
    expect(sv.body).toMatchObject({ side: 'STORE' });
    expect(sv.body.allowedActions).toEqual(expect.arrayContaining(['APPROVE', 'REJECT']));
    expect(sv.body.evidence).toHaveLength(1);
    // A step not allowed now is refused.
    expect((await call(storeStepRoute, `/seller/returns/${id}/steps`, { token: st, idem: key(), params: rp, body: { step: 'ACCEPT' } })).status).toBeGreaterThanOrEqual(400);
    const ap = await call(storeStepRoute, `/seller/returns/${id}/steps`, { token: st, idem: key(), params: rp, body: { step: 'APPROVE', note: 'ابعته على عنوان المرتجعات' } });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect(ap.body.status).toBe('APPROVED');

    const bv = await call(returnRoute, `/returns/${id}`, { token: bt, params: rp });
    expect(bv.body.allowedActions).toContain('SHIP_BACK');
    const sb = await call(shipBackRoute, `/returns/${id}/ship-back`, { token: bt, idem: key(), params: rp, body: { carrier: 'بوسطة', tracking: 'BOS-12345' } });
    expect(sb.body).toMatchObject({ status: 'RETURN_IN_TRANSIT', returnCarrier: 'بوسطة' });

    await call(storeStepRoute, `/seller/returns/${id}/steps`, { token: st, idem: key(), params: rp, body: { step: 'MARK_RECEIVED' } });
    const entriesBefore = (await db.select().from(journalEntries)).length;
    const acceptKey = key();
    const acc = await call(storeStepRoute, `/seller/returns/${id}/steps`, { token: st, idem: acceptKey, params: rp, body: { step: 'ACCEPT', restock: true } });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.status).toBe('REFUND_PENDING');
    expect(acc.body.refunds).toHaveLength(1);
    expect(acc.body.refunds[0].status).not.toBe('PAID');
    // Journey 10: replays (same key = cached; new key = step no longer allowed) never create a second refund.
    expect((await call(storeStepRoute, `/seller/returns/${id}/steps`, { token: st, idem: acceptKey, params: rp, body: { step: 'ACCEPT', restock: true } })).body.refunds).toHaveLength(1);
    expect((await call(storeStepRoute, `/seller/returns/${id}/steps`, { token: st, idem: key(), params: rp, body: { step: 'ACCEPT', restock: true } })).status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(refunds).where(and(eq(refunds.sourceType, 'RETURN'), eq(refunds.sourceId, id)))).toHaveLength(1);
    expect((await db.select().from(journalEntries)).length).toBe(entriesBefore); // a refund REQUEST posts nothing

    // Journey 7: the refund follows the existing finance workflow (two-person approval in the admin console).
    const { approveRefundsOf } = await import('../helpers/factory');
    await approveRefundsOf(so.id);
    const after = await call(returnRoute, `/returns/${id}`, { token: bt, params: rp });
    expect(after.body.refunds[0].status).not.toBe('REQUESTED');
    const inv = await financialInvariants(db);
    expect(inv.checks.find((x) => x.code === 'TRIAL_BALANCE')!.count).toBe(0);
    expect(inv.checks.find((x) => x.code === 'UNBALANCED_ENTRY')!.count).toBe(0);

    // A catalog member of the store cannot handle returns.
    const cat = await makeUser();
    await db.insert(sellerMembers).values({ sellerId: s.actor.sellerId!, userId: cat.id, role: 'CATALOG_MANAGER' });
    expect((await call(storeReturnsRoute, '/seller/returns', { token: await login(cat.email!) })).status).toBe(403);
  });

  it('a rejected return can be escalated by the buyer to an EDMN dispute', async () => {
    const { so, bt, st } = await deliveredOrder(1);
    const opt = await call(returnOptionsRoute, `/seller-orders/${so.id}/return-options`, { token: bt, params: { sellerOrderId: so.id } });
    const f = new FormData();
    f.set('sellerOrderId', so.id);
    f.set('reason', 'CHANGED_MIND');
    f.set('description', 'المقاس مش مناسب ليا خالص');
    f.set('items', JSON.stringify([{ orderItemId: opt.body.items[0].orderItemId, quantity: 1 }]));
    const r = await call(createReturnRoute, '/returns', { token: bt, idem: key(), form: f });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rp = { returnId: r.body.id };
    await call(storeStepRoute, `/seller/returns/${r.body.id}/steps`, { token: st, idem: key(), params: rp, body: { step: 'REJECT', reason: 'المنتج اتفتح واستُخدم' } });
    const v = await call(returnRoute, `/returns/${r.body.id}`, { token: bt, params: rp });
    expect(v.body).toMatchObject({ status: 'REJECTED', decisionReason: 'المنتج اتفتح واستُخدم' });
    expect(v.body.allowedActions).toContain('ESCALATE');
    const e = await call(escalateRoute, `/returns/${r.body.id}/escalate`, { token: bt, idem: key(), params: rp, body: { description: 'المنتج ما اتفتحش، والصور بتثبت كده' } });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    const d = await call(disputeRoute, `/disputes/${e.body.disputeId}`, { token: bt, params: { disputeId: e.body.disputeId } });
    expect(d.body).toMatchObject({ role: 'CLAIMANT', returnId: r.body.id, status: 'OPEN' });
  });
});

describe('Disputes (journeys 3–6, 9)', () => {
  it('buyer opens; store replies with evidence; EDMN decides in the admin console; both parties see the decision; strangers see nothing', async () => {
    const { s, so, bt, st } = await deliveredOrder(1);
    const form = async () => {
      const f = new FormData();
      f.set('sellerOrderId', so.id);
      f.set('reasonCode', 'NOT_AS_DESCRIBED');
      f.set('description', 'اللون والمقاس مختلفين تمامًا عن صور الإعلان');
      f.set('claimedAmountPiastres', '40000');
      f.append('evidence', new Blob([new Uint8Array(await png('claim'))], { type: 'image/png' }), 'claim.png');
      return f;
    };
    const o = await call(openDisputeRoute, '/disputes', { token: bt, idem: key(), form: await form() });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    expect(o.body).toMatchObject({ status: 'OPEN', role: 'CLAIMANT', fundsFrozen: true, claimedAmountPiastres: 40000, context: { kind: 'ORDER' } });
    expect(o.body.allowedActions).toEqual(['REPLY', 'ADD_EVIDENCE']);
    // One open dispute per order.
    expect((await call(openDisputeRoute, '/disputes', { token: bt, idem: key(), form: await form() })).status).toBe(409);
    const id = o.body.id as string;
    const dp = { disputeId: id };

    // Store sees it and replies with a file.
    expect((await call(storeDisputesRoute, '/seller/disputes', { token: st })).body.items.map((x: { id: string }) => x.id)).toContain(id);
    const rf = new FormData();
    rf.set('body', 'المنتج مطابق للوصف، ودي صورة قبل الشحن');
    rf.append('attachment', new Blob([new Uint8Array(await png('proof'))], { type: 'image/png' }), 'proof.png');
    const sr = await call(storeReplyRoute, `/seller/disputes/${id}/messages`, { token: st, idem: key(), params: dp, form: rf });
    expect(sr.status, JSON.stringify(sr.body)).toBe(200);
    expect(sr.body.role).toBe('RESPONDENT');
    const bv = await call(disputeRoute, `/disputes/${id}`, { token: bt, params: dp });
    expect(bv.body.messages.find((m: { from: string }) => m.from === 'RESPONDENT')).toBeTruthy();
    expect(bv.body.evidence).toHaveLength(2);

    // Journey 9: strangers (customer and store catalog member) get uniform 404 / 403; private evidence stays private.
    const x = await makeCustomer();
    const xt = await login(x.user.email!);
    expect((await call(disputeRoute, `/disputes/${id}`, { token: xt, params: dp })).status).toBe(404);
    const xf = new FormData();
    xf.set('body', 'تدخل');
    expect((await call(replyRoute, `/disputes/${id}/messages`, { token: xt, idem: key(), params: dp, form: xf })).status).toBe(404);
    const fileId = bv.body.evidence[0].fileId as string;
    expect((await call(fileRoute, `/files/${fileId}`, { token: xt, params: { fileId } })).status).toBe(404);
    expect((await call(fileRoute, `/files/${fileId}`, { token: st, params: { fileId } })).status).toBe(200);
    const cat = await makeUser();
    await db.insert(sellerMembers).values({ sellerId: s.actor.sellerId!, userId: cat.id, role: 'CATALOG_MANAGER' });
    const ct = await login(cat.email!);
    expect((await call(storeDisputesRoute, '/seller/disputes', { token: ct })).status).toBe(403);
    expect((await call(storeDisputeRoute, `/seller/disputes/${id}`, { token: ct, params: dp })).status).toBe(404);

    // Journey 5: EDMN decides in the admin console (permission + fresh 2FA, outside the mobile API).
    await resolveDispute(admin, id, { decision: 'FULL_REFUND', reasonCode: 'ITEM_NOT_AS_DESCRIBED', note: 'الصور بتثبت إن المنتج مختلف عن الوصف' });
    for (const [h, path, t] of [[disputeRoute, `/disputes/${id}`, bt], [storeDisputeRoute, `/seller/disputes/${id}`, st]] as const) {
      const v = await call(h, path, { token: t, params: dp });
      expect(v.body).toMatchObject({ status: 'RESOLVED', fundsFrozen: false, allowedActions: [], decision: { code: 'FULL_REFUND' } });
      expect(v.body.decision.note).toContain('الصور');
    }
    // The decision only REQUESTS the refund (finance approves); no reply after the decision.
    const dv = await call(disputeRoute, `/disputes/${id}`, { token: bt, params: dp });
    expect(dv.body.refunds.length).toBeGreaterThanOrEqual(1);
    for (const r of dv.body.refunds) expect(r.status).not.toBe('PAID');
    const late = new FormData();
    late.set('body', 'رد بعد القرار');
    expect((await call(replyRoute, `/disputes/${id}/messages`, { token: bt, idem: key(), params: dp, form: late })).status).toBeGreaterThanOrEqual(400);
    expect((await call(disputesRoute, '/disputes', { token: bt })).body.items.find((d: { id: string }) => d.id === id)).toMatchObject({ decision: 'FULL_REFUND' });
    const inv = await financialInvariants(db);
    expect(inv.checks.find((c) => c.code === 'TRIAL_BALANCE')!.count).toBe(0);
  });
});

describe('Reviews (journey 8)', () => {
  it('verified purchase only, once per item / order; published reviews appear on the product page', async () => {
    const { p, so, bt } = await deliveredOrder(1);
    const sop = { sellerOrderId: so.id };
    const o = await call(reviewOptionsRoute, `/seller-orders/${so.id}/review-options`, { token: bt, params: sop });
    expect(o.body).toMatchObject({ eligible: true, sellerReviewed: false });
    const itemId = o.body.items[0].orderItemId as string;
    const f = () => {
      const x = new FormData();
      x.set('orderItemId', itemId);
      x.set('rating', '5');
      x.set('title', 'ممتاز');
      x.set('body', 'المنتج مطابق للوصف والتغليف كويس');
      return x;
    };
    const r = await call(reviewProductRoute, '/reviews/products', { token: bt, idem: key(), form: f() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items[0].reviewed).toBe(true);
    expect((await call(reviewProductRoute, '/reviews/products', { token: bt, idem: key(), form: f() })).status).toBe(409);
    const sr = await call(reviewSellerRoute, '/reviews/sellers', { token: bt, idem: key(), body: { sellerOrderId: so.id, rating: 4, deliveryRating: 5, body: 'شحن سريع' } });
    expect(sr.body.sellerReviewed).toBe(true);
    expect((await call(reviewSellerRoute, '/reviews/sellers', { token: bt, idem: key(), body: { sellerOrderId: so.id, rating: 1 } })).status).toBe(409);
    // Someone who did not buy cannot review.
    const x = await makeCustomer();
    const xt = await login(x.user.email!);
    const xf = new FormData();
    xf.set('orderItemId', itemId);
    xf.set('rating', '1');
    expect((await call(reviewProductRoute, '/reviews/products', { token: xt, idem: key(), form: xf })).status).toBeGreaterThanOrEqual(403);
    expect((await call(reviewOptionsRoute, `/seller-orders/${so.id}/review-options`, { token: xt, params: sop })).status).toBe(404);
    // Published on the product page.
    const [prod] = await db.select({ slug: products.slug }).from(products).where(eq(products.id, p.productId));
    const pub = await call(reviewsPublicRoute, `/catalog/products/${prod.slug}/reviews`, { params: { slug: prod.slug } });
    expect(pub.body.items.some((x: { rating: number; body: string | null }) => x.rating === 5 && x.body?.includes('مطابق'))).toBe(true);
  });
});
