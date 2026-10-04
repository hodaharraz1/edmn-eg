import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { sql } from 'drizzle-orm';
import { productVariants, products, sellerShippingRates, sellers, stores } from '@/server/db/schema';

/**
 * Single source of truth for cart/checkout pricing. Used to DISPLAY the cart and, again,
 * inside the order transaction at submission — client-side totals are never trusted.
 */
export interface PricingLineInput {
  variantId: string;
  quantity: number;
  priceSeen?: number;
}

export type LineIssue = 'UNAVAILABLE' | 'INSUFFICIENT_STOCK' | 'PRICE_CHANGED' | 'SELLER_UNAVAILABLE' | 'NO_SHIPPING';

export interface PricedLine {
  variantId: string;
  productId: string;
  productSlug: string;
  title: string;
  variantLabel: string;
  sku: string;
  condition: string;
  categoryId: string | null;
  imageKey: string | null;
  imageFileId: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  lineTotal: number;
  available: number;
  priceSeen?: number;
  issues: LineIssue[];
}

export interface SellerGroup {
  sellerId: string;
  storeName: string;
  storeSlug: string;
  storeVerified: boolean;
  lines: PricedLine[];
  merchandiseSubtotal: number;
  shippingFee: number | null; // null = seller does not ship to this governorate / not chosen yet
  freeShippingApplied: boolean;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  processingDays: number;
  total: number;
}

export interface PricedCart {
  groups: SellerGroup[];
  merchandiseTotal: number;
  shippingTotal: number;
  discountTotal: number;
  grandTotal: number;
  itemCount: number;
  hasIssues: boolean;
  shippingResolved: boolean;
}

export async function priceLines(conn: DbOrTx, inputs: PricingLineInput[], governorateId: number | null): Promise<PricedCart> {
  if (!inputs.length) {
    return { groups: [], merchandiseTotal: 0, shippingTotal: 0, discountTotal: 0, grandTotal: 0, itemCount: 0, hasIssues: false, shippingResolved: true };
  }
  const rows = await conn
    .select({
      variant: productVariants,
      product: products,
      sellerStatus: sellers.status,
      store: stores,
      image: sql<{ key: string; id: string } | null>`(select json_build_object('key', f.storage_key, 'id', f.id) from product_images pi join files f on f.id = pi.file_id where pi.product_id = ${products.id} order by pi.sort_order limit 1)`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(sellers, eq(sellers.id, products.sellerId))
    .innerJoin(stores, eq(stores.sellerId, products.sellerId))
    .where(inArray(productVariants.id, inputs.map((i) => i.variantId)));

  const sellerIds = [...new Set(rows.map((r) => r.product.sellerId))];
  const rates = governorateId && sellerIds.length
    ? await conn.select().from(sellerShippingRates).where(and(inArray(sellerShippingRates.sellerId, sellerIds), eq(sellerShippingRates.governorateId, governorateId)))
    : [];

  const groups = new Map<string, SellerGroup>();
  for (const input of inputs) {
    const r = rows.find((x) => x.variant.id === input.variantId);
    if (!r) continue;
    const sellerOk = r.sellerStatus === 'APPROVED' || r.sellerStatus === 'RESTRICTED';
    const available = r.variant.stockOnHand - r.variant.reserved;
    const issues: LineIssue[] = [];
    if (r.product.status !== 'LIVE' || !r.variant.isActive) issues.push('UNAVAILABLE');
    if (!sellerOk) issues.push('SELLER_UNAVAILABLE');
    if (available < input.quantity) issues.push('INSUFFICIENT_STOCK');
    if (input.priceSeen !== undefined && input.priceSeen !== r.variant.price) issues.push('PRICE_CHANGED');
    if (!groups.has(r.product.sellerId)) {
      groups.set(r.product.sellerId, {
        sellerId: r.product.sellerId,
        storeName: r.store.name,
        storeSlug: r.store.slug,
        storeVerified: r.store.isVerified,
        lines: [],
        merchandiseSubtotal: 0,
        shippingFee: null,
        freeShippingApplied: false,
        etaMinDays: null,
        etaMaxDays: null,
        processingDays: r.store.defaultProcessingDays,
        total: 0,
      });
    }
    const g = groups.get(r.product.sellerId)!;
    const lineTotal = r.variant.price * input.quantity;
    g.lines.push({
      variantId: r.variant.id,
      productId: r.product.id,
      productSlug: r.product.slug,
      title: r.product.titleAr,
      variantLabel: r.variant.label,
      sku: r.variant.sku,
      condition: r.product.condition,
      categoryId: r.product.categoryId,
      imageKey: r.image?.key ?? null,
      imageFileId: r.image?.id ?? null,
      unitPrice: r.variant.price,
      compareAtPrice: r.variant.compareAtPrice,
      quantity: input.quantity,
      lineTotal,
      available: Math.max(0, available),
      priceSeen: input.priceSeen,
      issues,
    });
    g.merchandiseSubtotal += lineTotal;
    g.processingDays = Math.max(g.processingDays, r.product.processingDays ?? r.store.defaultProcessingDays);
  }

  let shippingResolved = !!governorateId;
  for (const g of groups.values()) {
    if (!governorateId) continue;
    const rate = rates.find((x) => x.sellerId === g.sellerId && x.enabled);
    if (!rate) {
      shippingResolved = false;
      for (const l of g.lines) l.issues.push('NO_SHIPPING');
      continue;
    }
    const store = rows.find((x) => x.product.sellerId === g.sellerId)!.store;
    const free = store.freeShippingThreshold !== null && g.merchandiseSubtotal >= store.freeShippingThreshold;
    g.shippingFee = free ? 0 : rate.fee;
    g.freeShippingApplied = free;
    g.etaMinDays = rate.etaMinDays;
    g.etaMaxDays = rate.etaMaxDays;
  }
  for (const g of groups.values()) g.total = g.merchandiseSubtotal + (g.shippingFee ?? 0);

  const list = [...groups.values()];
  const merchandiseTotal = list.reduce((a, g) => a + g.merchandiseSubtotal, 0);
  const shippingTotal = list.reduce((a, g) => a + (g.shippingFee ?? 0), 0);
  return {
    groups: list,
    merchandiseTotal,
    shippingTotal,
    discountTotal: 0,
    grandTotal: merchandiseTotal + shippingTotal,
    itemCount: list.reduce((a, g) => a + g.lines.reduce((b, l) => b + l.quantity, 0), 0),
    hasIssues: list.some((g) => g.lines.some((l) => l.issues.length)),
    shippingResolved,
  };
}
