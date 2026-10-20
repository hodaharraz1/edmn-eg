import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { hasPermission, requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { decrypt, encrypt } from '@/server/core/crypto';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { isValidEgyptNationalId } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { reviewEvents, sellerDocuments, sellers, userIdentityVerifications, users, type IdentityStatus } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { storeUpload } from '@/server/storage/uploads';

/**
 * GLOBAL USER IDENTITY (KYC) — one user-level domain shared by buyers, Marketplace sellers and Protected Deal
 * sellers. Identity APPROVED is NOT seller/store approval, NOT payout-destination verification, NOT a refund
 * or release decision. This is an identity check against the National ID only — not a complete AML programme.
 */

export type Identity = typeof userIdentityVerifications.$inferSelect;

export const IDENTITY_LABELS: Record<IdentityStatus, string> = {
  INCOMPLETE: 'لم يكتمل',
  PENDING_REVIEW: 'قيد المراجعة',
  MORE_INFO_REQUIRED: 'مطلوب معلومات إضافية',
  APPROVED: 'تم التحقق',
  REJECTED: 'مرفوض',
  REVERIFICATION_REQUIRED: 'مطلوب إعادة التحقق',
};

/** Operations that start NEW transactional risk (central list; each boundary passes its own code). */
export const IDENTITY_GUARDED_ACTIONS = {
  ORDER_PLACEMENT: 'إتمام طلب شراء',
  PAYMENT_SUBMISSION: 'إرسال إثبات دفع',
  SELLER_APPLICATION: 'تقديم طلب بائع',
  PRODUCT_SUBMISSION: 'إرسال منتج للمراجعة',
  WITHDRAWAL_REQUEST: 'طلب سحب',
  PAYOUT_DESTINATION: 'إضافة بيانات استلام الأموال',
  DEAL_INVITATION: 'إرسال دعوة صفقة محمية',
  DEAL_OFFER: 'تقديم عرض في صفقة محمية',
  DEAL_ACCEPTANCE: 'قبول شروط صفقة محمية',
  DEAL_PAYMENT: 'بدء دفع صفقة محمية',
} as const;
export type IdentityGuardedAction = keyof typeof IDENTITY_GUARDED_ACTIONS;

export async function identityOf(conn: DbOrTx, userId: string): Promise<Identity | null> {
  const [row] = await conn.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.userId, userId));
  return row ?? null;
}

export async function identityStatus(conn: DbOrTx, userId: string): Promise<IdentityStatus> {
  return (await identityOf(conn, userId))?.status ?? 'INCOMPLETE';
}

/**
 * THE central eligibility policy (server-side; UI hiding is never relied upon). Fail closed: anything but an
 * APPROVED identity refuses the NEW transactional action. Existing obligations (viewing, support, disputes,
 * evidence, receiving refunds, fulfilling already-paid orders) are deliberately NOT routed through this guard.
 */
export async function requireApprovedIdentity(conn: DbOrTx, actor: Actor, action: IdentityGuardedAction, userId?: string) {
  if (actor.type === 'SYSTEM' && !userId) return;
  const uid = userId ?? requireUser(actor);
  const status = await identityStatus(conn, uid);
  if (status !== 'APPROVED') {
    throw new DomainError(
      'IDENTITY_REQUIRED',
      `لازم تتحقق من هويتك الأول قبل: ${IDENTITY_GUARDED_ACTIONS[action]} (حالة التحقق: ${IDENTITY_LABELS[status]}). من صفحة «التحقق من الهوية» في حسابك.`,
    );
  }
}

/** Customer-safe view: never the national ID number or internal notes. */
export async function myIdentity(actor: Actor) {
  const uid = requireUser(actor);
  const row = await identityOf(db, uid);
  if (!row) return { status: 'INCOMPLETE' as IdentityStatus, legalName: null, last4: null, hasFront: false, hasBack: false, reason: null, submittedAt: null, reviewedAt: null };
  return {
    status: row.status,
    legalName: row.legalName,
    last4: row.nationalIdLast4,
    hasFront: !!row.frontFileId,
    hasBack: !!row.backFileId,
    frontFileId: row.frontFileId,
    backFileId: row.backFileId,
    reason: row.status === 'MORE_INFO_REQUIRED' || row.status === 'REJECTED' || row.status === 'REVERIFICATION_REQUIRED' ? row.reviewReason : null,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
  };
}

const SUBMITTABLE: IdentityStatus[] = ['INCOMPLETE', 'MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED'];

async function event(tx: DbOrTx, subjectId: string, actorId: string | null, action: string, from: string | null, to: string, reason?: string | null) {
  await tx.insert(reviewEvents).values({ subjectType: 'IDENTITY', subjectId, actorUserId: actorId, action, fromStatus: from, toStatus: to, reason: reason ?? null });
}

/**
 * Submit (or resubmit) the identity: legal name, Egyptian National ID number, front AND back images.
 * Front/back are required (a resubmission may keep a previously uploaded side). Moves to PENDING_REVIEW.
 */
