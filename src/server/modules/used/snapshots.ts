import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requireUser, type Actor } from '@/server/core/actor';
import { sha256 } from '@/server/core/crypto';
import { conflict, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import {
  conditionSnapshots,
  externalDeals,
  orderItems,
  orders,
  productPassportEvents,
  productPassports,
  sellerOrders,
  sellers,
  usedConditionReports,
} from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { canonicalJson, coerceAnswers, declaredDefects, fieldDisplay, USED_DISPUTE_REASONS, type Defect, type UsedAnswers } from '@/domain/used';
import { track, valueBucket } from './analytics';
import { policyForCategory } from './policies';
import { reportBundle, type ReportBundle } from './reports';

export type SnapshotRow = typeof conditionSnapshots.$inferSelect;

/** The frozen, signed description of a used item at agreement time. Never contains the clear identifier. */
export type ConditionSnapshot = {
  schema: 'edmn.condition.v1';
  policy: { profile: string; title: string; version: number };
  passport: { code: string; level: string };
  report: { id: string; version: number; declaredAt: string | null };
  fields: { code: string; group: string; label: string; value: string | number | boolean | null; display: string }[];
  identifier: { masked: string; hash: string } | null;
  defects: Defect[];
  evidence: { slot: string; label: string; fileId: string; sha256: string; private: boolean }[];
  declaration: { text: string; at: string | null; byUserId: string };
  commercial: {
    unitPrice: number;
    quantity: number;
    goodsTotal: number;
    shippingFee: number;
    deliveryMethod: string | null;
    processingDays: number | null;
    deliveryMinDays: number | null;
    deliveryMaxDays: number | null;
    returnPolicy: { type: string; windowDays: number | null } | null;
    inspectionDays: number | null;
  };
  parties: { buyerId: string; sellerUserId: string | null };
  disputeReasons: { code: string; label: string }[];
  amendment?: { fromVersion: number; reason: string; changed: string[] };
  frozenAt: string;
};

export function hashSnapshot(snapshot: unknown, prevHash: string | null): string {
  return sha256(canonicalJson({ snapshot, prevHash }));
}

/** Tamper check: the stored hash must match the stored content and chain. */
export function snapshotIntact(row: Pick<SnapshotRow, 'snapshot' | 'hash' | 'prevHash'>): boolean {
  return hashSnapshot(row.snapshot, row.prevHash) === row.hash;
}

function describe(b: ReportBundle, commercial: ConditionSnapshot['commercial'], parties: ConditionSnapshot['parties']): ConditionSnapshot {
  const answers = (b.report.answers ?? {}) as UsedAnswers;
  return {
    schema: 'edmn.condition.v1',
    policy: { profile: b.policy.profile, title: b.policy.title, version: b.report.policyVersion },
    passport: { code: b.passport!.code, level: b.passport!.level },
    report: { id: b.report.id, version: b.report.version, declaredAt: b.report.declaredAt?.toISOString() ?? null },
    fields: b.policy.fields
      .filter((f) => !f.identifier)
      .map((f) => ({ code: f.code, group: f.group, label: f.label, value: answers[f.code] ?? null, display: fieldDisplay(f, answers[f.code]) })),
    identifier: b.report.identifierHash ? { masked: b.report.identifierMasked ?? '', hash: b.report.identifierHash } : null,
    defects: b.check.defects,
    evidence: b.evidence.map((e) => {
      const slot = b.policy.evidence.find((s) => s.code === e.slot);
      return { slot: e.slot, label: slot?.label ?? e.slot, fileId: e.fileId, sha256: e.sha256, private: e.visibility === 'PRIVATE' };
    }),
    declaration: { text: b.policy.declaration, at: b.report.declaredAt?.toISOString() ?? null, byUserId: b.report.authorUserId },
    commercial,
    parties,
    disputeReasons: b.policy.disputeReasons.map((c) => ({ code: c, label: USED_DISPUTE_REASONS[c] })),
    frozenAt: new Date().toISOString(),
  };
}

async function lastAccepted(tx: DbOrTx, where: ReturnType<typeof eq>) {
  const [row] = await tx.select().from(conditionSnapshots).where(and(where, eq(conditionSnapshots.status, 'ACCEPTED'))).orderBy(desc(conditionSnapshots.version)).limit(1);
  return row ?? null;
}

async function nextVersion(tx: DbOrTx, where: ReturnType<typeof eq>) {
  const [r] = await tx.select({ v: sql<number>`coalesce(max(${conditionSnapshots.version}), 0)` }).from(conditionSnapshots).where(where);
  return Number(r?.v ?? 0) + 1;
}

/* ───────── Protected deals ───────── */

type DealRow = typeof externalDeals.$inferSelect;
type OfferTerms = {
  price: { unitPrice: number; goodsTotal: number; shippingFee: number };
  delivery: { method: string | null; processingDays: number; expectedMinDays?: number; expectedMaxDays?: number; inspectionDays: number };
  returnPolicy: { type: string; windowDays?: number | null };
};

/** Does this deal fall under a used-condition policy (USED + a covered category)? */
export async function dealUsesPolicy(tx: DbOrTx, deal: Pick<DealRow, 'condition' | 'categoryId'>) {
  if (deal.condition !== 'USED' || !deal.categoryId) return null;
  return policyForCategory(deal.categoryId, tx);
}

/**
 * Seller offer → a PROPOSED snapshot bound to that terms version. Returns null for deals outside the used-condition
 * scheme (legacy free-text disclosure keeps working). A covered used deal cannot be offered without a declared report.
 */
export async function proposeDealSnapshot(tx: DbOrTx, actor: Actor, deal: DealRow, termsVersion: number, terms: OfferTerms) {
  if (!(await dealUsesPolicy(tx, deal))) return null;
  const [r] = await tx.select().from(usedConditionReports).where(eq(usedConditionReports.dealId, deal.id)).for('update');
  if (!r || r.status !== 'DECLARED') throw validation('وثّق حالة المنتج المستعمل (البيانات والصور والإقرار) قبل ما تقدّم العرض');
  const b = await reportBundle(tx, r);
  if (!b.check.complete || !b.passport) throw validation('توثيق الحالة ناقص');
  const where = eq(conditionSnapshots.dealId, deal.id);
  await tx.update(conditionSnapshots).set({ status: 'SUPERSEDED', respondedAt: new Date() }).where(and(where, eq(conditionSnapshots.status, 'PROPOSED')));
  const prev = await lastAccepted(tx, where);
  const snapshot = describe(
    b,
    {
      unitPrice: terms.price.unitPrice,
      quantity: deal.quantity,
      goodsTotal: terms.price.goodsTotal,
      shippingFee: terms.price.shippingFee,
      deliveryMethod: terms.delivery.method,
      processingDays: terms.delivery.processingDays,
      deliveryMinDays: terms.delivery.expectedMinDays ?? null,
      deliveryMaxDays: terms.delivery.expectedMaxDays ?? null,
      returnPolicy: { type: terms.returnPolicy.type, windowDays: terms.returnPolicy.windowDays ?? null },
      inspectionDays: terms.delivery.inspectionDays,
    },
    { buyerId: deal.buyerId, sellerUserId: deal.sellerUserId },
  );
  const version = await nextVersion(tx, where);
  const hash = hashSnapshot(snapshot, prev?.hash ?? null);
  const [row] = await tx
    .insert(conditionSnapshots)
    .values({ reportId: r.id, passportId: b.passport.id, dealId: deal.id, termsVersion, version, status: 'PROPOSED', snapshot, hash, prevHash: prev?.hash ?? null, proposedBy: actor.userId })
    .returning();
  await track(tx, 'SELLER_OFFER_SUBMITTED', deal.id, { profile: b.policy.profile, level: b.passport.level, valueBucket: valueBucket(terms.price.goodsTotal) });
  return { snapshotId: row.id, version, hash, passportCode: b.passport.code, level: b.passport.level };
}

/** Buyer agreed on terms version `termsVersion`: its snapshot becomes the frozen condition; the report is locked. */
export async function acceptDealSnapshot(tx: DbOrTx, actor: Actor, dealId: string, termsVersion: number) {
  const [row] = await tx
    .select()
    .from(conditionSnapshots)
    .where(and(eq(conditionSnapshots.dealId, dealId), eq(conditionSnapshots.termsVersion, termsVersion), eq(conditionSnapshots.status, 'PROPOSED')))
    .for('update');
  if (!row) return null;
  if (!snapshotIntact(row)) throw conflict('بيانات الحالة المعروضة اتغيرت. اطلب من البائع يرسل العرض تاني.');
  await tx.update(conditionSnapshots).set({ status: 'ACCEPTED', respondedBy: actor.userId, respondedAt: new Date() }).where(eq(conditionSnapshots.id, row.id));
  await tx.update(usedConditionReports).set({ status: 'LOCKED' }).where(eq(usedConditionReports.id, row.reportId));
  await tx.insert(productPassportEvents).values({ passportId: row.passportId, kind: 'SNAPSHOT_FROZEN', actorUserId: actor.userId, data: { dealVersion: row.version, hash: row.hash } });
  const snap = row.snapshot as ConditionSnapshot;
  await track(tx, 'CONDITION_FROZEN', dealId, { profile: snap.policy.profile, level: snap.passport.level, valueBucket: valueBucket(snap.commercial.goodsTotal) });
  return row;
}

/** Offer rejected / changed: its pending snapshot never becomes binding. */
export async function closeProposedSnapshots(tx: DbOrTx, dealId: string, as: 'REJECTED' | 'SUPERSEDED') {
  await tx.update(conditionSnapshots).set({ status: as, respondedAt: new Date() }).where(and(eq(conditionSnapshots.dealId, dealId), eq(conditionSnapshots.status, 'PROPOSED')));
}

/** Deal states in which the seller may still disclose a material change (paid or not, but before shipping). */
const AMENDABLE = ['PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'ACTIVE'];

/**
 * After agreement the condition is frozen. A material change (e.g. a newly found defect) is a NEW snapshot version
 * that only becomes binding when the buyer accepts it; until then the agreed version stays authoritative.
 */
export async function proposeConditionAmendment(actor: Actor, dealId: string, input: { changes: Record<string, unknown>; note: string; reason: string }) {
  const uid = requireUser(actor);
  if (input.reason.trim().length < 5) throw validation('اكتب سبب التعديل');
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal || deal.sellerUserId !== uid) throw notFound('الصفقة');
    if (!AMENDABLE.includes(deal.status) || deal.deliveredAt) throw invalidState('التعديل على الحالة متاح بعد الاتفاق وقبل الشحن فقط');
    const where = eq(conditionSnapshots.dealId, deal.id);
    const current = await lastAccepted(tx, where);
    if (!current) throw invalidState('الصفقة دي مفيهاش حالة مثبتة');
    const [pending] = await tx.select({ id: conditionSnapshots.id }).from(conditionSnapshots).where(and(where, eq(conditionSnapshots.status, 'PROPOSED')));
    if (pending) throw conflict('فيه تعديل مستني رد المشتري بالفعل');
    const resolved = await dealUsesPolicy(tx, deal);
    if (!resolved) throw invalidState('الصفقة دي مش ضمن توثيق المستعمل');
    const prev = current.snapshot as ConditionSnapshot;
    const patch = coerceAnswers(resolved.policy, input.changes);
    const answers: UsedAnswers = Object.fromEntries(prev.fields.filter((f) => f.value !== null).map((f) => [f.code, f.value as string | number | boolean]));
    const changed: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (answers[k] !== v) changed.push(k);
      answers[k] = v;
    }
    const note = input.note.trim().slice(0, 500);
    if (!changed.length && !note) throw validation('مفيش تغيير');
    const defects = declaredDefects(resolved.policy, answers);
    if (note) defects.push({ code: 'amendment_note', label: 'إفصاح إضافي من البائع', detail: note });
    const snapshot: ConditionSnapshot = {
      ...prev,
      fields: prev.fields.map((f) => {
        const def = resolved.policy.fields.find((x) => x.code === f.code);
        return def && f.code in patch ? { ...f, value: answers[f.code], display: fieldDisplay(def, answers[f.code]) } : f;
      }),
      defects,
      amendment: { fromVersion: current.version, reason: input.reason.trim().slice(0, 500), changed },
      frozenAt: new Date().toISOString(),
    };
    const version = await nextVersion(tx, where);
    const [row] = await tx
      .insert(conditionSnapshots)
      .values({ reportId: current.reportId, passportId: current.passportId, dealId: deal.id, termsVersion: current.termsVersion, version, status: 'PROPOSED', snapshot, hash: hashSnapshot(snapshot, current.hash), prevHash: current.hash, proposedBy: uid, reason: input.reason.trim().slice(0, 500) })
      .returning();
    await tx.insert(productPassportEvents).values({ passportId: current.passportId, kind: 'AMENDMENT_PROPOSED', actorUserId: uid, data: { version, changed } });
    await audit(tx, actor, { action: 'used.condition_amendment_proposed', entityType: 'external_deal', entityId: deal.id, newValues: { version, changed } });
    await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.buyerId], vars: { deal: `صفقة #${deal.number}` }, link: `/account/deals/${deal.id}` });
    return row;
  });
}

