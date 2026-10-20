import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';

/**
 * UNIFIED SELLER FINANCIAL VIEW (Batch 1.5) — ONE experience, TWO attributed sources, derived only:
 *
 *  MARKETPLACE     from the seller sub-ledger (SELLER_PENDING / SELLER_AVAILABLE / SELLER_WITHDRAWAL_RESERVED)
 *                  and, per sub-order, from the journal (source_type = seller_order) for pending classification.
 *  PROTECTED_DEAL  from the user's deals as seller (settled through platform accounts DEAL_FUNDS_HELD /
 *                  DEAL_PAYOUTS_PAYABLE) and their per-deal payout records (`deal_payouts`).
 *
 * Nothing here is stored or editable: every total is recomputed from the financial source of truth, every
 * amount keeps its source type and source entity, and no historical record is converted or rewritten.
 * A Protected Deal seller needs no Marketplace store. Money is never moved by reading this view.
 */

export interface SourceBalances {
  /** Paid by the buyer, not yet entitled (in delivery / buyer response window). */
  pending: number;
  /** Frozen by a hold or an open dispute. */
  held: number;
  /** Entitled (buyer confirmation / timeout / dispute decision) — waiting for the two-person Admin release. */
  entitledAwaitingRelease: number;
  /** Released and payable to the seller (Marketplace: withdrawable; Protected Deal: payout due per deal). */
  available: number;
  /** Locked by an in-flight (approved, not yet paid) withdrawal — per source. */
  reserved: number;
  /** Owed BY the seller (e.g. a refund after release exceeded the available balance). */
  liability: number;
  /** Already transferred to the seller (information). */
  paidOut: number;
}

export interface AttributedItem {
  sourceType: 'MARKETPLACE' | 'PROTECTED_DEAL';
  entityType: 'seller_order' | 'external_deal';
  entityId: string;
  ref: string;
  bucket: 'pending' | 'held' | 'entitledAwaitingRelease' | 'available';
  amount: number;
}

export interface SellerFinancialView {
  marketplace: (SourceBalances & { sellerId: string; storeName: string | null }) | null;
  protectedDeal: SourceBalances | null;
  combined: SourceBalances;
  items: AttributedItem[];
}

const zero = (): SourceBalances => ({ pending: 0, held: 0, entitledAwaitingRelease: 0, available: 0, reserved: 0, liability: 0, paidOut: 0 });

async function rows<T>(conn: DbOrTx, q: ReturnType<typeof sql>) {
  return (await conn.execute(q)).rows as T[];
}

