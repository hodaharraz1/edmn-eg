import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import type { Actor } from '@/server/core/actor';
import { invalidState } from '@/server/core/errors';
import type { DbOrTx } from '@/server/db/client';
import { formatEGP } from '@/lib/format';
import { orderItems, returnItems, sellerFinancialHolds, sellerOrders, sellers } from '@/server/db/schema';
import { accountBalance } from './ledger';
import { sellerOrderPosition } from './postings';

/**
 * B2 — POST-RELEASE FINANCIAL HOLDS (P0 #5).
 *
 * When a dispute / return / refund request is opened on a seller order whose funds were ALREADY released to the
 * seller's available balance, the affected amount becomes an ACTIVE hold (an encumbrance on SELLER_AVAILABLE).
 * A hold moves NO money and edits NO balance — a buyer action can never post a journal entry (every entry needs a
 * named Admin approval, DB-enforced). The ledger stays the only source of balances; the liability is booked only
 * by the Maker/Checker refund approval (DR SELLER_AVAILABLE), at which point the refund hold is CONSUMED.
 *
 *   A  available           = SELLER_AVAILABLE (ledger; may be negative = booked seller debt)
 *   R  reservedNotStarted  = SELLER_WITHDRAWAL_RESERVED of APPROVED withdrawals whose transfer has NOT started
 *                            (still inside EDMN; PROCESSING / TRANSFER_UNCERTAIN / PAID never count as backing)
 *   H  held                = Σ ACTIVE holds
 *   securedByAvailable     = min(max(A, 0), H)
 *   securedByReservation   = min(R, max(0, H − securedByAvailable))  — backing frozen in place, NOT withdrawable
 *   unsecuredExposure      = max(0, H − securedByAvailable − securedByReservation)  — not backed by EDMN cash
 *   bookedDebt             = max(0, −A)
 *   withdrawable           = max(0, A − H)  — R never adds to it (no double count)
 *
 * Every hold read/write that decides money runs under the per-seller lock (lockSellerFunds), also taken by
 * withdrawal approval and execution, so the order in which concurrent requests arrive cannot open a hole.
 */

export type SellerHold = typeof sellerFinancialHolds.$inferSelect;
type SellerOrder = typeof sellerOrders.$inferSelect;
type HoldKind = SellerHold['kind'];

