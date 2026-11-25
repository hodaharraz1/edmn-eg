import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, requireUser, SYSTEM_ACTOR, type Actor, requireAnyPermission } from '@/server/core/actor';
import { forbidden, invalidState, notFound } from '@/server/core/errors';
import { logger } from '@/server/core/logger';
import { db, type DbOrTx } from '@/server/db/client';
import { accountClosureRequests, addresses, devicePushTokens, files, mobileDevices, pushSubscriptions, sellers, sessions, users } from '@/server/db/schema';
import { storage } from '@/server/storage/storage';
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
    union all select 'OPEN_REFUNDS', count(*)::text from refunds where customer_id = ${userId} and status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','FAILED','TRANSFER_UNCERTAIN','PENDING')
    union all select 'OPEN_DISPUTES', count(*)::text from disputes where (claimant_user_id = ${userId} or respondent_user_id = ${userId}) and status in ('OPEN','UNDER_REVIEW','AWAITING_INFORMATION')
    union all select 'ACTIVE_DEALS', count(*)::text from external_deals where (buyer_id = ${userId} or seller_user_id = ${userId}) and status not in ('DRAFT','COMPLETED','CANCELLED','REFUNDED')
    union all select 'PENDING_DEAL_PAYOUTS', count(*)::text from deal_payouts where payee_user_id = ${userId} and status = 'PENDING'
    union all select 'SELLER_OPEN_ORDERS', count(*)::text from seller_orders so join sellers s on s.id = so.seller_id
      where s.owner_user_id = ${userId} and so.status not in ('COMPLETED','CANCELLED','DELIVERY_FAILED','PENDING_PAYMENT')
    union all select 'SELLER_OPEN_RETURNS', count(*)::text from returns r join sellers s on s.id = r.seller_id where s.owner_user_id = ${userId} and r.status not in ('REFUNDED','REJECTED')
    union all select 'OPEN_WITHDRAWALS', count(*)::text from withdrawal_requests w join sellers s on s.id = w.seller_id
      where s.owner_user_id = ${userId} and w.status in ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','TRANSFER_UNCERTAIN')
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
/**
 * Step 1 (Maker): a staff member asks for a PENDING closure to be executed. Nothing is changed on the account.
 * Needs the same permission and a fresh step-up as the execution. A repeat by the same person is a no-op; a request already
 * made by someone else stays theirs (the Checker is whoever is not the Maker).
 */
export async function requestClosureExecution(actor: Actor, requestId: string) {
  requirePermission(actor, 'customers.manage');
  requireStepUp(actor);
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(accountClosureRequests).where(eq(accountClosureRequests.id, requestId)).for('update');
    if (!req) throw notFound('طلب الإغلاق');
    if (req.status !== 'PENDING') throw invalidState('الطلب ده مش قيد التنفيذ');
    if (req.userId === actor.userId) throw forbidden('لا يمكنك إغلاق حسابك من لوحة الإدارة');
    if (req.executionRequestedBy) return { requested: false as const, makerId: req.executionRequestedBy };
    await tx.update(accountClosureRequests).set({ executionRequestedBy: actor.userId!, executionRequestedAt: new Date() }).where(eq(accountClosureRequests.id, req.id));
    await audit(tx, actor, { action: 'account.closure_execution_requested', entityType: 'user', entityId: req.userId, newValues: { requestId: req.id } });
    return { requested: true as const, makerId: actor.userId! };
  });
}

/**
 * SEC-165: what a closed account must not keep, as the published deletion page promises (docs/store/ACCOUNT_DELETION_PAGE.md).
 * Runs inside the closure transaction.
 *  - device push tokens, web-push subscriptions: deleted. Mobile devices: revoked.
 *  - the account's own national-ID photos (IDENTITY_DOCUMENT): LOCKED (soft-deleted, so nothing can open them) and kept for
 *    IDENTITY_RETENTION_AFTER_CLOSURE (owner decision 2026-11-25: 6 months, for fraud and disputes), then removed for good by
 *    purgeClosedAccountIdentityFiles. Accounts that ever owned a store keep their verification documents.
 * Financial records, evidence files and receipts are untouched.
 */
async function releasePersonalData(tx: DbOrTx, userId: string, now: Date) {
  await tx.update(mobileDevices).set({ revokedAt: now }).where(and(eq(mobileDevices.userId, userId), isNull(mobileDevices.revokedAt)));
  const tokens = await tx.delete(devicePushTokens).where(eq(devicePushTokens.userId, userId)).returning({ id: devicePushTokens.id });
  const subs = await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).returning({ id: pushSubscriptions.id });
  const [store] = await tx.select({ id: sellers.id }).from(sellers).where(eq(sellers.ownerUserId, userId)).limit(1);
  let photos = 0;
  if (!store) {
    const docs = await tx
      .update(files)
      .set({ deletedAt: now })
      .where(and(eq(files.ownerUserId, userId), eq(files.purpose, 'IDENTITY_DOCUMENT'), isNull(files.deletedAt)))
      .returning({ id: files.id });
    photos = docs.length;
  }
  return { pushTokens: tokens.length, webPushSubscriptions: subs.length, identityPhotosLocked: photos };
}

/** Owner decision 2026-11-25: ID photos of a closed account are kept (locked) this long after closure, then removed. */
export const IDENTITY_RETENTION_AFTER_CLOSURE = '6 months';

/**
 * Scheduled (privacy.purge_closed_identity_files): removes for good the national-ID photos of accounts whose closure completed
 * more than IDENTITY_RETENTION_AFTER_CLOSURE ago. Only files locked by a closure (soft-deleted, owner CLOSED, never a store
 * owner); each file is audited. The row stays, with purged_at set, as a record that a file existed. A storage failure leaves
 * the file locked and it is retried on the next run.
 */
