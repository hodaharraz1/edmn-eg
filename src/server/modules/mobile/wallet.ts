import { and, desc, eq } from 'drizzle-orm';
import { requireSeller, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { externalDeals, orders, payments, receivingDestinations, refunds, sellers, withdrawalRequests } from '@/server/db/schema';
import { sellerFinancialView, type SourceBalances } from '@/server/modules/finance/seller-wallet';
import { sellerStatement } from '@/server/modules/finance/seller-statement';
import { accountWithdrawals, cancelWithdrawal, previewAccountWithdrawal, requestAccountWithdrawal, type AccountDestination } from '@/server/modules/finance/withdrawals';
import { identityStatus } from '@/server/modules/identity/service';
import { archiveReceivingDestination, myReceivingDestinations, submitReceivingDestination, type ReceivingDestinationInput } from '@/server/modules/identity/receiving';
import { getSetting } from '@/server/modules/settings';
import { activePayoutMethod } from '@/server/modules/sellers/service';

/**
 * The account wallet for the Customer App — read-only projections over the existing financial system:
 *
 *  - balances: `sellerFinancialView` (store sales from the seller sub-ledger + Protected Deal payouts), recomputed
 *    from the ledger on every read; holds, disputes and debts are NEVER counted as withdrawable;
 *  - activity: the user's payments, refunds and payout requests (what actually happened to their money);
 *  - payout REQUESTS only (owner decision §20): a request reserves nothing and moves nothing — two-person approval,
 *    reservation and the transfer stay in the admin console; TRANSFER_UNCERTAIN is shown as such, never resolved here;
 *  - receiving accounts: submitted for staff verification; only verified ones can receive.
 *
 * EDMN keeps no prepaid buyer balance: there is no top-up / deposit service, and refunds go back to the original
 * payment method. The app therefore shows no «add funds» flow (see docs/mobile/WALLET_FINANCIAL_STATES.md).
 */

type Bal = Pick<SourceBalances, 'pending' | 'held' | 'entitledAwaitingRelease' | 'available' | 'reserved' | 'liability' | 'disputeExposure' | 'paidOut'>;
const bal = (s: Bal) => ({
  pendingPiastres: s.pending,
  heldPiastres: s.held,
  awaitingReleasePiastres: s.entitledAwaitingRelease,
  /** Withdrawable now (holds, disputes and in-flight requests already excluded by the finance service). */
  availablePiastres: s.available,
  reservedPiastres: s.reserved,
  debtPiastres: s.liability,
  /** Claimed by open post-release disputes and not covered by money inside EDMN — information, never cash. */
  unsecuredClaimsPiastres: s.disputeExposure,
  paidOutPiastres: s.paidOut,
});

export async function walletView(actor: Actor) {
  const userId = requireUser(actor);
  const view = await sellerFinancialView(db, userId);
  const [store] = await db.select().from(sellers).where(eq(sellers.ownerUserId, userId)).limit(1);
  const pm = store ? await activePayoutMethod(db, store.id) : null;
  const dests = await db
    .select()
    .from(receivingDestinations)
    .where(and(eq(receivingDestinations.userId, userId), eq(receivingDestinations.status, 'APPROVED')));
  const verified = (await identityStatus(db, userId)) === 'APPROVED';
  const destinations = [
    ...(pm ? [{ key: 'STORE_PAYOUT_METHOD', label: pm.maskedLabel, scope: 'STORE_AND_DEALS' as const }] : []),
    ...dests.map((d) => ({ key: d.id, label: d.maskedLabel, scope: 'DEALS_ONLY' as const })),
  ];
  const c = view.combined;
  let blockReason: 'IDENTITY' | 'NO_DESTINATION' | 'DEBT' | 'NOTHING_AVAILABLE' | null = null;
  if (!verified) blockReason = 'IDENTITY';
  else if (!destinations.length) blockReason = 'NO_DESTINATION';
  else if (c.liability > 0) blockReason = 'DEBT';
  else if (c.available <= 0) blockReason = 'NOTHING_AVAILABLE';
  return {
    hasEarnings: !!(view.marketplace || view.protectedDeal),
    balances: bal(c),
    sources: [
      ...(view.marketplace ? [{ source: 'MARKETPLACE' as const, storeName: view.marketplace.storeName, ...bal(view.marketplace) }] : []),
      ...(view.protectedDeal ? [{ source: 'PROTECTED_DEAL' as const, storeName: null, ...bal(view.protectedDeal) }] : []),
    ],
    items: view.items.map((i) => ({ source: i.sourceType, kind: i.entityType === 'seller_order' ? ('SELLER_ORDER' as const) : ('DEAL' as const), entityId: i.entityId, ref: i.ref, bucket: i.bucket, amountPiastres: i.amount })),
    payout: {
      identityApproved: verified,
      destinations,
      minimumPiastres: await getSetting('withdrawals.minimumAmount', db),
      blockReason,
    },
    /** No prepaid balance / top-up service exists in EDMN (business decision pending): the app shows no deposit flow. */
    topUpAvailable: false,
    realMoney: await getSetting('payments.realMoneyEnabled', db),
  };
}

/* ───────── Activity: payments, refunds, payout requests ───────── */

export type ActivityKind = 'PAYMENT' | 'REFUND' | 'PAYOUT';

export async function walletActivity(actor: Actor, kind?: ActivityKind, q?: string) {
  const userId = requireUser(actor);
  const digits = (q ?? '').replace(/\D/g, '');
  const rows: {
    kind: ActivityKind;
    id: string;
    direction: 'OUT' | 'IN';
    amountPiastres: number;
    status: string;
    ref: string;
    method: string | null;
    reference: string | null;
    note: string | null;
    isTest: boolean;
    createdAt: string;
    link: { kind: 'ORDER' | 'DEAL' | 'PAYMENT'; id: string } | null;
  }[] = [];
  if (!kind || kind === 'PAYMENT') {
    const ps = await db
      .select({ p: payments, orderNumber: orders.number, dealNumber: externalDeals.number })
      .from(payments)
      .leftJoin(orders, eq(orders.id, payments.orderId))
      .leftJoin(externalDeals, eq(externalDeals.id, payments.dealId))
      .where(eq(payments.payerUserId, userId))
      .orderBy(desc(payments.createdAt))
      .limit(100);
    for (const r of ps) {
      rows.push({
        kind: 'PAYMENT',
        id: r.p.id,
        direction: 'OUT',
        amountPiastres: r.p.amountDue,
        status: r.p.status,
        ref: r.p.orderId ? `#${r.orderNumber}` : `EDMN-${String(r.dealNumber).padStart(8, '0')}`,
        method: r.p.method,
        reference: r.p.providerReference,
        note: null,
        isTest: r.p.isTest,
        createdAt: r.p.createdAt.toISOString(),
        link: { kind: 'PAYMENT', id: r.p.id },
      });
    }
  }
  if (!kind || kind === 'REFUND') {
    // Refunds carry no own test flag: they follow the platform's Real Money mode.
    const testMode = !(await getSetting('payments.realMoneyEnabled', db));
    const rs = await db.select().from(refunds).where(eq(refunds.customerId, userId)).orderBy(desc(refunds.createdAt)).limit(100);
    for (const r of rs) {
      rows.push({
        kind: 'REFUND',
        id: r.id,
        direction: 'IN',
        amountPiastres: r.amount,
        status: r.status,
        ref: `#${r.number}`,
        method: null,
        reference: r.status === 'PAID' ? r.paidReference : null,
        note: r.status === 'REJECTED' ? r.rejectReason : r.reason,
        isTest: testMode,
        createdAt: r.createdAt.toISOString(),
        link: r.dealId ? { kind: 'DEAL', id: r.dealId } : null,
      });
    }
  }
  if (!kind || kind === 'PAYOUT') {
    for (const { w } of await accountWithdrawals(userId)) {
      rows.push({
        kind: 'PAYOUT',
        id: w.id,
        direction: 'OUT',
        amountPiastres: w.amount,
        status: w.status,
        ref: `#${w.number}`,
        method: w.payoutType,
        reference: w.status === 'PAID' ? w.paidReference : null,
        note: w.status === 'REJECTED' ? w.rejectReason : w.payoutMasked,
        isTest: w.isTest,
        createdAt: w.createdAt.toISOString(),
        link: null,
      });
    }
  }
  const filtered = digits ? rows.filter((r) => r.ref.replace(/\D/g, '').includes(digits) || (r.reference ?? '').includes(digits)) : rows;
  filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { items: filtered.slice(0, 150) };
}

/* ───────── Payout requests (request only; owner decision §20) ───────── */

const toDestination = (key: string): AccountDestination => (key === 'STORE_PAYOUT_METHOD' ? { kind: 'STORE_PAYOUT_METHOD' } : { kind: 'RECEIVING_DESTINATION', id: key });

export async function accountPayoutRequests(actor: Actor) {
  const userId = requireUser(actor);
  const rows = await accountWithdrawals(userId);
  return {
    items: rows.map(({ w, allocations }) => ({
      id: w.id,
      number: String(w.number),
      amountPiastres: w.amount,
      status: w.status,
      destination: w.payoutMasked,
      createdAt: w.createdAt.toISOString(),
      paidAt: w.paidAt?.toISOString() ?? null,
      reference: w.status === 'PAID' ? (w.paidReference ?? null) : null,
      reasonAr: w.status === 'REJECTED' ? (w.rejectReason ?? null) : null,
      isTest: w.isTest,
      sources: allocations.map((a) => ({ source: a.sourceType, amountPiastres: a.amount, status: a.status })),
      // The same rule as cancelWithdrawal: the requester's own account request, before approval reserved funds.
      cancellable: ['REQUESTED', 'UNDER_REVIEW'].includes(w.status) && !w.reservedAt && !w.sellerId && w.requestedBy === userId,
    })),
  };
}

export async function previewAccountPayout(actor: Actor, amountPiastres: number, destinationKey: string) {
  requireUser(actor);
  const p = await previewAccountWithdrawal(actor, amountPiastres, toDestination(destinationKey));
  return {
    amountPiastres: p.amount,
    availablePiastres: p.available,
    fits: !!p.plan,
    destination: p.masked,
    sources: (p.plan ?? []).map((x) => ({ source: x.sourceType, amountPiastres: x.amount })),
  };
}

/** clientKey is the request's idempotency key: a retried submit returns the original request (created=false). */
export async function requestAccountPayout(actor: Actor, amountPiastres: number, destinationKey: string, clientKey: string) {
  const r = await requestAccountWithdrawal(actor, { amount: amountPiastres, clientKey, destination: toDestination(destinationKey) });
  const list = await accountPayoutRequests(actor);
  return { created: r.created, request: list.items.find((x) => x.id === r.withdrawal.id)! };
}

export async function cancelAccountPayout(actor: Actor, id: string) {
  const userId = requireUser(actor);
  const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id));
  if (!w || w.userId !== userId || w.sellerId) throw notFound('طلب السحب');
  await cancelWithdrawal(actor, id);
  return accountPayoutRequests(actor);
}

