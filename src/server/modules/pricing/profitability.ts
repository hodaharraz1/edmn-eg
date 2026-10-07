import { sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, type Actor } from '@/server/core/actor';
import { validation } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { COST_BEARERS, COST_NATURES, COST_TYPES, transactionCosts, type PricingAssumptions } from '@/server/db/schema';
import { DEFAULT_ASSUMPTIONS } from './validation';

/**
 * Transaction economics / contribution (management accounting — NOT company net profit, NOT cash):
 *   Gross EDMN revenue  = buyer fee + seller fee − fee reversals on approved refunds
 *   Direct costs        = ACTUAL costs borne by EDMN (transfer, refund, return, dispute, provider…)
 *   Estimates           = reserves/provisions from the snapshotted assumptions (refund, dispute,
 *                         operational, fraud on GMV; tax provision on revenue) — clearly ESTIMATE
 *   Net contribution    = revenue − actual direct costs − estimates
 *   Contribution margin = net / revenue (undefined when revenue = 0)
 */
export interface EconomicsRow {
  model: 'MARKETPLACE' | 'PROTECTED_DEAL';
  id: string;
  ref: string;
  date: string;
  sellerId: string | null;
  sellerName: string | null;
  economicClass: string | null;
  pricingVersionNo: number | null;
  pricingSource: string;
  gmv: number;
  buyerFee: number;
  sellerFee: number;
  feeReversals: number;
  grossRevenue: number;
  actualCosts: number;
  estimatedReserves: number;
  taxProvision: number;
  netContribution: number;
  marginBps: number | null;
  refunded: boolean;
  disputed: boolean;
  tier: string;
}

const bps = (a: number, b: number) => Math.floor((a * b + 5000) / 10000);

function tierOf(base: number) {
  if (base <= 500_000) return '≤ 5,000';
  if (base <= 2_500_000) return '5,000 – 25,000';
  if (base <= 10_000_000) return '25,000 – 100,000';
  return '> 100,000';
}

function estimate(assumptions: PricingAssumptions | null, gmv: number, revenue: number) {
  const a = assumptions ?? DEFAULT_ASSUMPTIONS;
  return {
    reserves: bps(gmv, a.refundReserveBps + a.disputeReserveBps + a.operationalReserveBps + a.fraudReserveBps),
    tax: bps(Math.max(revenue, 0), a.taxProvisionBps),
  };
}

