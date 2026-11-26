import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { enforce } from '@/server/auth/rate-limit';
import { requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { featureDisabled, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { formatEGP } from '@/lib/format';
import { parseEgp } from '@/server/core/money';
import { db, type DbOrTx } from '@/server/db/client';
import {
  customerWalletEntries,
  financialMovementRequests,
  users,
  walletTopups,
  WALLET_TOPUP_METHODS,
} from '@/server/db/schema';
import { grantApproval } from '@/server/modules/finance/approvals';
import { assertNotPaused } from '@/server/modules/finance/controls';
import { postEntry } from '@/server/modules/finance/ledger';
import { completeMovementRequest, takeMovementRequest } from '@/server/modules/finance/movements';
import { notify } from '@/server/modules/notifications/notify';
import { enabledPaymentMethods } from '@/server/modules/payments/service';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { parse } from '../_shared';

/**
 * PKG-WALLET-01 phase 1 — customer wallet top-up (deposit). Everything sits behind `wallet.topUpEnabled` (default off).
 *
 *  customer: uploads the transfer receipt (InstaPay / bank) → PENDING_REVIEW. Nothing is credited.
 *  staff:    Maker (finance.movement.request) requests the credit; a DIFFERENT Checker (payments.verify + 2FA) executes:
 *            Dr PLATFORM_CASH / Cr CUSTOMER_WALLETS + one customer_wallet_entries row. DB-enforced two-person.
 *  No deposit fee. Daily cap (Africa/Cairo day) is `payments.dailyReceiptLimit`, SHARED with order/deal receipts.
 */

export const topupSchema = z.object({
  amount: z.string().trim().min(1).max(20),
  method: z.enum(WALLET_TOPUP_METHODS),
  payerReference: z.string().trim().max(100).optional().default(''),
  clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
});

export async function topUpEnabled(conn: DbOrTx = db) {
  return getSetting('wallet.topUpEnabled', conn);
}

async function requireEnabled(conn: DbOrTx) {
  if (!(await topUpEnabled(conn))) throw featureDisabled('إيداع الرصيد مش متاح دلوقتي');
}

const CAIRO_TODAY = (col: ReturnType<typeof sql>) => sql`(${col} at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date`;

/** Receipts (orders/deals) + deposits counted today (Cairo) against the one shared daily cap. Rejected/cancelled stop counting. */
export async function usedToday(conn: DbOrTx, userId: string): Promise<number> {
  const r = await conn.execute<{ total: string }>(sql`
    select (
      coalesce((select sum(s.claimed_amount) from payment_submissions s join payments p on p.id = s.payment_id
        where p.payer_user_id = ${userId} and s.status in ('SUBMITTED','ACCEPTED') and ${CAIRO_TODAY(sql`s.created_at`)}), 0)
      + coalesce((select sum(t.amount) from wallet_topups t
        where t.user_id = ${userId} and t.status in ('PENDING_REVIEW','CREDITED') and ${CAIRO_TODAY(sql`t.created_at`)}), 0)
    )::text total`);
  return Number(r.rows[0].total);
}

export async function walletBalance(conn: DbOrTx, userId: string): Promise<number> {
  const [r] = await conn.select({ total: sql<string>`coalesce(sum(${customerWalletEntries.amount}), 0)::text` }).from(customerWalletEntries).where(eq(customerWalletEntries.userId, userId));
  return Number(r.total);
}

export type TopupRow = typeof walletTopups.$inferSelect;

export async function submitTopup(actor: Actor, input: z.input<typeof topupSchema>, proof: { data: Buffer; name: string } | null) {
  const userId = requireUser(actor);
  await requireEnabled(db);
  const d = parse(topupSchema, input);
  await enforce(`topup:${userId}`, 10, 3600);
  let amount: number;
  try {
    amount = parseEgp(d.amount);
    if (!(amount > 0)) throw new Error('non-positive');
  } catch {
    throw validation('المبلغ غير صحيح', { amount: ['المبلغ غير صحيح'] });
  }
  return db.transaction(async (tx) => {
    // One deposit decision per customer at a time, so two parallel submits cannot both slip under the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wallet-cap:${userId}`}))`);
    const [same] = await tx.select().from(walletTopups).where(and(eq(walletTopups.userId, userId), eq(walletTopups.clientKey, d.clientKey)));
    if (same) return { topup: same, created: false };
    await requireEnabled(tx);
    if (!proof) throw validation('ارفع صورة أو ملف إيصال التحويل', { proof: ['مطلوب'] });
    const methods = await enabledPaymentMethods(tx);
    if (!methods.some((m) => m.code === d.method)) throw invalidState('طريقة الإيداع دي مش متاحة دلوقتي');
    const limit = await getSetting('payments.dailyReceiptLimit', tx);
    const used = await usedToday(tx, userId);
    if (used + amount > limit) {
      throw validation(`وصلت للحد الأقصى اليومي (${formatEGP(limit)}) للإيداعات وإيصالات الدفع. مينفعش ترفع إيصال جديد قبل بكرة بتوقيت القاهرة`, { amount: ['تجاوز الحد اليومي'] });
    }
    const file = await storeUpload(tx, actor, { purpose: 'PAYMENT_PROOF', data: proof.data, originalName: proof.name });
    const [topup] = await tx
      .insert(walletTopups)
      .values({ userId, amount, method: d.method, proofFileId: file.id, proofSha256: file.sourceSha256, payerReference: d.payerReference || null, clientKey: d.clientKey })
      .returning();
    await audit(tx, actor, { action: 'wallet.topup_submitted', entityType: 'wallet_topup', entityId: topup.id, newValues: { amount, method: d.method } });
    await notify(tx, { event: 'WALLET_TOPUP_SUBMITTED', userIds: [userId], vars: { amount: formatEGP(amount) }, link: '/wallet', dedupeKey: `topup:${topup.id}:submitted` });
    return { topup, created: true };
  });
}

/** My deposits, newest first, plus where to send money (enabled methods only). */
export async function myTopups(actor: Actor) {
  const userId = requireUser(actor);
  await requireEnabled(db);
  const items = await db.select().from(walletTopups).where(eq(walletTopups.userId, userId)).orderBy(desc(walletTopups.createdAt)).limit(100);
  const methods = await enabledPaymentMethods(db);
  const limit = await getSetting('payments.dailyReceiptLimit', db);
  const used = await usedToday(db, userId);
  return {
    items,
    methods: methods
      .filter((m) => (WALLET_TOPUP_METHODS as readonly string[]).includes(m.code))
      .map((m) => ({ code: m.code as (typeof WALLET_TOPUP_METHODS)[number], nameAr: m.nameAr, nameEn: m.nameEn, instructionsAr: m.instructionsAr, destinations: m.destinations.map((x) => ({ label: x.label, details: x.details, instructionsAr: x.instructionsAr, isTest: x.isTest })) })),
    dailyLimitPiastres: limit,
    usedTodayPiastres: used,
    balancePiastres: await walletBalance(db, userId),
  };
}

/** The wallet-home block: always answerable (flag off → enabled=false and nothing to show). */
export async function topUpSummary(conn: DbOrTx, userId: string) {
  const [enabled, limit, balance, used, pending] = await Promise.all([
    topUpEnabled(conn),
    getSetting('payments.dailyReceiptLimit', conn),
    walletBalance(conn, userId),
    usedToday(conn, userId),
    conn.select().from(walletTopups).where(and(eq(walletTopups.userId, userId), eq(walletTopups.status, 'PENDING_REVIEW'))).orderBy(desc(walletTopups.createdAt)),
  ]);
  return {
    enabled,
    balancePiastres: balance,
    pending: enabled ? pending.map((p) => ({ id: p.id, amountPiastres: p.amount, method: p.method, createdAt: p.createdAt.toISOString() })) : [],
    dailyLimitPiastres: limit,
    usedTodayPiastres: used,
  };
}

/** Customer cancels while PENDING_REVIEW and no staff movement request exists for it. */
export async function cancelTopup(actor: Actor, topupId: string) {
  const userId = requireUser(actor);
  await requireEnabled(db);
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(walletTopups).where(eq(walletTopups.id, topupId)).for('update');
    if (!t || t.userId !== userId) throw notFound('الإيداع');
    if (t.status === 'CANCELLED') return t;
    if (t.status !== 'PENDING_REVIEW') throw invalidState('الإيداع ده اتحسم بالفعل ومينفعش يتلغي');
    const [open] = await tx
      .select({ id: financialMovementRequests.id })
      .from(financialMovementRequests)
      .where(and(eq(financialMovementRequests.kind, 'WALLET_TOPUP_CREDIT'), eq(financialMovementRequests.entityId, t.id), eq(financialMovementRequests.status, 'PENDING')));
    if (open) throw invalidState('الإيداع ده بدأت مراجعته ومينفعش يتلغي دلوقتي');
    const [row] = await tx.update(walletTopups).set({ status: 'CANCELLED', decidedAt: new Date() }).where(eq(walletTopups.id, t.id)).returning();
    await audit(tx, actor, { action: 'wallet.topup_cancelled', entityType: 'wallet_topup', entityId: t.id });
    return row;
  });
}