export async function purgeClosedAccountIdentityFiles(now = new Date(), limit = 200) {
  const due = await db
    .select({ id: files.id, ownerUserId: files.ownerUserId, visibility: files.visibility, storageKey: files.storageKey, variantKeys: files.variantKeys })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerUserId))
    .innerJoin(accountClosureRequests, and(eq(accountClosureRequests.userId, files.ownerUserId), eq(accountClosureRequests.status, 'COMPLETED')))
    .where(
      and(
        eq(files.purpose, 'IDENTITY_DOCUMENT'),
        isNotNull(files.deletedAt),
        isNull(files.purgedAt),
        eq(users.status, 'CLOSED'),
        sql`${accountClosureRequests.completedAt} <= ${now}::timestamptz - ${IDENTITY_RETENTION_AFTER_CLOSURE}::interval`,
        sql`not exists (select 1 from ${sellers} where ${sellers.ownerUserId} = ${files.ownerUserId})`,
      ),
    )
    .limit(limit);
  let processed = 0;
  for (const f of due) {
    try {
      for (const key of [f.storageKey, ...(f.variantKeys ?? [])]) await storage().remove(f.visibility, key);
    } catch (e) {
      logger.warn('closure.identity_purge_failed', { error: e instanceof Error ? e.message.slice(0, 40) : 'unknown' });
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.update(files).set({ purgedAt: now }).where(and(eq(files.id, f.id), isNull(files.purgedAt)));
      await audit(tx, SYSTEM_ACTOR, { action: 'account.identity_files_purged', entityType: 'user', entityId: f.ownerUserId!, newValues: { fileId: f.id, retention: IDENTITY_RETENTION_AFTER_CLOSURE } });
    });
    processed++;
  }
  return { processed };
}

/**
 * Step 2 (Checker): a DIFFERENT staff member completes the closure. Irreversible, so it needs a fresh step-up (SEC-164) and
 * two people: the Maker from requestClosureExecution can never be the Checker (service rule + account_closure_two_person_chk).
 */
export async function completeAccountClosure(actor: Actor, requestId: string) {
  requirePermission(actor, 'customers.manage');
  requireStepUp(actor);
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(accountClosureRequests).where(eq(accountClosureRequests.id, requestId)).for('update');
    if (!req) throw notFound('طلب الإغلاق');
    if (req.status !== 'PENDING') throw invalidState('الطلب ده مش قيد التنفيذ');
    if (req.userId === actor.userId) throw forbidden('لا يمكنك إغلاق حسابك من لوحة الإدارة');
    if (!req.executionRequestedBy) throw invalidState('الإغلاق يتطلب شخصين: لازم موظف يطلب التنفيذ الأول، وبعدين موظف تاني يعتمده');
    if (req.executionRequestedBy === actor.userId) throw forbidden('الإغلاق يتطلب شخصين: لا يمكنك اعتماد طلب تنفيذ أنشأته بنفسك');
    await lockAccount(tx, req.userId);
    const blockers = await closureBlockers(tx, req.userId);
    if (blockers.length) {
      await tx.update(accountClosureRequests).set({ status: 'BLOCKED', blockers, decidedBy: actor.userId }).where(eq(accountClosureRequests.id, req.id));
      await audit(tx, actor, { action: 'account.closure_blocked', entityType: 'user', entityId: req.userId, newValues: { blockers } });
      return { closed: false, blockers };
    }
    const now = new Date();
    const [u] = await tx.select().from(users).where(eq(users.id, req.userId)).for('update');
    // Notify BEFORE pseudonymising: notify() reads the email address from the users row, which is nulled below.
    // The customer hears that the request was executed (in-app + email via the outbox, same transaction).
    await notifyClosure(tx, req.userId, 'تم إغلاق حسابك بناءً على طلبك. بيانات الطلبات والمدفوعات محفوظة حسب سياسة الاحتفاظ.');
    await tx
      .update(users)
      .set({ status: 'CLOSED', closedAt: now, anonymizedAt: now, fullName: 'حساب مغلق', email: null, phone: null, totpSecretEnc: null })
      .where(eq(users.id, req.userId));
    await tx.update(addresses).set({ archivedAt: now }).where(eq(addresses.userId, req.userId));
    await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, req.userId));
    const released = await releasePersonalData(tx, req.userId, now);
    await tx.update(accountClosureRequests).set({ status: 'COMPLETED', completedAt: now, decidedBy: actor.userId }).where(eq(accountClosureRequests.id, req.id));
    await audit(tx, actor, {
      action: 'account.closed',
      entityType: 'user',
      entityId: req.userId,
      oldValues: { status: u.status, hadEmail: !!u.email, hadPhone: !!u.phone },
      newValues: { status: 'CLOSED', pseudonymised: ['full_name', 'email', 'phone', 'addresses'], released, retained: ['orders', 'payments', 'ledger', 'refunds', 'withdrawals', 'disputes', 'messages', 'audit', 'evidence'] },
    });
    return { closed: true, blockers: [] };
  });
}

export async function latestClosureRequest(userId: string) {
  const [r] = await db.select().from(accountClosureRequests).where(eq(accountClosureRequests.userId, userId)).orderBy(desc(accountClosureRequests.createdAt)).limit(1);
  return r ?? null;
}

export async function pendingClosures(actor: Actor, limit = 50, offset = 0) {
  requireAnyPermission(actor, ['customers.manage', 'customers.view']);
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