/** Buyer decides on a proposed amendment. Accepting supersedes the previously agreed condition. */
export async function respondConditionAmendment(actor: Actor, dealId: string, snapshotId: string, accept: boolean) {
  const uid = requireUser(actor);
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal || deal.buyerId !== uid) throw notFound('الصفقة');
    const [row] = await tx.select().from(conditionSnapshots).where(and(eq(conditionSnapshots.id, snapshotId), eq(conditionSnapshots.dealId, deal.id))).for('update');
    if (!row || row.status !== 'PROPOSED' || !(row.snapshot as ConditionSnapshot).amendment) throw notFound('التعديل');
    if (!snapshotIntact(row)) throw conflict('التعديل ده اتلاعب فيه ومينفعش يتقبل');
    const now = new Date();
    if (accept) {
      await tx.update(conditionSnapshots).set({ status: 'SUPERSEDED', respondedAt: now }).where(and(eq(conditionSnapshots.dealId, deal.id), eq(conditionSnapshots.status, 'ACCEPTED')));
      await tx.update(conditionSnapshots).set({ status: 'ACCEPTED', respondedBy: uid, respondedAt: now }).where(eq(conditionSnapshots.id, row.id));
    } else {
      await tx.update(conditionSnapshots).set({ status: 'REJECTED', respondedBy: uid, respondedAt: now }).where(eq(conditionSnapshots.id, row.id));
    }
    await tx.insert(productPassportEvents).values({ passportId: row.passportId, kind: accept ? 'AMENDMENT_ACCEPTED' : 'AMENDMENT_REJECTED', actorUserId: uid, data: { version: row.version } });
    await audit(tx, actor, { action: accept ? 'used.condition_amendment_accepted' : 'used.condition_amendment_rejected', entityType: 'external_deal', entityId: deal.id, newValues: { version: row.version } });
    await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.sellerUserId], vars: { deal: `صفقة #${deal.number}` }, link: `/account/deals/${deal.id}` });
  });
}

