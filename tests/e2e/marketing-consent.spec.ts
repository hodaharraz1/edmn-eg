import { expect, test } from '@playwright/test';
import { customerLogin, q } from './helpers';

/**
 * PKG-E2E-01 — marketing consent through the real profile screen: OFF by default, grant, withdraw. Every change
 * is a dated, never-edited row in marketing_consent_events (the audience export reads only consenting customers).
 */
test.describe.configure({ mode: 'serial' });

const EMAIL = 'ahmed@demo.edmn.local';
const events = async () => q<{ action: string }>(`select e.action from marketing_consent_events e join users u on u.id = e.user_id where u.email = $1 order by e.created_at`, [EMAIL]);
const optIn = async () => (await q<{ v: boolean }>(`select marketing_opt_in v from users where email = $1`, [EMAIL]))[0].v;

test('grant then withdraw marketing consent from the profile, each change recorded with its date', async ({ browser }) => {
  const page = await customerLogin(browser, EMAIL);
  const before = (await events()).length;
  await page.goto('/account/profile');
  const box = page.locator('input[name=marketing]');
  const save = () => page.locator('form').filter({ has: box }).getByRole('button', { name: 'حفظ الاختيار' }).click();

  // Normalise to OFF first (the demo seed may or may not have it on), then exercise both directions.
  if (await box.isChecked()) {
    await box.uncheck();
    await save();
    await expect.poll(optIn).toBe(false);
  }
  await box.check();
  await save();
  await expect(page.getByText(/هتوصلك عروضنا وأخبارنا/).first()).toBeVisible();
  await expect.poll(optIn).toBe(true);
  await page.reload();
  await expect(page.locator('input[name=marketing]')).toBeChecked();

  await page.locator('input[name=marketing]').uncheck();
  await save();
  await expect.poll(optIn).toBe(false);
  await page.reload();
  await expect(page.locator('input[name=marketing]')).not.toBeChecked();

  const log = await events();
  expect(log.length).toBeGreaterThanOrEqual(before + 2);
  expect(log.slice(-2).map((e) => e.action)).toEqual(['GRANT', 'WITHDRAW']);
  const audits = await q<{ action: string }>(`select a.action from audit_logs a join users u on u.id::text = a.entity_id where u.email = $1 and a.action like 'account.marketing_consent_%'`, [EMAIL]);
  expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['account.marketing_consent_granted', 'account.marketing_consent_withdrawn']));
});
