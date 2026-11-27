import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as adminTicketDetailRoute } from '@/app/api/v1/admin/support/tickets/[ticketId]/route';
import { GET as adminTicketsRoute } from '@/app/api/v1/admin/support/tickets/route';
import { ADMIN_API_ROUTES } from '@/server/api/routes';
import { totpCode } from '@/server/auth/totp';
import { openTicket } from '@/server/modules/support/service';
import { makeCustomer, makeUser } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PKG-I02-05 — Admin App support inbox (read-only) through the REAL route handlers with real login +
 * MFA tokens. Covers: queue tabs with masked requester names, full thread for staff, RBAC
 * (support.manage), 404 without data leakage, and the read-only contract guard.
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function call(h: unknown, path: string, opts: { token?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const method = opts.body !== undefined ? 'POST' : 'GET';
  const res = await (h as Handler)(new Request(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function staffToken(roles: string[]) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
  const token = login.body.tokens.accessToken as string;
  const enroll = await call(adminMfaEnrollRoute, '/admin/auth/mfa/enroll', { body: {}, token });
  expect((await call(adminMfaVerifyRoute, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token })).status).toBe(200);
  return { token, user: u };
}

describe('Admin App — support inbox (read-only, support.manage)', () => {
  it('lists open tickets with masked requesters and serves the full thread; tabs filter', async () => {
    const c = await makeCustomer();
    const t = await openTicket(c.actor, { type: 'ACCOUNT', subject: 'مشكلة في تسجيل الدخول', body: 'مش قادر أسجل دخول من موبايلي منذ أمس' });
    const support = await staffToken(['CUSTOMER_SUPPORT']);
    const list = await call(adminTicketsRoute, '/admin/support/tickets', { token: support.token });
    expect(list.status).toBe(200);
    const mine = list.body.items.find((x: { id: string }) => x.id === t.id);
    expect(mine).toBeTruthy();
    expect(mine.status).toBe('OPEN');
    expect(mine.requester).not.toBe(c.user.fullName); // masked
    // closed tab hides it
    const closed = await call(adminTicketsRoute, '/admin/support/tickets?tab=closed', { token: support.token });
    expect(closed.body.items.find((x: { id: string }) => x.id === t.id)).toBeFalsy();
    // thread: full message history for staff, masked author names, no attachment ids
    const detail = await call(adminTicketDetailRoute, '/admin/support/tickets/x', { token: support.token, params: { ticketId: t.id } });
    expect(detail.status).toBe(200);
    expect(detail.body.subject).toBe('مشكلة في تسجيل الدخول');
    expect(detail.body.messages.length).toBeGreaterThanOrEqual(1);
    expect(detail.body.messages[0]).not.toHaveProperty('attachmentFileId');
    expect(detail.body.messages[0].author).not.toBe(c.user.fullName); // masked
    // unknown id → 404
    expect((await call(adminTicketDetailRoute, '/admin/support/tickets/x', { token: support.token, params: { ticketId: randomUUID() } })).status).toBe(404);
  });

  it('refuses staff without support.manage and anonymous callers', async () => {
    const denied = await staffToken(['PAYMENT_REVIEWER']);
    expect((await call(adminTicketsRoute, '/admin/support/tickets', { token: denied.token })).status).toBe(403);
    expect((await call(adminTicketsRoute, '/admin/support/tickets', {})).status).toBe(401);
  });
});

describe('Admin App — support mobile API is read-only (contract guard)', () => {
  it('registers the two GET routes plus the one approved POST reply', () => {
    const paths = ADMIN_API_ROUTES.filter((r) => r.path.startsWith('/api/v1/admin/support'));
    expect(paths.map((r) => `${r.method} ${r.path}`).sort()).toEqual(['GET /api/v1/admin/support/tickets', 'GET /api/v1/admin/support/tickets/{ticketId}', 'POST /api/v1/admin/support/tickets/{ticketId}/reply']); // POST reply added by PKG-I02-06 (owner-approved)
  });
});
