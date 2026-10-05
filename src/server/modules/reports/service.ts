import { sql } from 'drizzle-orm';
import { requirePermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { sellerBalances } from '@/server/modules/finance/ledger';

const n = (v: unknown) => Number(v ?? 0);

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeFromPreset(preset: string | undefined): DateRange {
  const to = new Date();
  const days = preset === 'today' ? 0 : preset === '7d' ? 7 : preset === '90d' ? 90 : preset === '365d' ? 365 : 30;
  const from = new Date(to);
  if (days === 0) from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - days);
  return { from, to };
}

/** Executive KPIs from real aggregates (indexed by status/date columns). */
export async function adminDashboard(actor: Actor, range: DateRange) {
  requirePermission(actor, 'dashboard.view');
  const r = await db.execute<Record<string, string>>(sql`
    with paid as (select * from orders where paid_at between ${range.from} and ${range.to})
    select
      (select coalesce(sum(grand_total),0) from paid) as gmv,
      (select count(*) from orders where placed_at between ${range.from} and ${range.to}) as orders_total,
      (select count(*) from paid) as orders_paid,
      (select coalesce(avg(grand_total),0) from paid) as aov,
      (select count(*) from external_deals where created_at between ${range.from} and ${range.to} and status <> 'DRAFT') as deals,
      (select coalesce(sum(total_amount),0) from external_deals where activated_at between ${range.from} and ${range.to}) as deals_value,
      (select coalesce(sum(l.credit - l.debit),0) from journal_lines l join ledger_accounts a on a.id = l.account_id
         where a.code in ('COMMISSION_REVENUE','DEAL_FEE_REVENUE') and l.created_at between ${range.from} and ${range.to}) as revenue,
      (select count(distinct customer_id) from paid) as active_buyers,
      (select count(distinct so.seller_id) from seller_orders so where so.paid_at between ${range.from} and ${range.to}) as active_sellers,
      (select count(*) from sellers where status = 'PENDING_REVIEW') as pending_sellers,
      (select count(*) from products where status in ('SUBMITTED','UNDER_REVIEW')) +
        (select count(*) from product_revisions where status = 'SUBMITTED') as pending_products,
      (select count(*) from payments where status in ('PAYMENT_SUBMITTED','UNDER_REVIEW')) as pending_payments,
      (select count(*) from withdrawal_requests where status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING')) as pending_withdrawals,
      (select coalesce(sum(amount),0) from withdrawal_requests where status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING')) as pending_withdrawals_amount,
      (select count(*) from refunds where status = 'PENDING') as pending_refunds,
      (select count(*) from disputes where status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')) as open_disputes,
      (select count(*) from support_tickets where status not in ('RESOLVED','CLOSED')) as open_tickets,
      (select count(*) from seller_orders where status = 'SHIPPED' and delivery_follow_up_flagged_at is not null) as unconfirmed_deliveries,
      (select count(*) from returns where created_at between ${range.from} and ${range.to}) as returns_count,
      (select count(*) from seller_orders where paid_at between ${range.from} and ${range.to}) as seller_orders_paid,
      (select count(*) from disputes where created_at between ${range.from} and ${range.to}) as disputes_count
  `);
  const k = r.rows[0];
  const soPaid = n(k.seller_orders_paid);
  const [topCategories, topSellers, topProducts, daily] = await Promise.all([
    db.execute<{ name: string; gmv: string; units: string }>(sql`
      select c.name_ar as name, sum(oi.line_total) as gmv, sum(oi.quantity) as units
      from order_items oi join seller_orders so on so.id = oi.seller_order_id
      join categories c on c.id = oi.category_id_snapshot
      where so.paid_at between ${range.from} and ${range.to} and so.status <> 'CANCELLED'
      group by c.name_ar order by gmv desc limit 8`),
    db.execute<{ name: string; gmv: string; orders: string }>(sql`
      select st.name, sum(so.gross_total) as gmv, count(*) as orders
      from seller_orders so join stores st on st.seller_id = so.seller_id
      where so.paid_at between ${range.from} and ${range.to} and so.status <> 'CANCELLED'
      group by st.name order by gmv desc limit 8`),
    db.execute<{ name: string; gmv: string; units: string }>(sql`
      select oi.title_snapshot as name, sum(oi.line_total) as gmv, sum(oi.quantity) as units
      from order_items oi join seller_orders so on so.id = oi.seller_order_id
      where so.paid_at between ${range.from} and ${range.to} and so.status <> 'CANCELLED'
      group by oi.title_snapshot order by gmv desc limit 8`),
    db.execute<{ day: string; gmv: string; orders: string }>(sql`
      select to_char(date_trunc('day', paid_at at time zone 'Africa/Cairo'), 'YYYY-MM-DD') as day, sum(grand_total) as gmv, count(*) as orders
      from orders where paid_at between ${range.from} and ${range.to} group by 1 order by 1`),
  ]);
  return {
    gmv: n(k.gmv),
    ordersTotal: n(k.orders_total),
    ordersPaid: n(k.orders_paid),
    aov: Math.round(n(k.aov)),
    deals: n(k.deals),
    dealsValue: n(k.deals_value),
    revenue: n(k.revenue),
    activeBuyers: n(k.active_buyers),
    activeSellers: n(k.active_sellers),
    pendingSellers: n(k.pending_sellers),
    pendingProducts: n(k.pending_products),
    pendingPayments: n(k.pending_payments),
    pendingWithdrawals: n(k.pending_withdrawals),
    pendingWithdrawalsAmount: n(k.pending_withdrawals_amount),
    pendingRefunds: n(k.pending_refunds),
    openDisputes: n(k.open_disputes),
    openTickets: n(k.open_tickets),
    unconfirmedDeliveries: n(k.unconfirmed_deliveries),
    returnRate: soPaid ? n(k.returns_count) / soPaid : 0,
    disputeRate: soPaid ? n(k.disputes_count) / soPaid : 0,
    topCategories: topCategories.rows.map((x) => ({ name: x.name, gmv: n(x.gmv), units: n(x.units) })),
    topSellers: topSellers.rows.map((x) => ({ name: x.name, gmv: n(x.gmv), orders: n(x.orders) })),
    topProducts: topProducts.rows.map((x) => ({ name: x.name, gmv: n(x.gmv), units: n(x.units) })),
    daily: daily.rows.map((x) => ({ day: x.day, gmv: n(x.gmv), orders: n(x.orders) })),
  };
}