/**
 * Checker step: executes the Maker's credit request. Refuses without an open request by someone else for exactly this
 * amount (service) and, independently, the DB trigger refuses an approval where maker = checker.
 */
export async function creditTopup(actor: Actor, topupId: string, note?: string | null) {
  requirePermission(actor, 'payments.verify');
  requireStepUp(actor);
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(walletTopups).where(eq(walletTopups.id, topupId)).for('update');
    if (!t) throw notFound('الإيداع');
    if (t.status === 'CREDITED') return { alreadyCredited: true as const };
    await assertNotPaused(tx, 'killswitch.paymentConfirmation');
    await requireEnabled(tx);
    if (t.status !== 'PENDING_REVIEW') throw invalidState('الإيداع ده مش في انتظار المراجعة');
    if (t.userId === actor.userId) throw forbidden('لا يمكنك اعتماد إيداع خاص بحسابك');
    const req = await takeMovementRequest(tx, actor, 'WALLET_TOPUP_CREDIT', t.id, t.amount);
    const approval = await grantApproval(tx, actor, {
      action: 'WALLET_TOPUP_CREDIT',
      entityType: 'wallet_topup',
      entityId: t.id,
      amount: t.amount,
      economicVersion: `amount:${t.amount}:proof:${t.proofSha256 ?? t.proofFileId}`,
      reason: note?.trim() || req.reason,
      idempotencyKey: `wallet-topup-credit:${t.id}`,
      dualControl: { requestedBy: req.requestedBy },
    });
    const { entryId } = await postEntry(tx, actor, {
      entryType: 'WALLET_TOPUP_CREDIT',
      sourceType: 'wallet_topup',
      sourceId: t.id,
      idempotencyKey: `wallet-topup:${t.id}`,
      description: `إيداع في محفظة عميل (${formatEGP(t.amount)})`,
      lines: [
        { account: { code: 'PLATFORM_CASH' }, debit: t.amount, memo: 'إيداع محفظة' },
        { account: { code: 'CUSTOMER_WALLETS' }, credit: t.amount, memo: 'إيداع محفظة' },
      ],
      approvalId: approval.id,
    });
    await tx.insert(customerWalletEntries).values({ userId: t.userId, journalEntryId: entryId, amount: t.amount, kind: 'TOPUP', topupId: t.id });
    await tx.update(walletTopups).set({ status: 'CREDITED', journalEntryId: entryId, decidedAt: new Date(), decidedBy: actor.userId }).where(eq(walletTopups.id, t.id));
    await completeMovementRequest(tx, actor, req, approval.id);
    await audit(tx, actor, { action: 'wallet.topup_credited', entityType: 'wallet_topup', entityId: t.id, newValues: { amount: t.amount, journalEntryId: entryId, approvalId: approval.id, maker: req.requestedBy } });
    await notify(tx, { event: 'WALLET_TOPUP_CREDITED', userIds: [t.userId], vars: { amount: formatEGP(t.amount) }, link: '/wallet', dedupeKey: `topup:${t.id}:credited` });
    return { alreadyCredited: false as const };
  });
}

