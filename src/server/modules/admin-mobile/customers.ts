import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { addresses, disputes, externalDeals, governorates, orders, productReviews, returns, supportTickets, users } from '@/server/db/schema';
import { requirePermission, type Actor } from '@/server/core/actor';
import { notFound } from '@/server/core/errors';

/**
 * Admin App — customer search and 360 (PKG-I02-04, READ-ONLY). Mobile mirror of the console
 * /admin/customers pages, permission customers.view enforced HERE. Contact data is masked on mobile
 * (email/phone shown as hints with their verified flags); names stay visible so support can identify a
 * customer they deliberately opened. Status changes stay on the web console (customers.manage) — no
 * mutation exists in this module. Full street addresses and audit IPs are not exposed on mobile.
 */

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `${'*'.repeat(Math.max(phone.length - 2, 3))}${phone.slice(-2)}`;
}

export async function customersSearch(actor: Actor, opts: { q?: string; page: number }) {
  requirePermission(actor, 'customers.view');
  const pageSize = 25;
  const q = opts.q?.trim();
  const conds: SQL[] = [eq(users.isStaff, false)];
  if (q) {
    const safe = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(users.fullName, safe), ilike(users.email, safe), ilike(users.phone, safe))!);
  }
  const rows = await db
    .select({
      u: users,
      // Qualified on purpose: inside a select, ${users.id} renders as a bare "id" and the subquery would compare
      // orders.customer_id with orders.id (always 0).
      orderCount: sql<number>`(select count(*)::int from orders o where o.customer_id = "users"."id")`,
    })
    .from(users)
    .where(and(...conds))
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset((opts.page - 1) * pageSize);
  return {
    items: rows.map((r) => ({
      id: r.u.id,
      name: r.u.fullName,
      email: maskEmail(r.u.email),
      phone: maskPhone(r.u.phone),
      status: r.u.status as string,
      orderCount: r.orderCount,
      createdAt: r.u.createdAt?.toISOString() ?? null,
    })),
    page: opts.page,
    hasMore: rows.length === pageSize,
  };
}

export async function customer360ForStaff(actor: Actor, userId: string) {
  requirePermission(actor, 'customers.view');
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.isStaff) throw notFound('العميل');
  const count = async (n: Promise<{ n: number }[]>) => (await n)[0].n;
  const [addr, ords, ordersCount, returnsCount, disputesCount, ticketsCount, dealsCount, reviewsCount] = await Promise.all([
    db
      .select({ gov: governorates.nameAr, city: addresses.city })
      .from(addresses)
      .innerJoin(governorates, eq(governorates.id, addresses.governorateId))
      .where(and(eq(addresses.userId, userId), isNull(addresses.archivedAt))),
    db
      .select({ id: orders.id, number: orders.number, status: orders.status, grandTotal: orders.grandTotal, placedAt: orders.placedAt })
      .from(orders)
      .where(eq(orders.customerId, userId))
      .orderBy(desc(orders.placedAt))
      .limit(10),
    count(db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.customerId, userId))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(returns).where(eq(returns.customerId, userId))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(disputes).where(or(eq(disputes.claimantUserId, userId), eq(disputes.respondentUserId, userId)))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(supportTickets).where(eq(supportTickets.requesterUserId, userId))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(externalDeals).where(or(eq(externalDeals.buyerId, userId), eq(externalDeals.sellerUserId, userId)))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(productReviews).where(eq(productReviews.customerId, userId))),
  ]);
  return {
    id: u.id,
    name: u.fullName,
    email: maskEmail(u.email),
    emailVerified: u.emailVerifiedAt != null,
    phone: maskPhone(u.phone),
    phoneVerified: u.phoneVerifiedAt != null,
    status: u.status as string,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    addresses: addr.map((a) => `${a.gov}، ${a.city}`),
    counts: { orders: ordersCount, returns: returnsCount, disputes: disputesCount, supportTickets: ticketsCount, deals: dealsCount, reviews: reviewsCount },
    recentOrders: ords.map((o) => ({
      id: o.id,
      number: String(o.number),
      status: o.status as string,
      grandTotal: o.grandTotal,
      placedAt: o.placedAt?.toISOString() ?? null,
    })),
    createdAt: u.createdAt?.toISOString() ?? null,
  };
}
