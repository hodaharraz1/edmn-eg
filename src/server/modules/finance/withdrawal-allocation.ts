import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor } from '@/server/core/actor';
import type { DbOrTx } from '@/server/db/client';
import { dealPayouts, sellers, withdrawalAllocations, withdrawalRequests } from '@/server/db/schema';
import { accountBalance, type LineInput } from './ledger';

/**
 * CROSS-SOURCE WITHDRAWAL ALLOCATION (Batch 1.5 closure).
 *
 * A seller may hold money from two attributed sources:
 *   MARKETPLACE     the store sub-ledger (SELLER_AVAILABLE of the store the user owns)
 *   PROTECTED_DEAL  per-deal payables (deal_payouts PENDING, booked in the platform DEAL_PAYOUTS_PAYABLE)
 *
 * ALLOCATION POLICY (deterministic, accounting mechanics only — no fee, price or business effect):
 *   1. Protected Deal payables first, OLDEST FIRST (deal_payouts.created_at, then id). Each payable deal is an
 *      individually due obligation with its own eligibility time, so the oldest obligation is settled first.
 *   2. Then the Marketplace available balance (one pooled sub-ledger; it has no per-unit age).
 *   A request scoped to MARKETPLACE (store context / scheduled settlement) only uses step 2.
 *   Marketplace funds only ever leave through the store's verified payout method, so a withdrawal to a user-level
 *   receiving destination is scoped to PROTECTED_DEAL.
 *
 * The allocation is computed and stored at APPROVAL, under locks, atomically with the reservation journal, and
 * the sum of allocations equals the withdrawal amount exactly. Every later step (payout, release, return) acts
 * per allocation, so the source of every minor unit is never lost or pooled.
 */

export type Allocation = typeof withdrawalAllocations.$inferSelect;
export type Scope = 'MARKETPLACE' | 'ALL_FOR_STORE_DESTINATION' | 'PROTECTED_DEAL';

export interface SourceCandidate {
  sourceType: 'MARKETPLACE' | 'PROTECTED_DEAL';
  sourceEntityType: 'seller_account' | 'deal_payout';
  sourceEntityId: string;
  dealId: string | null;
  available: number;
}

/** Remaining payable of each PENDING deal payout of the user (amount − what live allocations consumed), oldest first. */
async function dealCandidates(tx: DbOrTx, userId: string, lock: boolean): Promise<SourceCandidate[]> {
  const payouts = lock
    ? await tx.select().from(dealPayouts).where(and(eq(dealPayouts.payeeUserId, userId), eq(dealPayouts.status, 'PENDING'))).orderBy(asc(dealPayouts.createdAt), asc(dealPayouts.id)).for('update')
    : await tx.select().from(dealPayouts).where(and(eq(dealPayouts.payeeUserId, userId), eq(dealPayouts.status, 'PENDING'))).orderBy(asc(dealPayouts.createdAt), asc(dealPayouts.id));
  if (!payouts.length) return [];
  const used = await tx.execute<{ id: string; n: string }>(sql`select source_entity_id::text id, coalesce(sum(amount - restored_amount), 0)::text n
    from withdrawal_allocations where source_entity_type = 'deal_payout' and source_entity_id in (${sql.join(payouts.map((p) => sql`${p.id}::uuid`), sql`, `)}) group by 1`);
  const consumed = new Map(used.rows.map((r) => [r.id, Number(r.n)]));
  return payouts
    .map((p) => ({ sourceType: 'PROTECTED_DEAL' as const, sourceEntityType: 'deal_payout' as const, sourceEntityId: p.id, dealId: p.dealId, available: p.amount - (consumed.get(p.id) ?? 0) }))
    .filter((c) => c.available > 0);
}

/**
 * Ordered candidate sources (policy above). Marketplace availability is the WITHDRAWABLE part of the ledger balance:
 * SELLER_AVAILABLE minus the active post-release holds (B2) — never negative here. With lock = true the store's
 * funds lock is taken first (callers deciding money already hold it; the advisory lock is re-entrant).
 */
export async function sourceCandidates(tx: DbOrTx, input: { userId: string; sellerId: string | null; scope: Scope; lock: boolean }): Promise<{ candidates: SourceCandidate[]; marketplaceBalance: number | null; marketplaceHeld: number }> {
  const out: SourceCandidate[] = [];
  if (input.scope !== 'MARKETPLACE') out.push(...(await dealCandidates(tx, input.userId, input.lock)));
  let marketplaceBalance: number | null = null;
  let marketplaceHeld = 0;
  if (input.sellerId && input.scope !== 'PROTECTED_DEAL') {
    const { lockSellerFunds, sellerFundsPosition } = await import('./holds');
    if (input.lock) await lockSellerFunds(tx, input.sellerId);
    marketplaceBalance = await accountBalance(tx, { code: 'SELLER_AVAILABLE', sellerId: input.sellerId }, input.lock);
    const pos = await sellerFundsPosition(tx, input.sellerId);
    marketplaceHeld = pos.held;
    if (pos.withdrawable > 0) out.push({ sourceType: 'MARKETPLACE', sourceEntityType: 'seller_account', sourceEntityId: input.sellerId, dealId: null, available: pos.withdrawable });
  }
  return { candidates: out, marketplaceBalance, marketplaceHeld };
}