export async function sellerFinancialView(conn: DbOrTx, userId: string): Promise<SellerFinancialView> {
  const items: AttributedItem[] = [];

  /* ── MARKETPLACE (only when the user owns a seller account) ── */
  let marketplace: SellerFinancialView['marketplace'] = null;
  const [seller] = await rows<{ id: string; store: string | null }>(conn, sql`select s.id, st.name store from sellers s left join stores st on st.seller_id = s.id where s.owner_user_id = ${userId} limit 1`);
  if (seller) {
    const bal = await rows<{ code: string; balance: string }>(conn, sql`select code, balance::text from ledger_accounts where seller_id = ${seller.id}`);
    const by = Object.fromEntries(bal.map((b) => [b.code, Number(b.balance)]));
    const m = { ...zero(), sellerId: seller.id, storeName: seller.store };
    const avail = by.SELLER_AVAILABLE ?? 0;
    m.available = Math.max(0, avail);
    m.liability = Math.max(0, -avail);
    m.reserved = by.SELLER_WITHDRAWAL_RESERVED ?? 0;
    // Per sub-order pending (journal-attributed), classified by state — sums back to SELLER_PENDING.
    const orders = await rows<{ id: string; status: string; basis: string | null; hold: boolean; blocked: boolean; ref: string; pending: string }>(
      conn,
      sql`select so.id, so.status, so.receipt_basis basis, so.financial_hold hold,
            exists (select 1 from disputes d where d.seller_order_id = so.id and d.status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')) blocked,
            o.number::text || '-' || so.suffix ref,
            coalesce(sum(l.credit - l.debit), 0)::text pending
          from seller_orders so join orders o on o.id = so.order_id
          join journal_entries e on e.source_type = 'seller_order' and e.source_id = so.id::text
          join journal_lines l on l.entry_id = e.id
          join ledger_accounts a on a.id = l.account_id and a.code = 'SELLER_PENDING'
         where so.seller_id = ${seller.id}
         group by so.id, o.number
        having coalesce(sum(l.credit - l.debit), 0) <> 0`,
    );
    for (const o of orders) {
      const amount = Number(o.pending);
      const bucket: AttributedItem['bucket'] = o.hold || o.blocked ? 'held' : o.status === 'DELIVERED' && o.basis ? 'entitledAwaitingRelease' : 'pending';
      m[bucket] += amount;
      items.push({ sourceType: 'MARKETPLACE', entityType: 'seller_order', entityId: o.id, ref: o.ref, bucket, amount });
    }
    // Paid out from the MARKETPLACE source only: its share of allocated withdrawals (net of restored amounts),
    // plus legacy withdrawals (before allocations) which were Marketplace-only by construction.
    const [paid] = await rows<{ n: string }>(
      conn,
      sql`select (coalesce((select sum(a.amount - a.restored_amount) from withdrawal_allocations a where a.source_type = 'MARKETPLACE' and a.seller_id = ${seller.id} and a.status in ('PAID','RETURNED')), 0)
        + coalesce((select sum(w.amount - coalesce(w.returned_amount, 0)) from withdrawal_requests w where w.seller_id = ${seller.id} and w.status in ('PAID','RETURNED')
            and not exists (select 1 from withdrawal_allocations a where a.withdrawal_id = w.id)), 0))::text n`,
    );
    m.paidOut = Number(paid.n);
    marketplace = m;
  }

  /* ── PROTECTED DEAL (deals where the user is the bound seller; no store required) ── */
  let protectedDeal: SourceBalances | null = null;
  const deals = await rows<{ id: string; number: string; status: string; hold: boolean; pays: string | null; fee: string; refund: string; payout_status: string | null; payout_amount: string | null; reserved: string; paid_alloc: string; has_alloc: boolean }>(
    conn,
    sql`select d.id, d.number::text, d.status, d.financial_hold hold, d.buyer_pays::text pays, d.fee_amount::text fee, d.pending_buyer_refund::text refund,
          p.status payout_status, p.amount::text payout_amount,
          coalesce((select sum(a.amount) from withdrawal_allocations a where a.source_entity_type = 'deal_payout' and a.source_entity_id = p.id and a.status = 'RESERVED'), 0)::text reserved,
          coalesce((select sum(a.amount - a.restored_amount) from withdrawal_allocations a where a.source_entity_type = 'deal_payout' and a.source_entity_id = p.id and a.status in ('PAID','RETURNED')), 0)::text paid_alloc,
          exists (select 1 from withdrawal_allocations a where a.source_entity_type = 'deal_payout' and a.source_entity_id = p.id) has_alloc
        from external_deals d left join deal_payouts p on p.deal_id = d.id
       where d.seller_user_id = ${userId}`,
  );
  if (deals.length) {
    const pd = zero();
    for (const d of deals) {
      const ref = `EDMN-${d.number.padStart(8, '0')}`;
      const expectedNet = Math.max(0, Number(d.pays ?? 0) - Number(d.refund) - Math.min(Number(d.fee), Number(d.pays ?? 0) - Number(d.refund)));
      let bucket: AttributedItem['bucket'] | null = null;
      let amount = expectedNet;
      if (d.status === 'COMPLETED') {
        // Per-deal payable split by its withdrawal allocations: reserved (in flight), paid out, still available.
        const reserved = Number(d.reserved);
        const paidOut = d.has_alloc ? Number(d.paid_alloc) : d.payout_status === 'PAID' ? Number(d.payout_amount ?? 0) : 0;
        pd.reserved += reserved;
        pd.paidOut += paidOut;
        if (d.payout_status === 'PENDING') {
          bucket = 'available';
          amount = Number(d.payout_amount) - reserved - Number(d.paid_alloc);
        }
      } else if (['ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE', 'DISPUTED'].includes(d.status) && d.pays) {
        bucket = d.hold || d.status === 'DISPUTED' ? 'held' : ['BUYER_CONFIRMED_RECEIPT', 'ENTITLED_AWAITING_RELEASE'].includes(d.status) ? 'entitledAwaitingRelease' : 'pending';
      }
      if (bucket && amount > 0) {
        pd[bucket] += amount;
        items.push({ sourceType: 'PROTECTED_DEAL', entityType: 'external_deal', entityId: d.id, ref, bucket, amount });
      }
    }
    protectedDeal = pd;
  }

  const combined = zero();
  for (const s of [marketplace, protectedDeal]) {
    if (!s) continue;
    for (const k of Object.keys(combined) as (keyof SourceBalances)[]) combined[k] += s[k];
  }
  return { marketplace, protectedDeal, combined, items };
}
