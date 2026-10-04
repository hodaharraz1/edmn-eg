import { expect, test } from '@playwright/test';
import { acceptDialogs, adminLogin, customerLogin, PDF, png, q } from './helpers';

/**
 * Critical path: buyer orders → uploads manual payment proof → admin verifies → seller confirms and ships
 * with a mandatory waybill → buyer confirms receipt (funds released) → seller requests withdrawal →
 * admin approves and records the transfer. Every state is asserted against the database.
 */
test.describe.configure({ mode: 'serial' });

let orderId = '';
let soId = '';

test('buyer places an order and submits payment proof', async ({ browser }) => {
  const [prod] = await q<{ slug: string }>(`select p.slug from products p join stores s on s.seller_id = p.seller_id join product_variants v on v.product_id = p.id
    where s.slug = 'تك-زون' and p.status = 'LIVE' and v.stock_on_hand - v.reserved >= 2 group by p.slug having count(v.id) = 1 limit 1`);
  expect(prod, 'demo product available').toBeTruthy();
  const page = await customerLogin(browser, 'mona@demo.edmn.local');
  await page.goto(`/product/${encodeURIComponent(prod.slug)}`);
  await page.getByRole('button', { name: /أضف إلى السلة|إضافة إلى السلة|أضف للسلة/ }).first().click();
  await expect.poll(async () => (await q(`select ci.id from cart_items ci join carts c on c.id = ci.cart_id join users u on u.id = c.user_id where u.email = 'mona@demo.edmn.local'`)).length).toBeGreaterThan(0);
  await page.goto('/checkout');
  await page.locator('input[name=paymentMethod][value=INSTAPAY]').check();
  await page.getByRole('button', { name: /تأكيد الطلب/ }).click();
  await page.waitForURL(/\/account\/orders\/[^/]+\/pay/);
  orderId = page.url().split('/orders/')[1].split('/')[0];
  await page.locator('input[name=payerName]').fill('منى خالد');
  await page.locator('input[name=reference]').fill('IPN-E2E-0001');
  await page.locator('input[name=proof]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: await png() });
  await page.getByRole('button', { name: 'رفع إثبات الدفع' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from payments where order_id = $1`, [orderId]))[0]?.status).toBe('PAYMENT_SUBMITTED');
  // The order is NOT paid until an admin verifies it.
  expect((await q<{ status: string }>(`select status from orders where id = $1`, [orderId]))[0].status).not.toBe('PAID');
});

test('admin verifies the payment', async ({ browser }) => {
  const [p] = await q<{ id: string }>(`select id from payments where order_id = $1`, [orderId]);
  const page = await adminLogin(browser);
  acceptDialogs(page);
  await page.goto(`/admin/payments/${p.id}`);
  await page.getByRole('button', { name: /تأكيد الدفع/ }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from payments where id = $1`, [p.id]))[0].status).toBe('CONFIRMED');
  const [so] = await q<{ id: string; status: string }>(`select id, status from seller_orders where order_id = $1`, [orderId]);
  expect(so.status).toBe('PAID');
  soId = so.id;
});

test('seller confirms and ships with a waybill', async ({ browser }) => {
  const page = await customerLogin(browser, 'techzone@demo.edmn.local');
  await page.goto(`/seller/orders/${soId}`);
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from seller_orders where id = $1`, [soId]))[0].status).toBe('SELLER_CONFIRMED');
  await page.reload();
  await page.locator('input[name=carrierName]').fill('بوسطة');
  await page.locator('input[name=trackingNumber]').fill('BOSTA-E2E-1');
  await page.locator('input[name=waybill]').setInputFiles({ name: 'waybill.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.locator('input[name=markShipped]').check();
  await page.getByRole('button', { name: 'حفظ' }).first().click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from seller_orders where id = $1`, [soId]))[0].status).toBe('SHIPPED');
  const docs = await q(`select d.id from shipment_documents d join shipments s on s.id = d.shipment_id where s.seller_order_id = $1`, [soId]);
  expect(docs.length).toBe(1);
});

test('buyer confirms receipt and seller funds become available', async ({ browser }) => {
  const [{ sid }] = await q<{ sid: string }>(`select seller_id as sid from seller_orders where id = $1`, [soId]);
  const bal = async () => Number((await q<{ b: string }>(`select balance as b from ledger_accounts where seller_id = $1 and code = 'SELLER_AVAILABLE'`, [sid]))[0]?.b ?? 0);
  const before = await bal();
  const page = await customerLogin(browser, 'mona@demo.edmn.local');
  await page.goto(`/account/orders/${orderId}`);
  await page.getByRole('button', { name: 'تأكيد استلام الطلب' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from seller_orders where id = $1`, [soId]))[0].status).toBe('DELIVERED');
  const [{ net }] = await q<{ net: string }>(`select seller_net as net from seller_orders where id = $1`, [soId]);
  await expect.poll(bal).toBe(before + Number(net));
});

test('seller requests a withdrawal; admin approves and records the transfer', async ({ browser }) => {
  const seller = await customerLogin(browser, 'techzone@demo.edmn.local');
  await seller.goto('/seller/withdrawals');
  await seller.locator('input[name=amount]').fill('150');
  await seller.getByRole('button', { name: 'تقديم طلب السحب' }).click();
  await expect.poll(async () => (await q(`select w.id from withdrawal_requests w join stores s on s.seller_id = w.seller_id where s.slug = 'تك-زون' and w.amount = 15000 and w.status = 'REQUESTED'`)).length).toBe(1);
  const [w] = await q<{ id: string }>(`select w.id from withdrawal_requests w join stores s on s.seller_id = w.seller_id where s.slug = 'تك-زون' and w.amount = 15000`);
  const admin = await adminLogin(browser);
  await admin.goto(`/admin/withdrawals/${w.id}`);
  await admin.getByRole('button', { name: 'اعتماد للصرف' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from withdrawal_requests where id = $1`, [w.id]))[0].status).toBe('APPROVED');
  await admin.reload();
  await admin.locator('input[name=reference]').fill('TRX-E2E-777');
  await admin.getByRole('button', { name: 'تأكيد الصرف' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from withdrawal_requests where id = $1`, [w.id]))[0].status).toBe('PAID');
  const entries = await q(`select id from journal_entries where idempotency_key = $1`, [`wd-paid:${w.id}`]);
  expect(entries.length).toBe(1);
});

test('ledger stays balanced after the flow', async () => {
  const [t] = await q<{ dr: string; cr: string }>(`select coalesce(sum(debit),0) dr, coalesce(sum(credit),0) cr from journal_lines`);
  expect(t.dr).toBe(t.cr);
});
