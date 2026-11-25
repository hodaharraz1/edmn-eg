import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as adminLoginRoute } from '@/app/api/v1/admin/auth/login/route';
import { POST as adminMfaEnrollRoute } from '@/app/api/v1/admin/auth/mfa/enroll/route';
import { POST as adminMfaVerifyRoute } from '@/app/api/v1/admin/auth/mfa/verify/route';
import { GET as adminClosuresRoute } from '@/app/api/v1/admin/closure-requests/route';
import { totpCode } from '@/server/auth/totp';
import { db } from '@/server/db/client';
import { notifications, outboundMessages, users } from '@/server/db/schema';
import { closureMonitor } from '@/server/modules/admin-mobile/monitoring';
import { completeAccountClosure, requestAccountClosure, requestClosureExecution } from '@/server/modules/customers/closure';
import { customerActor } from '@/server/auth/actors';
import { makeAdmin, makeCustomer, makeUser } from '../helpers/factory';

/**
 * PKG-ACCOUNT-02: (1) the customer is NOTIFIED when their closure request is executed (notifyClosure is wired into
 * completeAccountClosure); (2) the Admin App lists closure requests read-only behind the SAME permission as the web
 * /admin/closures page (customers.manage / customers.view), masked, through the real route handler.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = 'http://localhost/api/v1';
const inst = () => randomBytes(18).toString('base64url');
const device = () => ({ installationId: inst(), platform: 'ANDROID' as const, deviceName: 'Pixel', appVersion: '1.0.0' });

async function call(h: Handler, path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'x-edmn-installation': inst() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await h(new Request(`${BASE}${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), {
    params: Promise.resolve({}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function staffToken(roles: string[]) {
  const u = await makeUser({ staff: true, roles });
  const login = await call(adminLoginRoute as Handler, '/admin/auth/login', { body: { identifier: u.email, password: 'Test@12345', device: device() } });
  const token = login.body.tokens.accessToken as string;
  const enroll = await call(adminMfaEnrollRoute as Handler, '/admin/auth/mfa/enroll', { method: 'POST', body: {}, token });
  expect((await call(adminMfaVerifyRoute as Handler, '/admin/auth/mfa/verify', { body: { code: totpCode(enroll.body.secret) }, token })).status).toBe(200);
  return { token, user: u };
}

describe('account closure execution notification + admin app monitor', () => {
  it('executing a closure request notifies the customer (in-app notification row, outbox email)', async () => {
    const admin = await makeAdmin();
    const c = await makeCustomer();
    const r = await requestAccountClosure(customerActor(c.user.id), 'مش محتاج الحساب');
    expect(r.status).toBe('PENDING');

    await requestClosureExecution(await makeAdmin(), r.requestId!); // SEC-164: Maker, then a different Checker
    const done = await completeAccountClosure(admin, r.requestId!);
    expect(done.closed).toBe(true);

    // The execution notification exists, in Egyptian Arabic, addressed to the closed account's owner.
    const notes = await db.select().from(notifications).where(and(eq(notifications.userId, c.user.id), eq(notifications.event, 'ACCOUNT_CLOSURE')));
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('تم إغلاق حسابك بناءً على طلبك');
    expect(notes[0].title).toBe('طلب إغلاق الحساب');
    // ...and the email really reaches the outbox, addressed to the address the account had before pseudonymisation.
    const mails = await db.select().from(outboundMessages).where(and(eq(outboundMessages.event, 'ACCOUNT_CLOSURE'), eq(outboundMessages.channel, 'EMAIL'), eq(outboundMessages.recipient, c.user.email!)));
    expect(mails).toHaveLength(1);

    // The account itself was closed and pseudonymised (existing behavior, unchanged).
    const [u] = await db.select().from(users).where(eq(users.id, c.user.id));
    expect(u.status).toBe('CLOSED');
    expect(u.anonymizedAt).toBeTruthy();
  });

  it('monitor service: masked, tabbed, and gated by the web page permission', async () => {
    const admin = await makeAdmin();
    const c = await makeCustomer();
    const r = await requestAccountClosure(customerActor(c.user.id));

    // customers.view (CUSTOMER_SUPPORT) and customers.manage (SUPER_ADMIN) both pass — same as the web page.
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    const open = await closureMonitor(support, 'open');
    const item = open.find((i) => i.id === r.requestId);
    expect(item).toBeTruthy();
    expect(item!.customer).not.toBe(c.user.fullName);
    expect(item!.customer).toContain('عميل');
    expect(item!.status).toBe('PENDING');

    // A role without either permission is refused.
    const denied = await makeAdmin(['CATALOG_REVIEWER']);
    await expect(closureMonitor(denied, 'open')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // After execution the request moves to the closed tab.
    await requestClosureExecution(await makeAdmin(), r.requestId!);
    await completeAccountClosure(admin, r.requestId!);
    const stillOpen = await closureMonitor(admin, 'open');
    expect(stillOpen.some((i) => i.id === r.requestId)).toBe(false);
    const closed = await closureMonitor(admin, 'closed');
    const closedItem = closed.find((i) => i.id === r.requestId);
    expect(closedItem?.status).toBe('COMPLETED');
  });

  it('admin route serves the queue through the real handler with masking; wrong role gets 403', async () => {
    const c = await makeCustomer();
    await requestAccountClosure(customerActor(c.user.id));

    const { token } = await staffToken(['CUSTOMER_SUPPORT']);
    const ok = await call(adminClosuresRoute as Handler, '/admin/closure-requests?tab=open', { token });
    expect(ok.status, ok.raw).toBe(200);
    const item = ok.body.items.find((i: { customer: string | null }) => i.customer?.startsWith('عميل'));
    expect(item).toBeTruthy();
    expect(item.customer).not.toBe(c.user.fullName);
    expect(JSON.stringify(ok.body)).not.toContain(c.user.email!);
    expect(JSON.stringify(ok.body)).not.toMatch(/userId|decidedBy|blockers/);

    const denied = await staffToken(['CATALOG_REVIEWER']);
    const no = await call(adminClosuresRoute as Handler, '/admin/closure-requests?tab=open', { token: denied.token });
    expect(no.status).toBe(403);
  });
});
