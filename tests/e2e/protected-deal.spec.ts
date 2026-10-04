import { expect, test } from '@playwright/test';
import { acceptDialogs, adminLogin, customerLogin, png, q } from './helpers';

/**
 * External Protected Deal: buyer wizard → secure invitation → seller accepts with payout details →
 * buyer pays (manual proof) → admin verifies → seller declares delivery → buyer confirms →
 * seller payout becomes payable and is recorded as paid by finance.
 */
test.describe.configure({ mode: 'serial' });

let dealId = '';
let token = '';
const status = async () => (await q<{ status: string }>(`select status from external_deals where id = $1`, [dealId]))[0]?.status;

test('buyer creates a deal through the wizard and invites the seller', async ({ browser }) => {
  const page = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await page.goto('/account/deals/new');
  await page.locator('input[name=title]').fill('موبايل سامسونج S22 مستعمل');
  await page.locator('textarea[name=description]').fill('الجهاز بحالة ممتازة مع العلبة والشاحن الأصلي، البطارية 90%.');
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=2/);
  dealId = new URL(page.url()).searchParams.get('deal')!;
  await page.locator('input[name=sellerName]').fill('عمر سمير');
  await page.locator('input[name=sellerPhone]').fill('01088888888');
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=3/);
  await page.locator('input[name=unitPrice]').fill('9500');
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=4/);
  await page.locator('input[name=deliveryMethod]').fill('تسليم يد بيد في مدينة نصر');
  await page.locator('input[name=deliveryDeadline]').fill(new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=5/);
  await page.getByRole('button', { name: 'حفظ والتالي' }).click();
  await page.waitForURL(/step=6/);
  await page.locator('input[name=acceptTerms]').check();
  await page.getByRole('button', { name: 'إرسال الدعوة للبائع' }).click();
  await page.waitForURL(/invite=/);
  token = new URL(page.url()).searchParams.get('invite')!;
  expect(await status()).toBe('INVITED');
  // Only a hash of the invitation token is stored.
  const inv = await q<{ token_hash: string }>(`select token_hash from deal_invitations where deal_id = $1`, [dealId]);
  expect(inv[0].token_hash).not.toBe(token);
});

test('seller accepts the invitation with payout details', async ({ browser }) => {
  const page = await customerLogin(browser, 'omar@demo.edmn.local');
  await page.goto(`/deal-invite/${token}`);
  await page.locator('select[name=payoutType]').selectOption('INSTAPAY');
  await page.locator('input[name=instapayAddress]').fill('omar.e2e@instapay');
  await page.locator('input[name=acceptTerms]').check();
  await page.getByRole('button', { name: 'موافق على الصفقة' }).click();
  // Acceptance moves the deal straight on to awaiting the buyer's payment.
  await expect.poll(status).toBe('PAYMENT_PENDING');
  const [d] = await q<{ m: string; enc: string }>(`select seller_payout_masked m, seller_payout_enc enc from external_deals where id = $1`, [dealId]);
  expect(d.enc).not.toContain('omar.e2e');
  expect(d.m).not.toBe('omar.e2e@instapay');
});

test('buyer pays and admin verifies', async ({ browser }) => {
  const page = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await page.goto(`/account/deals/${dealId}`);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect.poll(async () => (await q(`select id from payments where deal_id = $1`, [dealId])).length).toBe(1);
  await page.reload();
  await page.locator('input[name=reference]').fill('VC-E2E-5555');
  await page.locator('input[name=proof]').setInputFiles({ name: 'vc.png', mimeType: 'image/png', buffer: await png() });
  await page.getByRole('button', { name: 'رفع إثبات الدفع' }).click();
  await expect.poll(status).toBe('PAYMENT_UNDER_REVIEW');
  const [p] = await q<{ id: string }>(`select id from payments where deal_id = $1`, [dealId]);
  const admin = await adminLogin(browser, 'payments@edmn.local');
  acceptDialogs(admin);
  await admin.goto(`/admin/payments/${p.id}`);
  await admin.getByRole('button', { name: /تأكيد الدفع/ }).click();
  await expect.poll(status).toBe('ACTIVE');
});

test('seller delivers, buyer confirms, payout becomes payable and is paid', async ({ browser }) => {
  const seller = await customerLogin(browser, 'omar@demo.edmn.local');
  await seller.goto(`/account/deals/${dealId}`);
  await seller.locator('textarea[name=note]').fill('تم التسليم يداً بيد يوم الخميس.');
  await seller.getByRole('button', { name: 'تسجيل التسليم' }).click();
  await expect.poll(status).toBe('DELIVERED');
  const buyer = await customerLogin(browser, 'ahmed@demo.edmn.local');
  await buyer.goto(`/account/deals/${dealId}`);
  await buyer.getByRole('button', { name: 'تأكيد الاستلام وإتمام الصفقة' }).click();
  await expect.poll(status).toBe('COMPLETED');
  const [po] = await q<{ id: string; amount: string; status: string }>(`select id, amount, status from deal_payouts where deal_id = $1`, [dealId]);
  const [d] = await q<{ r: string }>(`select seller_receives r from external_deals where id = $1`, [dealId]);
  expect(po.status).toBe('PENDING');
  expect(po.amount).toBe(d.r);
  const admin = await adminLogin(browser, 'finance@edmn.local');
  await admin.goto('/admin/refunds?tab=deals');
  const card = admin.locator('li', { hasText: `صفقة #` }).filter({ has: admin.locator(`input[name=id][value="${po.id}"]`) });
  await card.locator('input[name=reference]').fill('PAYOUT-E2E-1');
  await card.getByRole('button', { name: 'تسجيل الصرف' }).click();
  await expect.poll(async () => (await q<{ status: string }>(`select status from deal_payouts where id = $1`, [po.id]))[0].status).toBe('PAID');
});
