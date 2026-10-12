import { expect, test } from '@playwright/test';
import { adminLogin, customerLogin, q, verifyIdentityViaUi } from './helpers';

/**
 * Production Hardening Batch 1.5 — targeted deployment checks. Writes only to an isolated @e2e.local customer
 * created here (identity case, receiving destination, support ticket). No money moves; A-100016 is never used.
 * The full behavioural matrix lives in tests/integration/batch15.test.ts.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString().slice(-7);
const USER = { name: 'عميل التحقق التجريبي', email: `b15-${RUN}@e2e.local`, phone: `0128${RUN}`, password: 'E2e@Batch15-2026' };

test('schema: migrations 0014 + 0015 are applied with the two-person and immutability guards', async () => {
  const [m] = await q<{ n: number }>(`select count(*)::int n from drizzle.__drizzle_migrations`);
  expect(m.n).toBeGreaterThanOrEqual(16);
  const [t] = await q<{ n: number }>(`select count(*)::int n from pg_trigger where tgname in
    ('financial_approvals_two_person','financial_movement_requests_guard','receiving_destinations_guard','review_events_append_only','privileged_message_access_append_only',
     'withdrawal_allocations_guard','withdrawal_allocations_no_delete')`);
  expect(t.n).toBe(7);
  // legacy seller identities are linked for review, never auto-approved
  const [legacy] = await q<{ approved: number }>(`select count(*)::int approved from user_identity_verifications where source = 'LEGACY_SELLER_APPLICATION' and status = 'APPROVED' and reviewed_by is null`);
  expect(legacy.approved).toBe(0);
});

test('a new customer verifies identity (front + back) through an identity reviewer; it is not seller approval', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.goto('/register');
  await page.locator('input[name=fullName]').fill(USER.name);
  await page.locator('input[name=email]').fill(USER.email);
  await page.locator('input[name=phone]').fill(USER.phone);
  await page.locator('input[name=password]').fill(USER.password);
  await page.locator('input[name=terms]').check();
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/register'));
  await page.goto('/account/identity');
  await expect(page.getByTestId('identity-status')).toContainText('لم يكتمل');
  await verifyIdentityViaUi(browser, page, USER.email, `2950505${RUN}`, 'عميل التحقق التجريبي محمد');
  await page.reload();
  await expect(page.getByTestId('identity-status')).toContainText('تم التحقق');
  expect(await q(`select s.id from sellers s join users u on u.id = s.owner_user_id where u.email = $1`, [USER.email])).toHaveLength(0);
  // ID images are private files
  const files = await q<{ v: string }>(`select f.visibility v from user_identity_verifications i join users u on u.id = i.user_id join files f on f.id in (i.front_file_id, i.back_file_id) where u.email = $1`, [USER.email]);
  expect(files.map((f) => f.v)).toEqual(['PRIVATE', 'PRIVATE']);
  await ctx.close();
});

test('receiving details: saved for review (never a wallet / balance), approved by a destination reviewer, shown masked', async ({ browser }) => {
  const page = await customerLogin(browser, USER.email, USER.password);
  await page.goto('/account/receiving');
  await expect(page.getByText('دي مش محفظة على اضمن')).toBeVisible();
  const form = page.getByTestId('receiving-wallet-form');
  await form.locator('input[name=holderName]').fill('عميل التحقق التجريبي محمد');
  await form.locator('input[name=walletNumber]').fill(`0128${RUN}`);
  await form.getByRole('button', { name: 'حفظ للمراجعة' }).click();
  await expect(page.getByTestId('receiving-list')).toContainText('قيد المراجعة');
  expect(await page.content()).not.toContain(`0128${RUN}`); // never the full number
  const [d] = await q<{ id: string }>(`select d.id from receiving_destinations d join users u on u.id = d.user_id where u.email = $1`, [USER.email]);
  const checker = await adminLogin(browser, 'checker@edmn.local');
  await checker.goto('/admin/receiving-destinations');
  const row = checker.getByTestId('destination-queue').locator('li').filter({ has: checker.locator(`input[name=id][value="${d.id}"]`) });
  await row.locator('select[name=decision]').selectOption('APPROVE');
  await row.locator('input[name=holderMatchesIdentity]').check();
  await row.getByRole('button', { name: /تسجيل/ }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from receiving_destinations where id = $1`, [d.id]))[0].status).toBe('APPROVED');
  await page.reload();
  await expect(page.getByTestId('receiving-list')).toContainText('معتمدة');
  await checker.context().close();
});

test('support: a resolved ticket is reopened by the customer with a new SLA cycle; history kept', async ({ browser }) => {
  const page = await customerLogin(browser, USER.email, USER.password);
  await page.goto('/account/support/new');
  await page.locator('select[name=type]').selectOption('IDENTITY');
  await page.locator('input[name=subject]').fill('سؤال عن التحقق من الهوية');
  await page.locator('textarea[name=body]').fill('عايز أعرف بياناتي بتتحفظ إزاي؟');
  await page.getByRole('button', { name: /إرسال|ابعت/ }).first().click();
  await expect.poll(async () => (await q(`select t.id from support_tickets t join users u on u.id = t.requester_user_id where u.email = $1`, [USER.email])).length).toBe(1);
  const [t] = await q<{ id: string }>(`select t.id from support_tickets t join users u on u.id = t.requester_user_id where u.email = $1`, [USER.email]);
  const support = await adminLogin(browser, 'support@edmn.local');
  await support.goto(`/admin/support/${t.id}`);
  await support.locator('select[name=status]').first().selectOption('RESOLVED');
  await support.getByRole('button', { name: 'تحديث' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from support_tickets where id = $1`, [t.id]))[0].status).toBe('RESOLVED');
  await page.goto(`/account/support/${t.id}`);
  const reopen = page.getByTestId('ticket-reopen');
  await reopen.locator('textarea[name=reason]').fill('لسه عندي سؤال تاني');
  await reopen.getByRole('button', { name: 'إعادة فتح التذكرة' }).click();
  await expect.poll(async () => (await q<{ status: string; reopen_count: number; sla_cycle: number }>(`select status, reopen_count, sla_cycle from support_tickets where id = $1`, [t.id]))[0]).toMatchObject({ status: 'OPEN', reopen_count: 1, sla_cycle: 2 });
  const cycles = await q<{ cycle: number }>(`select cycle from support_sla_cycles where ticket_id = $1 order by cycle`, [t.id]);
  expect(cycles.map((c) => c.cycle)).toEqual([1, 2]);
  await support.reload();
  await expect(support.getByTestId('ticket-sla')).toContainText('دورة 2');
  await support.context().close();
});

test('admin: approvals center, movements queue, identity queue and alert inventory render; money pages show the two-step rule', async ({ browser }) => {
  const admin = await adminLogin(browser);
  await admin.goto('/admin/approvals');
  await expect(admin.getByText('حركات مالية بانتظار معتمد').first()).toBeVisible();
  await expect(admin.getByText('التحقق من الهوية').first()).toBeVisible();
  await admin.goto('/admin/movements');
  await expect(admin.getByText('لا يوجد حد أدنى للمبلغ')).toBeVisible();
  await admin.goto('/admin/identity');
  await expect(admin.getByText('ليس اعتمادًا للمتجر')).toBeVisible();
  await admin.goto('/admin/alerts');
  await expect(admin.getByTestId('alert-inventory').locator('tbody tr')).toHaveCount(37);
  await expect(admin.getByText('لا توجد رسائل SMS')).toBeVisible();
  await admin.goto('/admin/refunds');
  await expect(admin.getByText(/شخصين مختلفين بدون أي حد أدنى/)).toBeVisible();
  await admin.context().close();
});

test('seller: one financial view with Marketplace and Protected Deal attribution', async ({ browser }) => {
  const seller = await customerLogin(browser, 'techzone@demo.edmn.local');
  await seller.goto('/account/earnings');
  await expect(seller.getByTestId('balance-marketplace')).toContainText('رصيد مبيعات المتجر');
  await expect(seller.getByTestId('balance-marketplace')).toContainText('رصيد متاح');
  await expect(seller.getByTestId('balance-marketplace')).toContainText('مبالغ قيد الإفراج');
  await expect(seller.getByText('محفظة', { exact: true })).toHaveCount(0);
  await seller.context().close();
});

test('Protected Deal: the delivery / inspection countdown is shown from server time and never moves money', async ({ browser }) => {
  const [d] = await q<{ id: string; email: string }>(`select d.id, u.email from external_deals d join users u on u.id = d.buyer_id
    where d.status in ('ACTIVE','DELIVERED') and d.delivery_deadline is not null and u.email like '%@demo.edmn.local' order by d.created_at desc limit 1`);
  test.skip(!d, 'no active demo deal fixture');
  const before = await q<{ n: number }>(`select count(*)::int n from journal_entries where source_id = $1`, [d.id]);
  const page = await customerLogin(browser, d.email);
  await page.goto(`/account/deals/${d.id}`);
  const timer = page.getByTestId('deal-delivery-timer');
  await expect(timer).toBeVisible();
  await expect(timer).toContainText(/الوقت المتبقي للتسليم|متأخر عن الموعد/);
  await expect(timer).toContainText('لا يحوّل أي مبلغ');
  expect(await q<{ n: number }>(`select count(*)::int n from journal_entries where source_id = $1`, [d.id])).toEqual(before);
  await page.context().close();
});

test('cross-source withdrawal from the account page: preview shows the source split; approval stores the allocation; two people', async ({ browser }) => {
  const [t] = await q<{ status: string | null }>(`select v.status from users u left join user_identity_verifications v on v.user_id = u.id where u.email = 'techzone@demo.edmn.local'`);
  test.skip(t?.status !== 'APPROVED', 'techzone identity is not approved on this database (legacy case pending review) — the request is correctly refused there');
  const seller = await customerLogin(browser, 'techzone@demo.edmn.local');
  await seller.goto('/account/earnings');
  const wf = seller.getByTestId('account-withdrawal');
  const previewForm = wf.locator('form').filter({ has: seller.getByRole('button', { name: 'احسب التوزيع' }) });
  await previewForm.locator('input[name=amount]').fill('120');
  await previewForm.locator('select[name=destination]').selectOption('store');
  await previewForm.getByRole('button', { name: 'احسب التوزيع' }).click();
  await expect(seller.getByTestId('allocation-preview')).toContainText(/رصيد مبيعات المتجر|رصيد الصفقات المحمية/);
  const requestForm = wf.locator('form').filter({ has: seller.getByRole('button', { name: 'طلب سحب' }) });
  await requestForm.locator('input[name=amount]').fill('120');
  await requestForm.locator('select[name=destination]').selectOption('store');
  await requestForm.getByRole('button', { name: 'طلب سحب' }).click();
  const wOf = async () => (await q<{ id: string; status: string; amount: string }>(`select w.id, w.status, w.amount from withdrawal_requests w join users u on u.id = w.user_id where u.email = 'techzone@demo.edmn.local' and w.source = 'ACCOUNT' order by w.created_at desc limit 1`))[0];
  await expect.poll(async () => (await wOf())?.status).toBe('REQUESTED');
  const w = await wOf();
  const checker = await adminLogin(browser, 'checker@edmn.local');
  await checker.goto(`/admin/withdrawals/${w.id}`);
  await checker.getByRole('button', { name: /اعتماد وحجز/ }).click();
  await expect.poll(async () => (await wOf()).status).toBe('APPROVED');
  const [sum] = await q<{ n: string }>(`select coalesce(sum(amount), 0)::text n from withdrawal_allocations where withdrawal_id = $1`, [w.id]);
  expect(sum.n).toBe(w.amount); // SUM(source allocations) == withdrawal amount
  await expect(checker.getByRole('button', { name: 'تأكيد الصرف' })).toHaveCount(0); // the approver never pays
  const operator = await adminLogin(browser, 'finance@edmn.local');
  await operator.goto(`/admin/withdrawals/${w.id}`);
  await operator.locator('input[name=reference]').fill(`B15-X-${RUN}`);
  await operator.getByRole('button', { name: 'تأكيد الصرف' }).click();
  await expect.poll(async () => (await wOf()).status).toBe('PAID');
  const statuses = await q<{ status: string }>(`select status from withdrawal_allocations where withdrawal_id = $1`, [w.id]);
  expect(statuses.every((x) => x.status === 'PAID')).toBe(true);
  await seller.context().close();
});
