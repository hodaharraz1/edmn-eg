import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { financialApprovals, ledgerAccounts, sellerOrders, withdrawalRequests } from '@/server/db/schema';
import { approveWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { checkout, makeAdmin, makeCustomer, makeProduct, makeSeller, receiveAndRelease, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * PKG-I03-02 — conditional DB integrity guards (drizzle/0008_production_hardening.sql).
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 *
 * Covers the guards PKG-I03-01 deliberately excluded:
 *  - journal_entries_require_approval: no journal entry without a valid, covering, single-use approval.
 *  - journal_entries_approval_amount (deferred): debits posted under an approval must equal its amount.
 *  - financial_approvals_guard: final statuses stay final; the approver cannot be rewritten.
 *  - seller_orders_deadline_guard: release timestamp, once set, never moves.
 *  - withdrawal_requests_destination_guard: a requested amount never changes.
 *
 * Exclusions (tracked PKG-I03-03, documented not skipped): refund_items / delivery_evidence /
 * provider_events append-only (need refund/evidence seeding flows), withdrawal destination-snapshot
 * immutability (snapshot is only set later in the payout path), messaging guards.
 */


/** Drizzle wraps the PostgreSQL error: the SQLSTATE is on the error itself or on its cause. */
const sqlstateOf = (e: unknown) => (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

const rejected = async (label: string, run: () => Promise<unknown>, sqlstate = '42501') => {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `${label}: the database accepted a forbidden mutation`).not.toBeNull();
  if (sqlstate) expect(sqlstateOf(err), `${label}: unexpected SQLSTATE`).toBe(sqlstate);
};

/** Synthetic, fully-valid approval row (INSERT is allowed; the guard blocks UPDATE/DELETE only). */
async function makeApproval(overrides: { amount?: number; entryTypes?: string[] } = {}) {
  const maker = await makeAdmin(['FINANCE_OPERATOR']);
  const checker = await makeAdmin(['FINANCE_CHECKER']);
  const [a] = await db
    .insert(financialApprovals)
    .values({
      action: 'REFUND_APPROVAL',
      entityType: 'test',
      entityId: randomUUID(),
      amount: overrides.amount ?? 100,
      economicVersion: '1',
      entryTypes: overrides.entryTypes ?? ['TEST_ENTRY'],
      reason: 'اختبار حارس الموافقات',
      dualControl: true, // 0014: money approvals require an explicit maker ≠ checker flag
      requestedBy: maker.userId,
      approvedBy: checker.userId,
      approvedAt: new Date(),
      idempotencyKey: randomUUID(),
    })
    .returning();
  return a;
}

const journalSql = (approvalId: string | null, entryType = 'TEST_ENTRY') => sql`
  insert into journal_entries (entry_type, source_type, source_id, idempotency_key, description, approval_id)
  values (${entryType}, 'test', ${randomUUID()}, ${randomUUID()}, 'اختبار', ${approvalId})`;

describe('journal_entries_require_approval — every journal entry executes a valid approval', () => {
  it('refuses an entry with no approval, an unknown approval, or an approval for another entry type', async () => {
    await rejected('NULL approval_id', () => db.execute(journalSql(null)));
    await rejected('unknown approval', () => db.execute(journalSql(randomUUID())));
    const a = await makeApproval();
    await rejected('approval does not cover the entry type', () => db.execute(journalSql(a.id, 'UNCOVERED_TYPE')));
  });

  it('a covered entry posts, consumes the approval once, and a second transaction cannot reuse it', async () => {
    const a = await makeApproval({ amount: 100 });
    const [account] = await db.select().from(ledgerAccounts);
    // balanced and exactly covering the approved amount → allowed, and consumes the approval
    await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        insert into journal_entries (entry_type, source_type, source_id, idempotency_key, description, approval_id)
        values ('TEST_ENTRY', 'test', ${randomUUID()}, ${randomUUID()}, 'اختبار', ${a.id}) returning id`);
      const entryId = (rows.rows[0] as { id: string }).id;
      await tx.execute(sql`insert into journal_lines (entry_id, account_id, debit) values (${entryId}, ${account.id}, 100)`);
      await tx.execute(sql`insert into journal_lines (entry_id, account_id, credit) values (${entryId}, ${account.id}, 100)`);
    });
    const [after] = await db.select().from(financialApprovals).where(eq(financialApprovals.id, a.id));
    expect(after.status).toBe('CONSUMED');
    // a NEW transaction reusing the consumed approval is refused
    await rejected('consumed approval reuse', () => db.execute(journalSql(a.id)));
  });

  it('refuses at commit when the posted debits do not equal the approved amount', async () => {
    const a = await makeApproval({ amount: 100 });
    const [account] = await db.select().from(ledgerAccounts);
    await rejected('posted 50 under a 100 approval', () =>
      db.transaction(async (tx) => {
        const rows = await tx.execute(sql`
          insert into journal_entries (entry_type, source_type, source_id, idempotency_key, description, approval_id)
          values ('TEST_ENTRY', 'test', ${randomUUID()}, ${randomUUID()}, 'اختبار', ${a.id}) returning id`);
        const entryId = (rows.rows[0] as { id: string }).id;
        await tx.execute(sql`insert into journal_lines (entry_id, account_id, debit) values (${entryId}, ${account.id}, 50)`);
        await tx.execute(sql`insert into journal_lines (entry_id, account_id, credit) values (${entryId}, ${account.id}, 50)`);
      }),
    );
  });

  it('refuses an unbalanced entry at commit (journal_lines_balanced, drizzle/0001)', async () => {
    const a = await makeApproval({ amount: 100 });
    const [account] = await db.select().from(ledgerAccounts);
    await rejected('debit 100 with no matching credit', () =>
      db.transaction(async (tx) => {
        const rows = await tx.execute(sql`
          insert into journal_entries (entry_type, source_type, source_id, idempotency_key, description, approval_id)
          values ('TEST_ENTRY', 'test', ${randomUUID()}, ${randomUUID()}, 'اختبار', ${a.id}) returning id`);
        const entryId = (rows.rows[0] as { id: string }).id;
        await tx.execute(sql`insert into journal_lines (entry_id, account_id, debit) values (${entryId}, ${account.id}, 100)`);
      }),
      'P0001',
    );
  });
});

describe('financial_approvals_guard — approvals are immutable evidence', () => {
  it('a CONSUMED approval stays final and its approver cannot be rewritten', async () => {
    const a = await makeApproval({ amount: 100 });
    const [account] = await db.select().from(ledgerAccounts);
    await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        insert into journal_entries (entry_type, source_type, source_id, idempotency_key, description, approval_id)
        values ('TEST_ENTRY', 'test', ${randomUUID()}, ${randomUUID()}, 'اختبار', ${a.id}) returning id`);
      await tx.execute(sql`insert into journal_lines (entry_id, account_id, debit) values (${(rows.rows[0] as { id: string }).id}, ${account.id}, 100)`);
      await tx.execute(sql`insert into journal_lines (entry_id, account_id, credit) values (${(rows.rows[0] as { id: string }).id}, ${account.id}, 100)`);
    });
    await rejected('CONSUMED → APPROVED', () => db.execute(sql`update financial_approvals set status = 'APPROVED' where id = ${a.id}`));
    await rejected('approver rewrite', () => db.execute(sql`update financial_approvals set approved_by = ${randomUUID()} where id = ${a.id}`));
  });
});

describe('seller_orders_deadline_guard / withdrawal_requests_destination_guard — financial facts never move', () => {
  it('release timestamp on a released seller order is immutable', async () => {
    const admin = await makeAdmin(['SUPER_ADMIN']);
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 150_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id);
    const [rel] = await db.select().from(sellerOrders).where(eq(sellerOrders.id, so.id));
    expect(rel.fundsReleasedAt, 'flow did not reach release').not.toBeNull();
    await rejected('funds_released_at moved', () =>
      db.execute(sql`update seller_orders set funds_released_at = now() + interval '1 day' where id = ${so.id}`),
    );
  });

  it('a requested withdrawal amount never changes', async () => {
    const admin = await makeAdmin(['SUPER_ADMIN']);
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 150_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id);
    const { withdrawal: w } = await requestWithdrawal(s.actor, { amount: 120_00, clientKey: randomUUID() }); // ≥ withdrawals.minimumAmount (100 EGP)
    await approveWithdrawal(await makeAdmin(['FINANCE_CHECKER']), w.id);
    await rejected('withdrawal amount changed', () =>
      db.execute(sql`update withdrawal_requests set amount = 999999 where id = ${w.id}`),
    );
    const [after] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w.id));
    expect(after.amount).toBe(120_00);
  });
});
