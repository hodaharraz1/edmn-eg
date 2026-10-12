import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { decryptJson, encryptJson, mask, sha256 } from '@/server/core/crypto';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { receivingDestinations, reviewEvents, users, type ReceivingDestinationStatus } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { parse } from '../_shared';
import { identityOf } from './service';

/**
 * «بيانات استلام الأموال» — where EDMN can SEND money legitimately owed to a customer (refunds), when the
 * original payment destination cannot safely be used. This is NOT a wallet: no balance, no deposit, no
 * withdrawal, no ledger account. A destination is usable only after a destination reviewer APPROVED that exact
 * version; any material change creates a NEW version (the previous one is archived, never edited).
 */

export type ReceivingDestination = typeof receivingDestinations.$inferSelect;

export const DESTINATION_STATUS_LABELS: Record<ReceivingDestinationStatus, string> = {
  PENDING_REVIEW: 'قيد المراجعة',
  APPROVED: 'معتمدة',
  MORE_INFO_REQUIRED: 'مطلوب استكمال',
  REJECTED: 'مرفوضة',
  REVERIFICATION_REQUIRED: 'مطلوب إعادة التحقق',
  ARCHIVED: 'مؤرشفة',
};

export const receivingDestinationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BANK_ACCOUNT'),
    holderName: z.string().trim().min(6, 'اكتب اسم صاحب الحساب كاملًا').max(120),
    bankName: z.string().trim().min(2, 'اختار البنك').max(80),
    accountNumber: z.string().trim().max(40).optional().default(''),
    iban: z.string().trim().max(40).optional().default(''),
  }),
  z.object({
    type: z.literal('MOBILE_WALLET'),
    holderName: z.string().trim().min(6, 'اكتب اسم صاحب المحفظة كاملًا').max(120),
    walletProvider: z.string().trim().min(2, 'اختار مزود المحفظة').max(40),
    walletNumber: z.string().trim().min(10, 'رقم المحفظة غير صحيح').max(20),
  }),
]);
export type ReceivingDestinationInput = z.input<typeof receivingDestinationSchema>;

function normalize(d: z.infer<typeof receivingDestinationSchema>) {
  if (d.type === 'BANK_ACCOUNT') {
    const iban = d.iban.replace(/\s+/g, '').toUpperCase();
    const accountNumber = d.accountNumber.replace(/\s+/g, '');
    if (!iban && !accountNumber) throw validation('اكتب رقم الحساب أو الـ IBAN');
    if (iban && !/^EG\d{27}$/.test(iban)) throw validation('رقم الـ IBAN المصري غير صحيح (EG + 27 رقم)');
    if (accountNumber && !/^\d{6,30}$/.test(accountNumber)) throw validation('رقم الحساب غير صحيح');
    return { type: d.type, holderName: d.holderName, bankName: d.bankName, accountNumber, iban };
  }
  const walletNumber = normalizeEgyptMobile(d.walletNumber);
  if (!walletNumber) throw validation('رقم المحفظة غير صحيح');
  return { type: d.type, holderName: d.holderName, walletProvider: d.walletProvider, walletNumber };
}

function fingerprintOf(details: Record<string, string>) {
  return sha256(`receiving:${JSON.stringify(Object.keys(details).sort().map((k) => [k, details[k]]))}`);
}
function maskedOf(details: Record<string, string>) {
  return details.type === 'BANK_ACCOUNT' ? `${details.bankName} ${mask(details.iban || details.accountNumber)}` : `${details.walletProvider} ${mask(details.walletNumber)}`;
}

async function event(tx: DbOrTx, id: string, actorId: string | null, action: string, from: string | null, to: string, reason?: string | null) {
  await tx.insert(reviewEvents).values({ subjectType: 'RECEIVING_DESTINATION', subjectId: id, actorUserId: actorId, action, fromStatus: from, toStatus: to, reason: reason ?? null });
}