/** Seller Center dashboard metrics (scoped to one seller; indexed on seller_id + status). */
export async function sellerDashboard(sellerId: string, range: DateRange) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const r = await db.execute<Record<string, string>>(sql`
    select
      (select coalesce(sum(gross_total),0) from seller_orders where seller_id = ${sellerId} and paid_at >= ${startOfDay} and status <> 'CANCELLED') as today_sales,
      (select coalesce(sum(gross_total),0) from seller_orders where seller_id = ${sellerId} and paid_at between ${range.from} and ${range.to} and status <> 'CANCELLED') as gross,
      (select coalesce(sum(commission_total),0) from seller_orders where seller_id = ${sellerId} and paid_at between ${range.from} and ${range.to} and status <> 'CANCELLED') as commission,
      (select coalesce(sum(seller_net),0) from seller_orders where seller_id = ${sellerId} and paid_at between ${range.from} and ${range.to} and status <> 'CANCELLED') as net,
      (select coalesce(sum(refunded_total),0) from seller_orders where seller_id = ${sellerId} and paid_at between ${range.from} and ${range.to}) as refunds,
      (select count(*) from seller_orders where seller_id = ${sellerId} and paid_at between ${range.from} and ${range.to}) as orders,
      (select count(*) from seller_orders where seller_id = ${sellerId} and status = 'PAID') as pending_confirmation,
      (select count(*) from seller_orders where seller_id = ${sellerId} and status in ('SELLER_CONFIRMED','PROCESSING')) as processing,
      (select count(*) from seller_orders where seller_id = ${sellerId} and status = 'READY_TO_SHIP') as ready,
      (select count(*) from seller_orders where seller_id = ${sellerId} and status = 'SHIPPED') as shipped,
      (select count(*) from seller_orders where seller_id = ${sellerId} and status = 'CANCELLED' and paid_at between ${range.from} and ${range.to}) as cancelled,
      (select count(*) from returns where seller_id = ${sellerId} and created_at between ${range.from} and ${range.to}) as returns,
      (select count(*) from returns where seller_id = ${sellerId} and status in ('REQUESTED','UNDER_REVIEW','RECEIVED','INSPECTION')) as open_returns,
      (select count(*) from seller_orders so where seller_id = ${sellerId} and shipped_at is not null and paid_at between ${range.from} and ${range.to}
         and so.shipped_at <= so.paid_at + make_interval(days => coalesce(so.processing_days, 2) + 1)) as on_time,
      (select count(*) from seller_orders where seller_id = ${sellerId} and shipped_at is not null and paid_at between ${range.from} and ${range.to}) as shipped_in_range,
      (select count(*) from product_variants v join products p on p.id = v.product_id where p.seller_id = ${sellerId} and p.status in ('LIVE','APPROVED') and v.is_active and v.stock_on_hand - v.reserved <= 0) as out_of_stock,
      (select count(*) from product_variants v join products p on p.id = v.product_id where p.seller_id = ${sellerId} and p.status in ('LIVE','APPROVED') and v.is_active and v.stock_on_hand - v.reserved > 0 and v.stock_on_hand - v.reserved <= v.low_stock_threshold) as low_stock,
      (select rating_avg from sellers where id = ${sellerId}) as rating,
      (select rating_count from sellers where id = ${sellerId}) as rating_count,
      (select count(*) from withdrawal_requests where seller_id = ${sellerId} and status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING')) as withdrawals_open,
      (select coalesce(sum(amount),0) from withdrawal_requests where seller_id = ${sellerId} and status = 'PAID') as paid_out
  `);
  const k = r.rows[0];
  const [daily, top] = await Promise.all([
    db.execute<{ day: string; gross: string; orders: string }>(sql`
      select to_char(date_trunc('day', paid_at at time zone 'Africa/Cairo'), 'YYYY-MM-DD') as day, sum(gross_total) as gross, count(*) as orders
      from seller_orders where seller_id = ${sellerId} and paid_at between ${range.from} and ${range.to} and status <> 'CANCELLED' group by 1 order by 1`),
    db.execute<{ name: string; units: string; gross: string }>(sql`
      select oi.title_snapshot as name, sum(oi.quantity) as units, sum(oi.line_total) as gross
      from order_items oi join seller_orders so on so.id = oi.seller_order_id
      where so.seller_id = ${sellerId} and so.paid_at between ${range.from} and ${range.to} and so.status <> 'CANCELLED'
      group by 1 order by gross desc limit 5`),
  ]);
  const orders = n(k.orders);
  const balances = await sellerBalances(db, sellerId);
  return {
    todaySales: n(k.today_sales),
    gross: n(k.gross),
    commission: n(k.commission),
    net: n(k.net),
    refunds: n(k.refunds),
    orders,
    aov: orders ? Math.round(n(k.gross) / orders) : 0,
    pendingConfirmation: n(k.pending_confirmation),
    processing: n(k.processing),
    ready: n(k.ready),
    shipped: n(k.shipped),
    openReturns: n(k.open_returns),
    cancellationRate: orders ? n(k.cancelled) / orders : 0,
    returnRate: orders ? n(k.returns) / orders : 0,
    onTimeRate: n(k.shipped_in_range) ? n(k.on_time) / n(k.shipped_in_range) : null,
    outOfStock: n(k.out_of_stock),
    lowStock: n(k.low_stock),
    rating: n(k.rating),
    ratingCount: n(k.rating_count),
    withdrawalsOpen: n(k.withdrawals_open),
    paidOut: n(k.paid_out),
    balances,
    daily: daily.rows.map((x) => ({ day: x.day, gross: n(x.gross), orders: n(x.orders) })),
    topProducts: top.rows.map((x) => ({ name: x.name, units: n(x.units), gross: n(x.gross) })),
  };
}

