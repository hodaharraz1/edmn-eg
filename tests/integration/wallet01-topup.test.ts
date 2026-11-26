import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { customerWalletEntries, financialApprovals, financialMovementRequests, journalEntries, journalLines, ledgerAccounts, walletTopups } from '@/server/db/schema';
import { requestMovement } from '@/server/modules/finance/movements';
import { financialInvariants } from '@/server/modules/finance/controls';
import { accountBalance, reconcile } from '@/server/modules/finance/ledger';
import { cancelTopup, creditTopup, myTopups, rejectTopup, submitTopup, topUpSummary, walletBalance } from '@/server/modules/finance/wallet-topups';
import { submitProof } from '@/server/modules/payments/service';
import { walletView } from '@/server/modules/mobile/wallet';
import { updateSetting } from '@/server/modules/settings';
import type { Actor } from '@/server/core/actor';
import { checkout, ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller, paymentOf, png } from '../helpers/factory';

/**
 * PKG-WALLET-01 phase 1 — customer wallet top-up: flag gate, daily cap shared with receipts, two-person credit
 * (service + DB), balanced posting + per-user sub-ledger, rejection, finality, cancel rules, idempotency, invariants.
 */
let admin: Actor; // SUPER_ADMIN: Checker (payments.verify) and, when needed, a Maker too
let maker: Actor; // FINANCE_OPERATOR: finance.movement.request only

const flag = (on: boolean) => updateSetting(admin, 'wallet.topUpEnabled', on, on ? 'تفعيل الإيداع في الاختبار' : 'إعادة الإغلاق بعد الاختبار');

beforeAll(async () => {
  admin = await makeAdmin();
  maker = await makeAdmin(['FINANCE_OPERATOR']);
  await ensurePaymentSetup();
  await flag(true);
});
afterAll(async () => {
  await flag(false);
});

async function deposit(c: Awaited<ReturnType<typeof makeCustomer>>, egp = '500', method: 'INSTAPAY' | 'BANK_TRANSFER' | 'VODAFONE_CASH' = 'INSTAPAY') {
  const r = await submitTopup(c.actor, { amount: egp, method, clientKey: randomUUID(), payerReference: 'REF-1' }, { data: await png('receipt'), name: 'r.png' });
  return r.topup;
}
const makerRequestCredit = (topupId: string, amount: number, who: Actor = maker) =>
  requestMovement(who, 'WALLET_TOPUP_CREDIT', { entityId: topupId, amount, reason: 'تم التحقق من الإيصال في كشف الحساب' });
const entriesOf = (topupId: string) => db.select().from(journalEntries).where(and(eq(journalEntries.entryType, 'WALLET_TOPUP_CREDIT'), eq(journalEntries.sourceId, topupId)));

