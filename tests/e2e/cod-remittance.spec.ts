import { expect, test, type Browser } from '@playwright/test';
import { PDF, acceptDialogs, adminLogin, customerLogin, q } from './helpers';

/**
 * PKG-E2E-01 — cash on delivery, entirely through the UI, TWICE (exact statement, then a shortfall):
 * the customer orders with COD → the seller confirms, processes and ships (waybill) → the customer confirms
 * receipt → TWO different staff members record the courier company's statement (maker: admin@ requests,
 * checker: payments@ executes with the ACTUAL amount from the statement) → the ledger shows the cash in, and a
 * short statement leaves an OPEN shortfall (a receivable) with sellers unaffected.
 *
 * Role note (observed while writing this): the remittance panel renders only for staff holding BOTH
 * `payments.verify` (to see the panel) and `finance.movement.request` (to request). No single seeded demo role
 * has both, so the maker here is the super admin and the checker the payment reviewer.
 */
test.describe.configure({ mode: 'serial' });

const BUYER = 'ahmed@demo.edmn.local';
const SELLER = 'techzone@demo.edmn.local';
let slug = '';

async function setting(browser: Browser, key: string, value: string) {
  const admin = await adminLogin(browser, 'admin@edmn.local');
  await admin.goto('/admin/settings');
  const form = admin.locator('form').filter({ has: admin.locator(`input[name=key][value="${key}"]`) });
  await form.locator('input[name=value]').fill(value);
  await form.locator('input[name=reason]').fill('اختبار E2E للدفع عند الاستلام');
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(async () => (await q<{ v: unknown }>(`select value v from system_settings where key = $1`, [key]))[0]?.v).toEqual(value === 'true');
  await admin.context().close();
}

