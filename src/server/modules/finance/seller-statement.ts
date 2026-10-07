import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';

/**
 * Seller financial statement built from the immutable ledger (every row = one journal entry touching
 * the seller's accounts) and enriched with the sale economics snapshotted on the order. Running
 * balances reconcile exactly with the seller's ledger accounts. The EDMN seller fee appears once —
 * on the sale — and never again at withdrawal; the payout transfer cost is shown separately.
 */
export interface StatementRow {
  entryId: string;
  date: string;
  type: string;
  description: string;
  reference: string;
  orderRef: string | null;
  grossSale: number;
  sellerFee: number;
  refund: number;
  adjustment: number;
  payoutCost: number;
  netEffect: number;
  pendingDelta: number;
  availableDelta: number;
  reservedDelta: number;
  pending: number;
  available: number;
  reserved: number;
}

const DESCRIPTIONS: Record<string, string> = {
  ORDER_PAYMENT: 'بيع مؤكد الدفع: صافي المبيعات (بعد رسوم خدمة اضمن) معلق لحين الاستلام وموافقة الإدارة',
  SELLER_RELEASE: 'إتاحة صافي المبيعات بموافقة الإدارة (من معلق إلى متاح)',
  REFUND: 'استرداد معتمد للمشتري: خصم نصيبك من المنتج/الشحن مع عكس رسوم الخدمة على الوحدات المستردة',
  ADJUSTMENT: 'تسوية مالية معتمدة',
  WITHDRAWAL_RESERVE: 'حجز مبلغ طلب سحب معتمد',
  WITHDRAWAL_REVERSAL: 'إلغاء حجز طلب سحب',
  WITHDRAWAL_PAID: 'تحويل مبلغ السحب (رسوم التحويل موضحة منفصلة)',
};

export async function sellerStatement(sellerId: string, limit = 300): Promise<{ rows: StatementRow[]; totals: { pending: number; available: number; reserved: number; liability: number } }> {
  const r = await db.execute<{
    entry_id: string; created_at: string; entry_type: string; source_type: string; source_id: string; description: string;
    pending: string; available: string; reserved: string;
    so_ref: string | null; so_merch: string | null; so_ship: string | null; so_seller_fee: string | null; so_buyer_fee: string | null; so_commission: string | null; so_source: string | null;
    refund_liability: string | null; wd_number: number | null; wd_cost: string | null; wd_actual_cost: string | null; wd_payer: string | null;
  }>(sql`
    select e.id entry_id, e.created_at::text created_at, e.entry_type, e.source_type, e.source_id, e.description,
      coalesce(sum(l.credit - l.debit) filter (where a.code = 'SELLER_PENDING'), 0)::text pending,
      coalesce(sum(l.credit - l.debit) filter (where a.code = 'SELLER_AVAILABLE'), 0)::text available,
      coalesce(sum(l.credit - l.debit) filter (where a.code = 'SELLER_WITHDRAWAL_RESERVED'), 0)::text reserved,
      max(o.number::text || '-' || so.suffix) so_ref, max(so.merchandise_subtotal)::text so_merch, max(so.shipping_fee)::text so_ship,
      max(so.seller_fee_total)::text so_seller_fee, max(so.buyer_fee_total)::text so_buyer_fee, max(so.commission_total)::text so_commission, max(so.pricing_source) so_source,
      max(rf.seller_liability)::text refund_liability, max(w.number) wd_number, max(w.transfer_cost)::text wd_cost, max(w.actual_transfer_cost)::text wd_actual_cost, max(w.transfer_cost_payer) wd_payer
    from journal_entries e
    join journal_lines l on l.entry_id = e.id
    join ledger_accounts a on a.id = l.account_id and a.seller_id = ${sellerId}
    left join seller_orders so on e.source_type = 'seller_order' and so.id::text = e.source_id
    left join orders o on o.id = so.order_id
    left join refunds rf on e.entry_type = 'REFUND' and e.idempotency_key = 'refund:' || rf.id::text
    left join withdrawal_requests w on e.source_type = 'withdrawal' and w.id::text = e.source_id
    group by e.id
    order by e.seq asc
  `);
  let pending = 0;
  let available = 0;
  let reserved = 0;
  const rows: StatementRow[] = r.rows.map((x) => {
    const dP = Number(x.pending);
    const dA = Number(x.available);
    const dR = Number(x.reserved);
    pending += dP;
    available += dA;
    reserved += dR;
    const legacy = x.so_source !== 'ENGINE';
    const commission = Number(x.so_commission ?? 0);
    const buyerFee = Number(x.so_buyer_fee ?? 0);
    const sellerFee = x.entry_type === 'ORDER_PAYMENT' ? (legacy && buyerFee + Number(x.so_seller_fee ?? 0) !== commission ? commission - buyerFee : Number(x.so_seller_fee ?? 0)) : 0;
    const gross = x.entry_type === 'ORDER_PAYMENT' ? Number(x.so_merch ?? 0) + Number(x.so_ship ?? 0) : 0;
    const payoutCost = x.entry_type === 'WITHDRAWAL_PAID' && x.wd_payer === 'SELLER_PAYS' ? Math.min(Number(x.wd_actual_cost ?? x.wd_cost ?? 0), Number(x.wd_cost ?? 0)) : 0;
    return {
      entryId: x.entry_id,
      date: x.created_at,
      type: x.entry_type,
      description: DESCRIPTIONS[x.entry_type] ?? x.description,
      reference: x.wd_number ? `سحب #${x.wd_number}` : x.so_ref ? `طلب ${x.so_ref}` : x.source_id.slice(0, 8),
      orderRef: x.so_ref,
      grossSale: gross,
      sellerFee,
      refund: x.entry_type === 'REFUND' ? Number(x.refund_liability ?? -(dP + dA)) : 0,
      adjustment: x.entry_type === 'ADJUSTMENT' ? dP + dA : 0,
      payoutCost,
      netEffect: dP + dA + dR,
      pendingDelta: dP,
      availableDelta: dA,
      reservedDelta: dR,
      pending,
      available,
      reserved,
    };
  });
  return { rows: rows.reverse().slice(0, limit), totals: { pending, available, reserved, liability: available < 0 ? -available : 0 } };
}