/* ───────── Marketplace orders ───────── */

/**
 * Checkout = the buyer accepts the listing as documented. Every used item with a declared report gets an ACCEPTED
 * snapshot per seller order (price, shipping and the listing's return policy at that moment).
 */
export async function freezeOrderConditions(tx: DbOrTx, orderId: string) {
  const rows = await tx
    .select({ item: orderItems, so: sellerOrders, buyerId: orders.customerId, ownerUserId: sellers.ownerUserId, report: usedConditionReports })
    .from(orderItems)
    .innerJoin(sellerOrders, eq(sellerOrders.id, orderItems.sellerOrderId))
    .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
    .innerJoin(sellers, eq(sellers.id, sellerOrders.sellerId))
    .innerJoin(usedConditionReports, eq(usedConditionReports.productId, orderItems.productId))
    .where(and(eq(sellerOrders.orderId, orderId), eq(usedConditionReports.status, 'DECLARED')));
  for (const x of rows) {
    const b = await reportBundle(tx, x.report);
    if (!b.passport || !b.check.complete) continue;
    const rp = x.item.returnPolicySnapshot as { type?: string; windowDays?: number | null } | null;
    const snapshot = describe(
      b,
      {
        unitPrice: x.item.unitPrice,
        quantity: x.item.quantity,
        goodsTotal: x.item.lineTotal,
        shippingFee: x.so.shippingFee,
        deliveryMethod: null,
        processingDays: x.so.processingDays ?? null,
        deliveryMinDays: x.so.shippingEtaMinDays ?? null,
        deliveryMaxDays: x.so.shippingEtaMaxDays ?? null,
        returnPolicy: rp?.type ? { type: rp.type, windowDays: rp.windowDays ?? null } : null,
        inspectionDays: b.policy.inspection.defaultDays,
      },
      { buyerId: x.buyerId, sellerUserId: x.ownerUserId },
    );
    await tx
      .insert(conditionSnapshots)
      .values({ reportId: x.report.id, passportId: b.passport.id, sellerOrderId: x.so.id, version: 1, status: 'ACCEPTED', snapshot, hash: hashSnapshot(snapshot, null), proposedBy: x.ownerUserId, respondedBy: x.buyerId, respondedAt: new Date() })
      .onConflictDoNothing();
    await tx.insert(productPassportEvents).values({ passportId: b.passport.id, kind: 'SNAPSHOT_FROZEN', data: { channel: 'MARKETPLACE' } });
  }
}

