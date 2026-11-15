import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { POST as claimRoute } from '@/app/api/v1/deal-invitations/claim/route';
import { POST as changeRespRoute } from '@/app/api/v1/deals/[dealId]/change-response/route';
import { POST as confirmRoute } from '@/app/api/v1/deals/[dealId]/confirm-receipt/route';
import { GET as codeRoute } from '@/app/api/v1/deals/[dealId]/delivery-code/route';
import { POST as verifyRoute } from '@/app/api/v1/deals/[dealId]/delivery-code/verify/route';
import { POST as inviteRoute } from '@/app/api/v1/deals/[dealId]/invitation/route';
import { POST as offerRespRoute } from '@/app/api/v1/deals/[dealId]/offer-response/route';
import { POST as offerRoute } from '@/app/api/v1/deals/[dealId]/offer/route';
import { POST as payRoute } from '@/app/api/v1/deals/[dealId]/payment/route';
import { GET as dealRoute } from '@/app/api/v1/deals/[dealId]/route';
import { POST as shippedRoute } from '@/app/api/v1/deals/[dealId]/shipped/route';
import { PUT as stepRoute } from '@/app/api/v1/deals/[dealId]/steps/[step]/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/v1/deals/route';
import { POST as proofRoute } from '@/app/api/v1/payments/[paymentId]/proof/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { externalDeals, journalEntries, paymentSubmissions } from '@/server/db/schema';
import { confirmPayment } from '@/server/modules/payments/service';
import { ensurePaymentSetup, makeAdmin, makeUser, png } from '../helpers/factory';

