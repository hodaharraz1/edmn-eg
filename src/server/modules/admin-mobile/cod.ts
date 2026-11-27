import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { requirePermission, type Actor } from '@/server/core/actor';
import { db } from '@/server/db/client';
import { codRemittanceShortfalls, orders, payments, sellerOrders, users } from '@/server/db/schema';
import { maskName } from './monitoring';

/**
 * Admin App: COD monitor (PKG-ADMIN-03). READ-ONLY. Two lists:
 *  - `awaiting`: COD payments the customer confirmed as received (COD_COLLECTED) that the courier statement has not
 *    been recorded for yet, with the amount the courier is expected to remit.
 *  - `shortfalls`: remittances recorded below the expected amount and still OPEN.
 * Permission is `payments.view`, the same as the web payments page. Recording a remittance and settling a shortfall
 * are NOT exposed here: they stay on the web console behind the two-person rule. Customer names are masked.
 * Amounts are server piastres; the device never computes them.
 */
const PAGE_SIZE = 30;

export type CodMonitorTab = 'awaiting' | 'shortfalls';

export async function codMonitor(actor: Actor, opts: { tab: CodMonitorTab; page: number }) {
  requirePermission(actor, 'payments.view');
  const offset = (opts.page - 1) * PAGE_SIZE;
  if (opts.tab === 'shortfalls') {
    const rows = await db
      .select({ s: codRemittanceShortfalls, orderId: payments.orderId, orderNumber: orders.number, customerName: users.fullName })
      .from(codRemittanceShortfalls)
      .innerJoin(payments, eq(payments.id, codRemittanceShortfalls.paymentId))
      .leftJoin(orders, eq(orders.id, payments.orderId))
      .leftJoin(users, eq(users.id, payments.payerUserId))
      .where(eq(codRemittanceShortfalls.status, 'OPEN'))
      .orderBy(desc(codRemittanceShortfalls.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset);
    return {
      tab: opts.tab,
      items: rows.map((x) => ({
        id: x.s.id,
        paymentId: x.s.paymentId,
        orderNumber: x.orderNumber === null ? null : String(x.orderNumber),
        customer: maskName(x.customerName),
        status: x.s.status as string,
        expectedAmount: x.s.expectedAmount,
        actualAmount: x.s.actualAmount as number | null,
        shortfallAmount: x.s.shortfallAmount,
        statementRef: x.s.statementRef as string | null,
        at: x.s.createdAt?.toISOString() ?? null,
      })),
      page: opts.page,
      hasMore: rows.length === PAGE_SIZE,
    };
  }
  const rows = await db
    .select({ p: payments, orderNumber: orders.number, codFee: orders.codFee, customerName: users.fullName })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(users, eq(users.id, payments.payerUserId))
    .where(and(eq(payments.method, 'COD'), eq(payments.status, 'COD_COLLECTED')))
    .orderBy(desc(payments.updatedAt))
    .limit(PAGE_SIZE)
    .offset(offset);
  const orderIds = rows.map((r) => r.p.orderId).filter((x): x is string => !!x);
  const sums = orderIds.length
    ? await db
        .select({ orderId: sellerOrders.orderId, gross: sql<string>`coalesce(sum(${sellerOrders.grossTotal}), 0)::text` })
        .from(sellerOrders)
        .where(and(inArray(sellerOrders.orderId, orderIds), inArray(sellerOrders.status, ['DELIVERED', 'COMPLETED'])))
        .groupBy(sellerOrders.orderId)
    : [];
  const gross = new Map(sums.map((s) => [s.orderId, Number(s.gross)]));
  return {
    tab: opts.tab,
    items: rows.map((x) => ({
      id: x.p.id,
      paymentId: x.p.id,
      orderNumber: String(x.orderNumber),
      customer: maskName(x.customerName),
      status: x.p.status as string,
      // Same formula as the web payment page: delivered sub-orders the courier collected + the COD fee.
      expectedAmount: (gross.get(x.p.orderId as string) ?? 0) + (x.codFee ?? 0),
      actualAmount: null as number | null,
      shortfallAmount: null as number | null,
      statementRef: null as string | null,
      at: x.p.updatedAt?.toISOString() ?? null,
    })),
    page: opts.page,
    hasMore: rows.length === PAGE_SIZE,
  };
}