export async function economics(range: { from: Date; to: Date }): Promise<EconomicsRow[]> {
  const so = await db.execute<{
    id: string; ref: string; paid_at: string; seller_id: string; store: string | null; gmv: string; buyer_fee: string; seller_fee: string; commission: string;
    pricing_source: string; version_no: number | null; snapshot: { assumptions?: PricingAssumptions; groups?: { economicClass: string; base: number }[] } | null;
    reversals: string; costs: string; refunded: boolean; disputed: boolean;
  }>(sql`
    select so.id, o.number::text || '-' || so.suffix ref, so.paid_at::text paid_at, so.seller_id, st.name store,
      (so.merchandise_subtotal - so.discount_total)::text gmv, so.buyer_fee_total::text buyer_fee, so.seller_fee_total::text seller_fee, so.commission_total::text commission,
      so.pricing_source, pv.version_no, so.pricing_snapshot snapshot,
      coalesce((select sum(r.buyer_fee_refund + r.seller_fee_reversal) from refunds r where r.seller_order_id = so.id and r.approval_id is not null and r.status not in ('REJECTED','CANCELLED')), 0)::text reversals,
      coalesce((select sum(c.amount) from transaction_costs c where c.borne_by = 'EDMN' and c.nature = 'ACTUAL' and ((c.entity_type = 'seller_order' and c.entity_id = so.id::text)
        or (c.entity_type = 'refund' and c.entity_id in (select r.id::text from refunds r where r.seller_order_id = so.id)))), 0)::text costs,
      exists (select 1 from refunds r where r.seller_order_id = so.id and r.status not in ('REJECTED','CANCELLED')) refunded,
      exists (select 1 from disputes d where d.seller_order_id = so.id) disputed
    from seller_orders so join orders o on o.id = so.order_id left join stores st on st.seller_id = so.seller_id left join pricing_versions pv on pv.id = so.pricing_version_id
    where so.paid_at is not null and so.paid_at >= ${range.from.toISOString()} and so.paid_at < ${range.to.toISOString()}
    order by so.paid_at desc limit 5000`);
  const deals = await db.execute<{
    id: string; ref: string; paid_at: string; seller_user_id: string | null; seller_name: string | null; gmv: string; buyer_fee: string; seller_fee: string; fee: string;
    pricing_source: string; version_no: number | null; snapshot: { assumptions?: PricingAssumptions } | null; reversals: string; costs: string; refunded: boolean; disputed: boolean;
  }>(sql`
    select d.id, 'صفقة #' || d.number::text ref, d.activated_at::text paid_at, d.seller_user_id, d.seller_full_name seller_name,
      coalesce(d.unit_price * d.quantity, d.total_amount, 0)::text gmv, d.buyer_fee_amount::text buyer_fee, d.seller_fee_amount::text seller_fee, d.fee_amount::text fee,
      d.pricing_source, pv.version_no, d.pricing_snapshot snapshot,
      case when d.status = 'REFUNDED' then d.fee_amount else 0 end::text reversals,
      coalesce((select sum(c.amount) from transaction_costs c where c.borne_by = 'EDMN' and c.nature = 'ACTUAL' and c.entity_type = 'external_deal' and c.entity_id = d.id::text), 0)::text costs,
      d.status in ('REFUNDED') refunded,
      exists (select 1 from disputes x where x.deal_id = d.id) disputed
    from external_deals d left join pricing_versions pv on pv.id = d.pricing_version_id
    where d.activated_at is not null and d.activated_at >= ${range.from.toISOString()} and d.activated_at < ${range.to.toISOString()}
    order by d.activated_at desc limit 5000`);
  const out: EconomicsRow[] = [];
  for (const r of so.rows) {
    const legacy = r.pricing_source !== 'ENGINE';
    const commission = Number(r.commission);
    // Legacy snapshots: the stored commission is authoritative (borne by the seller unless split).
    const buyerFee = Number(r.buyer_fee);
    const sellerFee = legacy && buyerFee + Number(r.seller_fee) !== commission ? commission - buyerFee : Number(r.seller_fee);
    const gmv = Number(r.gmv);
    const revenue = buyerFee + sellerFee - Number(r.reversals);
    const est = estimate(r.snapshot?.assumptions ?? null, gmv, revenue);
    const actual = Number(r.costs);
    const net = revenue - actual - est.reserves - est.tax;
    const groups = r.snapshot?.groups ?? [];
    const cls = groups.length === 1 ? groups[0].economicClass : groups.length > 1 ? 'MIXED' : null;
    out.push({ model: 'MARKETPLACE', id: r.id, ref: r.ref, date: r.paid_at, sellerId: r.seller_id, sellerName: r.store, economicClass: cls, pricingVersionNo: r.version_no, pricingSource: r.pricing_source, gmv, buyerFee, sellerFee, feeReversals: Number(r.reversals), grossRevenue: revenue, actualCosts: actual, estimatedReserves: est.reserves, taxProvision: est.tax, netContribution: net, marginBps: revenue > 0 ? Math.round((net * 10000) / revenue) : null, refunded: r.refunded, disputed: r.disputed, tier: tierOf(gmv) });
  }
  for (const r of deals.rows) {
    const legacy = r.pricing_source !== 'ENGINE';
    const fee = Number(r.fee);
    const buyerFee = legacy ? 0 : Number(r.buyer_fee);
    const sellerFee = legacy ? fee : Number(r.seller_fee);
    const gmv = Number(r.gmv);
    const revenue = buyerFee + sellerFee - Number(r.reversals);
    const est = estimate(r.snapshot?.assumptions ?? null, gmv, revenue);
    const actual = Number(r.costs);
    const net = revenue - actual - est.reserves - est.tax;
    out.push({ model: 'PROTECTED_DEAL', id: r.id, ref: r.ref, date: r.paid_at, sellerId: r.seller_user_id, sellerName: r.seller_name, economicClass: 'DEAL', pricingVersionNo: r.version_no, pricingSource: r.pricing_source, gmv, buyerFee, sellerFee, feeReversals: Number(r.reversals), grossRevenue: revenue, actualCosts: actual, estimatedReserves: est.reserves, taxProvision: est.tax, netContribution: net, marginBps: revenue > 0 ? Math.round((net * 10000) / revenue) : null, refunded: r.refunded, disputed: r.disputed, tier: tierOf(gmv) });
  }
  return out;
}