/* ───────── Receiving accounts (verified by EDMN before use) ───────── */

export async function receivingAccounts(actor: Actor) {
  const rows = await myReceivingDestinations(actor);
  return {
    items: rows
      .filter((r) => r.status !== 'ARCHIVED')
      .map((r) => ({ id: r.id, type: r.type, label: r.maskedLabel, holderName: r.holderName, status: r.status, reviewNote: r.status === 'REJECTED' || r.status === 'MORE_INFO_REQUIRED' ? (r.reviewReason ?? null) : null, createdAt: r.createdAt.toISOString() })),
  };
}

export async function addReceivingAccount(actor: Actor, input: ReceivingDestinationInput, replacesId?: string) {
  await submitReceivingDestination(actor, input, { replacesId });
  return receivingAccounts(actor);
}

export async function removeReceivingAccount(actor: Actor, id: string) {
  await archiveReceivingDestination(actor, id);
  return receivingAccounts(actor);
}

/* ───────── Seller (store) statement — finance.view ───────── */

export async function storeStatement(actor: Actor) {
  const sellerId = requireSeller(actor, 'finance.view');
  if (!sellerId) throw forbidden();
  const s = await sellerStatement(sellerId, 200);
  let gross = 0;
  let fees = 0;
  let refunded = 0;
  for (const r of s.rows) {
    gross += r.grossSale;
    fees += r.sellerFee;
    refunded += r.refund;
  }
  return {
    totals: { grossSalesPiastres: gross, edmnFeesPiastres: fees, refundsPiastres: refunded, pendingPiastres: s.totals.pending, ledgerAvailablePiastres: s.totals.available, reservedPiastres: s.totals.reserved, debtPiastres: s.totals.liability },
    rows: s.rows.map((r) => ({
      id: r.entryId,
      date: r.date,
      type: r.type,
      description: r.description,
      reference: r.reference,
      orderRef: r.orderRef,
      netEffectPiastres: r.netEffect,
      pendingDeltaPiastres: r.pendingDelta,
      availableDeltaPiastres: r.availableDelta,
      reservedDeltaPiastres: r.reservedDelta,
      payoutCostPiastres: r.payoutCost,
    })),
  };
}

/** The store's verified payout account (masked), for the seller payout request screen. */
export async function storePayoutAccount(actor: Actor) {
  const sellerId = requireSeller(actor, 'finance.view');
  const pm = await activePayoutMethod(db, sellerId);
  return { account: pm ? { label: pm.maskedLabel, type: pm.type } : null };
}

