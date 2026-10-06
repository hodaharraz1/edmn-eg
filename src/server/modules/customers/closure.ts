import { and, desc, eq, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, invalidState, notFound } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { accountClosureRequests, addresses, sessions, users } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';

export const CLOSURE_BLOCKED_MESSAGE =
  'مش هينفع تقفل حسابك دلوقتي لأن عندك عمليات أو مستحقات لسه مفتوحة. خلّص العمليات الأول وبعدها تقدر تطلب إغلاق الحساب.';

const BLOCKER_LABELS: Record<string, string> = {
  OPEN_ORDERS: 'طلبات شراء لسه مفتوحة',
  PAYMENT_REVIEW: 'دفع قيد المراجعة',
  OPEN_RETURNS: 'طلبات إرجاع مفتوحة',
  OPEN_REFUNDS: 'استردادات لسه ما اتصرفتش',
  OPEN_DISPUTES: 'نزاعات مفتوحة',
  ACTIVE_DEALS: 'صفقات محمية مفتوحة',
  PENDING_DEAL_PAYOUTS: 'مستحقات صفقات لسه ما اتصرفتش',
  SELLER_OPEN_ORDERS: 'طلبات على متجرك لسه مفتوحة',
  SELLER_OPEN_RETURNS: 'مرتجعات على متجرك مفتوحة',
  OPEN_WITHDRAWALS: 'طلبات سحب مفتوحة',
  NON_ZERO_BALANCE: 'رصيد (معلق/متاح/محجوز/مديونية) لا يساوي صفر',
  FINANCIAL_HOLD: 'تجميد مالي قائم',
  ACTIVE_STORE: 'المتجر لسه نشط (لازم يتوقف من فريق اضمن الأول)',
  STAFF_ACCOUNT: 'حسابات فريق العمل لا تُغلق من هنا',
};
export const closureBlockerLabel = (code: string) => BLOCKER_LABELS[code] ?? code;

/**
 * Every open obligation of a user — as buyer, deal party and store owner. Positive, negative, pending,
 * available and reserved balances all block. Used by the UI, the request, the Admin completion and
 * any anonymisation path (the same function everywhere).
 */
export async function closureBlockers(conn: DbOrTx, userId: string): Promise<{ code: string; count: number }[]> {
  const r = await conn.execute<{ code: string; n: string }>(sql`
    select 'STAFF_ACCOUNT' code, count(*)::text n from users where id = ${userId} and is_staff
    union all select 'OPEN_ORDERS', count(*)::text from seller_orders so join orders o on o.id = so.order_id
      where o.customer_id = ${userId} and so.status not in ('COMPLETED','CANCELLED','DELIVERY_FAILED')
    union all select 'PAYMENT_REVIEW', count(*)::text from payments where payer_user_id = ${userId} and status in ('AWAITING_PAYMENT','PAYMENT_SUBMITTED','UNDER_REVIEW')
    union all select 'OPEN_RETURNS', count(*)::text from returns where customer_id = ${userId} and status not in ('REFUNDED','REJECTED')
    union all select 'OPEN_REFUNDS', count(*)::text from refunds where customer_id = ${userId} and status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','FAILED','PENDING')
    union all select 'OPEN_DISPUTES', count(*)::text from disputes where (claimant_user_id = ${userId} or respondent_user_id = ${userId}) and status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')
    union all select 'ACTIVE_DEALS', count(*)::text from external_deals where (buyer_id = ${userId} or seller_user_id = ${userId}) and status not in ('DRAFT','COMPLETED','CANCELLED','REFUNDED')
    union all select 'PENDING_DEAL_PAYOUTS', count(*)::text from deal_payouts where payee_user_id = ${userId} and status = 'PENDING'
    union all select 'SELLER_OPEN_ORDERS', count(*)::text from seller_orders so join sellers s on s.id = so.seller_id
      where s.owner_user_id = ${userId} and so.status not in ('COMPLETED','CANCELLED','DELIVERY_FAILED','PENDING_PAYMENT')
    union all select 'SELLER_OPEN_RETURNS', count(*)::text from returns r join sellers s on s.id = r.seller_id where s.owner_user_id = ${userId} and r.status not in ('REFUNDED','REJECTED')
    union all select 'OPEN_WITHDRAWALS', count(*)::text from withdrawal_requests w join sellers s on s.id = w.seller_id
      where s.owner_user_id = ${userId} and w.status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING')
    union all select 'NON_ZERO_BALANCE', count(*)::text from ledger_accounts a join sellers s on s.id = a.seller_id where s.owner_user_id = ${userId} and a.balance <> 0
    union all select 'FINANCIAL_HOLD', count(*)::text from seller_orders so join sellers s on s.id = so.seller_id where s.owner_user_id = ${userId} and so.financial_hold and so.funds_released_at is null
    union all select 'ACTIVE_STORE', count(*)::text from sellers where owner_user_id = ${userId} and status in ('APPROVED','RESTRICTED','PENDING_REVIEW','MORE_INFO_REQUIRED')`);
  return r.rows.filter((x) => Number(x.n) > 0).map((x) => ({ code: x.code, count: Number(x.n) }));
}

