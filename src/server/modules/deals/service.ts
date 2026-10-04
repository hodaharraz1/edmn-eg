import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { dealMachine, paymentMachine, type DealStatus, type DisputeDecision } from '@/domain/machines';
import { audit, recordTransition } from '@/server/audit/audit';
import { requireUser, SYSTEM_ACTOR, type Actor } from '@/server/core/actor';
import { encryptJson, randomToken, sha256 } from '@/server/core/crypto';
import { env } from '@/server/core/env';
import { forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { applyBps, parseEgp } from '@/server/core/money';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { dealEvidence, dealInvitations, dealPayouts, externalDeals, legalAcceptances, paymentDestinations, paymentMethods, payments, refunds, users } from '@/server/db/schema';
import { postEntry } from '@/server/modules/finance/ledger';
import { notify, sendDirect } from '@/server/modules/notifications/notify';
import { payoutMask, payoutSchema, currentLegalVersion, type PayoutInput } from '@/server/modules/sellers/service';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason, transition } from '../_shared';
import { formatEGP } from '@/lib/format';
import { asc } from 'drizzle-orm';

export type Deal = typeof externalDeals.$inferSelect;

async function lockBuyerDeal(tx: DbOrTx, actor: Actor, dealId: string) {
  const userId = requireUser(actor);
  const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
  if (!deal) throw notFound('الصفقة');
  if (deal.buyerId !== userId) throw forbidden();
  return deal;
}

async function moveDeal(tx: DbOrTx, actor: Actor, deal: Deal, to: DealStatus, extra: Partial<Deal> = {}, reason?: string | null) {
  await transition(tx, actor, dealMachine, deal.id, deal.status, to, reason);
  await tx.update(externalDeals).set({ status: to, ...extra }).where(eq(externalDeals.id, deal.id));
}

/* ───────── Wizard ───────── */

export const step1Schema = z.object({
  title: z.string().trim().min(3, 'اكتب اسم المنتج').max(200),
  description: z.string().trim().min(10, 'اكتب وصفاً للمنتج (10 أحرف على الأقل)').max(4000),
  productCategory: z.string().trim().max(100).optional().default(''),
  condition: z.enum(['NEW', 'USED']),
  sourceUrl: z.string().trim().max(500).optional().default(''),
  quantity: z.coerce.number().int().min(1).max(10000),
});
export const step2Schema = z.object({
  sellerName: z.string().trim().min(3, 'اكتب اسم البائع').max(120),
  sellerPhone: z.string().trim().min(8, 'رقم موبايل البائع مطلوب'),
  sellerEmail: z.string().trim().toLowerCase().email('البريد غير صحيح').or(z.literal('')).optional().default(''),
});
export const step3Schema = z.object({ unitPrice: z.string().trim().min(1, 'اكتب السعر') });
export const step4Schema = z.object({
  deliveryMethod: z.string().trim().min(3, 'وضح طريقة التسليم').max(300),
  deliveryDeadline: z.coerce.date({ message: 'حدد موعد التسليم' }),
  inspectionDays: z.coerce.number().int().min(1).max(14),
});
export const step5Schema = z.object({ customTerms: z.string().trim().max(4000).optional().default('') });

export async function createDeal(actor: Actor, input: z.input<typeof step1Schema>) {
  const userId = requireUser(actor);
  const d = parse(step1Schema, input);
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .insert(externalDeals)
      .values({ buyerId: userId, title: d.title, description: d.description, productCategory: d.productCategory || null, condition: d.condition, sourceUrl: d.sourceUrl || null, quantity: d.quantity, wizardStep: 2 })
      .returning();
    await recordTransition(tx, actor, 'external_deal', deal.id, null, 'DRAFT');
    await audit(tx, actor, { action: 'deal.created', entityType: 'external_deal', entityId: deal.id });
    return deal;
  });
}

async function requireDraft(tx: DbOrTx, actor: Actor, dealId: string) {
  const deal = await lockBuyerDeal(tx, actor, dealId);
  if (deal.status !== 'DRAFT') throw invalidState('لا يمكن تعديل الصفقة بعد إرسال الدعوة');
  return deal;
}

