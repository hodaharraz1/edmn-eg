import { expect, test } from '@playwright/test';
import { adminLogin, q } from './helpers';

/**
 * Production Hardening Batch 1 — targeted deployment checks (safe on staging: every write attempted here is
 * REFUSED by the server, nothing is mutated; A-100016 is excluded from every fixture query).
 * The full behavioural matrix lives in tests/integration/batch1-hardening.test.ts.
 */
test.describe.configure({ mode: 'serial' });

test('C8: the database is marked with its deployment kind and migration 0013 is applied', async () => {
  const [m] = await q<{ n: number }>(`select count(*)::int n from drizzle.__drizzle_migrations`);
  expect(m.n).toBeGreaterThanOrEqual(14);
  const [env] = await q<{ environment: string }>(`select environment from deployment_environment`);
  expect(['STAGING', 'DEVELOPMENT']).toContain(env?.environment ?? (process.env.E2E_BASE_URL ? 'MISSING' : 'DEVELOPMENT'));
  if (process.env.E2E_BASE_URL) expect(env.environment).toBe('STAGING');
  const [t] = await q<{ n: number }>(`select count(*)::int n from pg_trigger where tgname in ('users_production_fixture_guard','payment_destinations_production_guard','deployment_environment_guard')`);
  expect(t.n).toBe(3);
});

test('C1: an open dispute offers no generic resolve/close, and a forged RESOLVED status is refused by the server', async ({ browser }) => {
  const [d] = await q<{ id: string }>(`select d.id from disputes d left join seller_orders so on so.id = d.seller_order_id left join orders o on o.id = so.order_id
    where d.status = 'OPEN' and coalesce(o.number, 0) <> 100016 order by d.created_at desc limit 1`);
  test.skip(!d, 'no open dispute fixture');
  const admin = await adminLogin(browser);
  await admin.goto(`/admin/disputes/${d.id}`);
  const status = admin.locator('select[name="status"]');
  await expect(status.locator('option')).toHaveText(['قيد المراجعة', 'بانتظار معلومات']);
  await expect(admin.getByRole('button', { name: 'إغلاق النزاع' })).toHaveCount(0);
  // forge the form value: the server must refuse (no financial resolution through a status edit)
  await status.evaluate((el: HTMLSelectElement) => {
    const o = document.createElement('option');
    o.value = 'RESOLVED';
    o.textContent = 'RESOLVED';
    el.appendChild(o);
    el.value = 'RESOLVED';
  });
  await admin.getByRole('button', { name: 'تحديث' }).click();
  await expect(admin.getByText(/حسم النزاع يتم بإصدار قرار رسمي فقط/)).toBeVisible();
  const [after] = await q<{ status: string }>(`select status from disputes where id = $1`, [d.id]);
  expect(after.status).toBe('OPEN');
  await admin.context().close();
});

test('C2: creating a SUPER_ADMIN without the explicit privileged confirmation is refused and writes nothing', async ({ browser }) => {
  const email = `b1-escalation-${Date.now().toString(36)}@e2e.local`;
  const admin = await adminLogin(browser);
  await admin.goto('/admin/roles');
  const form = admin.locator('form').filter({ has: admin.getByRole('heading', { name: 'إضافة موظف' }) });
  await form.locator('input[name="fullName"]').fill('محاولة إنشاء مدير عام');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="phone"]').fill('01099999999');
  await form.locator('select[name="role"]').selectOption('SUPER_ADMIN');
  await form.getByRole('button', { name: 'إضافة' }).click();
  await expect(admin.getByText(/أكّد الإجراء صراحةً/)).toBeVisible();
  expect(await q(`select id from users where email = $1`, [email])).toHaveLength(0);
  await admin.context().close();
});

test('C5 + wording: withdrawals read their real money state; a paid withdrawal cannot be rejected', async ({ browser }) => {
  const admin = await adminLogin(browser);
  await admin.goto('/admin/withdrawals?tab=paid');
  await expect(admin.getByText('تم التحويل').first()).toBeVisible();
  const [w] = await q<{ id: string }>(`select id from withdrawal_requests where status = 'PAID' order by paid_at desc limit 1`);
  test.skip(!w, 'no paid withdrawal fixture');
  await admin.goto(`/admin/withdrawals/${w.id}`);
  await expect(admin.getByRole('heading', { name: 'رفض الطلب' })).toHaveCount(0);
  await expect(admin.getByTestId('wd-failed-before-transfer')).toHaveCount(0);
  await admin.context().close();
});

test('wording: seller orders name the receipt basis; refunds never read as paid before they are', async ({ browser }) => {
  const [so] = await q<{ order_id: string; basis: string }>(`select so.order_id, so.receipt_basis basis from seller_orders so join orders o on o.id = so.order_id
    where so.status = 'DELIVERED' and so.receipt_basis is not null and o.number <> 100016 order by so.updated_at desc limit 1`);
  test.skip(!so, 'no delivered seller order fixture');
  const admin = await adminLogin(browser);
  await admin.goto(`/admin/orders/${so.order_id}`);
  const expected = { BUYER_CONFIRMED: 'أكّد المشتري الاستلام', TIMEOUT_ENTITLEMENT: 'مستحق بانتهاء مهلة المشتري', DISPUTE_DECISION: 'مستحق بقرار نزاع' }[so.basis]!;
  await expect(admin.getByText(expected).first()).toBeVisible();
  await expect(admin.getByText('تم الاستلام', { exact: true })).toHaveCount(0);
  await admin.goto('/admin/refunds?tab=approved');
  await expect(admin.getByText(/^معتمد وجاري التحويل$/)).toHaveCount(0);
  await admin.context().close();
});