/** Serializes closure against new orders / payments / withdrawals of the same account (same lock as checkout). */
export async function lockAccount(tx: DbOrTx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'account:' + userId}))`);
}

/** Buyer / seller asks to close the account. Blocked (recorded with reasons) while anything is open. */
export async function requestAccountClosure(actor: Actor, reason?: string) {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    await lockAccount(tx, userId);
    const [open] = await tx.select().from(accountClosureRequests).where(and(eq(accountClosureRequests.userId, userId), eq(accountClosureRequests.status, 'PENDING')));
    if (open) return { status: 'PENDING' as const, blockers: [], requestId: open.id };
    const blockers = await closureBlockers(tx, userId);
    const status = blockers.length ? ('BLOCKED' as const) : ('PENDING' as const);
    const [row] = await tx.insert(accountClosureRequests).values({ userId, status, blockers, reason: reason?.trim() || null }).returning();
    await audit(tx, actor, { action: blockers.length ? 'account.closure_blocked' : 'account.closure_requested', entityType: 'user', entityId: userId, newValues: { requestId: row.id, blockers } });
    return { status, blockers, requestId: row.id };
  });
}

export async function withdrawAccountClosure(actor: Actor) {
  const userId = requireUser(actor);
  await db.transaction(async (tx) => {
    await lockAccount(tx, userId);
    await tx.update(accountClosureRequests).set({ status: 'WITHDRAWN' }).where(and(eq(accountClosureRequests.userId, userId), eq(accountClosureRequests.status, 'PENDING')));
    await audit(tx, actor, { action: 'account.closure_withdrawn', entityType: 'user', entityId: userId });
  });
}

/**
 * Operations completes a pending closure. All guards are re-checked at the closure commit under the
 * account lock. The account is deactivated and its directory PII pseudonymised; orders, payments,
 * ledger, refunds, withdrawals, disputes, messages, audit and evidence are kept (retention conflicts are
 * escalated for legal review — nothing financial is deleted).
 */
export async function completeAccountClosure(actor: Actor, requestId: string) {
  requirePermission(actor, 'customers.manage');
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(accountClosureRequests).where(eq(accountClosureRequests.id, requestId)).for('update');
    if (!req) throw notFound('طلب الإغلاق');
    if (req.status !== 'PENDING') throw invalidState('الطلب ده مش قيد التنفيذ');
    if (req.userId === actor.userId) throw forbidden('لا يمكنك إغلاق حسابك من لوحة الإدارة');
    await lockAccount(tx, req.userId);
    const blockers = await closureBlockers(tx, req.userId);
    if (blockers.length) {
      await tx.update(accountClosureRequests).set({ status: 'BLOCKED', blockers, decidedBy: actor.userId }).where(eq(accountClosureRequests.id, req.id));
      await audit(tx, actor, { action: 'account.closure_blocked', entityType: 'user', entityId: req.userId, newValues: { blockers } });
      return { closed: false, blockers };
    }
    const now = new Date();
    const [u] = await tx.select().from(users).where(eq(users.id, req.userId)).for('update');
    await tx
      .update(users)
      .set({ status: 'CLOSED', closedAt: now, anonymizedAt: now, fullName: 'حساب مغلق', email: null, phone: null, totpSecretEnc: null })
      .where(eq(users.id, req.userId));
    await tx.update(addresses).set({ archivedAt: now }).where(eq(addresses.userId, req.userId));
    await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, req.userId));
    await tx.update(accountClosureRequests).set({ status: 'COMPLETED', completedAt: now, decidedBy: actor.userId }).where(eq(accountClosureRequests.id, req.id));
    await audit(tx, actor, {
      action: 'account.closed',
      entityType: 'user',
      entityId: req.userId,
      oldValues: { status: u.status, hadEmail: !!u.email, hadPhone: !!u.phone },
      newValues: { status: 'CLOSED', pseudonymised: ['full_name', 'email', 'phone', 'addresses'], retained: ['orders', 'payments', 'ledger', 'refunds', 'withdrawals', 'disputes', 'messages', 'audit', 'evidence'] },
    });
    return { closed: true, blockers: [] };
  });
}

export async function latestClosureRequest(userId: string) {
  const [r] = await db.select().from(accountClosureRequests).where(eq(accountClosureRequests.userId, userId)).orderBy(desc(accountClosureRequests.createdAt)).limit(1);
  return r ?? null;
}

export async function pendingClosures(limit = 50, offset = 0) {
  return db
    .select({ r: accountClosureRequests, fullName: users.fullName, email: users.email })
    .from(accountClosureRequests)
    .innerJoin(users, eq(users.id, accountClosureRequests.userId))
    .where(eq(accountClosureRequests.status, 'PENDING'))
    .orderBy(accountClosureRequests.createdAt, accountClosureRequests.id)
    .limit(limit)
    .offset(offset);
}

export async function notifyClosure(tx: DbOrTx, userId: string, status: string) {
  await notify(tx, { event: 'ACCOUNT_CLOSURE', userIds: [userId], vars: { status }, link: '/account' });
}