export async function saveDealStep(actor: Actor, dealId: string, step: number, input: Record<string, unknown>) {
  return db.transaction(async (tx) => {
    const deal = await requireDraft(tx, actor, dealId);
    let sets: Partial<Deal> = {};
    if (step === 1) {
      const d = parse(step1Schema, input);
      sets = { title: d.title, description: d.description, productCategory: d.productCategory || null, condition: d.condition, sourceUrl: d.sourceUrl || null, quantity: d.quantity };
    } else if (step === 2) {
      const d = parse(step2Schema, input);
      const phone = normalizeEgyptMobile(d.sellerPhone);
      if (!phone) throw validation('رقم موبايل البائع غير صحيح');
      const [me] = await tx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, deal.buyerId));
      if (me.phone === phone || (d.sellerEmail && me.email === d.sellerEmail)) throw validation('لا يمكنك إنشاء صفقة مع نفسك');
      sets = { sellerName: d.sellerName, sellerPhone: phone, sellerEmail: d.sellerEmail || null };
    } else if (step === 3) {
      const d = parse(step3Schema, input);
      let unit: number;
      try {
        unit = parseEgp(d.unitPrice);
      } catch {
        throw validation('السعر غير صحيح');
      }
      if (unit <= 0) throw validation('السعر يجب أن يكون أكبر من صفر');
      const total = unit * deal.quantity;
      if (total > 50_000_000_00) throw validation('قيمة الصفقة تتجاوز الحد المسموح');
      const feeBps = await getSetting('deals.feeBps', tx);
      const feePayer = await getSetting('deals.feePayer', tx);
      const fee = applyBps(total, feeBps);
      sets = {
        unitPrice: unit,
        totalAmount: total,
        feeBps,
        feeAmount: fee,
        feePayer,
        buyerPays: feePayer === 'BUYER' ? total + fee : total,
        sellerReceives: feePayer === 'SELLER' ? total - fee : total,
      };
    } else if (step === 4) {
      const d = parse(step4Schema, input);
      if (d.deliveryDeadline.getTime() < Date.now() + 3600_000) throw validation('موعد التسليم يجب أن يكون في المستقبل');
      sets = { deliveryMethod: d.deliveryMethod, deliveryDeadline: d.deliveryDeadline, inspectionDays: d.inspectionDays };
    } else if (step === 5) {
      const d = parse(step5Schema, input);
      sets = { customTerms: d.customTerms || null };
    } else throw validation('خطوة غير معروفة');
    await tx.update(externalDeals).set({ ...sets, wizardStep: Math.max(deal.wizardStep, step + 1) }).where(eq(externalDeals.id, deal.id));
  });
}

export async function addDealPhotos(actor: Actor, dealId: string, photos: { data: Buffer; name: string }[]) {
  await db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (!['DRAFT', 'INVITED'].includes(deal.status)) throw invalidState('لا يمكن إضافة صور الآن');
    for (const p of photos.slice(0, 6)) {
      const f = await storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data: p.data, originalName: p.name });
      await tx.insert(dealEvidence).values({ dealId: deal.id, fileId: f.id, kind: 'PRODUCT_PHOTO', uploadedBy: actor.userId! });
    }
  });
}

export function dealProblems(deal: Deal): string[] {
  const p: string[] = [];
  if (!deal.title || !deal.description) p.push('بيانات المنتج');
  if (!deal.sellerName || !deal.sellerPhone) p.push('بيانات البائع');
  if (!deal.totalAmount) p.push('السعر');
  if (!deal.deliveryDeadline || !deal.deliveryMethod) p.push('موعد وطريقة التسليم');
  return p;
}