/** Serializes every decision about a seller's released funds (holds, withdrawal approval/execution, refund approval). */
export async function lockSellerFunds(tx: DbOrTx, sellerId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'seller-funds:' + sellerId}))`);
}

async function activeHeld(tx: DbOrTx, where: SQL): Promise<number> {
  const r = await tx.execute<{ n: string }>(sql`select coalesce(sum(amount), 0)::text n from seller_financial_holds where status = 'ACTIVE' and ${where}`);
  return Number(r.rows[0].n);
}

export interface SellerFundsPosition {
  available: number;
  reservedNotStarted: number;
  held: number;
  securedByAvailable: number;
  securedByReservation: number;
  unsecuredExposure: number;
  bookedDebt: number;
  withdrawable: number;
}

/**
 * R: the seller's Marketplace reservation for APPROVED withdrawals whose external transfer has not started
 * (allocation rows; a legacy reserved request without rows counts with its amount), capped by the ledger
 * SELLER_WITHDRAWAL_RESERVED balance so it can never exceed what the ledger holds.
 */
async function reservedNotStarted(tx: DbOrTx, sellerId: string): Promise<number> {
  const r = await tx.execute<{ n: string }>(sql`select coalesce(sum(x), 0)::text n from (
      select a.amount x from withdrawal_allocations a join withdrawal_requests w on w.id = a.withdrawal_id
       where a.seller_id = ${sellerId} and a.source_type = 'MARKETPLACE' and a.status = 'RESERVED' and w.status = 'APPROVED'
      union all
      select w.amount from withdrawal_requests w
       where w.seller_id = ${sellerId} and w.status = 'APPROVED' and w.reserved_at is not null
         and not exists (select 1 from withdrawal_allocations a where a.withdrawal_id = w.id)) t`);
  const ledgerReserved = await accountBalance(tx, { code: 'SELLER_WITHDRAWAL_RESERVED', sellerId });
  return Math.max(0, Math.min(Number(r.rows[0].n), ledgerReserved));
}

/** Derived position of a seller's released funds (read-only). Call under lockSellerFunds when deciding money. */
export async function sellerFundsPosition(tx: DbOrTx, sellerId: string): Promise<SellerFundsPosition> {
  const available = await accountBalance(tx, { code: 'SELLER_AVAILABLE', sellerId });
  const held = await activeHeld(tx, sql`seller_id = ${sellerId}`);
  const reserved = await reservedNotStarted(tx, sellerId);
  const securedByAvailable = Math.min(Math.max(available, 0), held);
  const securedByReservation = Math.min(reserved, Math.max(0, held - securedByAvailable));
  return {
    available,
    reservedNotStarted: reserved,
    held,
    securedByAvailable,
    securedByReservation,
    unsecuredExposure: Math.max(0, held - securedByAvailable - securedByReservation),
    bookedDebt: Math.max(0, -available),
    withdrawable: Math.max(0, available - held),
  };
}

/** Released seller funds of one sub-order not yet claimed by a refund approval or another active hold. */
async function subOrderOpenExposure(tx: DbOrTx, so: SellerOrder): Promise<number> {
  const pos = await sellerOrderPosition(tx, so);
  return Math.max(0, pos.available - (await activeHeld(tx, sql`seller_order_id = ${so.id}`)));
}

/** Seller value of the returned units (their purchase price) — the explicit allocation of a return. */
export async function returnUnitsValue(tx: DbOrTx, returnId: string): Promise<number> {
  const lines = await tx
    .select({ qty: returnItems.quantity, unitPrice: orderItems.unitPrice })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .where(eq(returnItems.returnId, returnId));
  return lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
}

/**
 * Open (idempotently) a hold for one case on a RELEASED seller order. Before release nothing is needed: the funds
 * are still pending and the release itself is blocked by open disputes/returns/refunds. The amount is the case's
 * explicit allocation, capped by the sub-order's released funds not already claimed (no double hold).
 */
export async function openHold(
  tx: DbOrTx,
  actor: Actor,
  input: { so: SellerOrder; kind: HoldKind; sourceId: string; disputeId?: string | null; returnId?: string | null; refundId?: string | null; requested?: number | null; reason: string },
): Promise<SellerHold | null> {
  if (!input.so.fundsReleasedAt) return null;
  await lockSellerFunds(tx, input.so.sellerId);
  const [existing] = await tx
    .select()
    .from(sellerFinancialHolds)
    .where(and(eq(sellerFinancialHolds.kind, input.kind), eq(sellerFinancialHolds.sourceId, input.sourceId), eq(sellerFinancialHolds.status, 'ACTIVE')));
  if (existing) return existing;
  const open = await subOrderOpenExposure(tx, input.so);
  const requested = input.requested ?? open;
  if (!Number.isSafeInteger(requested) || requested < 0) throw invalidState('مبلغ الحجز غير صالح');
  const amount = Math.min(requested, open);
  if (amount <= 0) return null;
  // secured_at_open: the part of this hold covered by AVAILABLE not already claimed by earlier holds.
  const pos = await sellerFundsPosition(tx, input.so.sellerId);
  const securedAtOpen = Math.max(0, Math.min(amount, pos.available - pos.held));
  const [hold] = await tx
    .insert(sellerFinancialHolds)
    .values({
      sellerId: input.so.sellerId,
      sellerOrderId: input.so.id,
      kind: input.kind,
      sourceId: input.sourceId,
      disputeId: input.disputeId ?? null,
      returnId: input.returnId ?? null,
      refundId: input.refundId ?? null,
      amount,
      securedAtOpen,
      unsecuredAtOpen: amount - securedAtOpen,
      reason: input.reason.slice(0, 500),
      createdBy: actor.userId ?? null,
    })
    .returning();
  await audit(tx, actor, {
    action: 'seller_hold.opened',
    entityType: 'seller_hold',
    entityId: hold.id,
    newValues: { sellerId: hold.sellerId, sellerOrderId: hold.sellerOrderId, kind: hold.kind, sourceId: hold.sourceId, amount, secured: securedAtOpen, unsecured: amount - securedAtOpen },
    reason: input.reason,
  });
  return hold;
}

/** Close ACTIVE holds matching `where` (only those — never another case's holds). Idempotent: closed holds are skipped. */
async function closeHolds(tx: DbOrTx, actor: Actor, where: SQL, status: 'RELEASED' | 'CONVERTED' | 'CONSUMED', reason: string): Promise<SellerHold[]> {
  const rows = await tx.select().from(sellerFinancialHolds).where(and(eq(sellerFinancialHolds.status, 'ACTIVE'), where));
  if (!rows.length) return [];
  for (const sellerId of [...new Set(rows.map((r) => r.sellerId))].sort()) await lockSellerFunds(tx, sellerId);
  const closed = await tx
    .update(sellerFinancialHolds)
    .set({ status, closedAt: new Date(), closedBy: actor.userId ?? null, closeReason: reason.slice(0, 500) })
    .where(and(inArray(sellerFinancialHolds.id, rows.map((r) => r.id)), eq(sellerFinancialHolds.status, 'ACTIVE')))
    .returning();
  for (const h of closed) {
    await audit(tx, actor, { action: `seller_hold.${status.toLowerCase()}`, entityType: 'seller_hold', entityId: h.id, oldValues: { status: 'ACTIVE' }, newValues: { status, amount: h.amount, kind: h.kind, sourceId: h.sourceId }, reason });
  }
  return closed;
}

/** Close ONLY the (non-refund) holds of one case: its dispute and/or its return. */
export async function closeCaseHolds(tx: DbOrTx, actor: Actor, c: { disputeId?: string | null; returnId?: string | null }, status: 'RELEASED' | 'CONVERTED', reason: string) {
  const parts: SQL[] = [];
  if (c.disputeId) parts.push(sql`${sellerFinancialHolds.disputeId} = ${c.disputeId}`);
  if (c.returnId) parts.push(sql`${sellerFinancialHolds.returnId} = ${c.returnId}`);
  if (!parts.length) return [];
  return closeHolds(tx, actor, sql`${sellerFinancialHolds.kind} <> 'REFUND' and (${sql.join(parts, sql` or `)})`, status, reason);
}

/** Seller-side or no-money outcome of a case: release ONLY that case's holds. */
export async function releaseCaseHolds(tx: DbOrTx, actor: Actor, c: { disputeId?: string | null; returnId?: string | null }, reason: string) {
  return closeCaseHolds(tx, actor, c, 'RELEASED', reason);
}

/**
 * A refund REQUEST on a released sub-order replaces the case's hold(s) with exactly the refund's seller liability
 * (the amount the approval will debit from SELLER_AVAILABLE). Other cases' holds are untouched.
 */
export async function convertToRefundHold(
  tx: DbOrTx,
  actor: Actor,
  so: SellerOrder,
  refund: { id: string; sellerLiability: number; sourceType: string; sourceId: string },
): Promise<SellerHold | null> {
  if (!so.fundsReleasedAt) return null;
  const caseWhere =
    refund.sourceType === 'RETURN'
      ? sql`${sellerFinancialHolds.returnId} = ${refund.sourceId}`
      : refund.sourceType === 'DISPUTE'
        ? sql`${sellerFinancialHolds.disputeId} = ${refund.sourceId}`
        : null;
  if (caseWhere) await closeHolds(tx, actor, sql`${sellerFinancialHolds.kind} <> 'REFUND' and ${caseWhere}`, 'CONVERTED', `حلّ محله طلب استرداد ${refund.id}`);
  if (refund.sellerLiability <= 0) return null;
  return openHold(tx, actor, { so, kind: 'REFUND', sourceId: refund.id, refundId: refund.id, requested: refund.sellerLiability, reason: 'طلب استرداد بعد إتاحة مستحقات البائع' });
}

/** The refund approval booked the liability in the ledger: its hold is consumed (the ledger now carries it). */
export async function consumeRefundHold(tx: DbOrTx, actor: Actor, refundId: string) {
  return closeHolds(tx, actor, sql`${sellerFinancialHolds.refundId} = ${refundId} and ${sellerFinancialHolds.kind} = 'REFUND'`, 'CONSUMED', 'اعتماد الاسترداد سجّل المديونية في دفتر الأستاذ');
}

/** The refund request will not be paid (rejected): its hold is released. */
export async function releaseRefundHold(tx: DbOrTx, actor: Actor, refundId: string, reason: string) {
  return closeHolds(tx, actor, sql`${sellerFinancialHolds.refundId} = ${refundId} and ${sellerFinancialHolds.kind} = 'REFUND'`, 'RELEASED', reason);
}

/** Take the funds lock of the store a user owns (if any) — BEFORE any ledger-row lock, to keep one lock order. */
export async function lockOwnerStoreFunds(tx: DbOrTx, ownerUserId: string): Promise<string | null> {
  const [store] = await tx.select({ id: sellers.id }).from(sellers).where(eq(sellers.ownerUserId, ownerUserId)).limit(1);
  if (store) await lockSellerFunds(tx, store.id);
  return store?.id ?? null;
}

/**
 * "May money leave / be committed?" gate. Every active claim on the store (holds) and every booked debt must be
 * covered by SELLER_AVAILABLE itself. A reservation of an approved, not-yet-transferred withdrawal may BACK a
 * claim (reporting), but releasing it externally would remove that backing — so it never satisfies this gate.
 * Used for: account withdrawal request, approval (Maker reservation), transfer start, and APPROVED → PAID.
 * Callers that decide money pass lock = true (or hold the funds lock already).
 */
export async function assertClaimsCoveredByAvailable(tx: DbOrTx, ownerUserId: string, lock: boolean) {
  const [store] = await tx.select({ id: sellers.id }).from(sellers).where(eq(sellers.ownerUserId, ownerUserId)).limit(1);
  if (!store) return;
  if (lock) await lockSellerFunds(tx, store.id);
  const reason = sendBlockReason(await sellerFundsPosition(tx, store.id));
  if (reason) throw invalidState(reason);
}

/** Why the store's position forbids releasing / committing money (null = covered). Pure; shared with the operator UI. */
export function sendBlockReason(p: SellerFundsPosition): string | null {
  const uncoveredClaims = p.held - p.securedByAvailable;
  if (uncoveredClaims <= 0 && p.bookedDebt <= 0) return null;
  const parts: string[] = [];
  if (p.bookedDebt > 0) parts.push(`مديونية مسجلة ${formatEGP(p.bookedDebt)}`);
  if (uncoveredClaims > 0) parts.push(`مطالبات نزاعات/مرتجعات مفتوحة ${formatEGP(uncoveredClaims)}`);
  let msg = `على المتجر ${parts.join(' و')} غير مغطاة برصيد متاح. لا يمكن اعتماد أو تنفيذ أي سحب قبل تغطيتها أو حسم الحالات`;
  if (p.securedByReservation > 0) {
    msg += ` (منها ${formatEGP(p.securedByReservation)} مغطاة حاليًا بمبلغ سحب معتمد محجوز لم يُحوَّل — لا يجوز تحويله. لتحرير الباقي يُرفض السحب بعكس الحجز (منشئ ومراجع) ثم يطلب البائع سحبًا جديدًا بالمبلغ القابل للسحب)`;
  }
  return msg;
}

/** Active holds of a seller (operator / seller visibility). */
export async function activeHoldsOf(tx: DbOrTx, sellerId: string) {
  return tx.select().from(sellerFinancialHolds).where(and(eq(sellerFinancialHolds.sellerId, sellerId), eq(sellerFinancialHolds.status, 'ACTIVE')));
}

/**
 * A return the SELLER rejected keeps its hold while the buyer may still escalate it to a dispute (a party's own
 * decision never lifts the restriction). Once the dispute window after delivery has lapsed with no dispute on the
 * return, the hold is released. Scheduled, idempotent; moves no money.
 */
export async function releaseLapsedReturnHolds(conn: DbOrTx, actor: Actor): Promise<number> {
  const { getSetting } = await import('@/server/modules/settings');
  const days = await getSetting('disputes.windowDays', conn);
  const due = await conn.execute<{ id: string }>(sql`select h.id from seller_financial_holds h
      join returns r on r.id = h.return_id join seller_orders so on so.id = h.seller_order_id
     where h.status = 'ACTIVE' and h.kind = 'RETURN' and r.status = 'REJECTED'
       and coalesce(so.delivered_at, r.created_at) < now() - make_interval(days => ${days}::int)
       and not exists (select 1 from disputes d where d.return_id = r.id)`);
  if (!due.rows.length) return 0;
  const closed = await closeHolds(conn, actor, sql`${sellerFinancialHolds.id} in (${sql.join(due.rows.map((r) => sql`${r.id}::uuid`), sql`, `)})`, 'RELEASED', 'انتهت مهلة تصعيد الإرجاع المرفوض بدون نزاع');
  return closed.length;
}
