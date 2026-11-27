import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, afterAll } from 'vitest';
import { resetSettings } from '../helpers/settings';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { financialApprovals, payments } from '@/server/db/schema';
import { confirmPayment, rejectPayment, startReview, submitProof } from '@/server/modules/payments/service';
import { updateSetting } from '@/server/modules/settings';
import { adminActor } from '@/server/auth/actors';
import type { Actor } from '@/server/core/actor';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, makeUser, paymentOf, png } from '../helpers/factory';

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
});

async function freshSubmittedProof(claimedEgp?: string) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { stock: 5 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
  const pay = await paymentOf(order.id);
  const { submission } = await submitProof(
    c.actor,
    pay.id,
    { claimedAmount: claimedEgp ?? String(pay.amountDue / 100), clientKey: randomUUID() },
    { data: await png('proof'), name: 'p.png' },
  );
  return { c, order, pay, submission };
}

// Shared settings this file changes go back to their defaults, even when a test fails midway (Q3, PKG-FOLLOWUP-01).
afterAll(() => resetSettings('payments.dailyReceiptLimit'));

describe('PAY-01 — payment confirmation is two-person (reviewer ≠ confirmer)', () => {
  it('confirmation without a started review is refused', async () => {
    const { pay, submission } = await freshSubmittedProof();
    await expect(confirmPayment(admin, pay.id, submission.id)).rejects.toThrow(/بدء المراجعة/);
  });

  it('the reviewer who started the review can never confirm (service + DB CHECK)', async () => {
    const reviewer = await makeAdmin(['PAYMENT_REVIEWER']);
    const { pay, submission } = await freshSubmittedProof();
    await startReview(reviewer, pay.id);
    await expect(confirmPayment(reviewer, pay.id, submission.id)).rejects.toThrow(/شخصين/);
    // DB level: even a direct write cannot make reviewer == confirmer.
    await expect(db.execute(sql`update payments set confirmed_by = review_started_by where id = ${pay.id}`)).rejects.toThrow();
  });

  it('a different staff member confirms; the approval records maker=reviewer, checker=confirmer', async () => {
    const reviewer = await makeAdmin(['PAYMENT_REVIEWER']);
    const { pay, submission } = await freshSubmittedProof();
    await startReview(reviewer, pay.id);
    expect((await confirmPayment(admin, pay.id, submission.id)).alreadyConfirmed).toBe(false);
    const [a] = await db.select().from(financialApprovals).where(eq(financialApprovals.idempotencyKey, `payment-confirmation:${pay.id}`));
    expect(a.dualControl).toBe(true);
    expect(a.requestedBy).toBe(reviewer.userId);
    expect(a.approvedBy).toBe(admin.userId);
    const [p] = await db.select().from(payments).where(eq(payments.id, pay.id));
    expect(p.status).toBe('CONFIRMED');
    expect(p.reviewStartedBy).toBe(reviewer.userId);
  });

  it('DB trigger: a single-person PAYMENT_CONFIRMATION approval can never be inserted', async () => {
    await expect(
      db.execute(sql`insert into financial_approvals (action, entity_type, entity_id, amount, economic_version, entry_types, reason, status, dual_control, requested_by, approved_by, idempotency_key)
        values ('PAYMENT_CONFIRMATION', 'payment', ${randomUUID()}, 100, 'v1', array['ORDER_PAYMENT'], 'اختبار اختراق', 'APPROVED', false, ${admin.userId!}, ${admin.userId!}, ${`pentest-${randomUUID()}`})`),
    ).rejects.toThrow();
  });
});

describe('PAY-01 — daily receipt limit per customer (Cairo day)', () => {
  it('receipts over the daily limit are refused with an Arabic validation error; rejected proofs stop counting', async () => {
    // Low test limit: 500 EGP (amounts are piasters).
    await updateSetting(admin, 'payments.dailyReceiptLimit', 500_00, 'اختبار الحد اليومي');
    try {
      const s = await makeSeller(admin);
      const prod = await makeProduct(s.actor, admin, { price: 400_00, stock: 10 });
      const c = await makeCustomer();
      // First receipt (400 EGP + shipping/fees make the order total; claimedAmount is what counts).
      const o1 = await checkout(c, [{ variantId: prod.variantId, qty: 1 }]);
      const p1 = await paymentOf(o1.id);
      const first = await submitProof(c.actor, p1.id, { claimedAmount: '300', clientKey: randomUUID() }, { data: await png('a'), name: 'a.png' });
      expect(first.created).toBe(true);
      // Second receipt pushes the day total (300 + 300 = 600 EGP) over the 500 EGP limit → refused.
      const o2 = await checkout(c, [{ variantId: prod.variantId, qty: 1 }], randomUUID());
      const p2 = await paymentOf(o2.id);
      await expect(submitProof(c.actor, p2.id, { claimedAmount: '300', clientKey: randomUUID() }, { data: await png('b'), name: 'b.png' })).rejects.toThrow(/للحد الأقصى اليومي/);
      // Rejecting the first proof frees the allowance: the refused receipt no longer counts.
      const reviewer = await makeAdmin(['PAYMENT_REVIEWER']);
      await startReview(reviewer, p1.id);
      await rejectPayment(reviewer, p1.id, first.submission.id, 'إيصال غير صحيح', true);
      const third = await submitProof(c.actor, p2.id, { claimedAmount: '300', clientKey: randomUUID() }, { data: await png('c'), name: 'c.png' });
      expect(third.created).toBe(true);
    } finally {
      await updateSetting(admin, 'payments.dailyReceiptLimit', 25_000_000, 'إعادة الافتراضي بعد الاختبار');
    }
  });

  it('the daily limit is a SENSITIVE setting: changing it requires a fresh step-up', async () => {
    const u = await makeUser({ staff: true, roles: ['SUPER_ADMIN'] });
    const stale = await adminActor(u.id, { stepUpAt: new Date(Date.now() - 60 * 60_000) }); // step-up older than the freshness window
    await expect(updateSetting(stale, 'payments.dailyReceiptLimit', 1_000_000, 'اختبار')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});