/** Step 7 — invite the external seller. Returns the one-time invitation link (also sent by SMS/email). */
export async function inviteSeller(actor: Actor, dealId: string, acceptTerms: boolean) {
  if (!acceptTerms) throw validation('يجب الموافقة على شروط الصفقات المحمية');
  return db.transaction(async (tx) => {
    const deal = await requireDraft(tx, actor, dealId);
    const missing = dealProblems(deal);
    if (missing.length) throw validation(`أكمل: ${missing.join('، ')}`);
    const token = randomToken(32);
    const ttl = await getSetting('deals.invitationTtlHours', tx);
    await tx.update(dealInvitations).set({ status: 'REVOKED' }).where(and(eq(dealInvitations.dealId, deal.id), eq(dealInvitations.status, 'PENDING')));
    await tx.insert(dealInvitations).values({ dealId: deal.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl * 3600_000) });
    const version = await currentLegalVersion(tx, 'EXTERNAL_DEAL_TERMS');
    await tx.insert(legalAcceptances).values({ userId: deal.buyerId, documentCode: 'EXTERNAL_DEAL_TERMS', version, context: `deal:${deal.id}:buyer`, ip: actor.ip ?? null });
    await moveDeal(tx, actor, deal, 'INVITED', { invitedAt: new Date(), termsVersion: version });
    const link = `${env().APP_URL}/deal-invite/${token}`;
    const [buyer] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, deal.buyerId));
    await sendDirect(tx, 'EXTERNAL_DEAL_INVITED', { phone: deal.sellerPhone, email: deal.sellerEmail }, {
      buyer: buyer.fullName,
      deal: deal.title,
      amount: formatEGP(deal.totalAmount),
      link,
    });
    await audit(tx, actor, { action: 'deal.invited', entityType: 'external_deal', entityId: deal.id, newValues: { termsVersion: version } });
    return { link };
  });
}

/** Issue a fresh invitation link (revokes the previous one). Only the buyer, only while INVITED. */
export async function refreshInvitation(actor: Actor, dealId: string) {
  return db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (deal.status !== 'INVITED') throw invalidState('لا يمكن إنشاء رابط دعوة جديد في الحالة الحالية');
    const token = randomToken(32);
    const ttl = await getSetting('deals.invitationTtlHours', tx);
    await tx.update(dealInvitations).set({ status: 'REVOKED' }).where(and(eq(dealInvitations.dealId, deal.id), eq(dealInvitations.status, 'PENDING')));
    await tx.insert(dealInvitations).values({ dealId: deal.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl * 3600_000) });
    await audit(tx, actor, { action: 'deal.invitation_refreshed', entityType: 'external_deal', entityId: deal.id });
    return { link: `${env().APP_URL}/deal-invite/${token}` };
  });
}

/** Look up an invitation by raw token (constant-time via hash lookup; tokens are 256-bit random). */
export async function invitationByToken(token: string) {
  if (!token || token.length < 30 || token.length > 100) return null;
  const [inv] = await db.select().from(dealInvitations).where(eq(dealInvitations.tokenHash, sha256(token)));
  if (!inv) return null;
  const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, inv.dealId));
  const [buyer] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, deal.buyerId));
  const expired = inv.expiresAt < new Date();
  const photos = await db.select().from(dealEvidence).where(and(eq(dealEvidence.dealId, deal.id), eq(dealEvidence.kind, 'PRODUCT_PHOTO')));
  return { invitation: inv, deal, buyerName: buyer.fullName, expired, usable: inv.status === 'PENDING' && !expired && deal.status === 'INVITED', photos };
}

export async function acceptInvitation(actor: Actor, token: string, payout: PayoutInput, acceptTerms: boolean) {
  const userId = requireUser(actor);
  if (!acceptTerms) throw validation('يجب الموافقة على شروط الصفقات المحمية');
  const p = parse(payoutSchema, payout);
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(dealInvitations).where(eq(dealInvitations.tokenHash, sha256(token))).for('update');
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date()) throw invalidState('الدعوة غير صالحة أو منتهية الصلاحية');
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, inv.dealId)).for('update');
    if (deal.buyerId === userId) throw forbidden('لا يمكن للمشتري قبول دعوته بنفسه');
    await tx.update(dealInvitations).set({ status: 'ACCEPTED', respondedAt: new Date(), respondedBy: userId }).where(eq(dealInvitations.id, inv.id));
    await tx.insert(legalAcceptances).values({ userId, documentCode: 'EXTERNAL_DEAL_TERMS', version: deal.termsVersion ?? 'unversioned-draft', context: `deal:${deal.id}:seller`, ip: actor.ip ?? null });
    await moveDeal(tx, actor, deal, 'ACCEPTED', {
      acceptedAt: new Date(),
      sellerUserId: userId,
      sellerPayoutType: p.type,
      sellerPayoutEnc: encryptJson(p),
      sellerPayoutMasked: payoutMask(p),
    });
    await moveDeal(tx, actor, { ...deal, status: 'ACCEPTED' }, 'PAYMENT_PENDING');
    await audit(tx, actor, { action: 'deal.accepted', entityType: 'external_deal', entityId: deal.id });
    await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.buyerId], vars: { deal: deal.number }, link: `/account/deals/${deal.id}` });
    return deal.id;
  });
}

