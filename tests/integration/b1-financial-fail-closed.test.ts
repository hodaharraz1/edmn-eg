import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db/client';
import { journalEntries, ledgerHealthChecks, refunds, sellerOrders, statusHistory, systemSettings } from '@/server/db/schema';
import type { Actor } from '@/server/core/actor';
import { sellerActor } from '@/server/auth/actors';
import { assertNotPaused, financialInvariants, KILL_SWITCHES, killSwitchEngaged, setKillSwitch, type KillSwitch } from '@/server/modules/finance/controls';
import { assertLedgerHealthy, ledgerHealthBlock, runLedgerHealthCheck } from '@/server/modules/finance/ledger-health';
import { approveRefund, markRefundFailed, markRefundTransferUncertain, recordRefundPayout, resolveRefundTransferNotSent } from '@/server/modules/finance/refunds';
import { cancelSellerOrder, confirmReceipt } from '@/server/modules/commerce/fulfilment';
import { escalateReturn, rejectReturn, requestReturn } from '@/server/modules/postpurchase/returns';
import { openDispute, resolveDispute } from '@/server/modules/postpurchase/disputes';
import { runOneJob, SCHEDULE } from '@/server/jobs/worker';
import { checkout, ensurePaymentSetup, itemsOf, makeAdmin, makeCustomer, makeProduct, makerRequest, makeSeller, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * B1 — FINANCIAL FAIL-CLOSED (P0 #1–#4 of docs/audits/END_TO_END_TRUST_FRAUD_GAP_AUDIT.md).
 * Uncertain or unreadable safety state must never let money move; an authorized decision's amount is never replaced.
 */
let admin: Actor;
let checker: Actor;
let checker2: Actor;
let operator: Actor;
let officer: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  checker = await makeAdmin(['FINANCE_CHECKER']);
  checker2 = await makeAdmin(['FINANCE_CHECKER']);
  operator = await makeAdmin(['FINANCE_OPERATOR']);
  officer = await makeAdmin(['DISPUTE_OFFICER']);
  await ensurePaymentSetup();
});
afterAll(async () => {
  // Leave the books with a fresh, real health snapshot for anything that runs next.
  await runLedgerHealthCheck('test-b1-teardown');
});

async function paidOrder(price = 400_00, qty = 1) {
  const s = await makeSeller(admin);
  const p = await makeProduct(s.actor, admin, { price, stock: 20 });
  const c = await makeCustomer();
  const order = await checkout(c, [{ variantId: p.variantId, qty }]);
  await submitAndConfirm(c, order.id, admin);
  const [so] = await sellerOrdersOf(order.id);
  return { s, c, order, so };
}

/** A cancelled paid order → refund REQUESTED; returns it once APPROVED by `checker` (the reversal journal is posted). */
async function approvedRefund() {
  const { s, so } = await paidOrder();
  await cancelSellerOrder(s.actor, so.id, 'المنتج خلص من المخزن');
  const [r] = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
  await makerRequest('REFUND_APPROVAL', r.id, r.amount);
  await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد الاسترداد' });
  return (await db.select().from(refunds).where(eq(refunds.id, r.id)))[0];
}
const refundOf = async (id: string) => (await db.select().from(refunds).where(eq(refunds.id, id)))[0];
const journalsOf = async (sourceId: string, entryType?: string) =>
  db.select().from(journalEntries).where(entryType ? and(eq(journalEntries.sourceId, sourceId), eq(journalEntries.entryType, entryType)) : eq(journalEntries.sourceId, sourceId));
const journalCount = async () => Number((await db.execute<{ n: string }>(sql`select count(*)::text n from journal_entries`)).rows[0].n);
const payoutApprovals = async (refundId: string) =>
  Number((await db.execute<{ n: string }>(sql`select count(*)::text n from financial_approvals where entity_id = ${refundId} and action = 'REFUND_PAYOUT'`)).rows[0].n);