async function codJourney(browser: Browser, shortBy: number) {
  // 1. Customer orders with COD.
  const buyer = await customerLogin(browser, BUYER);
  await buyer.goto(`/product/${encodeURIComponent(slug)}`);
  await buyer.getByRole('button', { name: /ضيف للسلة/ }).first().click();
  await expect.poll(async () => (await q(`select ci.id from cart_items ci join carts c on c.id = ci.cart_id join users u on u.id = c.user_id where u.email = $1`, [BUYER])).length).toBeGreaterThan(0);
  await buyer.goto('/checkout');
  await buyer.locator('input[name=paymentMethod][value=COD]').check();
  await expect(buyer.getByText(/نقدًا للمندوب عند الاستلام/)).toBeVisible();
  await buyer.getByRole('button', { name: /أكّد الطلب/ }).click();
  await buyer.waitForURL(/\/account\/orders\/[0-9a-f-]{36}/);
  const orderId = buyer.url().match(/\/account\/orders\/([0-9a-f-]{36})/)![1];
  const [pay] = await q<{ id: string; status: string; method: string; amount_due: string }>(`select id, status, method, amount_due from payments where order_id = $1`, [orderId]);
  expect(pay).toMatchObject({ status: 'COD_PENDING', method: 'COD' });
  const [so] = await q<{ id: string }>(`select id from seller_orders where order_id = $1`, [orderId]);
  const soStatus = async () => (await q<{ status: string }>(`select status from seller_orders where id = $1`, [so.id]))[0].status;
  // No ledger entry yet: nothing was paid.
  expect((await q(`select id from journal_entries where source_type = 'payment' and source_id = $1`, [pay.id])).length).toBe(0);

  // 2. Seller confirms, processes and ships with the mandatory waybill.
  const seller = await customerLogin(browser, SELLER);
  await seller.goto(`/seller/orders/${so.id}`);
  await seller.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect.poll(soStatus).toBe('SELLER_CONFIRMED');
  await seller.reload();
  await seller.getByRole('button', { name: 'بدء التجهيز' }).click();
  await expect.poll(soStatus).toBe('PROCESSING');
  await seller.reload();
  await seller.locator('input[name=carrierName]').fill('بوسطة');
  await seller.locator('input[name=trackingNumber]').fill(`COD-${Date.now().toString().slice(-7)}`);
  await seller.locator('input[name=waybill]').setInputFiles({ name: 'waybill.pdf', mimeType: 'application/pdf', buffer: PDF });
  await seller.locator('input[name=markShipped]').check();
  await seller.getByRole('button', { name: 'حفظ' }).first().click();
  await expect.poll(soStatus).toBe('SHIPPED');

  // 3. Customer confirms receipt: the courier has the cash, the payment becomes COD_COLLECTED.
  await buyer.goto(`/account/orders/${orderId}`);
  await buyer.getByRole('button', { name: 'أكّد الاستلام' }).click();
  await expect.poll(soStatus).toBe('DELIVERED');
  await expect.poll(async () => (await q<{ status: string }>(`select status from payments where id = $1`, [pay.id]))[0].status).toBe('COD_COLLECTED');
  expect((await q(`select id from journal_entries where source_type = 'payment' and source_id = $1`, [pay.id])).length).toBe(0); // still no ledger entry

  // 4a. Maker (super admin) requests the remittance; nothing moves.
  const maker = await adminLogin(browser, 'admin@edmn.local');
  await maker.goto(`/admin/payments/${pay.id}`);
  const makerPanel = maker.getByTestId('movement-maker-COD_REMITTANCE');
  await makerPanel.locator('input[name=reason]').fill('طلب تسجيل تحصيل شركة الشحن بعد التسليم');
  await makerPanel.getByRole('button', { name: /^طلب / }).click();
  await expect(maker.getByTestId('movement-open-COD_REMITTANCE')).toContainText('بانتظار معتمد آخر');
  await expect(maker.getByRole('button', { name: 'تسجيل التحصيل من الكشف' })).toHaveCount(0); // the maker can never execute
  expect((await q(`select id from journal_entries where source_type = 'payment' and source_id = $1`, [pay.id])).length).toBe(0);
  await maker.context().close();

  // 4b. A DIFFERENT person (payment reviewer) records the ACTUAL amount from the courier statement.
  const due = Number(pay.amount_due);
  const actual = due - shortBy;
  const checker = await adminLogin(browser, 'payments@edmn.local');
  acceptDialogs(checker);
  await checker.goto(`/admin/payments/${pay.id}`);
  const open = checker.getByTestId('movement-open-COD_REMITTANCE');
  await expect(open).toContainText('اعتماد وتنفيذ');
  const form = open.locator('form').filter({ has: checker.getByRole('button', { name: 'تسجيل التحصيل من الكشف' }) });
  await form.locator('input[name=actualAmount]').fill((actual / 100).toFixed(2));
  await form.locator('input[name=statementRef]').fill(`ST-E2E-${Date.now().toString().slice(-6)}`);
  await form.locator('input[name=reason]').fill('مطابقة كشف شركة الشحن وتسجيل التحصيل');
  await form.getByRole('button', { name: 'تسجيل التحصيل من الكشف' }).click();
  await expect.poll(async () => (await q(`select id from journal_entries where source_type = 'payment' and source_id = $1`, [pay.id])).length).toBe(1);
  await checker.context().close();

  // 5. The ledger: cash in by the ACTUAL amount; a shortfall is a receivable; every entry balances.
  const lines = await q<{ code: string; debit: string | null; credit: string | null }>(
    `select a.code, l.debit, l.credit from journal_lines l join ledger_accounts a on a.id = l.account_id join journal_entries e on e.id = l.entry_id where e.source_type = 'payment' and e.source_id = $1`,
    [pay.id],
  );
  const dr = (c: string) => Number(lines.find((l) => l.code === c)?.debit ?? 0);
  expect(dr('PLATFORM_CASH')).toBe(actual);
  expect(lines.reduce((a, l) => a + Number(l.debit ?? 0), 0)).toBe(lines.reduce((a, l) => a + Number(l.credit ?? 0), 0));
  const approval = (await q<{ requested_by: string; approved_by: string; dual_control: boolean }>(`select requested_by, approved_by, dual_control from financial_approvals where action = 'COD_REMITTANCE' and entity_id = $1`, [pay.id]))[0];
  expect(approval.dual_control).toBe(true);
  expect(approval.requested_by).not.toBe(approval.approved_by);

  const shortfalls = await q<{ status: string; shortfall_amount: string; actual_amount: string }>(`select status, shortfall_amount, actual_amount from cod_remittance_shortfalls where payment_id = $1`, [pay.id]);
  if (shortBy === 0) {
    expect(shortfalls).toHaveLength(0);
    expect(lines.find((l) => l.code === 'COD_SHORTAGE_RECEIVABLE')).toBeUndefined();
  } else {
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0]).toMatchObject({ status: 'OPEN' });
    expect(Number(shortfalls[0].shortfall_amount)).toBe(shortBy);
    expect(dr('COD_SHORTAGE_RECEIVABLE')).toBe(shortBy);
    const staff = await adminLogin(browser, 'payments@edmn.local');
    await staff.goto(`/admin/payments/${pay.id}`);
    await expect(staff.getByTestId('cod-shortfall')).toContainText('مفتوح');
    await staff.context().close();
  }
}

test('setup: pick a live single-variant demo product and enable cash on delivery from the settings screen', async ({ browser }) => {
  const [p] = await q<{ slug: string }>(
    `select p.slug from products p join sellers s on s.id = p.seller_id join users u on u.id = s.owner_user_id
      where u.email = $1 and p.status = 'LIVE'
        and (select count(*) from product_variants v where v.product_id = p.id and v.is_active) = 1
        and (select max(v.stock_on_hand - v.reserved) from product_variants v where v.product_id = p.id) >= 3
        and (select min(v.price) from product_variants v where v.product_id = p.id) <= 300000
      limit 1`,
    [SELLER],
  );
  expect(p, 'the demo seed must contain a live single-variant techzone product with stock >= 3 and price <= 3000 EGP').toBeTruthy();
  slug = p.slug;
  await setting(browser, 'orders.codEnabled', 'true');
});

test('COD journey with an exact courier statement: cash in, no shortfall', async ({ browser }) => {
  await codJourney(browser, 0);
});

test('COD journey with a short courier statement: cash in by the actual amount, an OPEN shortfall for review', async ({ browser }) => {
  await codJourney(browser, 500); // the courier remitted 5.00 EGP less than collected
});

test('teardown: cash on delivery goes back to disabled', async ({ browser }) => {
  await setting(browser, 'orders.codEnabled', 'false');
});
