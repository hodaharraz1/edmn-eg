import { eq } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import type { Actor } from '@/server/core/actor';
import { invalidState, notFound, validation } from '@/server/core/errors';
import type { DbOrTx } from '@/server/db/client';
import { customerWalletEntries, payments, users } from '@/server/db/schema';
import type { Payment } from '@/server/modules/payments/service';
import { formatEGP } from '@/lib/format';
import { getSetting } from '@/server/modules/settings';
import { notify } from '@/server/modules/notifications/notify';
import { postEntry } from './ledger';

/**
 * PKG-WALLET-02 (phase 2): spend the customer wallet balance on orders and Protected Deals.
 * Mirrors what a staff-confirmed transfer credits today — same accounts, same commission — except the debit
 * lands on CUSTOMER_WALLETS instead of PLATFORM_CASH. Owner brief: spending needs no staff review (no outside
 * money arrives; the deposit was credited two-person) but is audited. The balance can never go negative:
 * every spend serializes on the payer's users row (FOR UPDATE) and re-checks the sum under that lock.
 */

/** Serialize all spends of one user (credits only ever ADD funds, so they never race a spend check). */
export async function lockWalletUser(tx: DbOrTx, userId: string) {
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  if (!u) throw notFound('المستخدم');
}

export async function walletBalancePiastres(tx: DbOrTx, userId: string): Promise<number> {
  const rows = await tx.select({ amount: customerWalletEntries.amount }).from(customerWalletEntries).where(eq(customerWalletEntries.userId, userId));
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Flag + sufficient balance, under the caller's locks. Caller holds lockWalletUser already. */
export async function assertWalletSpendable(tx: DbOrTx, userId: string, amount: number) {
  if (!(await getSetting('wallet.topUpEnabled', tx))) throw validation('الدفع من المحفظة مش متاح حاليًا');
  const balance = await walletBalancePiastres(tx, userId);
  if (balance < amount) throw validation(`رصيد محفظتك (${formatEGP(balance)}) أقل من المطلوب (${formatEGP(amount)}). أضف رصيدًا أو اختار طريقة دفع تانية`);
}

/** One SPEND sub-ledger row per wallet-debiting journal entry (amount negative by DB CHECK). */
async function recordSpend(tx: DbOrTx, userId: string, journalEntryId: string, amount: number) {
  await tx.insert(customerWalletEntries).values({ userId, journalEntryId, amount: -amount, kind: 'SPEND' });
}

/**
 * Pay a marketplace order from the wallet. Runs inside the checkout transaction, right after the order,
 * seller orders and the payment row are created: the same steps confirmPaymentInternal takes for a confirmed
 * transfer (moveOrderTo → PAID, commit reservations, per-SO postings, SLAs, notifications), with the debit on
 * CUSTOMER_WALLETS and SPEND sub-ledger rows. Idempotent via the ledger idempotency keys.
 */
export async function payOrderWithWallet(tx: DbOrTx, actor: Actor, order: { id: string; number: string | number; grandTotal: number }, payment: Payment) {
  const payer = payment.payerUserId;
  await lockWalletUser(tx, payer);
  await assertWalletSpendable(tx, payer, payment.amountDue);
  const { moveOrderTo } = await import('@/server/modules/payments/service');
  const { commitReservation } = await import('@/server/modules/catalog/inventory');
  const { orderItems, inventoryReservations, sellerOrders, sellers } = await import('@/server/db/schema');
  const { postSellerOrderPayment } = await import('./postings');
  const { order: fullOrder, sellerOrders: sos } = await moveOrderTo(tx, actor, order.id, 'PAID');
  for (const so of sos) {
    const items = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.sellerOrderId, so.id));
    for (const it of items) {
      const [r] = await tx.select().from(inventoryReservations).where(eq(inventoryReservations.orderItemId, it.id));
      if (!r || r.status === 'RELEASED' || r.status === 'EXPIRED') throw invalidState('انتهى حجز المخزون لهذا الطلب. راجع توفر المنتجات قبل الدفع');
      await commitReservation(tx, it.id);
    }
    const { entryId } = await postSellerOrderPayment(tx, actor, payment.id, so, null, { debitAccount: 'CUSTOMER_WALLETS', entryType: 'WALLET_SPEND' });
    await recordSpend(tx, payer, entryId, so.grossTotal);
    const confirmHours = await getSetting('sla.sellerConfirmHours', tx);
    const grace = await getSetting('sla.shipGraceDays', tx);
    const now = Date.now();
    await tx
      .update(sellerOrders)
      .set({ sellerResponseDueAt: new Date(now + confirmHours * 3600_000), shipByDueAt: new Date(now + ((so.processingDays ?? 2) + grace) * 86400_000) })
      .where(eq(sellerOrders.id, so.id));
    const [s] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, so.sellerId));
    await notify(tx, { event: 'SELLER_NEW_ORDER', userIds: [s.ownerUserId], vars: { order: `${fullOrder.number}-${so.suffix}`, amount: formatEGP(so.grossTotal) }, link: `/seller/orders/${so.id}`, dedupeKey: `so:${so.id}:paid` });
  }
  await tx.update(payments).set({ status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: payer, confirmedAmount: payment.amountDue }).where(eq(payments.id, payment.id));
  await notify(tx, { event: 'PAYMENT_CONFIRMED', userIds: [payer], vars: { order: fullOrder.number }, link: `/account/orders/${fullOrder.id}`, dedupeKey: `payment:${payment.id}:confirmed` });
  await audit(tx, actor, {
    action: 'wallet.spend',
    entityType: 'payment',
    entityId: payment.id,
    newValues: { orderId: order.id, amount: payment.amountDue, method: 'WALLET' },
    reason: 'دفع من رصيد المحفظة (بدون مراجعة إدارة — رصيد العميل نفسه)',
  });
  return { paid: true as const };
}