export async function rejectInvitation(actor: Actor, token: string, reason: string) {
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(dealInvitations).where(eq(dealInvitations.tokenHash, sha256(token))).for('update');
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date()) throw invalidState('الدعوة غير صالحة أو منتهية الصلاحية');
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, inv.dealId)).for('update');
    await tx.update(dealInvitations).set({ status: 'REJECTED', respondedAt: new Date(), respondedBy: actor.userId, rejectReason: why }).where(eq(dealInvitations.id, inv.id));
    await moveDeal(tx, actor, deal, 'CANCELLED', { cancelledAt: new Date(), cancelReason: `رفض البائع: ${why}` }, why);
    await audit(tx, actor, { action: 'deal.rejected_by_seller', entityType: 'external_deal', entityId: deal.id, reason: why });
    await notify(tx, { event: 'EXTERNAL_DEAL_REJECTED', userIds: [deal.buyerId], vars: { deal: deal.number, reason: why }, link: `/account/deals/${deal.id}` });
  });
}

export async function cancelDeal(actor: Actor, dealId: string, reason: string) {
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (!['DRAFT', 'INVITED', 'ACCEPTED', 'PAYMENT_PENDING'].includes(deal.status)) throw invalidState('لا يمكن إلغاء الصفقة بعد إرسال الدفع. افتح نزاعاً إذا كانت هناك مشكلة');
    const [p] = await tx.select().from(payments).where(eq(payments.dealId, deal.id)).for('update');
    if (p && p.status !== 'AWAITING_PAYMENT' && p.status !== 'REJECTED') throw invalidState('يوجد إثبات دفع قيد المراجعة');
    if (p) {
      await transition(tx, actor, paymentMachine, p.id, p.status, 'CANCELLED', why);
      await tx.update(payments).set({ status: 'CANCELLED' }).where(eq(payments.id, p.id));
    }
    await tx.update(dealInvitations).set({ status: 'REVOKED' }).where(and(eq(dealInvitations.dealId, deal.id), eq(dealInvitations.status, 'PENDING')));
    await moveDeal(tx, actor, deal, 'CANCELLED', { cancelledAt: new Date(), cancelReason: why }, why);
    await audit(tx, actor, { action: 'deal.cancelled', entityType: 'external_deal', entityId: deal.id, reason: why });
  });
}

/** Buyer chooses how to pay → manual payment record created (same verification flow as orders). */
export async function startDealPayment(actor: Actor, dealId: string, method: 'BANK_TRANSFER' | 'INSTAPAY' | 'VODAFONE_CASH') {
  return db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (deal.status !== 'PAYMENT_PENDING') throw invalidState('الصفقة ليست بانتظار الدفع');
    const [existing] = await tx.select().from(payments).where(eq(payments.dealId, deal.id));
    if (existing) return existing;
    const [m] = await tx.select().from(paymentMethods).where(eq(paymentMethods.code, method));
    if (!m?.isEnabled) throw validation('طريقة الدفع غير متاحة');
    const dests = await tx.select().from(paymentDestinations).where(and(eq(paymentDestinations.methodCode, method), eq(paymentDestinations.isEnabled, true))).orderBy(asc(paymentDestinations.sortOrder));
    if (!dests.length) throw validation('طريقة الدفع غير مهيأة');
    const hours = await getSetting('payments.paymentWindowHours', tx);
    const [p] = await tx
      .insert(payments)
      .values({
        dealId: deal.id,
        payerUserId: deal.buyerId,
        method,
        destinationId: dests[0].id,
        destinationSnapshot: dests.map((x) => ({ label: x.label, details: x.details, instructions: x.instructionsAr })),
        amountDue: deal.buyerPays!,
        dueAt: new Date(Date.now() + hours * 3600_000),
      })
      .returning();
    await recordTransition(tx, actor, 'payment', p.id, null, 'AWAITING_PAYMENT');
    return p;
  });
}

