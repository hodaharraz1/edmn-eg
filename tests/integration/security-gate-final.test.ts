import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { journalEntries, sellers, withdrawalRequests } from '@/server/db/schema';
import { accountBalance } from '@/server/modules/finance/ledger';
import { approveWithdrawal, runScheduledSettlement } from '@/server/modules/finance/withdrawals';
import type { Actor } from '@/server/core/actor';
import { checkout, makeAdmin, makeCustomer, makeProduct, makeSeller, receiveAndRelease, sellerOrdersOf, shipIt, submitAndConfirm } from '../helpers/factory';

/**
 * Final pre-production security gate — automatic withdrawal REQUESTS.
 * The scheduled settlement may only CREATE requests. It must never reserve, move, release or pay money: reservation
 * happens only on an authenticated Admin approval, and payment needs a different person (maker/checker).
 */
let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
});

describe('scheduled settlement = requests only', () => {
  it('creates a REQUESTED withdrawal with nothing reserved, no journal entry and an unchanged available balance', async () => {
    const s = await makeSeller(admin);
    const p = await makeProduct(s.actor, admin, { price: 2000_00, stock: 2 });
    const buyer = await makeCustomer();
    const order = await checkout(buyer, [{ variantId: p.variantId, qty: 1 }]);
    await submitAndConfirm(buyer, order.id, admin);
    const [so] = await sellerOrdersOf(order.id);
    await shipIt(s.actor, so.id);
    await receiveAndRelease(buyer.actor, so.id);
    const sellerId = s.actor.sellerId!;
    const before = await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId });
    expect(before).toBeGreaterThan(10000);
    // Only this seller takes part (other test sellers stay untouched).
    const others = await db.select({ id: sellers.id }).from(sellers).where(and(ne(sellers.id, sellerId), eq(sellers.autoSettlement, true)));
    await db.update(sellers).set({ autoSettlement: false }).where(inArray(sellers.id, others.length ? others.map((o) => o.id) : [sellerId]));
    await db.update(sellers).set({ autoSettlement: true }).where(eq(sellers.id, sellerId));
    const entriesBefore = Number((await db.execute<{ n: string }>(sql`select count(*)::text n from journal_entries`)).rows[0].n);
    try {
      const res = await runScheduledSettlement(new Date('2031-01-15T09:00:00Z')); // the 15th in Cairo: a settlement day
      expect(res.created).toBe(1);
    } finally {
      if (others.length) await db.update(sellers).set({ autoSettlement: true }).where(inArray(sellers.id, others.map((o) => o.id)));
    }
    const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, sellerId));
    expect(w).toMatchObject({ status: 'REQUESTED', source: 'SCHEDULED', reservedAt: null, approvedBy: null, paidAt: null });
    expect(Number((await db.execute<{ n: string }>(sql`select count(*)::text n from journal_entries`)).rows[0].n)).toBe(entriesBefore);
    expect(await accountBalance(db, { code: 'SELLER_AVAILABLE', sellerId })).toBe(before);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.sourceId, w.id))).toHaveLength(0);
    // Re-running the same day is idempotent (no second request).
    await runScheduledSettlement(new Date('2031-01-15T10:00:00Z'));
    expect(await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, sellerId))).toHaveLength(1);
    // The system itself can never approve (reserve) it: only an authenticated, authorized human checker.
    const support = await makeAdmin(['CUSTOMER_SUPPORT']);
    await expect(approveWithdrawal(support, w.id)).rejects.toThrow();
    const [still] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, w.id));
    expect(still.reservedAt).toBeNull();
  });
});
