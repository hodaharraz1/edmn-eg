import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { paymentDestinations, systemSettings } from '@/server/db/schema';
import { realMoneyEnabled, updateSetting } from '@/server/modules/settings';
import { saveDestination } from '@/server/modules/payments/service';
import type { Actor } from '@/server/core/actor';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, paymentOf } from '../helpers/factory';

let admin: Actor;
const prevEnv = process.env.EDMN_ENVIRONMENT;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});
afterAll(async () => {
  process.env.EDMN_ENVIRONMENT = prevEnv;
  await db.delete(systemSettings).where(eq(systemSettings.key, 'payments.realMoneyEnabled'));
  await db.update(paymentDestinations).set({ isEnabled: false }).where(eq(paymentDestinations.isTest, false));
});

describe('pilot safety — real money is off unless explicitly enabled', () => {
  it('defaults to TEST: new payments are flagged test and snapshot their destinations as test', async () => {
    expect(await realMoneyEnabled()).toBe(false);
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    expect(pay.isTest).toBe(true);
    expect((pay.destinationSnapshot as { isTest: boolean }[]).every((d) => d.isTest)).toBe(true);
  });

  it('can never be enabled on a staging deployment', async () => {
    process.env.EDMN_ENVIRONMENT = 'staging';
    await expect(updateSetting(admin, 'payments.realMoneyEnabled', true, 'pilot go-live')).rejects.toThrow(/Staging/);
    process.env.EDMN_ENVIRONMENT = prevEnv;
  });

  it('requires an enabled non-test destination before it can be enabled', async () => {
    delete process.env.EDMN_ENVIRONMENT;
    await db.update(paymentDestinations).set({ isEnabled: false }).where(eq(paymentDestinations.isTest, false));
    await expect(updateSetting(admin, 'payments.realMoneyEnabled', true, 'go-live')).rejects.toThrow(/حقيقية/);
  });

  it('a real destination needs complete account data; test destinations do not', async () => {
    await expect(saveDestination(admin, null, { methodCode: 'INSTAPAY', label: 'رسمي', details: {}, isEnabled: true, isTest: false }, 'إضافة حساب')).rejects.toThrow();
    await expect(saveDestination(admin, null, { methodCode: 'INSTAPAY', label: 'تجريبي', details: {}, isEnabled: false, isTest: true }, 'إضافة حساب')).resolves.toBeTruthy();
  });

  it('with real money enabled only real destinations are offered and payments are not test', async () => {
    delete process.env.EDMN_ENVIRONMENT;
    await saveDestination(admin, null, { methodCode: 'INSTAPAY', label: 'حساب الشركة الرسمي', details: { instapayAddress: 'company@instapay' }, isEnabled: true, isTest: false }, 'حساب معتمد');
    await updateSetting(admin, 'payments.realMoneyEnabled', true, 'go-live approved');
    expect(await realMoneyEnabled()).toBe(true);
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 3 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    expect(pay.isTest).toBe(false);
    const snap = pay.destinationSnapshot as { isTest: boolean; label: string }[];
    expect(snap.length).toBeGreaterThan(0);
    expect(snap.every((d) => d.isTest === false)).toBe(true);
    // a staging flag always wins, even when the stored setting is on
    process.env.EDMN_ENVIRONMENT = 'staging';
    expect(await realMoneyEnabled()).toBe(false);
    process.env.EDMN_ENVIRONMENT = prevEnv;
    await updateSetting(admin, 'payments.realMoneyEnabled', false, 'back to pilot');
  });
});
