import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { DELETE as removeRoute, PUT as addRoute } from '@/app/api/v1/wishlist/[productId]/route';
import { GET as listRoute } from '@/app/api/v1/wishlist/route';
import type { Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { products, wishlistItems } from '@/server/db/schema';
import { makeAdmin, makeCustomer, makeProduct, makeSeller } from '../helpers/factory';

/**
 * B22 — wishlist through the REAL mobile routes: per-user isolation, idempotent add/remove (a retry never flips the
 * state), only publicly visible products can be added or are listed, and the rows are the same ones the web uses.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, opts: { method?: string; token?: string; idem?: string | null; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem !== null && opts.method && opts.method !== 'GET') headers['idempotency-key'] = opts.idem ?? key();
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method: opts.method ?? 'GET', headers }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const add = (productId: string, token?: string, idem?: string | null) => call(addRoute, `/wishlist/${productId}`, { method: 'PUT', token, idem, params: { productId } });
const remove = (productId: string, token?: string, idem?: string | null) => call(removeRoute, `/wishlist/${productId}`, { method: 'DELETE', token, idem, params: { productId } });

async function login(email: string) {
  const res = await (loginRoute as unknown as Handler)(
    new Request(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edmn-installation': key() }, body: JSON.stringify({ identifier: email, password: 'Test@12345', device: { installationId: key(), platform: 'ANDROID' } }) }),
    { params: Promise.resolve({}) },
  );
  return ((await res.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
}

let admin: Actor;
let p1: string;
let p2: string;
beforeAll(async () => {
  admin = await makeAdmin();
  const s = await makeSeller(admin);
  p1 = (await makeProduct(s.actor, admin, { title: 'سماعة لاسلكية للمفضلة' })).productId;
  p2 = (await makeProduct(s.actor, admin, { title: 'شاحن سريع للمفضلة' })).productId;
});

describe('B22 — wishlist', () => {
  it('requires a session and an idempotency key; lists only my own items, newest first, as product cards', async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const at = await login(a.user.email!);
    const bt = await login(b.user.email!);

    expect((await call(listRoute, '/wishlist')).status).toBe(401);
    expect((await add(p1)).status).toBe(401);
    expect((await add(p1, at, null)).status).toBe(400);

    expect((await add(p1, at)).status).toBe(200);
    const r = await add(p2, at);
    expect(r.status).toBe(200);
    expect(r.body.productIds).toEqual([p2, p1]);
    expect(r.body.items[0]).toMatchObject({ id: p2, titleAr: 'شاحن سريع للمفضلة', inStock: true, minPricePiastres: 10000 });
    expect(r.body.items[0].store.name).toBeTruthy();

    // B sees nothing of A's list, and B's changes never touch A's rows.
    expect((await call(listRoute, '/wishlist', { token: bt })).body).toEqual({ items: [], productIds: [] });
    await remove(p1, bt);
    expect((await call(listRoute, '/wishlist', { token: at })).body.productIds).toEqual([p2, p1]);

    // Same rows as the web page reads.
    const rows = await db.select().from(wishlistItems).where(eq(wishlistItems.userId, a.user.id));
    expect(rows.map((x) => x.productId).sort()).toEqual([p1, p2].sort());
  });

  it('add and remove are idempotent: retries (same or new key) never flip the state', async () => {
    const c = await makeCustomer();
    const t = await login(c.user.email!);
    const k = key();
    expect((await add(p1, t, k)).body.productIds).toEqual([p1]);
    expect((await add(p1, t, k)).body.productIds).toEqual([p1]); // replay of the same request
    expect((await add(p1, t)).body.productIds).toEqual([p1]); // a fresh request for the same intent
    const rk = key();
    expect((await remove(p1, t, rk)).body.productIds).toEqual([]);
    expect((await remove(p1, t, rk)).body.productIds).toEqual([]);
    expect((await remove(p1, t)).body.productIds).toEqual([]);
    expect(await db.select().from(wishlistItems).where(and(eq(wishlistItems.userId, c.user.id), eq(wishlistItems.productId, p1)))).toHaveLength(0);
  });

  it('only publicly visible products: unknown or hidden → 404 on add; a product hidden later drops out of the list and comes back', async () => {
    const c = await makeCustomer();
    const t = await login(c.user.email!);
    expect((await add('11111111-2222-4333-8444-555555555555', t)).status).toBe(404);
    expect((await call(addRoute, '/wishlist/not-a-uuid', { method: 'PUT', token: t, params: { productId: 'not-a-uuid' } })).status).toBe(422);

    const s = await makeSeller(admin);
    const draft = (await makeProduct(s.actor, admin, { approve: false })).productId;
    expect((await add(draft, t)).status).toBe(404);

    const live = (await makeProduct(s.actor, admin)).productId;
    expect((await add(live, t)).body.productIds).toEqual([live]);
    await db.update(products).set({ status: 'SUSPENDED' }).where(eq(products.id, live));
    expect((await call(listRoute, '/wishlist', { token: t })).body.productIds).toEqual([]);
    // Still saved: removing it works, and if it becomes visible again before that, it reappears.
    await db.update(products).set({ status: 'LIVE' }).where(eq(products.id, live));
    expect((await call(listRoute, '/wishlist', { token: t })).body.productIds).toEqual([live]);
    expect((await remove(live, t)).body.productIds).toEqual([]);
  });
});