/**
 * Flow C — a Protected Deal between two app users through the REAL mobile routes: create → steps → invite → seller
 * joins and offers → buyer requests a change → seller accepts the change → buyer accepts → payment (receipt reviewed
 * by EDMN) → seller ships → buyer's single-use code verified by the seller → buyer confirms receipt. The app can never
 * release money: the deal ends "entitled / awaiting release" for EDMN staff.
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

describe('Flow C — Protected Deal between two app users', () => {
  it('create → invite → offer → change → accept → pay → ship → code → confirm (no release from the app)', async () => {
    const buyerU = await makeUser();
    const sellerU = await makeUser();
    const stranger = await makeUser();
    const bt = await login(buyerU.email!);
    const st = await login(sellerU.email!);
    const xt = await login(stranger.email!);

    const created = await call(createRoute, '/deals', { token: bt, idem: key(), body: { title: 'لابتوب مستعمل', description: 'لابتوب بحالة ممتازة مع الشاحن الأصلي', condition: 'USED', quantity: 1 } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const p = { dealId: id };
    expect(created.body).toMatchObject({ role: 'BUYER', status: 'DRAFT' });
    for (const [step, body] of [
      [2, { unitPrice: '3000' }],
      [3, { deliveryMethod: 'تسليم يد بيد', deliveryDeadline: new Date(Date.now() + 5 * 86400_000).toISOString(), inspectionDays: 2 }],
      [5, { loc_governorateId: '1', loc_city: 'القاهرة', loc_street: 'شارع التحرير' }],
    ] as const) {
      const r = await call(stepRoute, `/deals/${id}/steps/${step}`, { method: 'PUT', token: bt, params: { dealId: id, step: String(step) }, body });
      expect(r.status, `step ${step}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    // Strangers see nothing.
    expect([403, 404]).toContain((await call(dealRoute, `/deals/${id}`, { token: xt, params: p })).status);

    const inv = await call(inviteRoute, `/deals/${id}/invitation`, { token: bt, idem: key(), params: p, body: { acceptTerms: true } });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    const token = (inv.body.link as string).split('/').pop()!;
    expect(inv.body.deal.status).toBe('INVITED');

    const joined = await call(claimRoute, '/deal-invitations/claim', { token: st, body: { token } });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ role: 'SELLER', status: 'SELLER_JOINED' });
    expect(joined.body.allowedActions).toContain('SUBMIT_OFFER');
    // Before payment the seller does not see the buyer's address.
    expect(joined.body.buyerLocation).toBeNull();
    // A second user cannot claim the same link.
    expect((await call(claimRoute, '/deal-invitations/claim', { token: xt, body: { token } })).status).toBeGreaterThanOrEqual(400);

    const offer = await call(offerRoute, `/deals/${id}/offer`, {
      token: st,
      idem: key(),
      params: p,
      body: {
        details: { fullName: 'بائع الصفقة' },
        location: { governorateId: 2, city: 'الجيزة', street: 'شارع الهرم' },
        payout: { type: 'INSTAPAY', holderName: 'بائع الصفقة', instapayAddress: `d${key().slice(0, 6)}@instapay` },
        offer: { shippingFee: '0', deliveryMethod: 'شحن عبر شركة شحن', deliveryMinDays: 1, deliveryMaxDays: 3, processingDays: 1, defects: 'لا يوجد', accessories: 'الشاحن الأصلي' },
        returnPolicy: { type: 'NONE' },
        acceptTerms: true,
      },
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(200);
    expect(offer.body.status).toBe('OFFER_PENDING_BUYER');
    const v1 = offer.body.terms.currentVersion as number;
    // Buyer sees server money (fees computed by the server, never by the app).
    const bv = await call(dealRoute, `/deals/${id}`, { token: bt, params: p });
    expect(bv.body.allowedActions).toContain('RESPOND_TO_OFFER');
    expect(bv.body.money.buyerPaysPiastres).toBeGreaterThan(0);

    // Buyer requests a change → seller must re-approve material terms.
    const change = await call(offerRespRoute, `/deals/${id}/offer-response`, {
      token: bt,
      idem: key(),
      params: p,
      body: { version: v1, decision: 'REQUEST_CHANGE', change: { returnPolicy: { type: 'VOLUNTARY', windowDays: 7 }, message: 'محتاج مدة إرجاع أسبوع' } },
    });
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect(change.body.status).toBe('CHANGE_REQUESTED');
    const sv = await call(dealRoute, `/deals/${id}`, { token: st, params: p });
    expect(sv.body.allowedActions).toContain('RESPOND_TO_CHANGE_REQUEST');
    // A stale version is refused (the terms moved).
    expect((await call(offerRespRoute, `/deals/${id}/offer-response`, { token: bt, idem: key(), params: p, body: { version: v1, decision: 'ACCEPT' } })).status).toBeGreaterThanOrEqual(400);
    const acc = await call(changeRespRoute, `/deals/${id}/change-response`, { token: st, idem: key(), params: p, body: { version: sv.body.terms.currentVersion, decision: 'ACCEPT' } });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    const after = await call(dealRoute, `/deals/${id}`, { token: bt, params: p });
    if (after.body.status === 'OFFER_PENDING_BUYER') {
      const ok = await call(offerRespRoute, `/deals/${id}/offer-response`, { token: bt, idem: key(), params: p, body: { version: after.body.terms.currentVersion, decision: 'ACCEPT' } });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    }

    // Payment: open, upload receipt → under review; only EDMN staff confirm it.
    const pay = await call(payRoute, `/deals/${id}/payment`, { token: bt, idem: key(), params: p, body: { method: 'INSTAPAY' } });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const paymentId = pay.body.paymentId as string;
    const f = new FormData();
    f.set('claimedAmount', String(pay.body.deal.money.buyerPaysPiastres / 100));
    f.set('clientKey', key());
    f.set('proof', new Blob([new Uint8Array(await png('r'))], { type: 'image/png' }), 'r.png');
    expect((await call(proofRoute, `/payments/${paymentId}/proof`, { token: bt, params: { paymentId }, form: f })).status).toBe(201);
    const pending = await call(dealRoute, `/deals/${id}`, { token: st, params: p });
    expect(pending.body.allowedActions).not.toContain('MARK_SHIPPED'); // not paid yet
    const [sub] = await db.select().from(paymentSubmissions).where(eq(paymentSubmissions.paymentId, paymentId));
    await confirmPayment(admin, paymentId, sub.id);

    const active = await call(dealRoute, `/deals/${id}`, { token: st, params: p });
    expect(active.body.status).toBe('ACTIVE');
    expect(active.body.buyerLocation).not.toBeNull(); // address revealed only after payment
    const ship = new FormData();
    ship.set('note', 'اتشحن مع شركة الشحن');
    ship.set('proof', new Blob([new Uint8Array(await png('w'))], { type: 'image/png' }), 'w.png');
    const shipped = await call(shippedRoute, `/deals/${id}/shipped`, { token: st, idem: key(), params: p, form: ship });
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    expect(shipped.body.status).toBe('DELIVERED');

    // The code is the buyer's: the seller cannot read it.
    expect((await call(codeRoute, `/deals/${id}/delivery-code`, { token: st, params: p })).status).toBe(403);
    const code = await call(codeRoute, `/deals/${id}/delivery-code`, { token: bt, params: p });
    expect(code.status, JSON.stringify(code.body)).toBe(200);
    expect(code.body.available).toBe(true);
    const wrong = await call(verifyRoute, `/deals/${id}/delivery-code/verify`, { token: st, params: p, body: { code: code.body.code === '000000' ? '111111' : '000000' } });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const right = await call(verifyRoute, `/deals/${id}/delivery-code/verify`, { token: st, params: p, body: { code: code.body.code } });
    expect(right.status, JSON.stringify(right.body)).toBe(200);
    expect(right.body.handoverVerified).toBe(true);
    // Single use.
    expect((await call(verifyRoute, `/deals/${id}/delivery-code/verify`, { token: st, params: p, body: { code: code.body.code } })).status).toBeGreaterThanOrEqual(400);

    const entriesBefore = (await db.select().from(journalEntries)).length;
    const conf = await call(confirmRoute, `/deals/${id}/confirm-receipt`, { token: bt, idem: key(), params: p });
    expect(conf.status, JSON.stringify(conf.body)).toBe(200);
    expect(['BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE']).toContain(conf.body.status);
    const [row] = await db.select().from(externalDeals).where(eq(externalDeals.id, id));
    expect(row.status).not.toBe('COMPLETED'); // release is an EDMN staff action
    expect((await db.select().from(journalEntries)).length).toBeGreaterThanOrEqual(entriesBefore);

    const list = await call(listRoute, '/deals', { token: st });
    expect(list.body.items.find((d: { id: string }) => d.id === id)).toMatchObject({ role: 'SELLER' });
  });
});
