import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD, q } from './helpers';

/**
 * PKG-E2E-01 — account deletion request, through the real mobile API (/api/v1/me/deletion-request). The web has
 * no deletion screen (the customer app calls this API), so the journey drives the same HTTP contract the app uses.
 *   1. A customer with an open order is REFUSED (422, BLOCKED request recorded with Arabic reasons).
 *   2. A customer with no obligations is ACCEPTED (PENDING) and can cancel it (WITHDRAWN); nothing is deleted.
 * The "refused" account is any demo buyer that has an order still in flight in the E2E database. The seeded demo
 * data normally contains one; the test SKIPS (visibly, never passes silently) when none exists.
 */
test.describe.configure({ mode: 'serial' });

const inst = () => randomBytes(18).toString('base64url');
const device = (installationId: string) => ({ installationId, platform: 'ANDROID', deviceName: 'E2E Pixel', appVersion: '1.0.0' });

async function apiLogin(request: APIRequestContext, identifier: string, password: string) {
  const installationId = inst();
  const res = await request.post('/api/v1/auth/login', { headers: { 'x-edmn-installation': installationId }, data: { identifier, password, device: device(installationId) } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).tokens.accessToken as string;
}

const auth = (token: string, idem?: string) => ({ authorization: `Bearer ${token}`, 'x-edmn-installation': inst(), ...(idem ? { 'idempotency-key': idem } : {}) });

test('a fresh customer with no obligations: request accepted (PENDING), then withdrawn — nothing deleted', async ({ request }) => {
  const run = Date.now().toString().slice(-8);
  const email = `del${run}@e2e.local`;
  const password = 'E2e@Delete2026';
  const installationId = inst();
  const reg = await request.post('/api/v1/auth/register', {
    headers: { 'x-edmn-installation': installationId },
    data: { fullName: 'عميل حذف الحساب', email, phone: `+2011${run}`, password, device: device(installationId) },
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const token = await apiLogin(request, email, password);

  const created = await request.post('/api/v1/me/deletion-request', { headers: auth(token, randomUUID()), data: { reason: 'مش محتاج الحساب' } });
  expect(created.status(), await created.text()).toBe(200);
  const body = await created.json();
  expect(body.request.status).toBe('PENDING');
  expect(body.request.blockers).toEqual([]);

  const [row] = await q<{ status: string }>(`select r.status from account_closure_requests r join users u on u.id = r.user_id where u.email = $1 order by r.created_at desc limit 1`, [email]);
  expect(row.status).toBe('PENDING');

  const cancelled = await request.post('/api/v1/me/deletion-request/cancel', { headers: auth(token, randomUUID()) });
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  expect((await cancelled.json()).request.status).toBe('WITHDRAWN');
  // Withdrawing twice is an invalid state, not a second success.
  expect((await request.post('/api/v1/me/deletion-request/cancel', { headers: auth(token, randomUUID()) })).status()).toBe(409);

  // The account is intact: still active, can still sign in; the request and its withdrawal are audited.
  expect((await q<{ status: string; closed_at: Date | null }>(`select status, closed_at from users where email = $1`, [email]))[0]).toMatchObject({ status: 'ACTIVE', closed_at: null });
  await apiLogin(request, email, password);
  const audits = await q<{ action: string }>(`select a.action from audit_logs a join users u on u.id = a.entity_id where u.email = $1 and a.action like 'account.closure_%'`, [email]);
  expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['account.closure_requested', 'account.closure_withdrawn']));
});

test('a customer with an open order is refused with Arabic reasons, and the attempt is recorded as BLOCKED', async ({ request }) => {
  // The demo buyer who currently has a seller order still in flight (anything not COMPLETED/CANCELLED/DELIVERY_FAILED).
  const [open] = await q<{ email: string }>(
    `select u.email from orders o join users u on u.id = o.customer_id join seller_orders so on so.order_id = o.id
      where u.email like '%@demo.edmn.local' and so.status not in ('COMPLETED','CANCELLED','DELIVERY_FAILED') limit 1`,
  );
  test.skip(!open, 'No demo customer has an order in flight in this database, so the BLOCKED path cannot be exercised here.');
  const token = await apiLogin(request, open.email, DEMO_PASSWORD);
  const refused = await request.post('/api/v1/me/deletion-request', { headers: auth(token, randomUUID()), data: {} });
  expect(refused.status(), await refused.text()).toBe(422);
  const b = await refused.json();
  expect(b.code).toBe('validation_failed');
  expect(b.fieldErrors.blockers).toContain('طلبات شراء لسه مفتوحة');
  const blocked = await q<{ status: string }>(`select r.status from account_closure_requests r join users u on u.id = r.user_id where u.email = $1 and r.status = 'BLOCKED'`, [open.email]);
  expect(blocked.length).toBeGreaterThan(0);
  const got = await request.get('/api/v1/me/deletion-request', { headers: auth(token) });
  expect((await got.json()).request.status).toBe('BLOCKED');
});
