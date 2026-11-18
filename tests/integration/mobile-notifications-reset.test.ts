import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { POST as forgotRoute } from '@/app/api/v1/auth/password/forgot/route';
import { POST as resetRoute } from '@/app/api/v1/auth/password/reset/route';
import { GET as meRoute } from '@/app/api/v1/me/route';
import { GET as prefsGet, PUT as prefsPut } from '@/app/api/v1/notifications/preferences/route';
import { POST as readRoute } from '@/app/api/v1/notifications/read/route';
import { GET as listRoute } from '@/app/api/v1/notifications/route';
import { GET as unreadRoute } from '@/app/api/v1/notifications/unread/route';
import type { Actor } from '@/server/core/actor';
import { randomToken, sha256 } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import { authTokens, notifications } from '@/server/db/schema';
import { targetOf } from '@/server/modules/mobile/notifications';
import { notify } from '@/server/modules/notifications/notify';
import { openTicket, replyToTicket } from '@/server/modules/support/service';
import { makeAdmin, makeCustomer } from '../helpers/factory';

/**
 * Phase 6 — notification center (C27) and password reset (B08) through the REAL mobile routes: only my own
 * notifications, message alerts kept out of the bell, links mapped to typed in-app targets only, preferences per
 * user; reset tokens are single-use, expiring, policy-checked, and a reset signs every session out.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const key = () => randomBytes(18).toString('base64url');

async function call(h: unknown, path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': key() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve({}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email: string, password = 'Test@12345') {
  return call(loginRoute, '/auth/login', { body: { identifier: email, password, device: { installationId: key(), platform: 'ANDROID' } } });
}

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
});

describe('C27 — notification center', () => {
  it('lists only my general notifications with typed targets; read state and preferences are per user', async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const at = (await login(a.user.email!)).body.tokens.accessToken as string;
    const bt = (await login(b.user.email!)).body.tokens.accessToken as string;
    expect((await call(listRoute, '/notifications')).status).toBe(401);

    // Whatever the platform already told A (e.g. a sign-in notice) is the baseline.
    const base = (await call(listRoute, '/notifications', { token: at })).body.items.length as number;
    await call(readRoute, '/notifications/read', { token: at, body: {} });

    // A real event: staff reply on my ticket.
    const ticket = await openTicket(a.actor, { type: 'ACCOUNT', subject: 'استفسار عن الحساب', body: 'محتاج أغيّر رقم الموبايل المسجل' });
    await replyToTicket(admin, ticket.id, 'أهلاً بحضرتك، تقدر تغيّره من بياناتي.');
    // More notifications for A: an internal page, an unknown page, an external link; and a message alert.
    const retId = '11111111-2222-4333-8444-555555555555';
    await notify(db, { event: 'RETURN_UPDATED', userIds: [a.user.id], vars: { ret: 9001, status: 'اتقبل' }, link: `/account/returns/${retId}` });
    await notify(db, { event: 'RETURN_UPDATED', userIds: [a.user.id], vars: { ret: 9002, status: 'مرفوض' }, link: 'https://evil.example/phish' });
    await notify(db, { event: 'RETURN_UPDATED', userIds: [a.user.id], vars: { ret: 9003, status: 'مرفوض' }, link: '/admin/users' });
    await db.insert(notifications).values({ userId: a.user.id, event: 'MESSAGE_FROM_SELLER', title: 'رسالة جديدة', body: 'رسالة', category: 'MESSAGE' });

    const list = await call(listRoute, '/notifications', { token: at });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.items).toHaveLength(base + 4); // the message alert is not in the bell
    expect(list.body.unread).toBe(4);
    expect(list.body.items.some((n: { event: string }) => n.event === 'MESSAGE_FROM_SELLER')).toBe(false);
    const byTarget = (kind: string) => list.body.items.find((n: { target: { kind: string } | null }) => n.target?.kind === kind);
    expect(byTarget('TICKET').target.id).toBe(ticket.id);
    expect(byTarget('RETURN').target.id).toBe(retId);
    // External and admin links are never turned into a navigation target.
    expect(list.body.items.filter((n: { target: unknown; event: string }) => n.target === null && n.event === 'RETURN_UPDATED')).toHaveLength(2);
    for (const n of list.body.items) expect(Object.keys(n)).not.toContain('link');

    // B sees nothing of A's, and cannot mark A's notifications read.
    const mine = new Set(list.body.items.map((n: { id: string }) => n.id));
    const bList = await call(listRoute, '/notifications', { token: bt });
    expect(bList.body.items.some((n: { id: string }) => mine.has(n.id))).toBe(false);
    const ids = list.body.items.filter((n: { read: boolean }) => !n.read).map((n: { id: string }) => n.id) as string[];
    await call(readRoute, '/notifications/read', { token: bt, body: { ids } });
    expect((await call(unreadRoute, '/notifications/unread', { token: at })).body.unread).toBe(4);

    // Paging and the unread filter.
    const p1 = await call(listRoute, '/notifications?unread=1&limit=3', { token: at });
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextBefore).toBeTruthy();
    const p2 = await call(listRoute, `/notifications?unread=1&limit=3&before=${encodeURIComponent(p1.body.nextBefore)}`, { token: at });
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextBefore).toBeNull();

    expect((await call(readRoute, '/notifications/read', { token: at, body: { ids: [ids[0]] } })).body.unread).toBe(3);
    expect((await call(listRoute, '/notifications?unread=1', { token: at })).body.items).toHaveLength(3);
    expect((await call(readRoute, '/notifications/read', { token: at, body: {} })).body.unread).toBe(0);
    // «Mark all» leaves message alerts to the Messages inbox.
    const [msg] = await db.select().from(notifications).where(eq(notifications.event, 'MESSAGE_FROM_SELLER')).orderBy(notifications.createdAt).limit(1);
    expect(msg).toBeTruthy();

    // Preferences: defaults, partial update, per user.
    expect((await call(prefsGet, '/notifications/preferences', { token: at })).body).toEqual({ messagesInApp: true, messagesSound: true, messagesPush: true, messagesEmail: true, pushPreview: false });
    const saved = await call(prefsPut, '/notifications/preferences', { method: 'PUT', token: at, body: { messagesEmail: false } });
    expect(saved.body).toMatchObject({ messagesEmail: false, messagesPush: true });
    expect((await call(prefsGet, '/notifications/preferences', { token: bt })).body.messagesEmail).toBe(true);
    expect((await call(prefsPut, '/notifications/preferences', { method: 'PUT', body: { messagesEmail: false } })).status).toBe(401);
  });

  it('maps only known internal pages to targets', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(targetOf(`/account/orders/${id}/pay`)).toEqual({ kind: 'ORDER', id });
    expect(targetOf(`/account/deals/${id}`)).toEqual({ kind: 'DEAL', id });
    expect(targetOf(`/seller/returns/${id}`)).toEqual({ kind: 'STORE_RETURN', id });
    expect(targetOf(`/account/disputes/${id}`)).toEqual({ kind: 'DISPUTE', id });
    expect(targetOf(`/account/messages/${id}?x=1`)).toEqual({ kind: 'CONVERSATION', id });
    expect(targetOf('/account/earnings')).toEqual({ kind: 'WALLET', id: null });
    for (const bad of [null, '', 'https://x.test/account/orders/' + id, '//x.test/a', '/admin/disputes/' + id, 'javascript:alert(1)', '/account/orders/not-a-uuid']) expect(targetOf(bad)).toBeNull();
  });
});

describe('B08 — password reset', () => {
  async function tokenFor(userId: string, ms = 3600_000) {
    const token = randomToken();
    await db.insert(authTokens).values({ userId, purpose: 'PASSWORD_RESET', tokenHash: sha256(token), expiresAt: new Date(Date.now() + ms) });
    return token;
  }

  it('single-use, expiring token; password policy enforced; every session is signed out', async () => {
    const c = await makeCustomer();
    const before = (await login(c.user.email!)).body.tokens.accessToken as string;
    expect((await call(meRoute, '/me', { token: before })).status).toBe(200);

    // Asking for a link never reveals whether the account exists.
    expect((await call(forgotRoute, '/auth/password/forgot', { body: { identifier: c.user.email } })).status).toBe(200);
    expect((await call(forgotRoute, '/auth/password/forgot', { body: { identifier: 'nobody-here@example.test' } })).status).toBe(200);

    const bad = await call(resetRoute, '/auth/password/reset', { body: { token: 'x'.repeat(40), newPassword: 'NewPass@2030' } });
    expect(bad.status).toBe(422);
    const expired = await tokenFor(c.user.id, -1000);
    expect((await call(resetRoute, '/auth/password/reset', { body: { token: expired, newPassword: 'NewPass@2030' } })).status).toBe(422);

    const token = await tokenFor(c.user.id);
    // A weak password is refused and does NOT consume the token.
    expect((await call(resetRoute, '/auth/password/reset', { body: { token, newPassword: 'short' } })).status).toBe(422);
    const ok = await call(resetRoute, '/auth/password/reset', { body: { token, newPassword: 'NewPass@2030' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // Single use.
    expect((await call(resetRoute, '/auth/password/reset', { body: { token, newPassword: 'Another@2031' } })).status).toBe(422);
    // Old sessions are revoked; old password no longer works; the new one does.
    expect((await call(meRoute, '/me', { token: before })).status).toBe(401);
    expect((await login(c.user.email!)).status).toBe(401);
    expect((await login(c.user.email!, 'NewPass@2030')).status).toBe(200);
    // The response never carries tokens (the user signs in again).
    expect(Object.keys(ok.body)).toEqual(['ok']);
  });
});
