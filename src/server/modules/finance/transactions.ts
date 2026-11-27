import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { TX_KINDS_NEED_PAYMENTS_VIEW, TX_METHOD_GROUP_CODES, type TxKind, type TxMethodGroup } from '@/lib/transaction-labels';

/**
 * PKG-FOLLOWUP-02: the unified, read-only list behind /admin/transactions. Every row is a money-movement document;
 * the ledger stays the accounting source of truth. Amounts are integer piastres (the page formats them with formatEGP).
 *
 *   ORDER_PAYMENT / DEAL_PAYMENT  a payment of any method except WALLET
 *   WALLET_SPEND                  a payment whose method is WALLET (orders and Protected Deals paid from the balance)
 *   SPEND_REVERSAL                a refund credited back to the wallet (customer_wallet_entries kind SPEND_REVERSAL)
 *   WALLET_TOPUP                  a deposit (wallet_topups); only for people who can see payments
 *   WITHDRAWAL / REFUND / DEAL_PAYOUT  outgoing documents, unchanged
 *
 * A refund that goes to the wallet appears twice on purpose: once as the REFUND document and once as the wallet credit.
 * لم يتم التحقق: هذا الاستعلام يلمس قاعدة البيانات ولم يُشغَّل على Postgres هنا (لا يوجد خادم).
 */
export type TransactionRow = {
  kind: TxKind;
  id: string;
  ref: string;
  party: string | null;
  amount: number;
  status: string;
  at: string;
  href: string;
  /** The payment-method code of the movement, or null for documents that have none (withdrawals, payouts). */
  method: string | null;
};

export interface TransactionQuery {
  kind?: TxKind | null;
  method?: TxMethodGroup | null;
  /** payments.view: a deposit is a payment document, so whoever cannot see payments cannot see deposits. */
  canViewPayments: boolean;
  limit?: number;
}

export async function listTransactions(db: DbOrTx, q: TransactionQuery): Promise<TransactionRow[]> {
  const topups = q.canViewPayments
    ? sql`union all
      select 'WALLET_TOPUP', t.id::text, 'T-' || upper(left(t.id::text, 8)), u.full_name, t.amount, t.status, coalesce(t.decided_at, t.created_at)::text, '/admin/wallet-topups/' || t.id, t.method
        from wallet_topups t join users u on u.id = t.user_id`
    : sql``;
  const where: SQL[] = [];
  if (q.kind && (q.canViewPayments || !TX_KINDS_NEED_PAYMENTS_VIEW.includes(q.kind))) where.push(sql`kind = ${q.kind}`);
  // The method filter lists each code as its own parameter (never one array parameter: drizzle would spread it into a tuple).
  if (q.method) where.push(sql`method in (${sql.join(TX_METHOD_GROUP_CODES[q.method].map((c) => sql`${c}`), sql`, `)})`);
  const whereSql = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  const r = await db.execute<TransactionRow>(sql`select * from (
      select case when p.method = 'WALLET' then 'WALLET_SPEND' when p.order_id is not null then 'ORDER_PAYMENT' else 'DEAL_PAYMENT' end kind, p.id::text id,
             coalesce('#' || o.number::text, 'D-' || d.number::text) ref, u.full_name party, coalesce(p.confirmed_amount, p.amount_due) amount, p.status, p.updated_at::text at,
             '/admin/payments/' || p.id href, p.method method
        from payments p join users u on u.id = p.payer_user_id left join orders o on o.id = p.order_id left join external_deals d on d.id = p.deal_id
      union all
      select 'SPEND_REVERSAL', e.id::text, 'J-' || je.seq::text, u.full_name, e.amount, 'POSTED', e.created_at::text, '/admin/ledger', 'WALLET'
        from customer_wallet_entries e join users u on u.id = e.user_id join journal_entries je on je.id = e.journal_entry_id where e.kind = 'SPEND_REVERSAL'
      union all
      select 'WITHDRAWAL', w.id::text, 'W-' || w.number::text, st.name, w.amount, w.status, w.updated_at::text, '/admin/withdrawals', null from withdrawal_requests w left join stores st on st.seller_id = w.seller_id
      union all
      select 'REFUND', rf.id::text, 'R-' || rf.number::text, u.full_name, rf.amount, rf.status, rf.updated_at::text, '/admin/refunds', case when rf.destination_snapshot ->> 'method' = 'WALLET' then 'WALLET' else null end from refunds rf join users u on u.id = rf.customer_id
      union all
      select 'DEAL_PAYOUT', dp.id::text, 'D-' || d.number::text, u.full_name, dp.amount, dp.status, dp.created_at::text, '/admin/refunds', null from deal_payouts dp join external_deals d on d.id = dp.deal_id left join users u on u.id = dp.payee_user_id
      ${topups}
    ) t ${whereSql} order by at desc limit ${q.limit ?? 200}`);
  return r.rows.map((x) => ({ ...x, amount: Number(x.amount) }));
}
