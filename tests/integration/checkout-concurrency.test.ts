import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { inventoryMovements, inventoryReservations, journalEntries, orderItems, orders, productVariants } from '@/server/db/schema';
import { addToCart, cartLines } from '@/server/modules/commerce/cart';
import { placeOrder } from '@/server/modules/commerce/orders';
import { priceLines } from '@/server/modules/commerce/pricing';
import { reconcile } from '@/server/modules/finance/ledger';
import { DomainError } from '@/server/core/errors';
import type { Actor } from '@/server/core/actor';
import { ensurePaymentSetup, makeAdmin, makeCustomer, makeProduct, makeSeller } from '../helpers/factory';

/**
 * PKG-PERF-01 v3 (P3): the 200-buyer race on one hot product.
 *
 * 200 customers check out 1 unit of the same variant at the same moment; the variant has STOCK units.
 * Whatever the interleaving, the outcome must be:
 *   - at most STOCK orders created, never more (no overselling);
 *   - reserved == units actually ordered, and reserved <= stock_on_hand (the DB CHECK alone is not the test);
 *   - every created order has exactly one reservation row and one RESERVE movement that sum to `reserved`;
 *   - every rejection is the clean Arabic CONFLICT/INSUFFICIENT_STOCK/INVALID_STATE message — never a 500;
 *   - no journal entry for any unpaid order, and the ledger still reconciles (projected == derived);
 *   - a retried checkoutKey returns the same order instead of creating a second one.
 *
 * Run: DATABASE_URL=postgres://… npx vitest run tests/integration/checkout-concurrency.test.ts
 */

const BUYERS = 200;
const STOCK = 5;
const MAX_ATTEMPTS = 4;

let admin: Actor;
beforeAll(async () => {
  admin = await makeAdmin();
  await ensurePaymentSetup();
}, 120_000);

describe('PERF-01/P3 — 200 concurrent checkouts on one variant', () => {
  it('never oversells, never breaks the ledger, rejects cleanly', async () => {
    const seller = await makeSeller(admin);
    const p = await makeProduct(seller.actor, admin, { stock: STOCK, price: 10000 });

    // Every buyer prepares their cart and reads their expected total before the race starts.
    const buyers = await Promise.all(
      Array.from({ length: BUYERS }, async () => {
        const c = await makeCustomer();
        await addToCart({ userId: c.user.id }, p.variantId, 1);
        const lines = await cartLines(db, { userId: c.user.id });
        const priced = await priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.address.governorateId);
        return { c, expectedTotal: priced.grandTotal, checkoutKey: randomUUID() };
      }),
    );

    // The race: every buyer retries the SAME checkoutKey until the order lands or stock is honestly gone.
    const attempt = async (b: (typeof buyers)[number]): Promise<{ ok: boolean; orderId?: string; error?: unknown }> => {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        try {
          const { order } = await placeOrder(b.c.actor, {
            addressId: b.c.address.id,
            paymentMethod: 'INSTAPAY',
            checkoutKey: b.checkoutKey,
            expectedTotal: b.expectedTotal,
          });
          return { ok: true, orderId: order.id };
        } catch (e) {
          if (e instanceof DomainError && e.code === 'CONFLICT') continue; // hot row: nothing reserved, try again
          if (e instanceof DomainError && ['INSUFFICIENT_STOCK', 'INVALID_STATE'].includes(e.code)) return { ok: false, error: e };
          return { ok: false, error: e };
        }
      }
      return { ok: false, error: new Error('attempts exhausted') };
    };
    const results = await Promise.all(buyers.map(attempt));

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // No failure may be an unexpected error: only the stock-out messages are allowed once retries are done.
    for (const f of failed) {
      expect(f.error).toBeInstanceOf(DomainError);
      expect(['INSUFFICIENT_STOCK', 'INVALID_STATE']).toContain((f.error as DomainError).code);
    }

    // No overselling: at most STOCK orders, and every winner holds exactly one unit.
    expect(succeeded.length).toBeLessThanOrEqual(STOCK);
    expect(succeeded.length).toBeGreaterThan(0);
    expect(succeeded.length).toBe(STOCK); // with retries the stock is fully allocated
    const orderIds = succeeded.map((s) => s.orderId!);
    expect(new Set(orderIds).size).toBe(orderIds.length); // no duplicate orders

    // Variant state: reserved equals the number of winning orders, never above stock.
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(v.reserved).toBe(succeeded.length);
    expect(v.reserved).toBeLessThanOrEqual(v.stockOnHand);
    expect(v.stockOnHand).toBe(STOCK);

    // Every winner: exactly one order item, one ACTIVE reservation, and movements that sum to `reserved`.
    const items = await db.select().from(orderItems).where(sql`${orderItems.sellerOrderId} in (select id from seller_orders where order_id in ${orderIds})`);
    expect(items).toHaveLength(succeeded.length);
    const reservations = await db.select().from(inventoryReservations).where(sql`${inventoryReservations.orderItemId} in (select id from order_items where seller_order_id in (select id from seller_orders where order_id in ${orderIds}))`);
    expect(reservations).toHaveLength(succeeded.length);
    expect(reservations.every((r) => r.status === 'ACTIVE' && r.quantity === 1)).toBe(true);
    const [movementSum] = await db
      .select({ total: sql<number>`coalesce(sum(${inventoryMovements.deltaReserved}), 0)::int` })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.variantId, p.variantId), eq(inventoryMovements.type, 'RESERVE')));
    expect(movementSum.total).toBe(succeeded.length);

    // No money moved (all orders unpaid): zero journal entries for these orders, and the ledger reconciles.
    const journals = await db.select().from(journalEntries).where(sql`${journalEntries.sourceId} in ${orderIds}`);
    expect(journals).toHaveLength(0);
    const drift = await reconcile(db);
    expect(drift.mismatches).toEqual([]);
    expect(drift.trialBalanceOk).toBe(true);

    // Losers really own nothing: no order rows beyond the winners.
    const allOrders = await db.select().from(orders).where(sql`${orders.id} in ${orderIds}`);
    expect(allOrders).toHaveLength(succeeded.length);
    const loserKeys = buyers.filter((b, i) => !results[i].ok).map((b) => b.checkoutKey);
    if (loserKeys.length) {
      const orphan = await db.select().from(orders).where(sql`${orders.checkoutKey} in ${loserKeys}`);
      expect(orphan).toHaveLength(0);
    }

    // Idempotent retry: a winner placing the same checkoutKey again gets the same order, not a new reservation.
    const winner = buyers[results.findIndex((r) => r.ok)];
    const again = await placeOrder(winner.c.actor, {
      addressId: winner.c.address.id,
      paymentMethod: 'INSTAPAY',
      checkoutKey: winner.checkoutKey,
      expectedTotal: winner.expectedTotal,
    });
    expect(again.created).toBe(false);
    expect(again.order.id).toBe(succeeded.find((s) => s.orderId)?.orderId);
    const [vAfter] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
    expect(vAfter.reserved).toBe(succeeded.length);
  }, 600_000);
});