/* ───────── Reads ───────── */

export async function dealSnapshots(dealId: string, conn: DbOrTx = db) {
  return conn.select().from(conditionSnapshots).where(eq(conditionSnapshots.dealId, dealId)).orderBy(asc(conditionSnapshots.version));
}

export async function orderSnapshots(sellerOrderIds: string[], conn: DbOrTx = db) {
  if (!sellerOrderIds.length) return [];
  return conn.select().from(conditionSnapshots).where(inArray(conditionSnapshots.sellerOrderId, sellerOrderIds)).orderBy(asc(conditionSnapshots.version));
}

/** The binding snapshot(s) a dispute is judged against, with an integrity verdict each. Caller authorizes. */
export async function snapshotsForDispute(d: { dealId: string | null; sellerOrderId: string | null }) {
  const rows = d.dealId ? await dealSnapshots(d.dealId) : d.sellerOrderId ? await orderSnapshots([d.sellerOrderId]) : [];
  return rows.filter((r) => r.status === 'ACCEPTED').map((r) => ({ row: r, snapshot: r.snapshot as ConditionSnapshot, intact: snapshotIntact(r) }));
}

export async function passportByCode(code: string) {
  const [pp] = await db.select().from(productPassports).where(eq(productPassports.code, code));
  if (!pp) return null;
  const [r] = await db.select().from(usedConditionReports).where(eq(usedConditionReports.id, pp.reportId));
  return r ? reportBundle(db, r) : null;
}

export function assertSnapshotParty(actor: Actor, snap: ConditionSnapshot) {
  if (actor.userId !== snap.parties.buyerId && actor.userId !== snap.parties.sellerUserId) throw forbidden();
}