/** CSV with formula-injection protection (cells starting with = + - @ are prefixed). */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export async function exportDataset(actor: Actor, dataset: 'orders' | 'sellers' | 'withdrawals' | 'payments' | 'products', range: DateRange) {
  requirePermission(actor, 'reports.export');
  const money = (v: unknown) => (n(v) / 100).toFixed(2);
  switch (dataset) {
    case 'orders': {
      const r = await db.execute<Record<string, string>>(sql`
        select o.number, o.status, o.placed_at, o.paid_at, o.grand_total, o.shipping_total, o.payment_method, u.full_name, g.name_ar as governorate
        from orders o join users u on u.id = o.customer_id join governorates g on g.id = o.governorate_id
        where o.placed_at between ${range.from} and ${range.to} order by o.placed_at desc limit 50000`);
      return toCsv(['order', 'status', 'placed_at', 'paid_at', 'total_egp', 'shipping_egp', 'payment_method', 'customer', 'governorate'], r.rows.map((x) => [x.number, x.status, x.placed_at, x.paid_at, money(x.grand_total), money(x.shipping_total), x.payment_method, x.full_name, x.governorate]));
    }
    case 'sellers': {
      // National ID data is deliberately excluded from exports.
      const r = await db.execute<Record<string, string>>(sql`
        select s.id, st.name, s.type, s.status, s.legal_name, s.mobile, s.email, s.approved_at, s.rating_avg, s.rating_count
        from sellers s left join stores st on st.seller_id = s.id order by s.created_at desc limit 50000`);
      return toCsv(['seller_id', 'store', 'type', 'status', 'legal_name', 'mobile', 'email', 'approved_at', 'rating', 'ratings'], r.rows.map((x) => [x.id, x.name, x.type, x.status, x.legal_name, x.mobile, x.email, x.approved_at, x.rating_avg, x.rating_count]));
    }
    case 'withdrawals': {
      const r = await db.execute<Record<string, string>>(sql`
        select w.number, st.name, w.amount, w.status, w.payout_type, w.payout_masked, w.created_at, w.sla_due_at, w.paid_at, w.paid_reference
        from withdrawal_requests w join stores st on st.seller_id = w.seller_id
        where w.created_at between ${range.from} and ${range.to} order by w.created_at desc limit 50000`);
      return toCsv(['withdrawal', 'store', 'amount_egp', 'status', 'payout_type', 'payout_masked', 'requested_at', 'sla_due', 'paid_at', 'reference'], r.rows.map((x) => [x.number, x.name, money(x.amount), x.status, x.payout_type, x.payout_masked, x.created_at, x.sla_due_at, x.paid_at, x.paid_reference]));
    }
    case 'payments': {
      const r = await db.execute<Record<string, string>>(sql`
        select p.id, o.number as order_number, d.number as deal_number, p.method, p.amount_due, p.status, p.created_at, p.confirmed_at, u.full_name
        from payments p join users u on u.id = p.payer_user_id left join orders o on o.id = p.order_id left join external_deals d on d.id = p.deal_id
        where p.created_at between ${range.from} and ${range.to} order by p.created_at desc limit 50000`);
      return toCsv(['payment_id', 'order', 'deal', 'method', 'amount_egp', 'status', 'created_at', 'confirmed_at', 'payer'], r.rows.map((x) => [x.id, x.order_number, x.deal_number, x.method, money(x.amount_due), x.status, x.created_at, x.confirmed_at, x.full_name]));
    }
    case 'products': {
      const r = await db.execute<Record<string, string>>(sql`
        select p.slug, p.title_ar, p.status, p.condition, p.min_price, p.total_available, p.sales_count, p.rating_avg, st.name as store, c.name_ar as category
        from products p join stores st on st.seller_id = p.seller_id left join categories c on c.id = p.category_id order by p.created_at desc limit 50000`);
      return toCsv(['slug', 'title', 'status', 'condition', 'price_egp', 'available', 'sold', 'rating', 'store', 'category'], r.rows.map((x) => [x.slug, x.title_ar, x.status, x.condition, money(x.min_price), x.total_available, x.sales_count, x.rating_avg, x.store, x.category]));
    }
  }
}