/** Customer adds a destination, or replaces one (`replacesId`): always a NEW immutable version, PENDING_REVIEW. */
export async function submitReceivingDestination(actor: Actor, input: ReceivingDestinationInput, opts: { replacesId?: string } = {}) {
  const uid = requireUser(actor);
  const details = normalize(parse(receivingDestinationSchema, input)) as unknown as Record<string, string>;
  return db.transaction(async (tx) => {
    let version = 1;
    let supersedesId: string | null = null;
    if (opts.replacesId) {
      const [old] = await tx.select().from(receivingDestinations).where(eq(receivingDestinations.id, opts.replacesId)).for('update');
      if (!old || old.userId !== uid) throw notFound('بيانات الاستلام');
      if (old.status === 'ARCHIVED') throw invalidState('النسخة دي مؤرشفة بالفعل');
      // Material change: the old version can never be used again for NEW refunds (existing snapshots keep it).
      await tx.update(receivingDestinations).set({ status: 'ARCHIVED' }).where(eq(receivingDestinations.id, old.id));
      await event(tx, old.id, uid, 'SUPERSEDED', old.status, 'ARCHIVED');
      version = old.version + 1;
      supersedesId = old.id;
    } else {
      const open = await tx.select({ id: receivingDestinations.id }).from(receivingDestinations).where(and(eq(receivingDestinations.userId, uid), inArray(receivingDestinations.status, ['PENDING_REVIEW', 'APPROVED', 'MORE_INFO_REQUIRED'])));
      if (open.length >= 5) throw validation('الحد الأقصى 5 وسائل استلام. عدّل أو احذف وسيلة قائمة');
    }
    const [row] = await tx
      .insert(receivingDestinations)
      .values({ userId: uid, type: details.type as 'BANK_ACCOUNT', detailsEnc: encryptJson(details), maskedLabel: maskedOf(details), holderName: details.holderName, fingerprint: fingerprintOf(details), version, supersedesId })
      .returning();
    await event(tx, row.id, uid, supersedesId ? 'RESUBMITTED' : 'SUBMITTED', null, 'PENDING_REVIEW');
    await audit(tx, actor, { action: 'receiving_destination.submitted', entityType: 'receiving_destination', entityId: row.id, newValues: { type: row.type, masked: row.maskedLabel, version, supersedesId } });
    return row;
  });
}

/** Customer archives a destination (existing refund snapshots are unaffected). */
export async function archiveReceivingDestination(actor: Actor, id: string) {
  const uid = requireUser(actor);
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(receivingDestinations).where(eq(receivingDestinations.id, id)).for('update');
    if (!d || d.userId !== uid) throw notFound('بيانات الاستلام');
    if (d.status === 'ARCHIVED') return;
    await tx.update(receivingDestinations).set({ status: 'ARCHIVED' }).where(eq(receivingDestinations.id, d.id));
    await event(tx, d.id, uid, 'ARCHIVED', d.status, 'ARCHIVED');
    await audit(tx, actor, { action: 'receiving_destination.archived', entityType: 'receiving_destination', entityId: d.id });
  });
}

/** Masked list for the owner (no full number ever leaves the server here). */
export async function myReceivingDestinations(actor: Actor) {
  const uid = requireUser(actor);
  const rows = await db.select().from(receivingDestinations).where(eq(receivingDestinations.userId, uid)).orderBy(desc(receivingDestinations.createdAt));
  return rows.map(({ detailsEnc: _d, fingerprint: _f, ...r }) => r);
}

export type DestinationDecision = 'APPROVE' | 'MORE_INFO_REQUIRED' | 'REJECT' | 'REVERIFICATION_REQUIRED';
const TO: Record<DestinationDecision, ReceivingDestinationStatus> = { APPROVE: 'APPROVED', MORE_INFO_REQUIRED: 'MORE_INFO_REQUIRED', REJECT: 'REJECTED', REVERIFICATION_REQUIRED: 'REVERIFICATION_REQUIRED' };

/**
 * Destination reviewer decision (destinations.review, fresh 2FA, reason except plain approval). Beneficiary
 * safety: approval requires the owner's identity to be APPROVED and the reviewer to confirm the holder matches
 * the verified legal name (`holderMatchesIdentity`) — ownership is never inferred from a name/number alone.
 * Verification itself NEVER moves money.
 */
