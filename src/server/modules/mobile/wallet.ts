import { and, eq, sql } from 'drizzle-orm';
import { requireSeller, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { receivingDestinations, sellers, withdrawalRequests } from '@/server/db/schema';
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

type ActivityRow = {
  kind: ActivityKind; id: string; direction: 'OUT' | 'IN'; amount: number; status: string;
  ref: string; method: string | null; reference: string | null; note: string | null;
  is_test: boolean | null; created_at: string; link_kind: 'ORDER' | 'DEAL' | 'PAYMENT' | null; link_id: string | null;
};

/** Search all owned records BEFORE pagination. No global money-mode setting may relabel historical refunds. */
export async function walletActivity(actor: Actor, kind?: ActivityKind, q?: string, page = 1, pageSize = 50, activityId?: string) {
  const userId = requireUser(actor);
  // Normalize Arabic-Indic digits without discarding letters in provider references.
  const search = (q ?? '').trim().replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) - (c <= '٩' ? 0x660 : 0x6f0))).toLowerCase();
  const result = await db.execute<ActivityRow>(sql`
    with activity as (
      select 'PAYMENT'::text kind, p.id, 'OUT'::text direction, p.amount_due amount, p.status,
        case when p.order_id is not null then '#' || o.number::text else 'EDMN-' || lpad(d.number::text, 8, '0') end ref,
        p.method, p.provider_reference reference, null::text note, p.is_test, p.created_at,
        'PAYMENT'::text link_kind, p.id link_id
      from payments p left join orders o on o.id = p.order_id left join external_deals d on d.id = p.deal_id
      where p.payer_user_id = ${userId}
      union all
      select 'REFUND', r.id, 'IN', r.amount, r.status, '#' || r.number::text, null,
        case when r.status = 'PAID' then r.paid_reference end,
        case when r.status = 'REJECTED' then r.reject_reason else r.reason end,
        p.is_test, r.created_at, case when r.deal_id is not null then 'DEAL' end, r.deal_id
      from refunds r left join payments p on p.id = r.original_payment_id
      where r.customer_id = ${userId}
      union all
      select 'PAYOUT', w.id, 'OUT', w.amount, w.status, '#' || w.number::text, w.payout_type,
        case when w.status = 'PAID' then w.paid_reference end,
        case when w.status = 'REJECTED' then w.reject_reason else w.payout_masked end,
        w.is_test, w.created_at, null, null::uuid
      from withdrawal_requests w where w.user_id = ${userId}
    )
    select * from activity
    where ${kind ? sql`kind = ${kind}` : sql`true`}
      and ${activityId ? sql`id = ${activityId}` : sql`true`}
      and ${search ? sql`(strpos(lower(ref), ${search}) > 0 or strpos(lower(coalesce(reference, '')), ${search}) > 0)` : sql`true`}
    order by created_at desc, kind, id
    limit ${pageSize + 1} offset ${(page - 1) * pageSize}
  `);
  return {
    items: result.rows.slice(0, pageSize).map((r) => ({
      kind: r.kind, id: r.id, direction: r.direction, amountPiastres: Number(r.amount), status: r.status,
      ref: r.ref, method: r.method, reference: r.reference, note: r.note, isTest: r.is_test,
      createdAt: new Date(r.created_at).toISOString(),
      link: r.link_kind && r.link_id ? { kind: r.link_kind, id: r.link_id } : null,
    })),
    page, pageSize, hasMore: result.rows.length > pageSize,
  };
}

/** Fetch fresh status directly by id, with the same owner filter as the list. */
export async function walletActivityDetail(actor: Actor, id: string) {
  const result = await walletActivity(actor, undefined, undefined, 1, 1, id);
  if (!result.items[0]) throw notFound('العملية');
  return result.items[0];
}

/* ───────── Payout requests (request only; owner decision §20) ───────── */

const toDestination = (key: string): AccountDestination => (key === 'STORE_PAYOUT_METHOD' ? { kind: 'STORE_PAYOUT_METHOD' } : { kind: 'RECEIVING_DESTINATION', id: key });

export async function accountPayoutRequests(actor: Actor, id?: string) {
  const userId = requireUser(actor);
  const rows = await accountWithdrawals(userId, id);
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
    fits: !!p.plan && !p.violations.length,
    transferCostPiastres: p.transferCost, netPiastres: p.net, violations: p.violations, warnings: p.warnings,
    destination: p.masked,
    sources: (p.plan ?? []).map((x) => ({ source: x.sourceType, amountPiastres: x.amount })),
  };
}

/** clientKey is the request's idempotency key: a retried submit returns the original request (created=false). */
export async function requestAccountPayout(actor: Actor, amountPiastres: number, destinationKey: string, clientKey: string) {
  const r = await requestAccountWithdrawal(actor, { amount: amountPiastres, clientKey, destination: toDestination(destinationKey) });
  const list = await accountPayoutRequests(actor, r.withdrawal.id);
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
  return {
    totals: { grossSalesPiastres: s.totals.grossSales, edmnFeesPiastres: s.totals.sellerFees, refundsPiastres: s.totals.refunds, pendingPiastres: s.totals.pending, ledgerAvailablePiastres: s.totals.available, reservedPiastres: s.totals.reserved, debtPiastres: s.totals.liability },
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