/** Fund a Protected Deal from the wallet: Dr CUSTOMER_WALLETS / Cr DEAL_FUNDS_HELD (what a confirmed transfer credits). */
export async function payDealWithWallet(tx: DbOrTx, actor: Actor, deal: { id: string; number: string | number; buyerId: string; sellerUserId: string | null; buyerPays: number | null }, payment: Payment) {
  const payer = payment.payerUserId;
  await lockWalletUser(tx, payer);
  await assertWalletSpendable(tx, payer, payment.amountDue);
  const { externalDeals } = await import('@/server/db/schema');
  const { transition } = await import('@/server/modules/_shared');
  const { dealMachine } = await import('@/domain/machines');
  const [d] = await tx.select().from(externalDeals).where(eq(externalDeals.id, deal.id)).for('update');
  await transition(tx, actor, dealMachine, d.id, d.status, 'ACTIVE');
  await tx.update(externalDeals).set({ status: 'ACTIVE', activatedAt: new Date() }).where(eq(externalDeals.id, d.id));
  const { entryId } = await postEntry(tx, actor, {
    entryType: 'WALLET_SPEND',
    sourceType: 'external_deal',
    sourceId: d.id,
    idempotencyKey: `payment:${payment.id}:deal:${d.id}`,
    description: `دفع الصفقة المحمية #${d.number} من رصيد المحفظة`,
    approvalId: null,
    lines: [
      { account: { code: 'CUSTOMER_WALLETS' }, debit: d.buyerPays! },
      { account: { code: 'DEAL_FUNDS_HELD' }, credit: d.buyerPays! },
    ],
  });
  await recordSpend(tx, payer, entryId, d.buyerPays!);
  await tx.update(payments).set({ status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: payer, confirmedAmount: payment.amountDue }).where(eq(payments.id, payment.id));
  await notify(tx, { event: 'EXTERNAL_DEAL_ACTIVE', userIds: [d.buyerId, d.sellerUserId].filter((x): x is string => !!x), vars: { deal: d.number }, link: `/account/deals/${d.id}` });
  await audit(tx, actor, {
    action: 'wallet.spend',
    entityType: 'payment',
    entityId: payment.id,
    newValues: { dealId: d.id, amount: payment.amountDue, method: 'WALLET' },
    reason: 'دفع من رصيد المحفظة (بدون مراجعة إدارة — رصيد العميل نفسه)',
  });
  return { paid: true as const };
}