/** Greedy deterministic split in candidate order. Returns null when the sources cannot cover the amount. */
export function planAllocation(candidates: SourceCandidate[], amount: number): (SourceCandidate & { amount: number })[] | null {
  const plan: (SourceCandidate & { amount: number })[] = [];
  let left = amount;
  for (const c of candidates) {
    if (left <= 0) break;
    const take = Math.min(c.available, left);
    if (take > 0) plan.push({ ...c, amount: take });
    left -= take;
  }
  return left === 0 ? plan : null;
}

/** Serialize every allocation decision of one beneficiary (concurrent approvals never double-allocate). */
export async function lockBeneficiary(tx: DbOrTx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'withdraw-alloc:' + userId}))`);
}

/** Owner of a withdrawal: the recorded beneficiary, or (legacy Marketplace rows) the store owner. */
export async function beneficiaryOf(tx: DbOrTx, w: typeof withdrawalRequests.$inferSelect): Promise<string> {
  if (w.userId) return w.userId;
  const [s] = await tx.select({ owner: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, w.sellerId!));
  return s.owner;
}

/**
 * Allocations of a withdrawal. Withdrawals reserved before the allocation model have no rows: they are a single
 * implicit MARKETPLACE allocation of the whole amount (history is never rewritten, rows are never back-filled).
 */
export async function allocationsOf(tx: DbOrTx, w: typeof withdrawalRequests.$inferSelect): Promise<{ rows: Allocation[]; legacy: boolean }> {
  const rows = await tx.select().from(withdrawalAllocations).where(eq(withdrawalAllocations.withdrawalId, w.id)).orderBy(asc(withdrawalAllocations.seq)).for('update');
  if (rows.length || !w.reservedAt) return { rows, legacy: false };
  const status: Allocation['status'] = w.status === 'PAID' ? 'PAID' : w.status === 'RETURNED' ? 'RETURNED' : ['REJECTED', 'FAILED_BEFORE_TRANSFER'].includes(w.status) ? 'RELEASED' : 'RESERVED';
  const virtual: Allocation = {
    id: `legacy:${w.id}`,
    withdrawalId: w.id,
    seq: 1,
    userId: w.userId,
    sellerId: w.sellerId,
    sourceType: 'MARKETPLACE',
    sourceEntityType: 'seller_account',
    sourceEntityId: w.sellerId!,
    dealId: null,
    amount: w.amount,
    status,
    restoredAmount: status === 'RELEASED' ? w.amount : status === 'RETURNED' ? (w.returnedAmount ?? 0) : 0,
    reservationJournalId: null,
    payoutJournalId: null,
    releaseJournalId: null,
    returnJournalId: null,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
  return { rows: [virtual], legacy: true };
}

/** The source account of an allocation (where funds come from / go back to). */
export const sourceAccount = (a: Pick<Allocation, 'sourceType' | 'sellerId'>): LineInput['account'] =>
  a.sourceType === 'MARKETPLACE' ? { code: 'SELLER_AVAILABLE', sellerId: a.sellerId } : { code: 'DEAL_PAYOUTS_PAYABLE' };
/** The reservation account of an allocation. */
export const reservedAccount = (a: Pick<Allocation, 'sourceType' | 'sellerId'>): LineInput['account'] =>
  a.sourceType === 'MARKETPLACE' ? { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId: a.sellerId } : { code: 'DEAL_PAYOUTS_RESERVED' };

export async function markAllocations(tx: DbOrTx, rows: Allocation[], set: Partial<Allocation>) {
  const ids = rows.filter((r) => !r.id.startsWith('legacy:')).map((r) => r.id);
  if (ids.length) await tx.update(withdrawalAllocations).set({ ...set, updatedAt: new Date() }).where(inArray(withdrawalAllocations.id, ids));
}

/**
 * Keeps the per-deal payout record in step with its allocations: a deal payout is PAID once its whole amount
 * was paid out through withdrawals (nothing reserved, nothing restored-pending); a returned allocation makes it
 * payable (PENDING) again for the restored part.
 */
export async function syncDealPayouts(tx: DbOrTx, actor: Actor, payoutIds: string[], paid?: { reference: string; approvalId: string }) {
  for (const id of [...new Set(payoutIds)]) {
    const [p] = await tx.select().from(dealPayouts).where(eq(dealPayouts.id, id)).for('update');
    if (!p) continue;
    const r = await tx.execute<{ consumed: string; reserved: string; paid: string }>(sql`select
        coalesce(sum(amount - restored_amount), 0)::text consumed,
        coalesce(sum(amount) filter (where status = 'RESERVED'), 0)::text reserved,
        coalesce(sum(amount - restored_amount) filter (where status in ('PAID','RETURNED')), 0)::text paid
      from withdrawal_allocations where source_entity_type = 'deal_payout' and source_entity_id = ${id}`);
    const { consumed, reserved, paid: paidOut } = r.rows[0];
    const fullyPaid = Number(reserved) === 0 && Number(paidOut) === p.amount && Number(consumed) === p.amount;
    if (fullyPaid && p.status !== 'PAID') {
      await tx.update(dealPayouts).set({ status: 'PAID', paidAt: new Date(), paidBy: actor.userId ?? null, paidReference: paid?.reference ?? null, payoutApprovalId: paid?.approvalId ?? null }).where(eq(dealPayouts.id, id));
    } else if (!fullyPaid && p.status === 'PAID') {
      await tx.update(dealPayouts).set({ status: 'PENDING' }).where(eq(dealPayouts.id, id));
    }
  }
}