/** Seller reports delivery/hand-over with optional proof. */
export async function markDealDelivered(actor: Actor, dealId: string, note: string, proof: { data: Buffer; name: string }[] = []) {
  const userId = requireUser(actor);
  await db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    if (deal.sellerUserId !== userId) throw forbidden();
    if (deal.status !== 'ACTIVE') throw invalidState('يمكن تسجيل التسليم بعد تأكيد الدفع فقط');
    for (const f of proof.slice(0, 6)) {
      const s = await storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data: f.data, originalName: f.name });
      await tx.insert(dealEvidence).values({ dealId: deal.id, fileId: s.id, kind: 'DELIVERY_PROOF', uploadedBy: userId, note: note.slice(0, 300) });
    }
    await moveDeal(tx, actor, deal, 'DELIVERED', { deliveredAt: new Date(), deliveryNote: note?.trim() || null });
    await audit(tx, actor, { action: 'deal.delivered', entityType: 'external_deal', entityId: deal.id });
    await notify(tx, { event: 'EXTERNAL_DEAL_DELIVERED', userIds: [deal.buyerId], vars: { deal: deal.number }, link: `/account/deals/${deal.id}` });
  });
}

async function postDealCompletion(tx: DbOrTx, actor: Actor, deal: Deal, refundToBuyer = 0) {
  const held = deal.buyerPays!;
  const remaining = held - refundToBuyer;
  const fee = Math.min(deal.feeAmount, remaining);
  const payout = remaining - fee;
  const lines = [
    { account: { code: 'DEAL_FUNDS_HELD' as const }, debit: held },
    ...(refundToBuyer > 0 ? [{ account: { code: 'CUSTOMER_REFUNDS_PAYABLE' as const }, credit: refundToBuyer }] : []),
    ...(payout > 0 ? [{ account: { code: 'DEAL_PAYOUTS_PAYABLE' as const }, credit: payout }] : []),
    ...(fee > 0 ? [{ account: { code: 'DEAL_FEE_REVENUE' as const }, credit: fee }] : []),
  ];
  await postEntry(tx, actor, {
    entryType: 'DEAL_SETTLEMENT',
    sourceType: 'external_deal',
    sourceId: deal.id,
    idempotencyKey: `deal-settle:${deal.id}`,
    description: `تسوية الصفقة المحمية #${deal.number}`,
    lines,
  });
  if (payout > 0) {
    await tx.insert(dealPayouts).values({ dealId: deal.id, payeeUserId: deal.sellerUserId, amount: payout }).onConflictDoNothing();
  }
  if (refundToBuyer > 0) {
    await tx
      .insert(refunds)
      .values({ sourceType: 'DEAL', sourceId: deal.id, customerId: deal.buyerId, dealId: deal.id, amount: refundToBuyer, reason: 'قرار نزاع صفقة محمية', createdBy: actor.userId })
      .onConflictDoNothing();
  }
}

/** Buyer confirms receipt → deal COMPLETED; seller payout becomes payable. Idempotent. */
export async function confirmDealReceipt(actor: Actor, dealId: string) {
  return db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (deal.status === 'COMPLETED') return { alreadyCompleted: true };
    if (deal.status !== 'DELIVERED' && deal.status !== 'BUYER_CONFIRMATION_PENDING') throw invalidState('لا يمكن تأكيد الاستلام قبل أن يعلن البائع التسليم');
    await moveDeal(tx, actor, deal, 'COMPLETED', { completedAt: new Date() });
    await postDealCompletion(tx, actor, deal);
    await audit(tx, actor, { action: 'deal.receipt_confirmed', entityType: 'external_deal', entityId: deal.id });
    await notify(tx, { event: 'EXTERNAL_DEAL_COMPLETED', userIds: [deal.buyerId, deal.sellerUserId], vars: { deal: deal.number }, link: `/account/deals/${deal.id}` });
    return { alreadyCompleted: false };
  });
}

