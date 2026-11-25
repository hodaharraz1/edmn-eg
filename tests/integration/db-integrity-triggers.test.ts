import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  auditLogs,
  financialApprovals,
  journalEntries,
  journalLines,
  ledgerAccounts,
  orders,
  payments,
  sellerOrders,
  statusHistory,
  withdrawalRequests,
} from '@/server/db/schema';
import { approveWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { checkout, makeAdmin, makeCustomer, makeProduct, makeSeller, receiveAndRelease, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * PKG-I03-01 — database integrity-trigger regression suite.
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 *
 * The financial and audit immutability controls live in DB triggers (drizzle/0001_integrity_triggers.sql,
 * drizzle/0008_production_hardening.sql): append-only journal/audit/history tables, no-TRUNCATE guards,
 * no-delete guards on financial records, and the financial_approvals mutation guard. Several were not
 * covered by any test attempting the forbidden mutation directly. This suite performs one real purchase
 * flow and then tries every forbidden mutation, expecting the database itself to refuse.
 *
 * Out of scope (documented, not silently skipped): refund_items, delivery_evidence, provider_events and
 * the conditional guards (conversation_messages_guard, seller_orders_deadline_guard,
 * withdrawal_requests_destination_guard, journal_entries_require_approval positive/negative paths) —
 * they need their own seeded flows or transition-specific expectations and are tracked as PKG-I03-02.
 */

/** Runs a forbidden statement and returns the error it must raise. */
async function forbidden(label: string, statement: ReturnType<typeof sql>, sqlstate = '42501') {
  const err = await db.execute(statement).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `${label}: the database accepted a forbidden mutation`).not.toBeNull();
  expect((err as { code?: string })?.code, `${label}: unexpected SQLSTATE`).toBe(sqlstate); // insufficient_privilege from the 0001/0008 guards
  return err;
}

describe('DB integrity triggers — append-only, no-delete, no-truncate on financial and audit records', () => {
  it('refuses every forbidden mutation after a real purchase + withdrawal flow', async () => {
    // ── Seed real rows through the public services (never by editing protected tables) ──
    const admin = await makeAdmin(['SUPER_ADMIN']);
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 250_00 });
    const c = await makeCustomer();
    const order = await checkout(c, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(c, order.id, admin);
    const [so] = await db.select().from(sellerOrders).where(eq(sellerOrders.orderId, order.id));
    await shipIt(s.actor, so.id);
    await receiveAndRelease(c.actor, so.id);
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    const [journal] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, so.id));
    const [line] = await db.select().from(journalLines).where(eq(journalLines.entryId, journal.id));
    const [audit] = await db.select().from(auditLogs).limit(1);
    const [hist] = await db.select().from(statusHistory).where(eq(statusHistory.entityId, order.id));
    expect(journal && line && audit && hist, 'flow did not produce journal/audit/history rows').toBeTruthy();

    // Withdrawal flow → withdrawal_requests + financial_approvals rows
    const { withdrawal: w } = await requestWithdrawal(s.actor, { amount: 150_00, clientKey: randomUUID() }); // ≥ withdrawals.minimumAmount (100 EGP)
    await approveWithdrawal(await makeAdmin(['FINANCE_CHECKER']), w.id);
    const [approval] = await db.select().from(financialApprovals).where(eq(financialApprovals.entityId, w.id));
    const [ledgerAccount] = await db.select().from(ledgerAccounts);

    // ── Append-only: UPDATE and DELETE must both fail (0001 + 0008 triggers) ──
    await forbidden('journal_entries UPDATE', sql`update journal_entries set description = 'tampered' where id = ${journal.id}`);
    await forbidden('journal_entries DELETE', sql`delete from journal_entries where id = ${journal.id}`);
    await forbidden('journal_lines UPDATE', sql`update journal_lines set debit = 0 where id = ${line.id}`);
    await forbidden('journal_lines DELETE', sql`delete from journal_lines where id = ${line.id}`);
    await forbidden('audit_logs UPDATE', sql`update audit_logs set action = 'tampered' where id = ${audit.id}`);
    await forbidden('audit_logs DELETE', sql`delete from audit_logs where id = ${audit.id}`);
    await forbidden('status_history UPDATE', sql`update status_history set to_status = 'tampered' where id = ${hist.id}`);
    await forbidden('status_history DELETE', sql`delete from status_history where id = ${hist.id}`);
    await forbidden('financial_approvals UPDATE', sql`update financial_approvals set amount = 1 where id = ${approval.id}`);
    await forbidden('financial_approvals DELETE', sql`delete from financial_approvals where id = ${approval.id}`);

    // ── No-DELETE guards on financial records (0008) ──
    await forbidden('orders DELETE', sql`delete from orders where id = ${order.id}`);
    await forbidden('seller_orders DELETE', sql`delete from seller_orders where id = ${so.id}`);
    await forbidden('payments DELETE', sql`delete from payments where id = ${payment.id}`);
    await forbidden('withdrawal_requests DELETE', sql`delete from withdrawal_requests where id = ${w.id}`);
    await forbidden('ledger_accounts DELETE', sql`delete from ledger_accounts where id = ${ledgerAccount.id}`);

    // ── No-TRUNCATE guards ──
    await forbidden('journal_entries TRUNCATE', sql`truncate journal_entries`);
    await forbidden('journal_lines TRUNCATE', sql`truncate journal_lines`);
    await forbidden('audit_logs TRUNCATE', sql`truncate audit_logs`);
    await forbidden('status_history TRUNCATE', sql`truncate status_history`);
    await forbidden('financial_approvals TRUNCATE', sql`truncate financial_approvals`);

    // ── The forbidden attempts really did fail (nothing was tampered with) ──
    const [journalAfter] = await db.select().from(journalEntries).where(eq(journalEntries.id, journal.id));
    expect(journalAfter).toMatchObject({ id: journal.id });
    const [orderAfter] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderAfter.status).not.toBe('DELETED' as never);
  });
});