export async function reviewReceivingDestination(actor: Actor, id: string, decision: DestinationDecision, input: { reason?: string | null; holderMatchesIdentity?: boolean } = {}) {
  requirePermission(actor, 'destinations.review');
  requireStepUp(actor);
  const reason = input.reason?.trim() || null;
  if (decision !== 'APPROVE' && (!reason || reason.length < 5)) throw validation('اكتب سبب القرار');
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(receivingDestinations).where(eq(receivingDestinations.id, id)).for('update');
    if (!d) throw notFound('بيانات الاستلام');
    if (d.userId === actor.userId) throw forbidden('لا يمكنك مراجعة بيانات استلام خاصة بك');
    const to = TO[decision];
    if (decision === 'REVERIFICATION_REQUIRED') {
      if (d.status !== 'APPROVED') throw invalidState('إعادة التحقق تُطلب لوسيلة معتمدة فقط');
    } else if (d.status !== 'PENDING_REVIEW') throw invalidState('الوسيلة ليست قيد المراجعة');
    if (decision === 'APPROVE') {
      const identity = await identityOf(tx, d.userId);
      if (identity?.status !== 'APPROVED') throw invalidState('لا يمكن اعتماد وسيلة استلام قبل التحقق من هوية صاحبها');
      if (!input.holderMatchesIdentity) throw validation('أكّد أن صاحب الحساب/المحفظة هو نفس صاحب الهوية المتحقق منها');
    }
    await tx.update(receivingDestinations).set({ status: to, reviewedBy: actor.userId, reviewedAt: new Date(), reviewReason: reason }).where(eq(receivingDestinations.id, d.id));
    await event(tx, d.id, actor.userId ?? null, decision, d.status, to, reason);
    await audit(tx, actor, { action: `receiving_destination.${decision.toLowerCase()}`, entityType: 'receiving_destination', entityId: d.id, oldValues: { status: d.status }, newValues: { status: to, fingerprint: d.fingerprint, version: d.version }, reason });
    await notify(tx, { event: 'RECEIVING_DESTINATION_UPDATED', userIds: [d.userId], vars: { destination: d.maskedLabel, status: DESTINATION_STATUS_LABELS[to], reason: reason ?? '' }, link: '/account/receiving', dedupeKey: `rdest:${d.id}:${to}` });
    return { status: to };
  });
}

export async function destinationQueue(actor: Actor, statuses: ReceivingDestinationStatus[] = ['PENDING_REVIEW']) {
  requirePermission(actor, 'destinations.review');
  return db
    .select({ d: { id: receivingDestinations.id, type: receivingDestinations.type, maskedLabel: receivingDestinations.maskedLabel, holderName: receivingDestinations.holderName, status: receivingDestinations.status, version: receivingDestinations.version, createdAt: receivingDestinations.createdAt, userId: receivingDestinations.userId }, owner: users.fullName })
    .from(receivingDestinations)
    .innerJoin(users, eq(users.id, receivingDestinations.userId))
    .where(inArray(receivingDestinations.status, statuses))
    .orderBy(asc(receivingDestinations.createdAt));
}

/** Full details (destinations.view_full + fresh 2FA), audited on every reveal. */
export async function revealReceivingDestination(actor: Actor, id: string) {
  requirePermission(actor, 'destinations.view_full');
  requireStepUp(actor);
  const [d] = await db.select().from(receivingDestinations).where(eq(receivingDestinations.id, id));
  if (!d) throw notFound('بيانات الاستلام');
  await audit(db, actor, { action: 'receiving_destination.revealed', entityType: 'receiving_destination', entityId: d.id });
  return decryptJson<Record<string, string>>(d.detailsEnc);
}

/** The exact APPROVED version owned by `userId` (beneficiary safety) — null otherwise. */
export async function approvedDestinationOf(conn: DbOrTx, userId: string, id: string) {
  const [d] = await conn.select().from(receivingDestinations).where(and(eq(receivingDestinations.id, id), eq(receivingDestinations.userId, userId), eq(receivingDestinations.status, 'APPROVED')));
  return d ?? null;
}

/** Recomputes the fingerprint from the stored details (tamper check before any transfer). */
export function destinationIntact(d: ReceivingDestination) {
  return fingerprintOf(decryptJson<Record<string, string>>(d.detailsEnc)) === d.fingerprint;
}