/** Reject (nothing is posted). If a Maker request is open, only someone else may reject it (the Maker cancels their own). */
export async function rejectTopup(actor: Actor, topupId: string, reason: string) {
  requirePermission(actor, 'payments.verify');
  requireStepUp(actor);
  const why = reason?.trim();
  if (!why || why.length < 10) throw validation('اكتب سبب الرفض (10 أحرف على الأقل)');
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(walletTopups).where(eq(walletTopups.id, topupId)).for('update');
    if (!t) throw notFound('الإيداع');
    if (t.status === 'REJECTED') return { alreadyRejected: true as const };
    if (t.status !== 'PENDING_REVIEW') throw invalidState('الإيداع ده اتحسم بالفعل');
    if (t.userId === actor.userId) throw forbidden('لا يمكنك البت في إيداع خاص بحسابك');
    const [open] = await tx
      .select()
      .from(financialMovementRequests)
      .where(and(eq(financialMovementRequests.kind, 'WALLET_TOPUP_CREDIT'), eq(financialMovementRequests.entityId, t.id), eq(financialMovementRequests.status, 'PENDING')))
      .for('update');
    if (open) {
      if (open.requestedBy === actor.userId) throw forbidden('المنشئ يسحب طلبه ولا يرفض الإيداع');
      await tx.update(financialMovementRequests).set({ status: 'REJECTED', decidedBy: actor.userId, decidedAt: new Date(), decisionReason: why }).where(eq(financialMovementRequests.id, open.id));
    }
    await tx.update(walletTopups).set({ status: 'REJECTED', rejectReason: why, decidedAt: new Date(), decidedBy: actor.userId }).where(eq(walletTopups.id, t.id));
    await audit(tx, actor, { action: 'wallet.topup_rejected', entityType: 'wallet_topup', entityId: t.id, newValues: { amount: t.amount }, reason: why });
    await notify(tx, { event: 'WALLET_TOPUP_REJECTED', userIds: [t.userId], vars: { amount: formatEGP(t.amount), reason: why }, link: '/wallet', dedupeKey: `topup:${t.id}:rejected` });
    return { alreadyRejected: false as const };
  });
}

/** Admin queue (permission payments.verify to see/act; payments.view to read). */
export async function topupQueue(statuses: ('PENDING_REVIEW' | 'CREDITED' | 'REJECTED' | 'CANCELLED')[], limit = 100) {
  return db
    .select({ t: walletTopups, user: users })
    .from(walletTopups)
    .innerJoin(users, eq(users.id, walletTopups.userId))
    .where(inArray(walletTopups.status, statuses))
    .orderBy(desc(walletTopups.createdAt))
    .limit(limit);
}


export { WALLET_TOPUP_METHODS };
