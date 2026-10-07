import { and, eq, sql } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import type { DbOrTx } from '@/server/db/client';
import { journalEntries, journalLines, ledgerAccounts, sellerOrders } from '@/server/db/schema';
import { postEntry } from './ledger';

type SellerOrder = typeof sellerOrders.$inferSelect;

/**
 * Accounting rules for marketplace orders. Every entry touching a seller order is tagged
 * sourceType='seller_order', sourceId=<seller order id>, so its position can always be derived.
 *
 * 1. Payment confirmed (per seller order):     DR PLATFORM_CASH gross
 *                                              CR SELLER_PENDING[s] net, CR COMMISSION_DEFERRED commission
 * 2. Admin seller release (after receipt basis): DR SELLER_PENDING → CR SELLER_AVAILABLE (remaining pending)
 *                                              DR COMMISSION_DEFERRED → CR COMMISSION_REVENUE (remaining deferred)
 *    Buyer receipt confirmation / timeout entitlement post NOTHING.
 * 3. Admin-approved refund (see refunds.ts):   DR SELLER_PENDING|SELLER_AVAILABLE seller liability,
 *                                              DR COMMISSION_DEFERRED|COMMISSION_REVENUE fee reversal,
 *                                              CR CUSTOMER_REFUNDS_PAYABLE amount
 * 4. Refund paid out (separate approval):      DR CUSTOMER_REFUNDS_PAYABLE / CR PLATFORM_CASH
 * Every entry executes an operation-specific Admin approval (financial_approvals).
 */
export async function postSellerOrderPayment(tx: DbOrTx, actor: Actor, paymentId: string, so: SellerOrder, approvalId: string) {
  return postEntry(tx, actor, {
    entryType: 'ORDER_PAYMENT',
    sourceType: 'seller_order',
    sourceId: so.id,
    idempotencyKey: `payment:${paymentId}:so:${so.id}`,
    description: `تأكيد دفع الطلب الفرعي ${so.suffix}`,
    approvalId,
    lines: [
      { account: { code: 'PLATFORM_CASH' }, debit: so.grossTotal, memo: 'customer payment (products + shipping + buyer fee)' },
      { account: { code: 'SELLER_PENDING', sellerId: so.sellerId }, credit: so.sellerNet, memo: 'seller payable (pending): products + shipping − seller fee' },
      // The fee is shown as its two components (deferred until the Admin release recognizes it).
      ...(so.buyerFeeTotal + so.sellerFeeTotal === so.commissionTotal && so.commissionTotal > 0
        ? [
            ...(so.buyerFeeTotal > 0 ? [{ account: { code: 'COMMISSION_DEFERRED' as const }, credit: so.buyerFeeTotal, memo: 'EDMN buyer service/protection fee (deferred)' }] : []),
            ...(so.sellerFeeTotal > 0 ? [{ account: { code: 'COMMISSION_DEFERRED' as const }, credit: so.sellerFeeTotal, memo: 'EDMN seller service fee (deferred)' }] : []),
          ]
        : [{ account: { code: 'COMMISSION_DEFERRED' as const }, credit: so.commissionTotal, memo: 'EDMN fee (legacy snapshot, deferred)' }]),
    ],
  });
}

/** Current pending / deferred position of a seller order, derived from the journal. */
export async function sellerOrderPosition(tx: DbOrTx, so: Pick<SellerOrder, 'id' | 'sellerId'>) {
  const res = await tx
    .select({ code: ledgerAccounts.code, net: sql<string>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.sourceType, 'seller_order'), eq(journalEntries.sourceId, so.id)))
    .groupBy(ledgerAccounts.code);
  const by = Object.fromEntries(res.map((r) => [r.code, Number(r.net)]));
  return { pending: by.SELLER_PENDING ?? 0, deferredCommission: by.COMMISSION_DEFERRED ?? 0, available: by.SELLER_AVAILABLE ?? 0 };
}

/**
 * Seller release: remaining pending → available and remaining deferred fee → revenue, as ONE balanced
 * entry executing ONE Admin approval (key release:<so>). Called only by the Admin release operation.
 */
export async function releaseSellerOrderFunds(tx: DbOrTx, actor: Actor, so: SellerOrder, approvalId: string) {
  const pos = await sellerOrderPosition(tx, so);
  let res = { entryId: '', created: false };
  if (pos.pending > 0 || pos.deferredCommission > 0) {
    res = await postEntry(tx, actor, {
      entryType: 'SELLER_RELEASE',
      sourceType: 'seller_order',
      sourceId: so.id,
      idempotencyKey: `release:${so.id}`,
      description: `إتاحة أرباح الطلب الفرعي ${so.suffix} بموافقة الإدارة`,
      approvalId,
      lines: [
        { account: { code: 'SELLER_PENDING', sellerId: so.sellerId }, debit: pos.pending },
        { account: { code: 'SELLER_AVAILABLE', sellerId: so.sellerId }, credit: pos.pending },
        { account: { code: 'COMMISSION_DEFERRED' }, debit: pos.deferredCommission },
        { account: { code: 'COMMISSION_REVENUE' }, credit: pos.deferredCommission },
      ],
    });
  }
  await tx.update(sellerOrders).set({ fundsReleasedAt: new Date(), releaseApprovalId: approvalId }).where(eq(sellerOrders.id, so.id));
  return res;
}
