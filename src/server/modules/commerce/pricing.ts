import { and, eq, inArray } from 'drizzle-orm';
import type { ReturnPolicy } from '@/domain/return-policy';
import { listingReturnPolicy } from '@/server/modules/catalog/return-policy';
import type { DbOrTx } from '@/server/db/client';
import { sql } from 'drizzle-orm';
import { productVariants, products, sellerShippingRates, sellers, stores } from '@/server/db/schema';
import { DomainError } from '@/server/core/errors';
import { activeVersionId, loadVersion, quoteMarketplace, type LoadedVersion, type MarketQuote } from '@/server/modules/pricing/service';

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
  /** Seller's voluntary return policy for this listing, shown before purchase (snapshotted on the order item). */
  returnPolicy: ReturnPolicy;
  /** Transparent EDMN fee on this line (basis: product value; shipping excluded), and its buyer / seller shares. */
  fee: { economicClass: string; total: number; buyer: number; seller: number } | null;
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
  /** Buyer share of the EDMN fee for this seller group (added to the buyer total). */
  buyerFee: number;
  sellerFee: number;
  total: number;
  /** Fee-engine quote for this seller sub-order (null when pricing is unavailable). */
  quote: MarketQuote | null;
}

export interface PricedCart {
  groups: SellerGroup[];
  merchandiseTotal: number;
  shippingTotal: number;
  discountTotal: number;
  /** Buyer share of the EDMN fee (Fb). Seller share (Fs) is deducted from the seller's proceeds. */
  buyerFeeTotal: number;
  sellerFeeTotal: number;
  /** Fee-engine version used for this quote (null → no valid pricing: checkout blocked, fail closed). */
  pricingVersionId: string | null;
  /** User-safe reason when fees cannot be calculated (no version / unmapped category). */
  pricingUnavailable: string | null;
  grandTotal: number;
  itemCount: number;
  hasIssues: boolean;
  shippingResolved: boolean;
}

export async function priceLines(conn: DbOrTx, inputs: PricingLineInput[], governorateId: number | null): Promise<PricedCart> {
  if (!inputs.length) {
    return { groups: [], merchandiseTotal: 0, shippingTotal: 0, discountTotal: 0, buyerFeeTotal: 0, sellerFeeTotal: 0, pricingVersionId: null, pricingUnavailable: null, grandTotal: 0, itemCount: 0, hasIssues: false, shippingResolved: true };
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
        buyerFee: 0,
        sellerFee: 0,
        total: 0,
        quote: null,
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
      returnPolicy: listingReturnPolicy(r.product, r.store),
      fee: null,
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
  // Fee engine: the same version and calculation used inside the order transaction (one quote per
  // seller sub-order). No valid version or an unmapped category → fees unavailable → checkout blocked.
  let version: LoadedVersion | null = null;
  let pricingUnavailable: string | null = null;
  const vid = await activeVersionId(conn, 'MARKETPLACE');
  if (vid) version = await loadVersion(conn, vid);
  else pricingUnavailable = 'الشراء متوقف مؤقتًا: لا يوجد إصدار رسوم ساري.';
  for (const g of groups.values()) {
    if (version && !pricingUnavailable) {
      try {
        const q = await quoteMarketplace(conn, version, g.lines.map((l) => ({ key: l.variantId, categoryId: l.categoryId, lineTotal: l.lineTotal })));
        g.quote = q;
        for (const l of g.lines) {
          const lf = q.result.lines.find((x) => x.key === l.variantId)!;
          l.fee = { economicClass: lf.economicClass, total: lf.total, buyer: lf.buyer, seller: lf.seller };
        }
        g.buyerFee = q.result.buyer;
        g.sellerFee = q.result.seller;
      } catch (e) {
        pricingUnavailable = e instanceof DomainError ? e.message : 'تعذر حساب رسوم الخدمة';
      }
    }
    g.total = g.merchandiseSubtotal + (g.shippingFee ?? 0) + g.buyerFee;
  }

  const list = [...groups.values()];
  const merchandiseTotal = list.reduce((a, g) => a + g.merchandiseSubtotal, 0);
  const shippingTotal = list.reduce((a, g) => a + (g.shippingFee ?? 0), 0);
  const buyerFeeTotal = list.reduce((a, g) => a + g.buyerFee, 0);
  return {
    groups: list,
    merchandiseTotal,
    shippingTotal,
    discountTotal: 0,
    buyerFeeTotal,
    sellerFeeTotal: list.reduce((a, g) => a + g.sellerFee, 0),
    pricingVersionId: pricingUnavailable ? null : (version?.id ?? null),
    pricingUnavailable,
    grandTotal: merchandiseTotal + shippingTotal + buyerFeeTotal,
    itemCount: list.reduce((a, g) => a + g.lines.reduce((b, l) => b + l.quantity, 0), 0),
    hasIssues: list.some((g) => g.lines.some((l) => l.issues.length)),
    shippingResolved,
  };
}