/** Called by dispute resolution. */
export async function applyDealDecision(tx: DbOrTx, actor: Actor, dealId: string, decision: DisputeDecision, amount: number | null, disputeId: string, note: string) {
  const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
  if (deal.status !== 'DISPUTED') return;
  if (decision === 'FULL_REFUND') {
    await moveDeal(tx, actor, deal, 'REFUNDED', {}, note);
    await postEntry(tx, actor, {
      entryType: 'DEAL_REFUND',
      sourceType: 'external_deal',
      sourceId: deal.id,
      idempotencyKey: `deal-refund:${deal.id}`,
      description: `استرداد كامل للصفقة #${deal.number} (نزاع)`,
      lines: [
        { account: { code: 'DEAL_FUNDS_HELD' }, debit: deal.buyerPays! },
        { account: { code: 'CUSTOMER_REFUNDS_PAYABLE' }, credit: deal.buyerPays! },
      ],
    });
    await tx
      .insert(refunds)
      .values({ sourceType: 'DEAL', sourceId: deal.id, customerId: deal.buyerId, dealId: deal.id, amount: deal.buyerPays!, reason: `قرار نزاع ${disputeId}`, createdBy: actor.userId })
      .onConflictDoNothing();
  } else if (decision === 'PARTIAL_REFUND') {
    if (!amount || amount <= 0 || amount >= deal.buyerPays!) throw validation('مبلغ الاسترداد الجزئي غير صحيح');
    await moveDeal(tx, actor, deal, 'COMPLETED', { completedAt: new Date() }, note);
    await postDealCompletion(tx, actor, deal, amount);
  } else if (decision === 'RELEASE_TO_SELLER' || decision === 'REJECT_CLAIM') {
    await moveDeal(tx, actor, deal, 'COMPLETED', { completedAt: new Date() }, note);
    await postDealCompletion(tx, actor, deal);
  } else {
    // RETURN_REQUIRED / REPLACEMENT → the deal continues
    await moveDeal(tx, actor, deal, 'ACTIVE', {}, note);
  }
}

export async function onDealRefundPaid(_tx: DbOrTx, _actor: Actor, _dealId: string) {
  // Refund status is tracked on the refund record itself; deal is already REFUNDED/COMPLETED.
}

/** Job: inspection period over without buyer action → flag for operations (no automatic release). */
export async function flagDealsAwaitingConfirmation(now = new Date()) {
  const rows = await db.select().from(externalDeals).where(eq(externalDeals.status, 'DELIVERED'));
  let n = 0;
  for (const deal of rows) {
    if (!deal.deliveredAt || deal.deliveredAt.getTime() + deal.inspectionDays * 86400_000 > now.getTime()) continue;
    await db.transaction(async (tx) => {
      const [d] = await tx.select().from(externalDeals).where(eq(externalDeals.id, deal.id)).for('update');
      if (d.status !== 'DELIVERED') return;
      await moveDeal(tx, SYSTEM_ACTOR, d, 'BUYER_CONFIRMATION_PENDING', {}, 'انتهت مدة الفحص دون تأكيد');
      await notify(tx, { event: 'DELIVERY_FOLLOW_UP', userIds: [d.buyerId], vars: { order: `صفقة ${d.number}` }, link: `/account/deals/${d.id}` });
      n++;
    });
  }
  return n;
}

/* ───────── Reads ───────── */

export async function dealsForUser(userId: string) {
  return db.select().from(externalDeals).where(or(eq(externalDeals.buyerId, userId), eq(externalDeals.sellerUserId, userId))).orderBy(desc(externalDeals.createdAt));
}

export async function dealGraph(actor: Actor, dealId: string) {
  const userId = requireUser(actor);
  const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, dealId));
  if (!deal) throw notFound('الصفقة');
  const role = deal.buyerId === userId ? 'BUYER' : deal.sellerUserId === userId ? 'SELLER' : actor.type === 'ADMIN' ? 'ADMIN' : null;
  if (!role) throw forbidden();
  const [payment] = await db.select().from(payments).where(eq(payments.dealId, deal.id));
  const evidence = await db.select().from(dealEvidence).where(eq(dealEvidence.dealId, deal.id));
  const [payout] = await db.select().from(dealPayouts).where(eq(dealPayouts.dealId, deal.id));
  const [buyer] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, deal.buyerId));
  return { deal, role, payment: payment ?? null, evidence, payout: payout ?? null, buyerName: buyer.fullName };
}
