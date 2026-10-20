import { expect, test } from '@playwright/test';
import { customerLogin, q } from './helpers';

/**
 * F-6 store team invitations — deployment check (safe on staging: writes only an isolated @e2e.local customer and
 * an invitation on the demo store, and removes the membership again at the end; no money moves, A-100016 unused).
 * Full behavioural matrix: tests/integration/seller-invitations.test.ts.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString().slice(-7);
const OWNER = 'techzone@demo.edmn.local';
const INVITEE = { name: 'عضو فريق تجريبي', email: `inv-${RUN}@e2e.local`, phone: `0127${RUN}`, password: 'E2e@Invite-2026' };
const INTRUDER = { name: 'مستخدم آخر تجريبي', email: `inv-x-${RUN}@e2e.local`, phone: `0126${RUN}`, password: 'E2e@Invite-2026' };

async function register(browser: import('@playwright/test').Browser, u: typeof INVITEE) {
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.goto('/register');
  await page.locator('input[name=fullName]').fill(u.name);
  await page.locator('input[name=email]').fill(u.email);
  await page.locator('input[name=phone]').fill(u.phone);
  await page.locator('input[name=password]').fill(u.password);
  await page.locator('input[name=terms]').check();
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await page.waitForURL((x) => !x.pathname.startsWith('/register'));
  await ctx.close();
}

test('schema: invitations table exists (migration 0017) with one open invitation per store and user', async () => {
  const [t] = await q<{ n: number }>(`select count(*)::int n from pg_indexes where indexname = 'seller_member_invitations_open_uq'`);
  expect(t.n).toBe(1);
});

test('owner invites → pending, no access; another user cannot accept; the invitee accepts and gets exactly the role; owner removes', async ({ browser }) => {
  await register(browser, INVITEE);
  await register(browser, INTRUDER);
  const owner = await customerLogin(browser, OWNER);
  await owner.goto('/seller/settings');
  const invite = owner.locator('form').filter({ has: owner.getByRole('button', { name: 'إرسال دعوة' }) });
  await invite.locator('input[name=email]').fill(INVITEE.email);
  await invite.locator('select[name=role]').selectOption('ORDER_MANAGER');
  await invite.getByRole('button', { name: 'إرسال دعوة' }).click();
  await expect(owner.getByText(/الدعوة اتبعتت/)).toBeVisible();
  await expect(owner.getByTestId('pending-invitations')).toContainText(INVITEE.email);
  const [inv] = await q<{ id: string; status: string }>(`select i.id, i.status from seller_member_invitations i join users u on u.id = i.invited_user_id where u.email = $1`, [INVITEE.email]);
  expect(inv.status).toBe('PENDING');
  expect(await q(`select 1 from seller_members m join users u on u.id = m.user_id where u.email = $1`, [INVITEE.email])).toHaveLength(0);

  // Pending: the invitee has no Seller Center access yet.
  const invitee = await customerLogin(browser, INVITEE.email, INVITEE.password);
  await invitee.goto('/seller');
  await expect(invitee).toHaveURL(/\/seller\/register|\/sell/);

  // Another account sees nothing and cannot act on the invitation.
  const intruder = await customerLogin(browser, INTRUDER.email, INTRUDER.password);
  await intruder.goto('/account/store-invitations');
  await expect(intruder.getByTestId('store-invitations')).toHaveCount(0);
  await intruder.context().close();

  await invitee.goto('/account');
  await expect(invitee.getByTestId('store-invitations-link')).toBeVisible();
  await invitee.goto('/account/store-invitations');
  await expect(invitee.getByTestId('store-invitations')).toContainText('مسؤول الطلبات');
  await invitee.getByRole('button', { name: 'قبول الدعوة' }).click();
  // The answered invitation moves to the history list, marked accepted, with the way into Seller Center.
  await expect(invitee.getByText('اتقبلت')).toBeVisible();
  await expect(invitee.getByRole('link', { name: 'روح لمركز البائع' })).toBeVisible();
  const [m] = await q<{ role: string; is_active: boolean }>(`select m.role, m.is_active from seller_members m join users u on u.id = m.user_id where u.email = $1`, [INVITEE.email]);
  expect(m).toEqual({ role: 'ORDER_MANAGER', is_active: true });
  const audits = await q<{ action: string }>(`select action from audit_logs where entity_id = $1 order by created_at`, [inv.id]);
  expect(audits.map((a) => a.action)).toEqual(['seller.staff_invited', 'seller.staff_invitation_accepted']);

  // RBAC: an order manager reaches orders but not the team/payout settings.
  await invitee.goto('/seller/orders');
  await expect(invitee).toHaveURL(/\/seller\/orders/);
  await invitee.goto('/seller/settings');
  await expect(invitee.getByRole('button', { name: 'إرسال دعوة' })).toHaveCount(0);
  await invitee.context().close();

  // Cleanup through the owner's UI: the membership is deactivated, history stays.
  await owner.reload();
  const row = owner.locator('li').filter({ hasText: INVITEE.email }).filter({ has: owner.getByRole('button', { name: 'إزالة' }) });
  await row.getByRole('button', { name: 'إزالة' }).click();
  await expect.poll(async () => (await q<{ a: boolean }>(`select m.is_active a from seller_members m join users u on u.id = m.user_id where u.email = $1`, [INVITEE.email]))[0]?.a).toBe(false);
  await owner.context().close();
});

test('owner revokes a pending invitation; the invitee can no longer accept it', async ({ browser }) => {
  const owner = await customerLogin(browser, OWNER);
  await owner.goto('/seller/settings');
  const invite = owner.locator('form').filter({ has: owner.getByRole('button', { name: 'إرسال دعوة' }) });
  await invite.locator('input[name=email]').fill(INTRUDER.email);
  await invite.locator('select[name=role]').selectOption('SUPPORT');
  await invite.getByRole('button', { name: 'إرسال دعوة' }).click();
  await expect(owner.getByTestId('pending-invitations')).toContainText(INTRUDER.email);
  await owner.getByTestId('pending-invitations').locator('li').filter({ hasText: INTRUDER.email }).getByRole('button', { name: 'إلغاء الدعوة' }).click();
  // The revoked invitation leaves the pending list (its form unmounts with it).
  await expect(owner.getByTestId('pending-invitations').locator('li').filter({ hasText: INTRUDER.email })).toHaveCount(0);
  const [inv] = await q<{ status: string }>(`select i.status from seller_member_invitations i join users u on u.id = i.invited_user_id where u.email = $1 order by i.created_at desc limit 1`, [INTRUDER.email]);
  expect(inv.status).toBe('REVOKED');
  const user = await customerLogin(browser, INTRUDER.email, INTRUDER.password);
  await user.goto('/account/store-invitations');
  await expect(user.getByRole('button', { name: 'قبول الدعوة' })).toHaveCount(0);
  expect(await q(`select 1 from seller_members m join users u on u.id = m.user_id where u.email = $1`, [INTRUDER.email])).toHaveLength(0);
  await user.context().close();
  await owner.context().close();
});