export async function submitIdentity(
  actor: Actor,
  input: { legalName: string; nationalId: string },
  docs: { front?: { data: Buffer; name: string } | null; back?: { data: Buffer; name: string } | null },
) {
  const uid = requireUser(actor);
  const legalName = input.legalName?.trim().replace(/\s+/g, ' ');
  if (!legalName || legalName.length < 6 || legalName.split(' ').length < 3) throw validation('اكتب الاسم الكامل كما في البطاقة (ثلاثي على الأقل)');
  const nid = (input.nationalId ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  if (!isValidEgyptNationalId(nid)) throw validation('الرقم القومي غير صحيح (14 رقم)');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'identity:' + uid}))`);
    const current = await identityOf(tx, uid);
    const from = current?.status ?? 'INCOMPLETE';
    if (!SUBMITTABLE.includes(from)) {
      throw invalidState(from === 'PENDING_REVIEW' ? 'بياناتك قيد المراجعة بالفعل' : from === 'APPROVED' ? 'هويتك متحقق منها بالفعل' : 'لا يمكن إعادة التقديم في الحالة الحالية. تواصل مع الدعم');
    }
    const front = docs.front ? await storeUpload(tx, actor, { purpose: 'IDENTITY_DOCUMENT', data: docs.front.data, originalName: docs.front.name }) : null;
    const back = docs.back ? await storeUpload(tx, actor, { purpose: 'IDENTITY_DOCUMENT', data: docs.back.data, originalName: docs.back.name }) : null;
    const frontFileId = front?.id ?? current?.frontFileId ?? null;
    const backFileId = back?.id ?? current?.backFileId ?? null;
    if (!frontFileId || !backFileId) throw validation('ارفع صورة وجه البطاقة وظهرها');
    const values = {
      legalName,
      nationalIdEnc: encrypt(nid),
      nationalIdLast4: nid.slice(-4),
      frontFileId,
      backFileId,
      status: 'PENDING_REVIEW' as const,
      submittedAt: new Date(),
      submissionVersion: (current?.submissionVersion ?? 0) + 1,
      reviewReason: null,
    };
    let row: Identity;
    if (current) [row] = await tx.update(userIdentityVerifications).set(values).where(eq(userIdentityVerifications.id, current.id)).returning();
    else [row] = await tx.insert(userIdentityVerifications).values({ userId: uid, source: 'SELF', ...values }).returning();
    await event(tx, row.id, uid, current ? 'RESUBMITTED' : 'SUBMITTED', from, 'PENDING_REVIEW');
    await audit(tx, actor, { action: 'identity.submitted', entityType: 'identity', entityId: row.id, oldValues: { status: from }, newValues: { status: 'PENDING_REVIEW', submissionVersion: row.submissionVersion, newFront: !!front, newBack: !!back } });
    return { id: row.id, status: row.status };
  });
}

export type IdentityDecision = 'APPROVE' | 'MORE_INFO_REQUIRED' | 'REJECT' | 'REVERIFICATION_REQUIRED';
const DECISION_TO: Record<IdentityDecision, IdentityStatus> = { APPROVE: 'APPROVED', MORE_INFO_REQUIRED: 'MORE_INFO_REQUIRED', REJECT: 'REJECTED', REVERIFICATION_REQUIRED: 'REVERIFICATION_REQUIRED' };

/** Staff decision (identity.review, fresh 2FA). Reason mandatory except for a plain approval; never self-review. */
export async function reviewIdentity(actor: Actor, verificationId: string, decision: IdentityDecision, input: { reason?: string | null; internalNote?: string | null; expectedVersion?: number } = {}) {
  requirePermission(actor, 'identity.review');
  requireStepUp(actor);
  const reason = input.reason?.trim() || null;
  if (decision !== 'APPROVE' && (!reason || reason.length < 5)) throw validation('اكتب سبب القرار (يظهر للعميل)');
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.id, verificationId)).for('update');
    if (!row) throw notFound('حالة التحقق');
    if (row.userId === actor.userId) throw forbidden('لا يمكنك مراجعة هويتك بنفسك');
    if (input.expectedVersion !== undefined && input.expectedVersion !== row.submissionVersion) throw invalidState('تم تحديث البيانات بعد فتح الصفحة. راجع النسخة الجديدة');
    const to = DECISION_TO[decision];
    if (decision === 'REVERIFICATION_REQUIRED') {
      if (row.status !== 'APPROVED') throw invalidState('إعادة التحقق تُطلب لهوية متحقق منها فقط');
    } else if (row.status !== 'PENDING_REVIEW') throw invalidState('لا يوجد تقديم قيد المراجعة');
    if (decision === 'APPROVE' && (!row.frontFileId || !row.backFileId || !row.nationalIdEnc || !row.legalName)) throw invalidState('البيانات أو صور البطاقة غير مكتملة');
    await tx
      .update(userIdentityVerifications)
      .set({ status: to, reviewedBy: actor.userId, reviewedAt: new Date(), reviewReason: reason, internalNote: input.internalNote?.trim() || row.internalNote })
      .where(eq(userIdentityVerifications.id, row.id));
    await event(tx, row.id, actor.userId ?? null, decision, row.status, to, reason);
    await audit(tx, actor, { action: `identity.${decision.toLowerCase()}`, entityType: 'identity', entityId: row.id, oldValues: { status: row.status }, newValues: { status: to, submissionVersion: row.submissionVersion }, reason });
    await notify(tx, { event: 'IDENTITY_UPDATED', userIds: [row.userId], vars: { status: IDENTITY_LABELS[to], reason: reason ?? '' }, link: '/account/identity', dedupeKey: `identity:${row.id}:${row.submissionVersion}:${to}` });
    return { status: to };
  });
}

/** Staff list (identity.view). Never returns the national ID number. */
export async function identityQueue(actor: Actor, statuses: IdentityStatus[], limit = 100) {
  requirePermission(actor, 'identity.view');
  return db
    .select({ v: userIdentityVerifications, name: users.fullName, email: users.email })
    .from(userIdentityVerifications)
    .innerJoin(users, eq(users.id, userIdentityVerifications.userId))
    .where(inArray(userIdentityVerifications.status, statuses))
    .orderBy(asc(userIdentityVerifications.submittedAt))
    .limit(limit);
}

export async function identityCase(actor: Actor, verificationId: string) {
  requirePermission(actor, 'identity.view');
  const [row] = await db.select({ v: userIdentityVerifications, name: users.fullName, email: users.email, phone: users.phone }).from(userIdentityVerifications).innerJoin(users, eq(users.id, userIdentityVerifications.userId)).where(eq(userIdentityVerifications.id, verificationId));
  if (!row) throw notFound('حالة التحقق');
  const history = await db.select().from(reviewEvents).where(and(eq(reviewEvents.subjectType, 'IDENTITY'), eq(reviewEvents.subjectId, verificationId))).orderBy(desc(reviewEvents.createdAt));
  return { ...row, history, canSeeDocuments: hasPermission(actor, 'identity.documents.view') };
}

/** Identity documents are served only within a fresh step-up window (same rule as the file access check). */
export function documentsUnlocked(actor: Actor, windowMs = 60 * 60_000) {
  return !!actor.stepUpAt && Date.now() - new Date(actor.stepUpAt).getTime() < windowMs;
}

/** Full national ID for a reviewer: identity.documents.view + fresh 2FA, audited every time. */
export async function revealIdentityNumber(actor: Actor, verificationId: string): Promise<string> {
  requirePermission(actor, 'identity.documents.view');
  requireStepUp(actor);
  const [row] = await db.select().from(userIdentityVerifications).where(eq(userIdentityVerifications.id, verificationId));
  if (!row?.nationalIdEnc) throw notFound('الرقم القومي');
  await audit(db, actor, { action: 'identity.national_id_revealed', entityType: 'identity', entityId: row.id });
  return decrypt(row.nationalIdEnc);
}

/**
 * LEGACY MAPPING (idempotent, additive): a seller application that already holds a legal name, an encrypted
 * national ID and current front/back scans gets an identity case that LINKS those files (no copy) in
 * PENDING_REVIEW. The old seller decision reviewed a whole application, not an identity — it is NEVER treated
 * as an identity approval. Returns the mapping report.
 */
export async function mapLegacySellerIdentities(conn: DbOrTx = db) {
  const candidates = await conn
    .select({ s: sellers })
    .from(sellers)
    .leftJoin(userIdentityVerifications, eq(userIdentityVerifications.userId, sellers.ownerUserId))
    .where(isNull(userIdentityVerifications.id));
  let linked = 0;
  let incomplete = 0;
  for (const { s } of candidates) {
    const docs = await conn.select().from(sellerDocuments).where(and(eq(sellerDocuments.sellerId, s.id), isNull(sellerDocuments.supersededAt), inArray(sellerDocuments.kind, ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK'])));
    const front = docs.filter((d) => d.kind === 'NATIONAL_ID_FRONT').sort((a, b) => +b.createdAt - +a.createdAt)[0];
    const back = docs.filter((d) => d.kind === 'NATIONAL_ID_BACK').sort((a, b) => +b.createdAt - +a.createdAt)[0];
    if (!s.legalName || !s.nationalIdEnc || !front || !back) {
      incomplete++;
      continue;
    }
    const [row] = await conn
      .insert(userIdentityVerifications)
      .values({
        userId: s.ownerUserId,
        status: 'PENDING_REVIEW',
        legalName: s.legalName,
        nationalIdEnc: s.nationalIdEnc,
        nationalIdLast4: s.nationalIdLast4,
        frontFileId: front.fileId,
        backFileId: back.fileId,
        source: 'LEGACY_SELLER_APPLICATION',
        legacySellerId: s.id,
        submissionVersion: 1,
        submittedAt: s.submittedAt ?? s.createdAt,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await event(conn, row.id, null, 'LEGACY_LINKED', null, 'PENDING_REVIEW', 'ربط مستندات طلب البائع السابق — يحتاج مراجعة هوية مستقلة');
      linked++;
    }
  }
  return { candidates: candidates.length, linkedPendingReview: linked, leftIncomplete: incomplete };
}
