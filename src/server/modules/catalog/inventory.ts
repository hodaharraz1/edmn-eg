import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requireSeller, type Actor } from '@/server/core/actor';
import { DomainError, forbidden, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { inventoryMovements, inventoryReservations, productVariants, products } from '@/server/db/schema';
import { refreshProductReadModel } from './read-model';

/**
 * Inventory model per variant:
 *   stock_on_hand  physical units the seller holds
 *   reserved       units held by unpaid / under-review orders
 *   available      = stock_on_hand − reserved   (derived; never stored)
 * A DB CHECK guarantees 0 ≤ reserved ≤ stock_on_hand, so overselling is impossible even under races.
 */

/** Atomically reserve units. The conditional UPDATE is the concurrency guard: the last unit can only be won once. */
export async function reserve(tx: DbOrTx, variantId: string, quantity: number, orderItemId: string, expiresAt: Date): Promise<void> {
  const res = await tx
    .update(productVariants)
    .set({ reserved: sql`${productVariants.reserved} + ${quantity}` })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.isActive, true), sql`${productVariants.stockOnHand} - ${productVariants.reserved} >= ${quantity}`))
    .returning({ id: productVariants.id, productId: productVariants.productId });
  if (!res.length) throw new DomainError('INSUFFICIENT_STOCK', 'الكمية اللي طلبتها مبقتش متوفرة');
  await tx.insert(inventoryReservations).values({ variantId, orderItemId, quantity, expiresAt });
  await tx.insert(inventoryMovements).values({ variantId, type: 'RESERVE', deltaReserved: quantity, reference: `order_item:${orderItemId}` });
  await refreshProductReadModel(tx, res[0].productId);
}

/** Payment confirmed → reserved units leave stock permanently. Idempotent per reservation. */
export async function commitReservation(tx: DbOrTx, orderItemId: string): Promise<void> {
  const [r] = await tx.select().from(inventoryReservations).where(eq(inventoryReservations.orderItemId, orderItemId)).for('update');
  if (!r || r.status !== 'ACTIVE') return;
  const [v] = await tx
    .update(productVariants)
    .set({ stockOnHand: sql`${productVariants.stockOnHand} - ${r.quantity}`, reserved: sql`${productVariants.reserved} - ${r.quantity}` })
    .where(eq(productVariants.id, r.variantId))
    .returning({ productId: productVariants.productId });
  await tx.update(inventoryReservations).set({ status: 'COMMITTED', resolvedAt: new Date() }).where(eq(inventoryReservations.id, r.id));
  await tx.insert(inventoryMovements).values({ variantId: r.variantId, type: 'COMMIT', deltaOnHand: -r.quantity, deltaReserved: -r.quantity, reference: `order_item:${orderItemId}` });
  await tx.update(products).set({ salesCount: sql`${products.salesCount} + ${r.quantity}` }).where(eq(products.id, v.productId));
  await refreshProductReadModel(tx, v.productId);
}

/** Unpaid order expired (EXPIRED) / cancelled (RELEASED) → units go back to available. Idempotent: a second worker finds it resolved. */
export async function releaseReservation(tx: DbOrTx, orderItemId: string, as: 'RELEASED' | 'EXPIRED' = 'RELEASED'): Promise<void> {
  const [r] = await tx.select().from(inventoryReservations).where(eq(inventoryReservations.orderItemId, orderItemId)).for('update');
  if (!r || r.status !== 'ACTIVE') return;
  const [v] = await tx
    .update(productVariants)
    .set({ reserved: sql`${productVariants.reserved} - ${r.quantity}` })
    .where(eq(productVariants.id, r.variantId))
    .returning({ productId: productVariants.productId });
  await tx.update(inventoryReservations).set({ status: as, resolvedAt: new Date() }).where(eq(inventoryReservations.id, r.id));
  await tx.insert(inventoryMovements).values({ variantId: r.variantId, type: 'RELEASE', deltaReserved: -r.quantity, reference: `order_item:${orderItemId}:${as.toLowerCase()}` });
  await refreshProductReadModel(tx, v.productId);
}

/** A paid order cancelled before shipment → committed units are restocked. */
export async function restock(tx: DbOrTx, variantId: string, quantity: number, reference: string): Promise<void> {
  const [v] = await tx
    .update(productVariants)
    .set({ stockOnHand: sql`${productVariants.stockOnHand} + ${quantity}` })
    .where(eq(productVariants.id, variantId))
    .returning({ productId: productVariants.productId });
  await tx.insert(inventoryMovements).values({ variantId, type: 'RESTOCK', deltaOnHand: quantity, reference });
  await tx.update(products).set({ salesCount: sql`greatest(${products.salesCount} - ${quantity}, 0)` }).where(eq(products.id, v.productId));
  await refreshProductReadModel(tx, v.productId);
}

/** Seller sets physical stock. Cannot go below units already reserved by pending orders. */
export async function setStock(actor: Actor, variantId: string, stockOnHand: number, lowStockThreshold?: number) {
  const sellerId = requireSeller(actor, 'inventory.manage');
  if (!Number.isInteger(stockOnHand) || stockOnHand < 0 || stockOnHand > 1_000_000) throw validation('الكمية غير صحيحة');
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ v: productVariants, sellerId: products.sellerId })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, variantId))
      .for('update', { of: productVariants });
    if (!row) throw notFound('المنتج');
    if (row.sellerId !== sellerId) throw forbidden();
    if (stockOnHand < row.v.reserved) throw validation(`لا يمكن أن تقل الكمية عن ${row.v.reserved} وحدة محجوزة لطلبات قائمة`);
    await tx
      .update(productVariants)
      .set({ stockOnHand, ...(lowStockThreshold !== undefined ? { lowStockThreshold: Math.max(0, lowStockThreshold) } : {}) })
      .where(eq(productVariants.id, variantId));
    await tx.insert(inventoryMovements).values({ variantId, type: 'ADJUSTMENT', deltaOnHand: stockOnHand - row.v.stockOnHand, actorUserId: actor.userId, reference: 'seller_adjustment' });
    await audit(tx, actor, { action: 'inventory.stock_set', entityType: 'product_variant', entityId: variantId, oldValues: { stockOnHand: row.v.stockOnHand }, newValues: { stockOnHand } });
    await refreshProductReadModel(tx, row.v.productId);
  });
}

/** Releases every expired ACTIVE reservation whose order is still unpaid (called by the order-expiry job). */
export async function expiredReservationItems(conn: DbOrTx, now = new Date()) {
  return conn
    .select({ orderItemId: inventoryReservations.orderItemId })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.status, 'ACTIVE'), lte(inventoryReservations.expiresAt, now)));
}

export async function lowStockVariants(conn: DbOrTx, sellerId: string) {
  return conn
    .select({ variant: productVariants, product: { id: products.id, titleAr: products.titleAr, status: products.status } })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(products.sellerId, sellerId),
        inArray(products.status, ['LIVE', 'APPROVED']),
        eq(productVariants.isActive, true),
        sql`${productVariants.stockOnHand} - ${productVariants.reserved} <= ${productVariants.lowStockThreshold}`,
      ),
    );
}