describe('PKG-WALLET-01 — flag gate (default closed)', () => {
  it('wallet.topUpEnabled defaults to false and every top-up path answers feature_disabled when off', async () => {
    const c = await makeCustomer();
    await flag(false);
    try {
      await expect(submitTopup(c.actor, { amount: '100', method: 'INSTAPAY', clientKey: randomUUID() }, { data: await png('x'), name: 'x.png' })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
      await expect(myTopups(c.actor)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
      await expect(cancelTopup(c.actor, randomUUID())).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
      const w = await walletView(c.actor);
      expect(w.topUp.enabled).toBe(false);
      expect(w.topUp.pending).toEqual([]);
      expect(w).not.toHaveProperty('topUpAvailable');
      // nothing was created
      expect(await db.select().from(walletTopups).where(eq(walletTopups.userId, c.user.id))).toHaveLength(0);
    } finally {
      await flag(true);
    }
  });

  it('the flag is a SENSITIVE setting (needs a fresh step-up)', async () => {
    const stale = { ...admin, stepUpAt: new Date(Date.now() - 60 * 60_000) } as Actor;
    await expect(updateSetting(stale, 'wallet.topUpEnabled', true, 'اختبار')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});

describe('PKG-WALLET-01 — submit, idempotency, daily cap shared with receipts', () => {
  it('a deposit is PENDING_REVIEW, credits nothing, and a retry with the same key returns the first one', async () => {
    const c = await makeCustomer();
    const key = randomUUID();
    const input = { amount: '1250.50', method: 'BANK_TRANSFER' as const, clientKey: key };
    const a = await submitTopup(c.actor, input, { data: await png('r1'), name: 'r1.png' });
    const b = await submitTopup(c.actor, input, { data: await png('r2'), name: 'r2.png' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.topup.id).toBe(a.topup.id);
    expect(a.topup.status).toBe('PENDING_REVIEW');
    expect(a.topup.amount).toBe(125_050);
    expect(await walletBalance(db, c.user.id)).toBe(0);
    expect(await entriesOf(a.topup.id)).toHaveLength(0);
    expect((await myTopups(c.actor)).items.map((t) => t.id)).toEqual([a.topup.id]);
    expect((await topUpSummary(db, c.user.id)).pending).toHaveLength(1);
  });

  it('a receipt file is required and a bad amount is refused', async () => {
    const c = await makeCustomer();
    await expect(submitTopup(c.actor, { amount: '100', method: 'INSTAPAY', clientKey: randomUUID() }, null)).rejects.toThrow(/إيصال/);
    for (const amount of ['0', '-5', 'abc']) {
      await expect(submitTopup(c.actor, { amount, method: 'INSTAPAY', clientKey: randomUUID() }, { data: await png('x'), name: 'x.png' })).rejects.toThrow(/المبلغ/);
    }
  });

  it('a mobile wallet deposit (Vodafone Cash / any Egyptian wallet) is accepted and offered with its destination', async () => {
    const c = await makeCustomer();
    expect((await deposit(c, '75', 'VODAFONE_CASH')).method).toBe('VODAFONE_CASH');
    expect((await myTopups(c.actor)).methods.map((m) => m.code)).toContain('VODAFONE_CASH');
  });

  it('there is no minimum: 1 EGP is accepted', async () => {
    const c = await makeCustomer();
    expect((await deposit(c, '1')).amount).toBe(100);
  });

  it('the daily cap is shared: an order receipt + a deposit together over the cap are refused; rejected deposits stop counting', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { stock: 5 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    const pay = await paymentOf(order.id);
    await submitProof(c.actor, pay.id, { claimedAmount: String(pay.amountDue / 100), clientKey: randomUUID() }, { data: await png('proof'), name: 'p.png' });
    await updateSetting(admin, 'payments.dailyReceiptLimit', pay.amountDue + 100_00, 'اختبار الحد اليومي المشترك');
    try {
      await expect(deposit(c, '200')).rejects.toThrow(/للحد الأقصى اليومي/);
      const ok = await deposit(c, '60'); // 60 EGP fits in the 100 EGP left
      expect(ok.status).toBe('PENDING_REVIEW');
      expect((await topUpSummary(db, c.user.id)).usedTodayPiastres).toBe(pay.amountDue + 60_00);
      await expect(deposit(c, '50')).rejects.toThrow(/للحد الأقصى اليومي/); // 60 + 50 > 100
      // a rejected deposit frees its allowance
      await rejectTopup(admin, ok.id, 'الإيصال غير واضح ولا يطابق الكشف');
      expect((await deposit(c, '50')).status).toBe('PENDING_REVIEW');
    } finally {
      await updateSetting(admin, 'payments.dailyReceiptLimit', 25_000_000, 'إعادة الافتراضي بعد الاختبار');
    }
  });

  it('the cap is 250,000 EGP per day by default, deposits alone included', async () => {
    const c = await makeCustomer();
    await deposit(c, '250000');
    await expect(deposit(c, '1')).rejects.toThrow(/للحد الأقصى اليومي/);
  });
});

describe('PKG-WALLET-01 — credit is two-person (service + DB)', () => {
  it('no open Maker request: the Checker cannot credit', async () => {
    const t = await deposit(await makeCustomer());
    await expect(creditTopup(admin, t.id)).rejects.toThrow(/منشئ/);
    expect((await db.select().from(walletTopups).where(eq(walletTopups.id, t.id)))[0].status).toBe('PENDING_REVIEW');
  });

  it('the same person can never be Maker and Checker (service)', async () => {
    const t = await deposit(await makeCustomer());
    await makerRequestCredit(t.id, t.amount, admin);
    await expect(creditTopup(admin, t.id)).rejects.toThrow(/شخصين|نفس الشخص/);
    expect(await entriesOf(t.id)).toHaveLength(0);
  });

  it('DB trigger: a single-person WALLET_TOPUP_CREDIT approval can never be inserted', async () => {
    await expect(
      db.execute(sql`insert into financial_approvals (action, entity_type, entity_id, amount, economic_version, entry_types, reason, status, dual_control, requested_by, approved_by, idempotency_key)
        values ('WALLET_TOPUP_CREDIT', 'wallet_topup', ${randomUUID()}, 100, 'v1', array['WALLET_TOPUP_CREDIT'], 'اختبار اختراق', 'APPROVED', false, ${admin.userId!}, ${admin.userId!}, ${`pentest-${randomUUID()}`})`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`insert into financial_approvals (action, entity_type, entity_id, amount, economic_version, entry_types, reason, status, dual_control, requested_by, approved_by, idempotency_key)
        values ('WALLET_TOPUP_CREDIT', 'wallet_topup', ${randomUUID()}, 100, 'v1', array['WALLET_TOPUP_CREDIT'], 'اختبار اختراق', 'APPROVED', true, ${admin.userId!}, ${admin.userId!}, ${`pentest-${randomUUID()}`})`),
    ).rejects.toThrow();
  });

  it('the Maker request must match a pending deposit and its exact amount', async () => {
    const t = await deposit(await makeCustomer());
    await expect(makerRequestCredit(t.id, t.amount + 1)).rejects.toThrow(/لا يطابق/);
    await expect(makerRequestCredit(randomUUID(), 100)).rejects.toThrow();
  });
});

describe('PKG-WALLET-01 — credit posts a balanced entry and the per-user sub-ledger row', () => {
  it('Maker requests, a different Checker credits: Dr PLATFORM_CASH / Cr CUSTOMER_WALLETS, +amount sub-ledger row, CREDITED', async () => {
    const c = await makeCustomer();
    const t = await deposit(c, '750.25');
    const cashBefore = await accountBalance(db, { code: 'PLATFORM_CASH' });
    await makerRequestCredit(t.id, t.amount);
    expect((await creditTopup(admin, t.id)).alreadyCredited).toBe(false);

    const [row] = await db.select().from(walletTopups).where(eq(walletTopups.id, t.id));
    expect(row.status).toBe('CREDITED');
    expect(row.decidedBy).toBe(admin.userId);
    const [entry] = await entriesOf(t.id);
    expect(row.journalEntryId).toBe(entry.id);
    const lines = await db
      .select({ code: ledgerAccounts.code, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, entry.id));
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.code === 'PLATFORM_CASH')).toMatchObject({ debit: 75_025, credit: 0 });
    expect(lines.find((l) => l.code === 'CUSTOMER_WALLETS')).toMatchObject({ debit: 0, credit: 75_025 });
    const sub = await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id));
    expect(sub).toHaveLength(1);
    expect(sub[0]).toMatchObject({ amount: 75_025, kind: 'TOPUP', topupId: t.id, journalEntryId: entry.id });
    expect(await walletBalance(db, c.user.id)).toBe(75_025);
    expect((await accountBalance(db, { code: 'PLATFORM_CASH' })) - cashBefore).toBe(75_025);

    const [a] = await db.select().from(financialApprovals).where(eq(financialApprovals.idempotencyKey, `wallet-topup-credit:${t.id}`));
    expect(a).toMatchObject({ dualControl: true, requestedBy: maker.userId, approvedBy: admin.userId, amount: 75_025, action: 'WALLET_TOPUP_CREDIT' });
    const [req] = await db.select().from(financialMovementRequests).where(and(eq(financialMovementRequests.kind, 'WALLET_TOPUP_CREDIT'), eq(financialMovementRequests.entityId, t.id)));
    expect(req.status).toBe('EXECUTED');

    // the customer sees it in the wallet view
    const w = await walletView(c.actor);
    expect(w.topUp).toMatchObject({ enabled: true, balancePiastres: 75_025, pending: [] });
  });

  it('a replayed credit posts nothing twice', async () => {
    const c = await makeCustomer();
    const t = await deposit(c, '100');
    await makerRequestCredit(t.id, t.amount);
    await creditTopup(admin, t.id);
    expect((await creditTopup(admin, t.id)).alreadyCredited).toBe(true);
    expect(await entriesOf(t.id)).toHaveLength(1);
    expect(await walletBalance(db, c.user.id)).toBe(10_000);
  });

  it('the ledger stays balanced and the wallet invariants hold (CUSTOMER_WALLETS = Σ sub-ledger, none negative)', async () => {
    const c = await makeCustomer();
    const t = await deposit(c, '300');
    await makerRequestCredit(t.id, t.amount);
    await creditTopup(admin, t.id);
    const rec = await reconcile(db);
    expect(rec.trialBalanceOk).toBe(true);
    expect(rec.mismatches).toEqual([]);
    const inv = await financialInvariants(db);
    for (const code of ['WALLET_LEDGER_DRIFT', 'WALLET_NEGATIVE', 'MISSING_WALLET_JOURNAL', 'UNBALANCED_ENTRY', 'UNAPPROVED_JOURNAL', 'ORPHAN_JOURNAL', 'DUPLICATE_BUSINESS_EVENT']) {
      expect(inv.checks.find((x) => x.code === code)?.count, code).toBe(0);
    }
    const [acc] = await db.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.code, 'CUSTOMER_WALLETS'), sql`seller_id is null`));
    const [{ s }] = (await db.execute<{ s: string }>(sql`select coalesce(sum(amount),0)::text s from customer_wallet_entries`)).rows;
    expect(acc.balance).toBe(Number(s));
  });

  it('the invariant catches drift: a wallet entry without its ledger balance is reported', async () => {
    // Detection test only: simulate drift in a rolled-back transaction so nothing leaks into other tests.
    const probe = Symbol('rollback');
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`update ledger_accounts set balance = balance + 1 where code = 'CUSTOMER_WALLETS' and seller_id is null`);
        const inv = await financialInvariants(tx);
        expect(inv.checks.find((x) => x.code === 'WALLET_LEDGER_DRIFT')!.count).toBe(1);
        throw probe;
      })
      .catch((e) => {
        if (e !== probe) throw e;
      });
  });
});