export interface Kpis {
  count: number;
  gmv: number;
  buyerFees: number;
  sellerFees: number;
  feeReversals: number;
  grossRevenue: number;
  actualCosts: number;
  payoutCostsEdmn: number;
  estimatedReserves: number;
  taxProvision: number;
  netContribution: number;
  marginBps: number | null;
  avgFeeBps: number | null;
  avgFee: number | null;
  refundRateBps: number | null;
  disputeRateBps: number | null;
  lossMaking: number;
  belowTarget: number;
}

export function kpis(rows: EconomicsRow[], targetBps = 5000, payoutCostsEdmn = 0): Kpis {
  const sum = (f: (r: EconomicsRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const revenue = sum((r) => r.grossRevenue);
  const net = sum((r) => r.netContribution) - payoutCostsEdmn;
  const gmv = sum((r) => r.gmv);
  const n = rows.length;
  return {
    count: n,
    gmv,
    buyerFees: sum((r) => r.buyerFee),
    sellerFees: sum((r) => r.sellerFee),
    feeReversals: sum((r) => r.feeReversals),
    grossRevenue: revenue,
    actualCosts: sum((r) => r.actualCosts),
    payoutCostsEdmn,
    estimatedReserves: sum((r) => r.estimatedReserves),
    taxProvision: sum((r) => r.taxProvision),
    netContribution: net,
    marginBps: revenue > 0 ? Math.round((net * 10000) / revenue) : null,
    avgFeeBps: gmv > 0 ? Math.round((sum((r) => r.buyerFee + r.sellerFee) * 10000) / gmv) : null,
    avgFee: n ? Math.round(sum((r) => r.buyerFee + r.sellerFee) / n) : null,
    refundRateBps: n ? Math.round((rows.filter((r) => r.refunded).length * 10000) / n) : null,
    disputeRateBps: n ? Math.round((rows.filter((r) => r.disputed).length * 10000) / n) : null,
    lossMaking: rows.filter((r) => r.netContribution < 0).length,
    belowTarget: rows.filter((r) => r.marginBps !== null && r.marginBps < targetBps).length,
  };
}

/** Payout transfer costs borne by EDMN in the period (seller-borne costs are not EDMN costs). */
export async function edmnPayoutCosts(range: { from: Date; to: Date }) {
  const r = await db.execute<{ total: string }>(sql`select coalesce(sum(amount), 0)::text total from transaction_costs
    where entity_type = 'withdrawal' and borne_by = 'EDMN' and nature = 'ACTUAL' and created_at >= ${range.from.toISOString()} and created_at < ${range.to.toISOString()}`);
  return Number(r.rows[0].total);
}

export function groupBy(rows: EconomicsRow[], key: (r: EconomicsRow) => string, targetBps = 5000) {
  const m = new Map<string, EconomicsRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].map(([k, rs]) => ({ key: k, ...kpis(rs, targetBps) })).sort((a, b) => b.grossRevenue - a.grossRevenue);
}

/** Finance records an ACTUAL (or ESTIMATE) direct cost on a transaction. Append-only, audited. */
export async function recordCost(actor: Actor, input: { entityType: 'seller_order' | 'external_deal' | 'refund' | 'withdrawal'; entityId: string; costType: string; nature: string; borneBy: string; amount: number; notes: string; reference?: string }) {
  requirePermission(actor, 'finance.controls');
  requireStepUp(actor);
  if (!(COST_TYPES as readonly string[]).includes(input.costType) || !(COST_NATURES as readonly string[]).includes(input.nature) || !(COST_BEARERS as readonly string[]).includes(input.borneBy)) throw validation('بيانات التكلفة غير صالحة');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw validation('المبلغ غير صالح');
  if (!input.notes || input.notes.trim().length < 3) throw validation('اكتب ملاحظة/سبب');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(transactionCosts)
      .values({ entityType: input.entityType, entityId: input.entityId, costType: input.costType as never, nature: input.nature as never, borneBy: input.borneBy as never, amount: input.amount, notes: input.notes.trim(), reference: input.reference ?? null, createdBy: actor.userId })
      .returning();
    await audit(tx, actor, { action: 'profitability.cost_recorded', entityType: input.entityType, entityId: input.entityId, newValues: { ...row } as Record<string, unknown>, reason: input.notes });
    return row;
  });
}
