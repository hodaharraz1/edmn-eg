import { and, eq } from 'drizzle-orm';
import { sha256 } from '@/server/core/crypto';
import { DomainError, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { cartItems, carts, productVariants, products, sellers } from '@/server/db/schema';
import { priceLines } from './pricing';

export type CartRef = { userId: string } | { guestToken: string };

async function findCart(conn: DbOrTx, ref: CartRef) {
  const where = 'userId' in ref ? eq(carts.userId, ref.userId) : eq(carts.guestTokenHash, sha256(ref.guestToken));
  const [c] = await conn.select().from(carts).where(where);
  return c ?? null;
}

async function getOrCreateCart(conn: DbOrTx, ref: CartRef) {
  const existing = await findCart(conn, ref);
  if (existing) return existing;
  const values = 'userId' in ref ? { userId: ref.userId } : { guestTokenHash: sha256(ref.guestToken) };
  await conn.insert(carts).values(values).onConflictDoNothing();
  return (await findCart(conn, ref))!;
}

export async function cartLines(conn: DbOrTx, ref: CartRef) {
  const cart = await findCart(conn, ref);
  if (!cart) return [];
  return conn.select().from(cartItems).where(eq(cartItems.cartId, cart.id)).orderBy(cartItems.createdAt);
}

export async function addToCart(ref: CartRef, variantId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw validation('الكمية غير صحيحة');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ v: productVariants, status: products.status, sellerStatus: sellers.status, sellerOwner: sellers.ownerUserId })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .where(eq(productVariants.id, variantId));
    if (!row || row.status !== 'LIVE' || !row.v.isActive || !['APPROVED', 'RESTRICTED'].includes(row.sellerStatus)) {
      throw new DomainError('INVALID_STATE', 'هذا المنتج غير متاح حالياً');
    }
    if ('userId' in ref && row.sellerOwner === ref.userId) throw validation('لا يمكنك شراء منتجات متجرك');
    const cart = await getOrCreateCart(tx, ref);
    const [existing] = await tx.select().from(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId)));
    const newQty = Math.min(99, (existing?.quantity ?? 0) + quantity);
    const available = row.v.stockOnHand - row.v.reserved;
    if (newQty > available) throw new DomainError('INSUFFICIENT_STOCK', available > 0 ? `المتاح ${available} فقط` : 'نفدت الكمية');
    if (existing) await tx.update(cartItems).set({ quantity: newQty, priceSeen: row.v.price }).where(eq(cartItems.id, existing.id));
    else await tx.insert(cartItems).values({ cartId: cart.id, variantId, quantity: newQty, priceSeen: row.v.price });
    return newQty;
  });
}

export async function updateCartItem(ref: CartRef, variantId: string, quantity: number) {
  const cart = await findCart(db, ref);
  if (!cart) throw notFound('السلة');
  if (quantity <= 0) {
    await db.delete(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId)));
    return;
  }
  if (!Number.isInteger(quantity) || quantity > 99) throw validation('الكمية غير صحيحة');
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
  if (v && quantity > v.stockOnHand - v.reserved) throw new DomainError('INSUFFICIENT_STOCK', `المتاح ${Math.max(0, v.stockOnHand - v.reserved)} فقط`);
  await db.update(cartItems).set({ quantity }).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId)));
}

/** The customer has seen the new prices → accept them (clears PRICE_CHANGED warnings). */
export async function acknowledgePrices(conn: DbOrTx, ref: CartRef) {
  const cart = await findCart(conn, ref);
  if (!cart) return;
  const items = await conn.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
  for (const i of items) {
    const [v] = await conn.select({ price: productVariants.price }).from(productVariants).where(eq(productVariants.id, i.variantId));
    if (v && v.price !== i.priceSeen) await conn.update(cartItems).set({ priceSeen: v.price }).where(eq(cartItems.id, i.id));
  }
}

export async function cartView(ref: CartRef, governorateId: number | null) {
  const lines = await cartLines(db, ref);
  return priceLines(db, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, priceSeen: l.priceSeen })), governorateId);
}

export async function cartCount(ref: CartRef): Promise<number> {
  const lines = await cartLines(db, ref);
  return lines.reduce((a, l) => a + l.quantity, 0);
}

/** On login, guest cart lines are merged into the user's cart (quantities summed, capped). */
export async function mergeGuestCart(guestToken: string, userId: string) {
  await db.transaction(async (tx) => {
    const guest = await findCart(tx, { guestToken });
    if (!guest) return;
    const userCart = await getOrCreateCart(tx, { userId });
    const items = await tx.select().from(cartItems).where(eq(cartItems.cartId, guest.id));
    for (const i of items) {
      const [ex] = await tx.select().from(cartItems).where(and(eq(cartItems.cartId, userCart.id), eq(cartItems.variantId, i.variantId)));
      if (ex) await tx.update(cartItems).set({ quantity: Math.min(99, ex.quantity + i.quantity) }).where(eq(cartItems.id, ex.id));
      else await tx.insert(cartItems).values({ cartId: userCart.id, variantId: i.variantId, quantity: i.quantity, priceSeen: i.priceSeen });
    }
    await tx.delete(carts).where(eq(carts.id, guest.id));
  });
}

export async function clearVariants(conn: DbOrTx, userId: string, variantIds: string[]) {
  const cart = await findCart(conn, { userId });
  if (!cart) return;
  for (const v of variantIds) await conn.delete(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, v)));
}