describe('PKG-WALLET-01 — reject, finality, cancel', () => {
  it('reject posts nothing, stores the reason, closes the open request, and the deposit can never be credited afterwards', async () => {
    const c = await makeCustomer();
    const t = await deposit(c, '200');
    await makerRequestCredit(t.id, t.amount);
    await expect(rejectTopup(admin, t.id, 'قصير')).rejects.toThrow(/10/);
    await rejectTopup(admin, t.id, 'الإيصال غير مطابق لكشف الحساب');
    const [row] = await db.select().from(walletTopups).where(eq(walletTopups.id, t.id));
    expect(row).toMatchObject({ status: 'REJECTED', rejectReason: 'الإيصال غير مطابق لكشف الحساب', decidedBy: admin.userId });
    expect(await entriesOf(t.id)).toHaveLength(0);
    expect(await walletBalance(db, c.user.id)).toBe(0);
    const [req] = await db.select().from(financialMovementRequests).where(and(eq(financialMovementRequests.kind, 'WALLET_TOPUP_CREDIT'), eq(financialMovementRequests.entityId, t.id)));
    expect(req.status).toBe('REJECTED');
    await expect(creditTopup(admin, t.id)).rejects.toThrow();
    await expect(makerRequestCredit(t.id, t.amount)).rejects.toThrow();
    expect((await myTopups(c.actor)).items[0]).toMatchObject({ status: 'REJECTED', rejectReason: 'الإيصال غير مطابق لكشف الحساب' });
  });

  it('the Maker cannot reject the deposit they requested (they withdraw the request instead)', async () => {
    const t = await deposit(await makeCustomer());
    const mk = await makeAdmin(['SUPER_ADMIN']);
    await makerRequestCredit(t.id, t.amount, mk);
    await expect(rejectTopup(mk, t.id, 'سبب الرفض كافي هنا')).rejects.toThrow();
  });

  it('CREDITED and REJECTED rows are final and never deleted (DB trigger)', async () => {
    const c = await makeCustomer();
    const credited = await deposit(c, '10');
    await makerRequestCredit(credited.id, credited.amount);
    await creditTopup(admin, credited.id);
    const rejected = await deposit(c, '11');
    await rejectTopup(admin, rejected.id, 'الإيصال غير مطابق لكشف الحساب');
    for (const id of [credited.id, rejected.id]) {
      await expect(db.execute(sql`update wallet_topups set status = 'PENDING_REVIEW' where id = ${id}`)).rejects.toThrow();
      await expect(db.execute(sql`update wallet_topups set status = 'CANCELLED' where id = ${id}`)).rejects.toThrow();
      await expect(db.execute(sql`delete from wallet_topups where id = ${id}`)).rejects.toThrow();
    }
    // a CREDITED row needs a journal entry and a decider; a REJECTED one needs a reason (CHECK)
    const pending = await deposit(c, '12');
    await expect(db.execute(sql`update wallet_topups set status = 'CREDITED' where id = ${pending.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update wallet_topups set status = 'REJECTED' where id = ${pending.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update wallet_topups set amount = amount + 1 where id = ${pending.id}`)).rejects.toThrow();
  });

  it('the wallet sub-ledger is append-only and can never go negative (DB)', async () => {
    const c = await makeCustomer();
    const t = await deposit(c, '40');
    await makerRequestCredit(t.id, t.amount);
    await creditTopup(admin, t.id);
    const [e] = await db.select().from(customerWalletEntries).where(eq(customerWalletEntries.userId, c.user.id));
    await expect(db.execute(sql`update customer_wallet_entries set amount = 1 where id = ${e.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from customer_wallet_entries where id = ${e.id}`)).rejects.toThrow();
    // a spend larger than the balance is refused at commit
    const overspend = await db
      .execute(sql`insert into customer_wallet_entries (user_id, journal_entry_id, amount, kind) values (${c.user.id}, ${e.journalEntryId}, ${-(e.amount + 1)}, 'SPEND')`)
      .then(() => null, (err: { cause?: { message?: string } }) => err.cause?.message ?? String(err));
    expect(overspend).toMatch(/would be negative/);
    expect(await walletBalance(db, c.user.id)).toBe(4_000);
  });

  it('cancel: allowed while pending with no staff request; refused once a request exists, after a decision, and for someone else\'s deposit', async () => {
    const c = await makeCustomer();
    const other = await makeCustomer();
    const free = await deposit(c, '20');
    await expect(cancelTopup(other.actor, free.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await cancelTopup(c.actor, free.id)).status).toBe('CANCELLED');
    expect((await cancelTopup(c.actor, free.id)).status).toBe('CANCELLED'); // idempotent

    const reviewed = await deposit(c, '21');
    await makerRequestCredit(reviewed.id, reviewed.amount);
    await expect(cancelTopup(c.actor, reviewed.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await creditTopup(admin, reviewed.id);
    await expect(cancelTopup(c.actor, reviewed.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // a cancelled deposit cannot be credited and stops counting toward the daily cap
    await expect(makerRequestCredit(free.id, free.amount)).rejects.toThrow();
    expect((await topUpSummary(db, c.user.id)).usedTodayPiastres).toBe(2_100);
  });
});
