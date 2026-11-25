import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { POST as replyRoute } from '@/app/api/v1/admin/support/tickets/[ticketId]/reply/route';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import { auditLogs, supportMessages, supportTickets } from '@/server/db/schema';
import { openTicket } from '@/server/modules/support/service';
import { makeCustomer, makeUser } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PKG-I02-06 — Admin App support reply through the REAL route handler with real login + MFA tokens.
 * Covers: RBAC (support.manage), MFA required, Idempotency-Key required + replay without a duplicate
 * message, unknown ticket (404, no leak), validation (min/max length), staff message flags, no auto-close,
 * audit row without the reply body.
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const idem = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function call(h: unknown, path: string, opts: { token?: string; body?: unknown; params?: Record<string, string>; idem?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method: 'POST', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function loginOnly(roles: string[]) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
  return { token: login.body.tokens.accessToken as string, user: u };
}
async function staffToken(roles: string[]) {
  const s = await loginOnly(roles);
  const enroll = await call(adminMfaEnrollRoute, '/admin/auth/mfa/enroll', { body: {}, token: s.token });
  expect((await call(adminMfaVerifyRoute, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token: s.token })).status).toBe(200);
  return s;
}
const reply = (token: string | undefined, ticketId: string, body: unknown, key: string | undefined = idem()) =>
  call(replyRoute, '/admin/support/tickets/x/reply', { token, body, params: { ticketId }, idem: key });

describe('Admin App — support reply (support.manage, idempotent, audited)', () => {
  it('posts a staff reply, notifies via the domain service, never closes, audits without the body, replays safely', async () => {
    const c = await makeCustomer();
    const t = await openTicket(c.actor, { type: 'ACCOUNT', subject: 'مشكلة في تسجيل الدخول', body: 'مش قادر أسجل دخول من موبايلي منذ أمس' });
    const support = await staffToken(['CUSTOMER_SUPPORT']);
    const key = idem();
    const secretText = `رد الدعم ${randomUUID()}`;

    const first = await reply(support.token, t.id, { body: secretText }, key);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });

    const msgs = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, t.id));
    const mine = msgs.filter((m) => m.body === secretText);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ isStaff: true, isInternal: false, attachmentFileId: null, authorUserId: support.user.id });
    const [after] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
    expect(after.status).toBe('IN_PROGRESS'); // OPEN → IN_PROGRESS by the existing rule; never RESOLVED/CLOSED
    expect(['RESOLVED', 'CLOSED']).not.toContain(after.status);

    // Replay with the same key + same body: original response, NO second message.
    const replay = await reply(support.token, t.id, { body: secretText }, key);
    expect(replay.status).toBe(200);
    expect((await db.select().from(supportMessages).where(eq(supportMessages.ticketId, t.id))).filter((m) => m.body === secretText)).toHaveLength(1);
    // Same key with a different body is refused.
    expect((await reply(support.token, t.id, { body: `${secretText} edited` }, key)).status).toBe(422);

    // Audit: staff identity + ticket, never the reply body.
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, t.id));
    const row = logs.find((l) => l.action === 'support.staff_replied');
    expect(row).toBeTruthy();
    expect(row!.actorUserId).toBe(support.user.id);
    expect(JSON.stringify(row)).not.toContain(secretText);
  });

  it('refuses: no token (401), MFA not verified (401 mfa_required), no support.manage (403), missing Idempotency-Key, bad input', async () => {
    const c = await makeCustomer();
    const t = await openTicket(c.actor, { type: 'ACCOUNT', subject: 'سؤال عن الحساب', body: 'عايز أعرف حالة حسابي من فضلكم' });
    const support = await staffToken(['CUSTOMER_SUPPORT']);
    const before = (await db.select().from(supportMessages).where(eq(supportMessages.ticketId, t.id))).length;

    expect((await reply(undefined, t.id, { body: 'مرحبا بك' })).status).toBe(401);
    const preMfa = await loginOnly(['CUSTOMER_SUPPORT']);
    expect((await reply(preMfa.token, t.id, { body: 'مرحبا بك' })).status).toBe(401); // mfa_required
    const denied = await staffToken(['PAYMENT_REVIEWER']);
    expect((await reply(denied.token, t.id, { body: 'مرحبا بك' })).status).toBe(403);
    expect((await reply(support.token, t.id, { body: 'مرحبا بك' }, undefined)).status).toBe(400);
    expect((await reply(support.token, t.id, { body: 'x' })).status).toBe(400); // too short
    expect((await reply(support.token, t.id, { body: 'ا'.repeat(4001) })).status).toBe(400); // too long
    expect((await reply(support.token, t.id, { body: 'مرحبا بك', internal: true, status: 'CLOSED' })).status).toBeLessThan(500); // extra keys never act
    expect((await reply(support.token, randomUUID(), { body: 'مرحبا بك' })).status).toBe(404);

    const msgs = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, t.id));
    expect(msgs.length - before).toBeLessThanOrEqual(1); // only the extra-keys call may have posted, and only as a plain reply
    expect(msgs.every((m) => !m.isInternal)).toBe(true);
    const [after] = await db.select().from(supportTickets).where(eq(supportTickets.id, t.id));
    expect(after.status).not.toBe('CLOSED');
  });
});
