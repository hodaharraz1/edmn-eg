import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as getDeletionRoute, POST as requestDeletionRoute } from '@/app/api/v1/me/deletion-request/route';
import { POST as cancelDeletionRoute } from '@/app/api/v1/me/deletion-request/cancel/route';
import { db } from '@/server/db/client';
import { accountClosureRequests, auditLogs } from '@/server/db/schema';
import { CLOSURE_BLOCKED_MESSAGE } from '@/server/modules/customers/closure';
import { checkout, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser } from '../helpers/factory';

/**
 * Account deletion REQUEST (C30) through the real route handlers: a customer asks, the closure service decides.
 * PENDING requests are visible and withdrawable; open obligations refuse 422 with Arabic reasons (the BLOCKED attempt
 * is recorded and audited); nothing is deleted or anonymized anywhere in this flow.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');

async function call(h: Handler, path: string, opts: { method?: string; body?: unknown; token?: string; installation?: string; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': opts.installation ?? inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await h(new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), {
    params: Promise.resolve({}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function customerLogin(identifier: string) {
  const installationId = inst();
  const r = await call(loginRoute as Handler, '/auth/login', {
    body: { identifier, password: 'Test@12345', device: { installationId, platform: 'ANDROID', deviceName: 'Pixel', appVersion: '1.0.0' } },
    installation: installationId,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.tokens.accessToken as string;
}

const myRequests = (userId: string) => db.select().from(accountClosureRequests).where(eq(accountClosureRequests.userId, userId));

describe('account deletion request (C30)', () => {
  it('request → PENDING → visible → withdrawn; idempotent and audited; nothing deleted', async () => {
    const u = await makeUser();
    const token = await customerLogin(u.email!);

    // Idempotency-Key is mandatory on this write.
    const noKey = await call(requestDeletionRoute as Handler, '/me/deletion-request', { token, body: {} });
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe('idempotency_key_required');

    const key = randomUUID();
    const created = await call(requestDeletionRoute as Handler, '/me/deletion-request', { token, body: { reason: 'مش محتاج الحساب' }, idem: key });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.request.status).toBe('PENDING');
    expect(created.body.request.blockers).toEqual([]);
    expect(created.body.request.reason).toBe('مش محتاج الحساب');
    const requestId = created.body.request.id;

    // Same key replays the stored response; a new key returns the same PENDING request (no duplicate).
    const replay = await call(requestDeletionRoute as Handler, '/me/deletion-request', { token, body: { reason: 'مش محتاج الحساب' }, idem: key });
    expect(replay.status).toBe(200);
    expect(replay.body.request.id).toBe(requestId);
    const again = await call(requestDeletionRoute as Handler, '/me/deletion-request', { token, body: {}, idem: randomUUID() });
    expect(again.status).toBe(200);
    expect(again.body.request.id).toBe(requestId);
    const mine = await myRequests(u.id);
    expect(mine.filter((r) => r.status === 'PENDING')).toHaveLength(1);

    // Reason over 500 chars is a validation error.
    const tooLong = await call(requestDeletionRoute as Handler, '/me/deletion-request', { token, body: { reason: 'x'.repeat(501) }, idem: randomUUID() });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code).toBe('validation_failed');

    // The owner sees the request; someone else sees nothing.
    const get = await call(getDeletionRoute as Handler, '/me/deletion-request', { token });
    expect(get.status).toBe(200);
    expect(get.body.request.id).toBe(requestId);
    expect(get.body.request.status).toBe('PENDING');
    const other = await makeUser();
    const otherToken = await customerLogin(other.email!);
    const otherGet = await call(getDeletionRoute as Handler, '/me/deletion-request', { token: otherToken });
    expect(otherGet.status).toBe(200);
    expect(otherGet.body.request).toBeNull();

    // The response shape carries no internal fields.
    expect(JSON.stringify(get.body)).not.toMatch(/userId|decidedBy|updatedAt/);

    const [requestedAudit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'account.closure_requested')));
    expect(requestedAudit).toBeTruthy();

    // Withdraw: 200 WITHDRAWN, then a second withdraw is an invalid state.
    const noKeyCancel = await call(cancelDeletionRoute as Handler, '/me/deletion-request/cancel', { token });
    expect(noKeyCancel.status).toBe(400);
    const cancelled = await call(cancelDeletionRoute as Handler, '/me/deletion-request/cancel', { token, idem: randomUUID() });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.request.status).toBe('WITHDRAWN');
    const recancel = await call(cancelDeletionRoute as Handler, '/me/deletion-request/cancel', { token, idem: randomUUID() });
    expect(recancel.status).toBe(409);
    expect(recancel.body.code).toBe('invalid_state');
    const [withdrawnAudit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, u.id), eq(auditLogs.action, 'account.closure_withdrawn')));
    expect(withdrawnAudit).toBeTruthy();

    // Nothing about the account itself changed: the user can still log in and has no CLOSED state.
    const relogin = await call(loginRoute as Handler, '/auth/login', {
      body: { identifier: u.email, password: 'Test@12345', device: { installationId: inst(), platform: 'ANDROID' } },
    });
    expect(relogin.status).toBe(200);
  });

  it('open obligations refuse 422 with clear Arabic reasons, and the BLOCKED attempt is recorded', async () => {
    const admin = await makeAdmin();
    const seller = await makeSeller(admin);
    const { variantId } = await makeProduct(seller.actor, admin);
    const c = await makeCustomer();
    await checkout(c, [{ variantId, qty: 1 }]);
    const token = await customerLogin(c.user.email!);

    const refused = await call(requestDeletionRoute as Handler, '/me/deletion-request', { token, body: {}, idem: randomUUID() });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('validation_failed');
    expect(refused.body.detail).toBe(CLOSURE_BLOCKED_MESSAGE);
    expect(refused.body.fieldErrors.blockers).toContain('طلبات شراء لسه مفتوحة');

    // The BLOCKED attempt is a recorded request with machine codes, and it is audited.
    const mine = await myRequests(c.user.id);
    const blocked = mine.filter((r) => r.status === 'BLOCKED');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].blockers.map((b) => b.code)).toContain('OPEN_ORDERS');
    const [blockedAudit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, c.user.id), eq(auditLogs.action, 'account.closure_blocked')));
    expect(blockedAudit).toBeTruthy();

    // GET surfaces the same BLOCKED state with ready-to-show Arabic labels.
    const get = await call(getDeletionRoute as Handler, '/me/deletion-request', { token });
    expect(get.status).toBe(200);
    expect(get.body.request.status).toBe('BLOCKED');
    const openOrders = get.body.request.blockers.find((b: { code: string }) => b.code === 'OPEN_ORDERS');
    expect(openOrders.label).toBe('طلبات شراء لسه مفتوحة');

    // There is nothing pending to withdraw.
    const cancel = await call(cancelDeletionRoute as Handler, '/me/deletion-request/cancel', { token, idem: randomUUID() });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('invalid_state');
  });
});