/** Credits to CUSTOMER_REFUNDS_PAYABLE (approval) / debits of it (payout) posted for one refund. */
async function payableMovement(refundId: string, side: 'credit' | 'debit') {
  const r = await db.execute<{ n: string }>(sql`select coalesce(sum(jl.${sql.raw(side)}), 0)::text n from journal_lines jl
    join journal_entries je on je.id = jl.entry_id join ledger_accounts la on la.id = jl.account_id
    where je.idempotency_key in (${'refund:' + refundId}, ${'refund-paid:' + refundId}) and la.code = 'CUSTOMER_REFUNDS_PAYABLE'`);
  return Number(r.rows[0].n);
}

/** Test-database-only: replace the (append-only) health history with exactly `rows`, inside one committed transaction. */
async function replaceHealthHistory(rows: { status: 'OK' | 'WARNING' | 'CRITICAL'; checkedAt: Date }[]) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table ledger_health_checks disable trigger user`);
    await tx.execute(sql`delete from ledger_health_checks`);
    for (const r of rows) await tx.insert(ledgerHealthChecks).values({ status: r.status, debits: 0, credits: 0, difference: 0, criticalChecks: [], warningChecks: [], trigger: 'test-b1', checkedAt: r.checkedAt });
    await tx.execute(sql`alter table ledger_health_checks enable trigger user`);
  });
}
/** A connection whose reads fail (database interruption / permission problem). */
const brokenConn = { execute: async () => { throw new Error('connection reset'); }, select: () => { throw new Error('connection reset'); } } as unknown as DbOrTx;

/* ═══════════════ P0 #1 — ledger health fails closed ═══════════════ */

describe('B1 P0#1 ledger health: missing / stale / CRITICAL / unreadable all block money movement', () => {
  afterAll(async () => {
    await runLedgerHealthCheck('test-b1-restore');
  });

  it('a fresh healthy (real) result permits the existing authorized path', async () => {
    const row = await runLedgerHealthCheck('test-b1-fresh');
    expect(row.status).not.toBe('CRITICAL');
    expect(await ledgerHealthBlock(db)).toBeNull();
    await expect(assertNotPaused(db, 'killswitch.refunds')).resolves.toBeUndefined();
    const r = await approvedRefund();
    expect(r.status).toBe('APPROVED');
  });

  it('a MISSING health result blocks the movement (no journal, no approval)', async () => {
    const { s, so } = await paidOrder();
    await cancelSellerOrder(s.actor, so.id, 'المنتج خلص من المخزن');
    const [r] = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await replaceHealthHistory([]);
    expect(await ledgerHealthBlock(db)).toBe('MISSING');
    const before = await journalCount();
    await expect(approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' })).rejects.toThrow(/مفيش أي فحص لسلامة دفتر الأستاذ/);
    expect(await journalCount()).toBe(before);
    expect((await refundOf(r.id)).status).toBe('REQUESTED');
    // The same request succeeds once a real, fresh check exists.
    await runLedgerHealthCheck('test-b1-after-missing');
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    expect((await refundOf(r.id)).status).toBe('APPROVED');
  });

  it('a STALE result (older than the window, even if OK) blocks', async () => {
    await replaceHealthHistory([{ status: 'OK', checkedAt: new Date(Date.now() - 3 * 3600_000) }]);
    expect(await ledgerHealthBlock(db)).toBe('STALE');
    await expect(assertNotPaused(db, 'killswitch.payouts')).rejects.toThrow(/أقدم من/);
    const r = await (async () => {
      await runLedgerHealthCheck('test-b1-tmp');
      const x = await approvedRefund();
      await replaceHealthHistory([{ status: 'OK', checkedAt: new Date(Date.now() - 3 * 3600_000) }]);
      return x;
    })();
    const before = await journalCount();
    await expect(recordRefundPayout(operator, r.id, 'REF-STALE')).rejects.toThrow(/سلامة دفتر الأستاذ/);
    expect(await journalCount()).toBe(before);
    expect((await refundOf(r.id)).status).toBe('APPROVED');
  });

  it('a future-dated result (beyond clock skew) is not trusted', async () => {
    await replaceHealthHistory([{ status: 'OK', checkedAt: new Date(Date.now() + 24 * 3600_000) }]);
    expect(await ledgerHealthBlock(db)).toBe('STALE');
    await expect(assertLedgerHealthy(db)).rejects.toThrow();
    // A future-dated row stays "latest": a newer real check does not lift the block on its own (fail closed).
    await runLedgerHealthCheck('test-b1-after-future');
    expect(await ledgerHealthBlock(db)).toBe('STALE');
    await replaceHealthHistory([]);
    await runLedgerHealthCheck('test-b1-reset');
    expect(await ledgerHealthBlock(db)).toBeNull();
  });

  it('a CRITICAL latest result blocks; a later clean real result lifts it', async () => {
    await runLedgerHealthCheck('test-b1-base');
    await db.insert(ledgerHealthChecks).values({ status: 'CRITICAL', debits: 1, credits: 0, difference: 1, criticalChecks: [{ code: 'TRIAL_BALANCE', count: 1 }], trigger: 'test-b1-critical', checkedAt: new Date(Date.now() + 1000) });
    expect(await ledgerHealthBlock(db)).toBe('CRITICAL');
    await expect(assertNotPaused(db, 'killswitch.sellerRelease')).rejects.toThrow(/مخالفة حرجة/);
    await new Promise((res) => setTimeout(res, 1100));
    await runLedgerHealthCheck('test-b1-clean');
    expect(await ledgerHealthBlock(db)).toBeNull();
  });

  it('an unreadable / indeterminate result fails closed', async () => {
    expect(await ledgerHealthBlock(brokenConn)).toBe('UNREADABLE');
    await expect(assertLedgerHealthy(brokenConn)).rejects.toThrow(/تعذّر قراءة/);
    const weird = (row: Record<string, unknown>) => ({ execute: async () => ({ rows: [row] }) }) as unknown as DbOrTx;
    expect(await ledgerHealthBlock(weird({ status: 'SOMETHING_ELSE', fresh: true, future: false }))).toBe('INDETERMINATE');
    expect(await ledgerHealthBlock(weird({ status: 'OK', fresh: null, future: false }))).toBe('STALE');
    expect(await ledgerHealthBlock(weird({ status: 'OK', fresh: true, future: null }))).toBe('STALE');
    expect(await ledgerHealthBlock(weird({ status: null, fresh: true, future: false }))).toBe('INDETERMINATE');
    expect(await ledgerHealthBlock(weird({ status: 'OK', fresh: true, future: false }))).toBeNull();
    expect(await ledgerHealthBlock(weird({ status: 'WARNING', fresh: true, future: false }))).toBeNull();
  });
});

/* ═══════════════ P0 #2 — kill switches fail closed ═══════════════ */

describe('B1 P0#2 kill switches: only an explicit "running" value lets money move', () => {
  /** Store the exact JSON value (bypassing the driver's own value mapping). */
  const setRaw = (key: KillSwitch, value: unknown) =>
    db.execute(sql`insert into system_settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb) on conflict (key) do update set value = excluded.value`);
  afterAll(async () => {
    for (const key of Object.keys(KILL_SWITCHES) as KillSwitch[]) await setRaw(key, false);
  });

  it('migration 0020 stores the explicit running state for every switch', async () => {
    const rows = await db.select().from(systemSettings).where(sql`${systemSettings.key} like 'killswitch.%' and ${systemSettings.key} <> 'killswitch.globalReleaseRequest'`);
    expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(KILL_SWITCHES).sort());
  });

  it('explicit running (false) follows the existing authorized behaviour; explicit pause blocks the real path', async () => {
    await setRaw('killswitch.refunds', false);
    await expect(assertNotPaused(db, 'killswitch.refunds')).resolves.toBeUndefined();
    const { s, so } = await paidOrder();
    await cancelSellerOrder(s.actor, so.id, 'المنتج خلص من المخزن');
    const [r] = await db.select().from(refunds).where(eq(refunds.sellerOrderId, so.id));
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await setKillSwitch(admin, 'killswitch.refunds', true, 'حادث اختبار');
    try {
      const before = await journalCount();
      await expect(approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' })).rejects.toThrow(/موقوف مؤقتًا/);
      expect(await journalCount()).toBe(before);
    } finally {
      await setKillSwitch(admin, 'killswitch.refunds', false, 'انتهى الاختبار');
    }
    await approveRefund(checker, r.id, { expectedAmount: r.amount, reason: 'اعتماد' });
    expect((await refundOf(r.id)).status).toBe('APPROVED');
  });

  it('a MISSING switch row counts as paused', async () => {
    await db.delete(systemSettings).where(eq(systemSettings.key, 'killswitch.withdrawals'));
    expect(await killSwitchEngaged(db, 'killswitch.withdrawals')).toBe(true);
    await expect(assertNotPaused(db, 'killswitch.withdrawals')).rejects.toThrow(/موقوف مؤقتًا/);
    await setRaw('killswitch.withdrawals', false);
    await expect(assertNotPaused(db, 'killswitch.withdrawals')).resolves.toBeUndefined();
  });

  it('a missing GLOBAL switch row blocks every money movement', async () => {
    await db.delete(systemSettings).where(eq(systemSettings.key, 'killswitch.global'));
    await expect(assertNotPaused(db, 'killswitch.payouts')).rejects.toThrow(/إيقاف طوارئ/);
    await setRaw('killswitch.global', false);
    await expect(assertNotPaused(db, 'killswitch.payouts')).resolves.toBeUndefined();
  });

  it('malformed / ambiguous stored values count as paused (never the lenient default)', async () => {
    for (const bad of ['false', 0, null, {}, [], 'off', { paused: false }]) {
      await setRaw('killswitch.payouts', bad);
      expect(await killSwitchEngaged(db, 'killswitch.payouts')).toBe(true);
      await expect(assertNotPaused(db, 'killswitch.payouts')).rejects.toThrow(/موقوف مؤقتًا/);
    }
    await setRaw('killswitch.global', 'false');
    await expect(assertNotPaused(db, 'killswitch.refunds')).rejects.toThrow(/إيقاف طوارئ/);
    await setRaw('killswitch.global', false);
    await setRaw('killswitch.payouts', false);
    await expect(assertNotPaused(db, 'killswitch.payouts')).resolves.toBeUndefined();
  });

  it('an unreadable switch counts as paused', async () => {
    for (const key of Object.keys(KILL_SWITCHES) as KillSwitch[]) expect(await killSwitchEngaged(brokenConn, key)).toBe(true);
  });
});

/* ═══════════════ P0 #3 — refund transfer uncertainty ═══════════════ */

describe('B1 P0#3 refund payout: no second payment for one obligation without explicit resolution', () => {
  it('a successful refund cannot execute twice (repeat + duplicate concurrent requests)', async () => {
    const r = await approvedRefund();
    await recordRefundPayout(operator, r.id, 'REF-ONCE');
    await recordRefundPayout(operator, r.id, 'REF-ONCE-AGAIN'); // idempotent no-op
    await Promise.all([recordRefundPayout(operator, r.id, 'REF-DUP-1'), recordRefundPayout(operator, r.id, 'REF-DUP-2')]);
    const paid = await refundOf(r.id);
    expect(paid.status).toBe('COMPLETED');
    expect(paid.paidReference).toBe('REF-ONCE');
    expect(await journalsOf(r.id, 'REFUND_PAID')).toHaveLength(1);
    expect(await payoutApprovals(r.id)).toBe(1);
    await expect(markRefundFailed(operator, r.id, 'محاولة بعد الصرف')).rejects.toThrow();
    await expect(markRefundTransferUncertain(operator, r.id, 'محاولة بعد الصرف')).rejects.toThrow();
  });

  it('concurrent duplicate HTTP requests on a fresh approval produce exactly one payout', async () => {
    const r = await approvedRefund();
    const results = await Promise.allSettled([recordRefundPayout(operator, r.id, 'REF-C1'), recordRefundPayout(operator, r.id, 'REF-C2'), recordRefundPayout(operator, r.id, 'REF-C3')]);
    expect(results.some((x) => x.status === 'fulfilled')).toBe(true);
    expect(await journalsOf(r.id, 'REFUND_PAID')).toHaveLength(1);
    expect(await payoutApprovals(r.id)).toBe(1);
    expect(await payableMovement(r.id, 'debit')).toBe(r.amount);
  });

  it('a FAILED attempt cannot be paid again without an explicit resolution', async () => {
    const r = await approvedRefund();
    await markRefundFailed(operator, r.id, 'البنك رجّع رسالة خطأ');
    await markRefundFailed(operator, r.id, 'تكرار'); // idempotent
    const before = await journalCount();
    await expect(recordRefundPayout(operator, r.id, 'REF-RETRY')).rejects.toThrow(/لم تُحسم/);
    await expect(recordRefundPayout(admin, r.id, 'REF-RETRY-ADMIN')).rejects.toThrow(/لم تُحسم/);
    expect(await journalCount()).toBe(before);
    expect(await payoutApprovals(r.id)).toBe(0);
    expect((await refundOf(r.id)).status).toBe('FAILED');
  });

  it('an UNCERTAIN outcome cannot be retried as a failure, and blocks any new attempt', async () => {
    const r = await approvedRefund();
    await markRefundTransferUncertain(operator, r.id, 'انقطع الاتصال بمزود الدفع');
    await markRefundTransferUncertain(operator, r.id, 'تكرار'); // idempotent
    await expect(markRefundFailed(operator, r.id, 'نعتبره فشل ونعيد')).rejects.toThrow(/غير مؤكدة/);
    expect((await refundOf(r.id)).status).toBe('TRANSFER_UNCERTAIN');
    expect(await journalsOf(r.id, 'REFUND_PAID')).toHaveLength(0);
  });

  it('worker ticks never resolve, retry or pay an unresolved attempt', async () => {
    const failed = await approvedRefund();
    await markRefundFailed(operator, failed.id, 'فشل التحويل');
    const uncertain = await approvedRefund();
    await markRefundTransferUncertain(operator, uncertain.id, 'نتيجة غير معروفة');
    // Every scheduled job handler and the job queue, run twice (a worker retry) — without touching the shared
    // scheduler leases other test files assert on. No job may resolve, retry or pay an unresolved attempt.
    for (let pass = 0; pass < 2; pass++) {
      for (const job of SCHEDULE) await job.run();
      while (await runOneJob()) { /* drain */ }
    }
    expect((await refundOf(failed.id)).status).toBe('FAILED');
    expect((await refundOf(uncertain.id)).status).toBe('TRANSFER_UNCERTAIN');
    expect(await journalsOf(failed.id, 'REFUND_PAID')).toHaveLength(0);
    expect(await journalsOf(uncertain.id, 'REFUND_PAID')).toHaveLength(0);
  });

  it('resolution "not sent": a second authorized person with evidence; then exactly one payout', async () => {
    const r = await approvedRefund();
    await markRefundFailed(operator, r.id, 'رفض البنك التحويل');
    await expect(resolveRefundTransferNotSent(operator, r.id, { reason: 'التحويل لم يخرج', evidence: 'كشف حساب' })).rejects.toThrow(); // no refunds.approve
    await expect(resolveRefundTransferNotSent(checker2, r.id, { reason: 'التحويل لم يخرج', evidence: '' })).rejects.toThrow(/دليل/);
    await expect(resolveRefundTransferNotSent({ ...checker2, stepUpAt: null } as Actor, r.id, { reason: 'التحويل لم يخرج', evidence: 'كشف' })).rejects.toThrow();
    await resolveRefundTransferNotSent(checker2, r.id, { reason: 'كشف الحساب يثبت عدم الخصم', evidence: 'STATEMENT-2026-10-20' });
    await resolveRefundTransferNotSent(checker2, r.id, { reason: 'تكرار الطلب', evidence: 'STATEMENT-2026-10-20' }); // idempotent
    expect((await refundOf(r.id)).status).toBe('APPROVED');
    const [h] = await db
      .select()
      .from(statusHistory)
      .where(and(eq(statusHistory.entityType, 'refund'), eq(statusHistory.entityId, r.id), eq(statusHistory.fromStatus, 'FAILED')));
    expect(h.toStatus).toBe('APPROVED');
    expect(h.actorUserId).toBe(checker2.userId);
    expect((h.meta as { evidence?: string }).evidence).toBe('STATEMENT-2026-10-20');
    await recordRefundPayout(operator, r.id, 'REF-AFTER-RESOLUTION');
    await recordRefundPayout(operator, r.id, 'REF-AFTER-RESOLUTION-DUP');
    expect((await refundOf(r.id)).status).toBe('COMPLETED');
    expect(await journalsOf(r.id, 'REFUND_PAID')).toHaveLength(1);
    expect(await payableMovement(r.id, 'debit')).toBe(r.amount);
    await expect(resolveRefundTransferNotSent(checker2, r.id, { reason: 'بعد الصرف', evidence: 'x-ref' })).rejects.toThrow();
  });

  it('the person who recorded the failed/uncertain attempt cannot resolve it', async () => {
    const r = await approvedRefund();
    await markRefundTransferUncertain(admin, r.id, 'نتيجة غير معروفة');
    await expect(resolveRefundTransferNotSent(admin, r.id, { reason: 'التحويل لم يخرج', evidence: 'كشف' })).rejects.toThrow(/شخص غير من سجّل/);
    expect((await refundOf(r.id)).status).toBe('TRANSFER_UNCERTAIN');
  });

  it('resolution "it went out": the uncertain transfer is recorded once, never re-sent', async () => {
    const r = await approvedRefund();
    await markRefundTransferUncertain(operator, r.id, 'انقطع الاتصال');
    await recordRefundPayout(operator, r.id, 'REF-CONFIRMED-OUT');
    await recordRefundPayout(operator, r.id, 'REF-CONFIRMED-OUT-2');
    const done = await refundOf(r.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.paidReference).toBe('REF-CONFIRMED-OUT');
    expect(await journalsOf(r.id, 'REFUND_PAID')).toHaveLength(1);
    await expect(resolveRefundTransferNotSent(checker2, r.id, { reason: 'محاولة إعادة', evidence: 'x-ref' })).rejects.toThrow();
  });
});

/* ═══════════════ P0 #4 — exact authorized partial refund amount ═══════════════ */

describe('B1 P0#4 dispute decisions: the authorized amount propagates exactly', () => {
  /** Delivered order of `qty` units → return requested for all units → seller rejects → buyer escalates to a dispute. */
  async function disputedReturn(price = 400_00, qty = 2) {
    const { s, c, so } = await paidOrder(price, qty);
    await shipIt(s.actor, so.id);
    await confirmReceipt(c.actor, so.id);
    const [it] = await itemsOf(so.id);
    const ret = await requestReturn(c.actor, { sellerOrderId: so.id, reason: 'CHANGED_MIND', description: 'المقاس غير مناسب وأرغب في الإرجاع بحالته', items: [{ orderItemId: it.id, quantity: qty }] });
    await rejectReturn((await sellerActor(s.user.id))!, ret.id, 'المنتج تم استخدامه ولا يقبل الإرجاع');
    const d = await escalateReturn(c.actor, ret.id, 'البائع رفض الإرجاع رغم أن المنتج بحالته');
    return { s, c, so, ret, d };
  }
  const returnRefund = async (returnId: string) => (await db.select().from(refunds).where(and(eq(refunds.sourceType, 'RETURN'), eq(refunds.sourceId, returnId))))[0];

  it('PARTIAL_REFUND on a disputed return = exactly the decided amount (not the returned units value); ledger matches', async () => {
    const { ret, d } = await disputedReturn(400_00, 2); // returned units worth 800 EGP
    await resolveDispute(officer, d.id, { decision: 'PARTIAL_REFUND', amount: '150', reasonCode: 'PARTIAL_COMPENSATION', note: 'تعويض جزئي عن فرق الحالة بعد مراجعة الأدلة' });
    const r = await returnRefund(ret.id);
    expect(r.amount).toBe(150_00);
    expect(r.principalAmount).toBe(150_00);
    expect(r.shippingAmount).toBe(0);
    expect(r.buyerFeeRefund).toBe(0);
    expect(r.amount).toBeLessThan(800_00);
    await makerRequest('REFUND_APPROVAL', r.id, r.amount);
    await expect(approveRefund(checker, r.id, { expectedAmount: 800_00, reason: 'محاولة بقيمة الوحدات' })).rejects.toThrow();
    await approveRefund(checker, r.id, { expectedAmount: 150_00, reason: 'اعتماد المبلغ المقرر' });
    expect(await payableMovement(r.id, 'credit')).toBe(150_00);
    await recordRefundPayout(operator, r.id, 'REF-PARTIAL');
    expect(await payableMovement(r.id, 'debit')).toBe(150_00);
    expect((await refundOf(r.id)).status).toBe('COMPLETED');
  });

  it('a decided amount above the returned units value is refused and nothing is created', async () => {
    const { ret, d } = await disputedReturn(100_00, 1);
    await expect(resolveDispute(officer, d.id, { decision: 'PARTIAL_REFUND', amount: '250', reasonCode: 'PARTIAL_COMPENSATION', note: 'تعويض أكبر من قيمة المرتجع للاختبار' })).rejects.toThrow(/أكبر من قيمة الوحدات المرتجعة/);
    expect(await returnRefund(ret.id)).toBeUndefined();
  });

  it('FULL_REFUND on a disputed return remains the full returned value (+ shipping)', async () => {
    const { so, ret, d } = await disputedReturn(300_00, 1);
    await resolveDispute(officer, d.id, { decision: 'FULL_REFUND', reasonCode: 'ITEM_NOT_AS_DESCRIBED', note: 'الأدلة تثبت حق المشتري في الاسترداد الكامل' });
    const r = await returnRefund(ret.id);
    const [sub] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id));
    expect(r.principalAmount).toBe(300_00);
    expect(r.shippingAmount).toBe(sub.shippingFee);
    expect(r.amount).toBeGreaterThanOrEqual(300_00);
  });

  it('PARTIAL_REFUND without a return is exactly the decided amount', async () => {
    const { s, c, so } = await paidOrder(500_00, 1);
    await shipIt(s.actor, so.id);
    const d = await openDispute(c.actor, { sellerOrderId: so.id, reasonCode: 'NOT_AS_DESCRIBED', description: 'المنتج مختلف عن الوصف المعروض تماماً' });
    await resolveDispute(officer, d.id, { decision: 'PARTIAL_REFUND', amount: '120', reasonCode: 'PARTIAL_COMPENSATION', note: 'تعويض جزئي بعد مراجعة الأدلة المقدمة' });
    const [r] = await db.select().from(refunds).where(and(eq(refunds.sourceType, 'DISPUTE'), eq(refunds.sourceId, d.id)));
    expect(r.amount).toBe(120_00);
    expect(r.shippingAmount).toBe(0);
  });

  it('the books stay balanced after every B1 scenario', async () => {
    const inv = await financialInvariants(db);
    expect(inv.totals.difference).toBe(0);
    const row = await runLedgerHealthCheck('test-b1-final');
    expect(row.status).not.toBe('CRITICAL');
  });
});
