import { and, eq, sql } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import { invalidState } from '@/server/core/errors';
import { proportion } from '@/server/core/money';
import type { DbOrTx } from '@/server/db/client';
import { journalEntries, journalLines, ledgerAccounts, refunds, sellerOrders } from '@/server/db/schema';
import { postEntry } from './ledger';

type SellerOrder = typeof sellerOrders.$inferSelect;

/**
 * Accounting rules for marketplace orders. Every entry touching a seller order is tagged
 * sourceType='seller_order', sourceId=<seller order id>, so its position can always be derived.
 *
 * 1. Payment confirmed (per seller order):     DR PLATFORM_CASH gross
 *                                              CR SELLER_PENDING[s] net, CR COMMISSION_DEFERRED commission
 * 2. Buyer confirms receipt (release):         DR SELLER_PENDING → CR SELLER_AVAILABLE (remaining pending)
 *                                              DR COMMISSION_DEFERRED → CR COMMISSION_REVENUE (remaining deferred)
 * 3. Refund owed to customer:                  DR SELLER_PENDING|SELLER_AVAILABLE seller share,
 *                                              DR COMMISSION_DEFERRED|COMMISSION_REVENUE commission share,
 *                                              CR CUSTOMER_REFUNDS_PAYABLE amount
 * 4. Refund paid out manually:                 DR CUSTOMER_REFUNDS_PAYABLE / CR PLATFORM_CASH
 */
export async function postSellerOrderPayment(tx: DbOrTx, actor: Actor, paymentId: string, so: SellerOrder) {
  return postEntry(tx, actor, {
    entryType: 'ORDER_PAYMENT',
    sourceType: 'seller_order',
    sourceId: so.id,
    idempotencyKey: `payment:${paymentId}:so:${so.id}`,
    description: `تأكيد دفع الطلب الفرعي ${so.suffix}`,
    lines: [
      { account: { code: 'PLATFORM_CASH' }, debit: so.grossTotal, memo: 'customer payment' },
      { account: { code: 'SELLER_PENDING', sellerId: so.sellerId }, credit: so.sellerNet, memo: 'seller payable (pending)' },
      { account: { code: 'COMMISSION_DEFERRED' }, credit: so.commissionTotal, memo: 'EDMN commission (deferred)' },
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
  return { pending: by.SELLER_PENDING ?? 0, deferredCommission: by.COMMISSION_DEFERRED ?? 0 };
}

/** Move remaining pending funds to available. Idempotent (key release:<so>). */
export async function releaseSellerOrderFunds(tx: DbOrTx, actor: Actor, so: SellerOrder) {
  const pos = await sellerOrderPosition(tx, so);
  let res = { entryId: '', created: false };
  if (pos.pending > 0 || pos.deferredCommission > 0) {
    res = await postEntry(tx, actor, {
      entryType: 'SELLER_RELEASE',
      sourceType: 'seller_order',
      sourceId: so.id,
      idempotencyKey: `release:${so.id}`,
      description: `إتاحة أرباح الطلب الفرعي ${so.suffix} بعد تأكيد الاستلام`,
      lines: [
        { account: { code: 'SELLER_PENDING', sellerId: so.sellerId }, debit: pos.pending },
        { account: { code: 'SELLER_AVAILABLE', sellerId: so.sellerId }, credit: pos.pending },
        { account: { code: 'COMMISSION_DEFERRED' }, debit: pos.deferredCommission },
        { account: { code: 'COMMISSION_REVENUE' }, credit: pos.deferredCommission },
      ],
    });
  }
  await tx.update(sellerOrders).set({ fundsReleasedAt: new Date() }).where(eq(sellerOrders.id, so.id));
  return res;
}

/**
 * Record money owed back to the customer for (part of) a seller order and reverse the seller's
 * share and EDMN's commission proportionally. Returns the refund record id. Idempotent per source.
 */
export async function createSellerOrderRefund(
  tx: DbOrTx,
  actor: Actor,
  input: {
    sellerOrderId: string;
    customerId: string;
    amount: number;
    sourceType: 'ORDER_CANCELLATION' | 'RETURN' | 'DISPUTE';
    sourceId: string;
    reason: string;
  },
): Promise<string> {
  const [existing] = await tx
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.sourceType, input.sourceType), eq(refunds.sourceId, input.sourceId)));
  if (existing) return existing.id;

  const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, input.sellerOrderId)).for('update');
  const remaining = so.grossTotal - so.refundedTotal;
  if (input.amount <= 0 || input.amount > remaining) throw invalidState(`المبلغ القابل للاسترداد لهذا الطلب ${remaining / 100} ج.م`);

  const [{ reversed }] = await tx
    .select({ reversed: sql<string>`coalesce(sum(${refunds.commissionReversal}), 0)` })
    .from(refunds)
    .where(eq(refunds.sellerOrderId, so.id));
  const commissionLeft = so.commissionTotal - Number(reversed);
  const commissionReversal = Math.min(commissionLeft, input.amount === remaining ? commissionLeft : proportion(so.commissionTotal, input.amount, so.grossTotal));
  const sellerShare = input.amount - commissionReversal;
  const released = !!so.fundsReleasedAt;

  const [refund] = await tx
    .insert(refunds)
    .values({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      customerId: input.customerId,
      sellerOrderId: so.id,
      amount: input.amount,
      commissionReversal,
      reason: input.reason,
      createdBy: actor.userId,
    })
    .returning({ id: refunds.id });

  await postEntry(tx, actor, {
    entryType: 'REFUND',
    sourceType: 'seller_order',
    sourceId: so.id,
    idempotencyKey: `refund:${refund.id}`,
    description: `استرداد للعميل (${input.sourceType}) على الطلب الفرعي ${so.suffix}`,
    lines: [
      { account: { code: released ? 'SELLER_AVAILABLE' : 'SELLER_PENDING', sellerId: so.sellerId }, debit: sellerShare },
      { account: { code: released ? 'COMMISSION_REVENUE' : 'COMMISSION_DEFERRED' }, debit: commissionReversal },
      { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' }, credit: input.amount },
    ],
  });
  await tx.update(sellerOrders).set({ refundedTotal: so.refundedTotal + input.amount }).where(eq(sellerOrders.id, so.id));
  return refund.id;
}
