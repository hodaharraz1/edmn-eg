import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { dealMachine, paymentMachine, type DealStatus, type DisputeDecision } from '@/domain/machines';
import { audit, recordTransition } from '@/server/audit/audit';
import { requireStepUp, requireUser, SYSTEM_ACTOR, type Actor, hasPermission } from '@/server/core/actor';
import { decryptJson, encryptJson, randomToken, sha256 } from '@/server/core/crypto';
import { randomUUID } from 'node:crypto';
import { enforce, hit } from '@/server/auth/rate-limit';
import { deliveryCodeHash, deliveryCodeMatches, deliveryOtpTestMode, generateDeliveryCode } from './delivery-otp';
import { formatDate } from '@/lib/format';
import { env } from '@/server/core/env';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { applyBps, parseEgp } from '@/server/core/money';
import { normalizeEgyptMobile } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import { dealDeliveryOtps, dealEvidence, dealInvitations, dealPayouts, dealTermsVersions, externalDeals, governorates, legalAcceptances, paymentDestinations, paymentMethods, payments, refunds, riskFlags, users } from '@/server/db/schema';
import { postEntry } from '@/server/modules/finance/ledger';
import { notify } from '@/server/modules/notifications/notify';
import { enqueueJob } from '@/server/jobs/queue';
import { outboundMessages } from '@/server/db/schema';
import { decryptLocation, encryptLocation, locationFromValues, locationSchema, toStoredLocation } from '@/server/modules/locations';
import { payoutMask, payoutSchema, currentLegalVersion, type PayoutInput } from '@/server/modules/sellers/service';
import { getSetting, realMoneyEnabled } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason, transition } from '../_shared';
import { returnPolicySchema, type ReturnPolicy, type ReturnPolicySnapshot } from '@/domain/return-policy';
import { offeredDestinations } from '@/server/modules/payments/service';
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
/** Wizard order: 1 product → 2 price → 3 delivery expectations → 4 terms → 5 buyer location (+ optional seller hints). */
export const step2Schema = z.object({ unitPrice: z.string().trim().min(1, 'اكتب السعر') });
export const step3Schema = z.object({
  deliveryMethod: z.string().trim().min(3, 'وضح طريقة التسليم').max(300),
  deliveryDeadline: z.coerce.date({ message: 'حدد موعد التسليم' }),
  inspectionDays: z.coerce.number().int().min(1).max(14),
});
export const step4Schema = z.object({ customTerms: z.string().trim().max(4000).optional().default('') });
/** Seller contact hints are OPTIONAL and unverified — they only help the buyer remember who to send the link to. */
export const sellerHintsSchema = z.object({
  sellerName: z.string().trim().max(120).optional().default(''),
  sellerPhone: z.string().trim().max(30).optional().default(''),
  sellerEmail: z.string().trim().toLowerCase().email('البريد غير صحيح').or(z.literal('')).optional().default(''),
});

/** Public, human-friendly deal reference (never used as a secret). */
export const dealRef = (n: number | bigint) => `EDMN-${String(n).padStart(8, '0')}`;

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
    } else if (step === 3) {
      const d = parse(step3Schema, input);
      if (d.deliveryDeadline.getTime() < Date.now() + 3600_000) throw validation('موعد التسليم يجب أن يكون في المستقبل');
      sets = { deliveryMethod: d.deliveryMethod, deliveryDeadline: d.deliveryDeadline, inspectionDays: d.inspectionDays };
    } else if (step === 4) {
      const d = parse(step4Schema, input);
      sets = { customTerms: d.customTerms || null };
    } else if (step === 5) {
      const loc = toStoredLocation(parse(locationSchema, locationFromValues(input)));
      const h = parse(sellerHintsSchema, input);
      let hintPhone: string | null = null;
      if (h.sellerPhone) {
        hintPhone = normalizeEgyptMobile(h.sellerPhone);
        if (!hintPhone) throw validation('رقم موبايل البائع غير صحيح (أو اتركه فارغاً)');
      }
      const [me] = await tx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, deal.buyerId));
      if ((hintPhone && me.phone === hintPhone) || (h.sellerEmail && me.email === h.sellerEmail)) throw validation('لا يمكنك إنشاء صفقة مع نفسك');
      sets = {
        buyerLocationEnc: encryptLocation(loc),
        destinationGovernorateId: loc.governorateId,
        sellerName: h.sellerName || null,
        sellerPhone: hintPhone,
        sellerEmail: h.sellerEmail || null,
      };
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
  if (!deal.totalAmount) p.push('السعر');
  if (!deal.deliveryDeadline || !deal.deliveryMethod) p.push('موعد وطريقة التسليم');
  if (!deal.buyerLocationEnc) p.push('عنوان الاستلام');
  return p;
}

export const invitationPath = (token: string) => `/deal/invite/${token}`;

async function issueInvitation(tx: DbOrTx, dealId: string) {
  // 256-bit CSPRNG token; only its sha256 is stored. It carries no data about the deal or the buyer.
  const token = randomToken(32);
  const ttl = await getSetting('deals.invitationTtlHours', tx);
  await tx.update(dealInvitations).set({ status: 'REVOKED' }).where(and(eq(dealInvitations.dealId, dealId), eq(dealInvitations.status, 'PENDING')));
  await tx.insert(dealInvitations).values({ dealId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl * 3600_000) });
  return token;
}

/**
 * Create the deal request and its secure invitation link. The buyer shares the link themselves
 * (copy / WhatsApp / share sheet) — EDMN sends nothing to buyer-typed contacts, so free text can
 * never be relayed as a branded SMS. Returns the raw link once; only its hash is stored.
 */
export async function inviteSeller(actor: Actor, dealId: string, acceptTerms: boolean) {
  if (!acceptTerms) throw validation('يجب الموافقة على شروط الصفقات المحمية');
  return db.transaction(async (tx) => {
    const deal = await requireDraft(tx, actor, dealId);
    const missing = dealProblems(deal);
    if (missing.length) throw validation(`أكمل: ${missing.join('، ')}`);
    const token = await issueInvitation(tx, deal.id);
    const version = await currentLegalVersion(tx, 'EXTERNAL_DEAL_TERMS');
    await tx.insert(legalAcceptances).values({ userId: deal.buyerId, documentCode: 'EXTERNAL_DEAL_TERMS', version, context: `deal:${deal.id}:buyer`, ip: actor.ip ?? null });
    await moveDeal(tx, actor, deal, 'INVITED', { invitedAt: new Date(), termsVersion: version });
    await audit(tx, actor, { action: 'deal.invitation_created', entityType: 'external_deal', entityId: deal.id, newValues: { termsVersion: version } });
    return { link: `${env().APP_URL}${invitationPath(token)}`, token };
  });
}

/** Issue a fresh invitation link (revokes the previous one). Only the buyer, only while no seller has joined. */
export async function refreshInvitation(actor: Actor, dealId: string) {
  return db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (deal.status !== 'INVITED') throw invalidState('لا يمكن إنشاء رابط دعوة جديد في الحالة الحالية');
    const token = await issueInvitation(tx, deal.id);
    await audit(tx, actor, { action: 'deal.invitation_revoked', entityType: 'external_deal', entityId: deal.id, newValues: { reason: 'replaced' } });
    await audit(tx, actor, { action: 'deal.invitation_created', entityType: 'external_deal', entityId: deal.id });
    return { link: `${env().APP_URL}${invitationPath(token)}`, token };
  });
}

/** Revoke the active link; the deal returns to DRAFT so the buyer can edit and re-share. */
export async function revokeInvitation(actor: Actor, dealId: string) {
  await db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (deal.status !== 'INVITED') throw invalidState('لا يمكن إلغاء الرابط بعد انضمام البائع');
    await tx.update(dealInvitations).set({ status: 'REVOKED' }).where(and(eq(dealInvitations.dealId, deal.id), eq(dealInvitations.status, 'PENDING')));
    await moveDeal(tx, actor, deal, 'DRAFT');
    await audit(tx, actor, { action: 'deal.invitation_revoked', entityType: 'external_deal', entityId: deal.id });
  });
}

/**
 * Resolve an invitation for display. Returns ONLY a safe summary (no buyer name, contact or
 * location) until the viewer is the bound seller. First open is audited; an expired link is marked
 * EXPIRED (audited) the first time it is seen.
 */
export async function invitationByToken(token: string, viewerUserId?: string | null) {
  if (!token || !/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const [inv] = await db.select().from(dealInvitations).where(eq(dealInvitations.tokenHash, sha256(token)));
  if (!inv) return null;
  const [deal] = await db.select().from(externalDeals).where(eq(externalDeals.id, inv.dealId));
  const now = new Date();
  if (inv.status === 'PENDING' && inv.expiresAt < now) {
    await db.transaction(async (tx) => {
      const n = await tx.update(dealInvitations).set({ status: 'EXPIRED' }).where(and(eq(dealInvitations.id, inv.id), eq(dealInvitations.status, 'PENDING'))).returning({ id: dealInvitations.id });
      if (n.length) await audit(tx, SYSTEM_ACTOR, { action: 'deal.invitation_expired', entityType: 'external_deal', entityId: deal.id });
    });
    inv.status = 'EXPIRED';
  } else if (!inv.openedAt) {
    await db.transaction(async (tx) => {
      const n = await tx.update(dealInvitations).set({ openedAt: now }).where(and(eq(dealInvitations.id, inv.id), isNull(dealInvitations.openedAt))).returning({ id: dealInvitations.id });
      if (n.length) await audit(tx, SYSTEM_ACTOR, { action: 'deal.invitation_opened', entityType: 'external_deal', entityId: deal.id });
    });
  }
  const boundToViewer = !!viewerUserId && inv.boundUserId === viewerUserId;
  const boundToOther = !!inv.boundUserId && inv.boundUserId !== viewerUserId;
  const photos = await db.select().from(dealEvidence).where(and(eq(dealEvidence.dealId, deal.id), eq(dealEvidence.kind, 'PRODUCT_PHOTO')));
  // Only the buyer's governorate (never the address or coordinates) is shown before the seller joins.
  const [gov] = deal.destinationGovernorateId ? await db.select({ nameAr: governorates.nameAr }).from(governorates).where(eq(governorates.id, deal.destinationGovernorateId)) : [];
  return {
    status: inv.status,
    expired: inv.status === 'EXPIRED',
    usable: inv.status === 'PENDING' && (deal.status === 'INVITED' || (deal.status === 'SELLER_JOINED' && boundToViewer)),
    boundToViewer,
    boundToOther,
    isBuyer: !!viewerUserId && viewerUserId === deal.buyerId,
    dealId: deal.id,
    // Safe summary only.
    summary: {
      ref: dealRef(deal.number),
      title: deal.title,
      description: deal.description,
      condition: deal.condition,
      quantity: deal.quantity,
      totalAmount: deal.totalAmount,
      feeAmount: deal.feeAmount,
      feePayer: deal.feePayer,
      sellerReceives: deal.sellerReceives,
      deliveryMethod: deal.deliveryMethod,
      deliveryDeadline: deal.deliveryDeadline,
      inspectionDays: deal.inspectionDays,
      customTerms: deal.customTerms,
      destinationGovernorate: gov?.nameAr ?? null,
    },
    photoCount: photos.length,
  };
}

/**
 * The seller clicks "accept and continue" while signed in: the invitation is BOUND to that account
 * (once, forever). Any other account is refused afterwards. Idempotent for the same account.
 * Opening the link never binds anything and never starts any financial processing.
 */
export async function claimInvitation(actor: Actor, token: string) {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(dealInvitations).where(eq(dealInvitations.tokenHash, sha256(token))).for('update');
    if (!inv) throw invalidState('الدعوة غير صالحة');
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, inv.dealId)).for('update');
    if (inv.boundUserId) {
      if (inv.boundUserId !== userId) throw forbidden('هذه الدعوة مرتبطة بحساب آخر');
      return deal.id; // replay by the same seller: no-op
    }
    if (inv.status !== 'PENDING' || inv.expiresAt < new Date() || deal.status !== 'INVITED') throw invalidState('الدعوة غير صالحة أو منتهية الصلاحية');
    if (deal.buyerId === userId) throw forbidden('لا يمكن للمشتري قبول دعوته بنفسه');
    const now = new Date();
    await tx.update(dealInvitations).set({ boundUserId: userId, boundAt: now }).where(eq(dealInvitations.id, inv.id));
    await moveDeal(tx, actor, deal, 'SELLER_JOINED', { sellerUserId: userId, sellerJoinedAt: now });
    await audit(tx, actor, { action: 'deal.invitation_bound', entityType: 'external_deal', entityId: deal.id });
    await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.buyerId], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
    return deal.id;
  });
}

export const sellerDetailsSchema = z.object({
  fullName: z.string().trim().min(3, 'اكتب اسمك بالكامل').max(120),
  contactEmail: z.string().trim().toLowerCase().email('البريد غير صحيح').or(z.literal('')).optional().default(''),
});

/** The seller's offer: material terms the buyer reviews before agreeing (and before any payment). */
export const sellerOfferSchema = z
  .object({
  /** Final unit price offered by the seller (defaults to the buyer's requested price). */
  unitPrice: z.string().trim().optional().default(''),
  shippingFee: z.string().trim().optional().default('0'),
  /** The seller — not the buyer — sets how and how fast the item is delivered. */
  deliveryMethod: z.string().trim().min(3, 'اكتب طريقة الشحن / التسليم').max(300),
  processingDays: z.coerce.number().int().min(0).max(30),
  deliveryMinDays: z.coerce.number().int().min(0, 'مدة التوصيل غير صحيحة').max(60),
  deliveryMaxDays: z.coerce.number().int().min(0, 'مدة التوصيل غير صحيحة').max(90),
  defects: z.string().trim().max(2000).optional().default(''),
  accessories: z.string().trim().max(1000).optional().default(''),
  warranty: z.string().trim().max(500).optional().default(''),
  })
  .refine((o) => o.deliveryMaxDays >= o.deliveryMinDays, { path: ['deliveryMaxDays'], message: 'أقصى مدة توصيل يجب ألا تقل عن أقل مدة' });

export type Terms = {
  product: { title: string; description: string | null; condition: string | null; quantity: number; category: string | null };
  disclosure: { defects: string; accessories: string; warranty: string };
  price: { unitPrice: number; goodsTotal: number; shippingFee: number; totalAmount: number; feeBps: number; feeAmount: number; feePayer: string; buyerPays: number; sellerReceives: number };
  /**
   * Seller-controlled delivery terms. `deadline` / `buyerRequestedMethod` are the buyer's original
   * (non-authoritative) expectations, kept for reference.
   */
  delivery: { method: string | null; processingDays: number; expectedMinDays?: number; expectedMaxDays?: number; inspectionDays: number; deadline: string | null; buyerRequestedMethod?: string | null };
  /** The buyer's original request (price / delivery expectation) the offer answered. */
  request?: { unitPrice: number | null; deliveryMethod: string | null; latestDate: string | null };
  /** Added when both parties agree (immutable snapshot). */
  parties?: { buyerId: string; buyerName: string; sellerUserId: string | null; sellerName: string | null; sellerVerifiedPhone: string | null };
  deliveryInfo?: { originGovernorateId: number | null; destinationGovernorateId: number | null; buyerLocationRef: string | null; sellerLocationRef: string | null };
  agreement?: { version: number; proposedBy: string; proposedAt: string; agreedAt: string; acceptedByUserId: string | null };
  returnPolicy: ReturnPolicySnapshot;
  mandatoryRightsNotice: string;
  customTerms: string | null;
  dealTermsLegalVersion: string | null;
};

async function buildTerms(tx: DbOrTx, deal: Deal, offer: z.output<typeof sellerOfferSchema>, policy: ReturnPolicy): Promise<Terms> {
  let shipping: number;
  try {
    shipping = offer.shippingFee ? parseEgp(offer.shippingFee) : 0;
  } catch {
    throw validation('تكلفة الشحن غير صحيحة');
  }
  if (shipping < 0) throw validation('تكلفة الشحن غير صحيحة');
  if (deal.condition === 'USED' && !offer.defects) throw validation('للمنتج المستعمل: اكتب العيوب المعروفة (أو "لا يوجد")');
  let unit = deal.unitPrice ?? 0;
  if (offer.unitPrice) {
    try {
      unit = parseEgp(offer.unitPrice);
    } catch {
      throw validation('السعر غير صحيح');
    }
  }
  if (unit <= 0) throw validation('السعر يجب أن يكون أكبر من صفر');
  const goods = unit * deal.quantity;
  if (goods > 50_000_000_00) throw validation('قيمة الصفقة تتجاوز الحد المسموح');
  const total = goods + shipping;
  const fee = applyBps(total, deal.feeBps);
  return {
    product: { title: deal.title, description: deal.description, condition: deal.condition, quantity: deal.quantity, category: deal.productCategory },
    disclosure: { defects: offer.defects, accessories: offer.accessories, warranty: offer.warranty },
    price: { unitPrice: unit, goodsTotal: goods, shippingFee: shipping, totalAmount: total, feeBps: deal.feeBps, feeAmount: fee, feePayer: deal.feePayer, buyerPays: deal.feePayer === 'BUYER' ? total + fee : total, sellerReceives: deal.feePayer === 'SELLER' ? total - fee : total },
    delivery: {
      method: offer.deliveryMethod,
      processingDays: offer.processingDays,
      expectedMinDays: offer.deliveryMinDays,
      expectedMaxDays: offer.deliveryMaxDays,
      inspectionDays: deal.inspectionDays,
      deadline: deal.deliveryDeadline?.toISOString() ?? null,
      buyerRequestedMethod: deal.deliveryMethod,
    },
    request: { unitPrice: deal.unitPrice, deliveryMethod: deal.deliveryMethod, latestDate: deal.deliveryDeadline?.toISOString() ?? null },
    returnPolicy: { ...policy, legalNoticeVersion: await currentLegalVersion(tx, 'RETURNS_POLICY') },
    mandatoryRightsNotice: await getSetting('returns.mandatoryRightsNotice', tx),
    customTerms: deal.customTerms,
    dealTermsLegalVersion: deal.termsVersion,
  };
}

async function nextVersion(tx: DbOrTx, dealId: string) {
  const [r] = await tx.select({ v: sql<number>`coalesce(max(${dealTermsVersions.version}), 0)` }).from(dealTermsVersions).where(eq(dealTermsVersions.dealId, dealId));
  return Number(r?.v ?? 0) + 1;
}

async function closeOpenVersions(tx: DbOrTx, dealId: string, as: 'SUPERSEDED' | 'REJECTED') {
  await tx.update(dealTermsVersions).set({ status: as, respondedAt: new Date() }).where(and(eq(dealTermsVersions.dealId, dealId), eq(dealTermsVersions.status, 'PROPOSED')));
}

/**
 * Seller submits an offer (first time: together with their own identity, pickup location and
 * payout details; later: as a counter-offer). Every offer is a NEW terms version; the buyer must
 * explicitly agree before anything financial happens.
 */
export async function submitSellerOffer(
  actor: Actor,
  dealId: string,
  input: { details?: z.input<typeof sellerDetailsSchema>; location?: Record<string, unknown>; payout?: PayoutInput; offer: z.input<typeof sellerOfferSchema>; returnPolicy: unknown; message?: string },
  acceptTerms: boolean,
) {
  const userId = requireUser(actor);
  if (!acceptTerms) throw validation('يجب الموافقة على شروط الصفقات المحمية');
  const offer = parse(sellerOfferSchema, input.offer);
  const policy = parse(returnPolicySchema, input.returnPolicy);
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    if (deal.sellerUserId !== userId) throw forbidden();
    if (deal.status !== 'SELLER_JOINED' && deal.status !== 'CHANGE_REQUESTED') throw invalidState('لا يمكن تقديم عرض في حالة الصفقة الحالية');
    let sellerSets: Partial<Deal> = {};
    if (deal.status === 'SELLER_JOINED') {
      const [me] = await tx.select({ phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, userId));
      if (!me?.phoneVerifiedAt) throw validation('أكّد رقم موبايلك أولاً قبل تقديم العرض');
      const details = parse(sellerDetailsSchema, input.details ?? {});
      const loc = toStoredLocation(parse(locationSchema, input.location ?? {}));
      const p = parse(payoutSchema, input.payout);
      sellerSets = {
        sellerFullName: details.fullName,
        sellerVerifiedPhone: me.phone,
        sellerContactEmail: details.contactEmail || null,
        sellerLocationEnc: encryptLocation(loc),
        originGovernorateId: loc.governorateId,
        sellerPayoutType: p.type,
        sellerPayoutEnc: encryptJson(p),
        sellerPayoutMasked: payoutMask(p),
      };
      await tx.insert(legalAcceptances).values({ userId, documentCode: 'EXTERNAL_DEAL_TERMS', version: deal.termsVersion ?? 'unversioned-draft', context: `deal:${deal.id}:seller`, ip: actor.ip ?? null });
    }
    const terms = await buildTerms(tx, deal, offer, policy);
    await closeOpenVersions(tx, deal.id, 'SUPERSEDED');
    const version = await nextVersion(tx, deal.id);
    await tx.insert(dealTermsVersions).values({ dealId: deal.id, version, proposedBy: 'SELLER', proposedByUserId: userId, terms, message: input.message?.trim().slice(0, 1000) || null });
    await moveDeal(tx, actor, deal, 'OFFER_PENDING_BUYER', sellerSets);
    await audit(tx, actor, { action: deal.status === 'SELLER_JOINED' ? 'deal.offer_submitted' : 'deal.offer_countered', entityType: 'external_deal', entityId: deal.id, newValues: { version, returnPolicy: policy.type, windowDays: policy.windowDays } });
    await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.buyerId], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
    return { version };
  });
}

/** Both parties agreed on `v`: freeze the snapshot (DB-immutable) and open the payment step. */
async function finalizeTerms(tx: DbOrTx, actor: Actor, deal: Deal, v: typeof dealTermsVersions.$inferSelect) {
  const t = v.terms as unknown as Terms;
  const now = new Date();
  const [buyer] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, deal.buyerId));
  // The agreed snapshot also freezes who agreed, where it ships from/to (encrypted locations are
  // referenced by fingerprint, never copied in clear) and when each side committed.
  const snapshot: Terms = {
    ...t,
    parties: { buyerId: deal.buyerId, buyerName: buyer?.fullName ?? '', sellerUserId: deal.sellerUserId, sellerName: deal.sellerFullName, sellerVerifiedPhone: deal.sellerVerifiedPhone },
    deliveryInfo: {
      originGovernorateId: deal.originGovernorateId,
      destinationGovernorateId: deal.destinationGovernorateId,
      buyerLocationRef: deal.buyerLocationEnc ? sha256(deal.buyerLocationEnc) : null,
      sellerLocationRef: deal.sellerLocationEnc ? sha256(deal.sellerLocationEnc) : null,
    },
    agreement: { version: v.version, proposedBy: v.proposedBy, proposedAt: v.createdAt.toISOString(), agreedAt: now.toISOString(), acceptedByUserId: actor.userId ?? null },
  };
  await tx.update(dealTermsVersions).set({ status: 'ACCEPTED', respondedAt: now }).where(eq(dealTermsVersions.id, v.id));
  await tx.update(dealInvitations).set({ status: 'ACCEPTED', respondedAt: new Date(), respondedBy: deal.sellerUserId }).where(and(eq(dealInvitations.dealId, deal.id), eq(dealInvitations.status, 'PENDING')));
  await moveDeal(tx, actor, deal, 'ACCEPTED', {
    acceptedAt: new Date(),
    agreedTerms: snapshot,
    agreedVersion: v.version,
    agreedAt: now,
    unitPrice: t.price.unitPrice,
    shippingFee: t.price.shippingFee,
    processingDays: t.delivery.processingDays,
    totalAmount: t.price.totalAmount,
    feeAmount: t.price.feeAmount,
    buyerPays: t.price.buyerPays,
    sellerReceives: t.price.sellerReceives,
  });
  await moveDeal(tx, actor, { ...deal, status: 'ACCEPTED' }, 'PAYMENT_PENDING');
  await audit(tx, actor, { action: 'deal.terms_agreed', entityType: 'external_deal', entityId: deal.id, newValues: { version: v.version, returnPolicy: t.returnPolicy.type } });
  await audit(tx, actor, { action: 'deal.invitation_accepted', entityType: 'external_deal', entityId: deal.id });
  await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.buyerId, deal.sellerUserId!], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
}

export const changeRequestSchema = z.object({ message: z.string().trim().min(3, 'اكتب التعديل المطلوب').max(1000) });

/** Buyer reviews the seller's offer: accept it, request a change (return policy), or reject the deal. */
export async function respondToOffer(actor: Actor, dealId: string, version: number, decision: 'ACCEPT' | 'REQUEST_CHANGE' | 'REJECT', change?: { returnPolicy: unknown; message: string }) {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    if (deal.buyerId !== userId) throw forbidden();
    if (decision === 'ACCEPT' && deal.agreedVersion === version && (deal.status === 'ACCEPTED' || deal.status === 'PAYMENT_PENDING')) return { status: deal.status }; // idempotent
    if (deal.status !== 'OFFER_PENDING_BUYER') throw invalidState('لا يوجد عرض بانتظار ردك');
    const [v] = await tx.select().from(dealTermsVersions).where(and(eq(dealTermsVersions.dealId, deal.id), eq(dealTermsVersions.version, version))).for('update');
    if (!v || v.status !== 'PROPOSED' || v.proposedBy !== 'SELLER') throw invalidState('هذا العرض لم يعد قائماً، راجع آخر نسخة');
    if (decision === 'ACCEPT') {
      await finalizeTerms(tx, actor, deal, v);
      return { status: 'PAYMENT_PENDING' };
    }
    if (decision === 'REJECT') {
      await closeOpenVersions(tx, deal.id, 'REJECTED');
      await tx.update(dealInvitations).set({ status: 'REJECTED', respondedAt: new Date() }).where(and(eq(dealInvitations.dealId, deal.id), eq(dealInvitations.status, 'PENDING')));
      await moveDeal(tx, actor, deal, 'CANCELLED', { cancelledAt: new Date(), cancelReason: 'رفض المشتري عرض البائع' });
      await audit(tx, actor, { action: 'deal.offer_rejected_by_buyer', entityType: 'external_deal', entityId: deal.id, newValues: { version } });
      if (deal.sellerUserId) await notify(tx, { event: 'EXTERNAL_DEAL_REJECTED', userIds: [deal.sellerUserId], vars: { deal: dealRef(deal.number), reason: 'رفض المشتري العرض' }, link: `/account/deals/${deal.id}` });
      return { status: 'CANCELLED' };
    }
    const policy = parse(returnPolicySchema, change?.returnPolicy);
    const { message } = parse(changeRequestSchema, { message: change?.message ?? '' });
    const t = v.terms as unknown as Terms;
    const proposed: Terms = { ...t, returnPolicy: { ...policy, legalNoticeVersion: t.returnPolicy.legalNoticeVersion } };
    await closeOpenVersions(tx, deal.id, 'SUPERSEDED');
    const nv = await nextVersion(tx, deal.id);
    await tx.insert(dealTermsVersions).values({ dealId: deal.id, version: nv, proposedBy: 'BUYER', proposedByUserId: userId, terms: proposed, message });
    await moveDeal(tx, actor, deal, 'CHANGE_REQUESTED');
    await audit(tx, actor, { action: 'deal.change_requested', entityType: 'external_deal', entityId: deal.id, newValues: { version: nv, returnPolicy: policy.type, windowDays: policy.windowDays } });
    if (deal.sellerUserId) await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.sellerUserId], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
    return { status: 'CHANGE_REQUESTED', version: nv };
  });
}

/** Seller answers a buyer's change request: accept it as-is (both agreed) or reject it (previous offer stands). Counter = submitSellerOffer. */
export async function respondToChangeRequest(actor: Actor, dealId: string, version: number, decision: 'ACCEPT' | 'REJECT') {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    if (deal.sellerUserId !== userId) throw forbidden();
    if (decision === 'ACCEPT' && deal.agreedVersion === version && (deal.status === 'ACCEPTED' || deal.status === 'PAYMENT_PENDING')) return { status: deal.status };
    if (deal.status !== 'CHANGE_REQUESTED') throw invalidState('لا يوجد طلب تعديل بانتظار ردك');
    const [v] = await tx.select().from(dealTermsVersions).where(and(eq(dealTermsVersions.dealId, deal.id), eq(dealTermsVersions.version, version))).for('update');
    if (!v || v.status !== 'PROPOSED' || v.proposedBy !== 'BUYER') throw invalidState('طلب التعديل لم يعد قائماً');
    if (decision === 'ACCEPT') {
      await finalizeTerms(tx, actor, deal, v);
      return { status: 'PAYMENT_PENDING' };
    }
    // Reject the change: the seller's last offer is re-proposed as a new version (history kept).
    const [lastSeller] = await tx.select().from(dealTermsVersions).where(and(eq(dealTermsVersions.dealId, deal.id), eq(dealTermsVersions.proposedBy, 'SELLER'))).orderBy(desc(dealTermsVersions.version)).limit(1);
    await tx.update(dealTermsVersions).set({ status: 'REJECTED', respondedAt: new Date() }).where(eq(dealTermsVersions.id, v.id));
    const nv = await nextVersion(tx, deal.id);
    await tx.insert(dealTermsVersions).values({ dealId: deal.id, version: nv, proposedBy: 'SELLER', proposedByUserId: userId, terms: lastSeller.terms, message: 'رفض البائع التعديل المطلوب — العرض السابق قائم' });
    await moveDeal(tx, actor, deal, 'OFFER_PENDING_BUYER');
    await audit(tx, actor, { action: 'deal.change_rejected', entityType: 'external_deal', entityId: deal.id, newValues: { rejectedVersion: version, reproposedVersion: nv } });
    await notify(tx, { event: 'EXTERNAL_DEAL_ACCEPTED', userIds: [deal.buyerId], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
    return { status: 'OFFER_PENDING_BUYER', version: nv };
  });
}

export async function termsHistory(actor: Actor, dealId: string) {
  await dealGraph(actor, dealId); // authorization
  return db.select().from(dealTermsVersions).where(eq(dealTermsVersions.dealId, dealId)).orderBy(asc(dealTermsVersions.version));
}

/** Reject: anyone signed in holding a still-unbound link, or the bound seller from the deal page. */
export async function rejectInvitation(actor: Actor, ref: { token?: string; dealId?: string }, reason: string) {
  const userId = requireUser(actor);
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [inv] = ref.token
      ? await tx.select().from(dealInvitations).where(eq(dealInvitations.tokenHash, sha256(ref.token))).for('update')
      : await tx.select().from(dealInvitations).where(and(eq(dealInvitations.dealId, ref.dealId ?? ''), eq(dealInvitations.boundUserId, userId))).for('update');
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date()) throw invalidState('الدعوة غير صالحة أو منتهية الصلاحية');
    if (inv.boundUserId && inv.boundUserId !== userId) throw forbidden('هذه الدعوة مرتبطة بحساب آخر');
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, inv.dealId)).for('update');
    if (deal.buyerId === userId) throw forbidden();
    if (deal.status !== 'INVITED' && deal.status !== 'SELLER_JOINED') throw invalidState('لا يمكن رفض الصفقة في حالتها الحالية');
    await tx.update(dealInvitations).set({ status: 'REJECTED', respondedAt: new Date(), respondedBy: userId, rejectReason: why }).where(eq(dealInvitations.id, inv.id));
    await moveDeal(tx, actor, deal, 'CANCELLED', { cancelledAt: new Date(), cancelReason: `رفض البائع: ${why}` }, why);
    await audit(tx, actor, { action: 'deal.rejected_by_seller', entityType: 'external_deal', entityId: deal.id, reason: why });
    await notify(tx, { event: 'EXTERNAL_DEAL_REJECTED', userIds: [deal.buyerId], vars: { deal: dealRef(deal.number), reason: why }, link: `/account/deals/${deal.id}` });
  });
}

/** Background: mark lapsed invitations EXPIRED (audited) so the lifecycle is explicit. */
export async function expireDealInvitations(now = new Date()) {
  const rows = await db.select().from(dealInvitations).where(and(eq(dealInvitations.status, 'PENDING'), lt(dealInvitations.expiresAt, now)));
  for (const inv of rows) {
    await db.transaction(async (tx) => {
      const n = await tx.update(dealInvitations).set({ status: 'EXPIRED' }).where(and(eq(dealInvitations.id, inv.id), eq(dealInvitations.status, 'PENDING'))).returning({ id: dealInvitations.id });
      if (n.length) await audit(tx, SYSTEM_ACTOR, { action: 'deal.invitation_expired', entityType: 'external_deal', entityId: inv.dealId });
    });
  }
  return rows.length;
}

export async function cancelDeal(actor: Actor, dealId: string, reason: string) {
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (!['DRAFT', 'INVITED', 'SELLER_JOINED', 'OFFER_PENDING_BUYER', 'CHANGE_REQUESTED', 'ACCEPTED', 'PAYMENT_PENDING'].includes(deal.status)) throw invalidState('لا يمكن إلغاء الصفقة بعد إرسال الدفع. افتح نزاعاً إذا كانت هناك مشكلة');
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
    const dests = await tx.select().from(paymentDestinations).where(and(eq(paymentDestinations.methodCode, method), offeredDestinations(await realMoneyEnabled(tx)))).orderBy(asc(paymentDestinations.sortOrder));
    if (!dests.length) throw validation('طريقة الدفع غير مهيأة');
    const hours = await getSetting('payments.paymentWindowHours', tx);
    const [p] = await tx
      .insert(payments)
      .values({
        dealId: deal.id,
        payerUserId: deal.buyerId,
        isTest: !(await realMoneyEnabled(tx)),
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
    // "Delivered" here means shipped / out for handover. It moves NO money; the buyer's handover code
    // is issued now and must be verified at the physical handover.
    await moveDeal(tx, actor, deal, 'DELIVERED', { deliveredAt: new Date(), deliveryNote: note?.trim() || null, deliveryAttempt: deal.deliveryAttempt + 1 });
    await audit(tx, actor, { action: 'deal.shipped', entityType: 'external_deal', entityId: deal.id, newValues: { deliveryAttempt: deal.deliveryAttempt + 1, proofFiles: proof.length } });
    await notify(tx, { event: 'EXTERNAL_DEAL_DELIVERED', userIds: [deal.buyerId], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
    await issueDeliveryOtpTx(tx, actor, { ...deal, deliveryAttempt: deal.deliveryAttempt + 1 }, 'deal.delivery_otp_issued');
  });
}

/* ───────── Delivery handover OTP ───────── */

const ACTIVE_OTP = (dealId: string) => and(eq(dealDeliveryOtps.dealId, dealId), isNull(dealDeliveryOtps.usedAt), isNull(dealDeliveryOtps.invalidatedAt));

/**
 * Issue a fresh handover code for the BUYER (any previous usable code is invalidated first). The code
 * goes to the buyer by SMS through the notification abstraction; only its HMAC is stored. Nothing in
 * the return value, audit log, in-app notification or logs contains the code.
 */
async function issueDeliveryOtpTx(tx: DbOrTx, actor: Actor, deal: Deal, auditAction: 'deal.delivery_otp_issued' | 'deal.delivery_otp_regenerated') {
  const prev = await tx.update(dealDeliveryOtps).set({ invalidatedAt: new Date(), invalidReason: 'REGENERATED' }).where(ACTIVE_OTP(deal.id)).returning({ id: dealDeliveryOtps.id });
  const ttlHours = await getSetting('deals.deliveryOtpTtlHours', tx);
  const maxAttempts = await getSetting('deals.deliveryOtpMaxAttempts', tx);
  const id = randomUUID();
  const code = generateDeliveryCode();
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await tx.insert(dealDeliveryOtps).values({
    id,
    dealId: deal.id,
    buyerId: deal.buyerId,
    deliveryAttempt: Math.max(1, deal.deliveryAttempt),
    codeHash: deliveryCodeHash(deal.id, id, code),
    testCodeEnc: deliveryOtpTestMode() ? encryptJson(code) : null,
    expiresAt,
    maxAttempts,
    issuedBy: actor.userId ?? null,
  });
  const [buyer] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, deal.buyerId));
  if (buyer?.phone) {
    const body = `رمز استلام صفقة اضمن #${dealRef(deal.number)}: ${code} — لا تعطه لأحد إلا عند استلام المنتج فعليًا. صالح حتى ${formatDate(expiresAt, true)}.`;
    await tx.insert(outboundMessages).values({ channel: 'SMS', recipient: buyer.phone, body, event: 'DEAL_DELIVERY_OTP' });
    await enqueueJob(tx, 'outbound.flush', {}, { dedupeKey: 'outbound.flush' });
  }
  await audit(tx, actor, { action: auditAction, entityType: 'external_deal', entityId: deal.id, newValues: { otpId: id, deliveryAttempt: Math.max(1, deal.deliveryAttempt), expiresAt: expiresAt.toISOString(), maxAttempts, invalidatedPrevious: prev.length } });
  return { otpId: id, expiresAt };
}

/** Buyer (or the bound seller, on the buyer's behalf) asks for a new code; it is always sent to the BUYER. */
export async function regenerateDeliveryOtp(actor: Actor, dealId: string) {
  const userId = requireUser(actor);
  if (!(await hit(`deal-otp-issue:${dealId}`, 5, 3600))) throw new DomainError('RATE_LIMITED', 'طلبت رموزًا كثيرة. حاول مرة أخرى بعد قليل');
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    if (deal.buyerId !== userId && deal.sellerUserId !== userId) throw forbidden();
    if (deal.status !== 'DELIVERED') throw invalidState('رمز الاستلام متاح فقط بعد الشحن وقبل التحقق من التسليم');
    const r = await issueDeliveryOtpTx(tx, actor, deal, 'deal.delivery_otp_regenerated');
    return { expiresAt: r.expiresAt };
  });
}

type VerifyOutcome = { ok: true } | { ok: false; error: DomainError };

/**
 * The seller / courier enters the code the buyer handed over. Rate-limited per deal and per user,
 * limited attempts per code, single use, row-locked (concurrent submissions verify at most once).
 * Success moves the deal to DELIVERY_HANDOVER_VERIFIED only — funds stay held.
 */
export async function verifyDeliveryOtp(actor: Actor, dealId: string, code: string) {
  const userId = requireUser(actor);
  await enforce(`deal-otp-verify:${dealId}`, 10, 900);
  await enforce(`deal-otp-verify-user:${userId}`, 20, 900);
  const candidate = String(code ?? '').trim();
  const outcome: VerifyOutcome = await db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) return { ok: false, error: notFound('الصفقة') };
    if (deal.sellerUserId !== userId) return { ok: false, error: forbidden('إدخال رمز الاستلام متاح لبائع الصفقة فقط') };
    if (deal.status !== 'DELIVERED') return { ok: false, error: invalidState(deal.handoverVerifiedAt ? 'تم التحقق من التسليم مسبقًا' : 'لا يمكن التحقق من التسليم في حالة الصفقة الحالية') };
    const [otp] = await tx.select().from(dealDeliveryOtps).where(ACTIVE_OTP(deal.id)).for('update');
    if (!otp || otp.buyerId !== deal.buyerId) return { ok: false, error: invalidState('لا يوجد رمز صالح. اطلب من المشتري رمزًا جديدًا') };
    const now = new Date();
    if (otp.expiresAt <= now) {
      await tx.update(dealDeliveryOtps).set({ invalidatedAt: now, invalidReason: 'EXPIRED' }).where(eq(dealDeliveryOtps.id, otp.id));
      await audit(tx, actor, { action: 'deal.delivery_otp_expired', entityType: 'external_deal', entityId: deal.id, newValues: { otpId: otp.id } });
      return { ok: false, error: invalidState('انتهت صلاحية رمز الاستلام. اطلب رمزًا جديدًا') };
    }
    const attempts = otp.attempts + 1;
    if (!deliveryCodeMatches(otp.codeHash, deal.id, otp.id, candidate)) {
      const locked = attempts >= otp.maxAttempts;
      await tx
        .update(dealDeliveryOtps)
        .set({ attempts, lastAttemptAt: now, ...(locked ? { invalidatedAt: now, invalidReason: 'LOCKED' as const } : {}) })
        .where(eq(dealDeliveryOtps.id, otp.id));
      await audit(tx, actor, { action: 'deal.delivery_otp_failed', entityType: 'external_deal', entityId: deal.id, newValues: { otpId: otp.id, attempt: attempts, maxAttempts: otp.maxAttempts, locked } });
      return {
        ok: false,
        error: validation(locked ? 'تم تجاوز عدد المحاولات. اطلب من المشتري رمزًا جديدًا' : `رمز الاستلام غير صحيح (متبقٍ ${otp.maxAttempts - attempts} محاولة)`),
      };
    }
    await tx.update(dealDeliveryOtps).set({ attempts, lastAttemptAt: now, usedAt: now, usedBy: userId }).where(eq(dealDeliveryOtps.id, otp.id));
    await moveDeal(tx, actor, deal, 'DELIVERY_HANDOVER_VERIFIED', { handoverVerifiedAt: now, handoverOtpId: otp.id });
    await audit(tx, actor, { action: 'deal.delivery_otp_verified', entityType: 'external_deal', entityId: deal.id, newValues: { otpId: otp.id, attempt: attempts, deliveryAttempt: otp.deliveryAttempt } });
    await notify(tx, { event: 'DEAL_HANDOVER_VERIFIED', userIds: [deal.buyerId, deal.sellerUserId], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
    return { ok: true };
  });
  if (!outcome.ok) throw outcome.error;
  return { status: 'DELIVERY_HANDOVER_VERIFIED' as const };
}

/**
 * The BUYER's view of the current code: status, expiry and attempts left. The code itself is returned
 * only in staging / development test mode (production never keeps a recoverable copy). Never callable
 * by the seller or anyone else.
 */
export async function deliveryOtpForBuyer(actor: Actor, dealId: string) {
  const userId = requireUser(actor);
  const [deal] = await db.select({ buyerId: externalDeals.buyerId, status: externalDeals.status }).from(externalDeals).where(eq(externalDeals.id, dealId));
  if (!deal) throw notFound('الصفقة');
  if (deal.buyerId !== userId) throw forbidden();
  if (deal.status !== 'DELIVERED') return null;
  const [otp] = await db.select().from(dealDeliveryOtps).where(ACTIVE_OTP(dealId));
  if (!otp || otp.buyerId !== userId) return { active: false as const };
  const expired = otp.expiresAt <= new Date();
  return {
    active: !expired,
    expiresAt: otp.expiresAt,
    attemptsLeft: otp.maxAttempts - otp.attempts,
    testCode: !expired && deliveryOtpTestMode() && otp.testCodeEnc ? decryptJson<string>(otp.testCodeEnc) : null,
  };
}

/** Handover evidence for parties / staff — never includes the code or its hash. */
export async function deliveryOtpEvents(dealId: string) {
  return db
    .select({
      id: dealDeliveryOtps.id,
      deliveryAttempt: dealDeliveryOtps.deliveryAttempt,
      createdAt: dealDeliveryOtps.createdAt,
      expiresAt: dealDeliveryOtps.expiresAt,
      attempts: dealDeliveryOtps.attempts,
      maxAttempts: dealDeliveryOtps.maxAttempts,
      lastAttemptAt: dealDeliveryOtps.lastAttemptAt,
      usedAt: dealDeliveryOtps.usedAt,
      invalidatedAt: dealDeliveryOtps.invalidatedAt,
      invalidReason: dealDeliveryOtps.invalidReason,
    })
    .from(dealDeliveryOtps)
    .where(eq(dealDeliveryOtps.dealId, dealId))
    .orderBy(asc(dealDeliveryOtps.createdAt));
}

/** Job: mark lapsed handover codes EXPIRED (audited). */
export async function expireDeliveryOtps(now = new Date()) {
  const rows = await db.select({ id: dealDeliveryOtps.id, dealId: dealDeliveryOtps.dealId }).from(dealDeliveryOtps).where(and(isNull(dealDeliveryOtps.usedAt), isNull(dealDeliveryOtps.invalidatedAt), lt(dealDeliveryOtps.expiresAt, now)));
  for (const r of rows) {
    await db.transaction(async (tx) => {
      const n = await tx.update(dealDeliveryOtps).set({ invalidatedAt: now, invalidReason: 'EXPIRED' }).where(and(eq(dealDeliveryOtps.id, r.id), isNull(dealDeliveryOtps.usedAt), isNull(dealDeliveryOtps.invalidatedAt))).returning({ id: dealDeliveryOtps.id });
      if (n.length) await audit(tx, SYSTEM_ACTOR, { action: 'deal.delivery_otp_expired', entityType: 'external_deal', entityId: r.dealId, newValues: { otpId: r.id } });
    });
  }
  return rows.length;
}

const HOLD_FLAG_CODES = ['DELIVERY_CONFLICT', 'DELIVERY_EXCEPTION', 'ADMIN_HOLD'];

async function openDeliveryReview(tx: DbOrTx, actor: Actor, deal: Deal, kind: 'DELIVERY_CONFLICT' | 'DELIVERY_EXCEPTION', description: string) {
  const { openDisputeTx } = await import('@/server/modules/postpurchase/disputes');
  const dispute = await openDisputeTx(tx, actor, { dealId: deal.id, reasonCode: kind, description, claimantUserId: actor.userId! });
  await tx.insert(riskFlags).values({
    entityType: 'external_deal',
    entityId: deal.id,
    code: kind,
    severity: 'HIGH',
    note: kind === 'DELIVERY_CONFLICT' ? 'المشتري أفاد بعدم الاستلام رغم التحقق برمز الاستلام' : 'تعذر إتمام التحقق برمز الاستلام',
    meta: { disputeId: dispute.id, handoverOtpId: deal.handoverOtpId, handoverVerifiedAt: deal.handoverVerifiedAt?.toISOString() ?? null },
    createdBy: actor.userId ?? null,
  });
  await audit(tx, actor, { action: kind === 'DELIVERY_CONFLICT' ? 'deal.delivery_conflict' : 'deal.delivery_exception', entityType: 'external_deal', entityId: deal.id, newValues: { disputeId: dispute.id } });
  await notify(tx, { event: 'DEAL_DELIVERY_REVIEW', userIds: [deal.buyerId, deal.sellerUserId], vars: { deal: dealRef(deal.number) }, link: `/account/deals/${deal.id}` });
  return dispute;
}

/**
 * Buyer: "لم أستلم المنتج فعليًا". After a verified handover this is a DELIVERY_CONFLICT: the OTP is
 * evidence, not a judgment — funds stay held and Operations decides through the dispute.
 */
export async function reportNotReceived(actor: Actor, dealId: string, description: string) {
  const why = requireReason(description);
  return db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (!['DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING'].includes(deal.status)) throw invalidState('لا يمكن الإبلاغ عن عدم الاستلام في حالة الصفقة الحالية');
    await tx.update(dealDeliveryOtps).set({ invalidatedAt: new Date(), invalidReason: 'CLOSED' }).where(ACTIVE_OTP(deal.id));
    if (deal.handoverVerifiedAt) {
      await tx.update(externalDeals).set({ deliveryConflictAt: new Date() }).where(eq(externalDeals.id, deal.id));
      return { conflict: true, dispute: await openDeliveryReview(tx, actor, deal, 'DELIVERY_CONFLICT', why) };
    }
    const { openDisputeTx } = await import('@/server/modules/postpurchase/disputes');
    return { conflict: false, dispute: await openDisputeTx(tx, actor, { dealId: deal.id, reasonCode: 'NOT_RECEIVED', description: why, claimantUserId: actor.userId! }) };
  });
}

/** Buyer or seller: the code cannot be used (no phone / lost / courier issue) → Operations review. Never releases funds. */
export async function reportDeliveryException(actor: Actor, dealId: string, description: string) {
  const userId = requireUser(actor);
  const why = requireReason(description);
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    if (deal.buyerId !== userId && deal.sellerUserId !== userId) throw forbidden();
    if (deal.status !== 'DELIVERED') throw invalidState('طلب المراجعة متاح بعد الشحن وقبل التحقق من التسليم');
    await tx.update(dealDeliveryOtps).set({ invalidatedAt: new Date(), invalidReason: 'CLOSED' }).where(ACTIVE_OTP(deal.id));
    return openDeliveryReview(tx, actor, deal, 'DELIVERY_EXCEPTION', why);
  });
}

/** Operations hold on a deal (admin, step-up). While held, the buyer's confirmation cannot release the payout. */
export async function setDealFinancialHold(actor: Actor, dealId: string, hold: boolean, reason: string) {
  if (!hasPermission(actor, 'deals.manage')) throw forbidden();
  requireStepUp(actor);
  const why = requireReason(reason);
  await db.transaction(async (tx) => {
    const [deal] = await tx.select().from(externalDeals).where(eq(externalDeals.id, dealId)).for('update');
    if (!deal) throw notFound('الصفقة');
    await tx.update(externalDeals).set({ financialHold: hold }).where(eq(externalDeals.id, deal.id));
    await audit(tx, actor, { action: hold ? 'deal.hold_set' : 'deal.hold_released', entityType: 'external_deal', entityId: deal.id, reason: why });
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

/**
 * Buyer: "استلمت والمنتج مطابق" (explicit, after a VERIFIED handover). Only this — never the OTP, the
 * waybill, tracking or GPS — makes the seller's net amount payable, and only when payment is confirmed,
 * there is no dispute, no Operations hold and no open hold risk flag. Exactly once (row lock +
 * idempotent settlement key).
 */
export async function confirmDealReceipt(actor: Actor, dealId: string) {
  return db.transaction(async (tx) => {
    const deal = await lockBuyerDeal(tx, actor, dealId);
    if (deal.status === 'COMPLETED') return { alreadyCompleted: true };
    if (deal.status !== 'DELIVERY_HANDOVER_VERIFIED' && deal.status !== 'BUYER_CONFIRMATION_PENDING') {
      throw invalidState(deal.status === 'DELIVERED' ? 'يجب التحقق من التسليم برمز الاستلام أولًا' : 'لا يمكن تأكيد الاستلام في حالة الصفقة الحالية');
    }
    if (!deal.handoverVerifiedAt || !deal.handoverOtpId) throw invalidState('يجب التحقق من التسليم برمز الاستلام أولًا');
    const [pay] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.dealId, deal.id));
    if (pay?.status !== 'CONFIRMED') throw invalidState('لم يتم تأكيد الدفع لهذه الصفقة');
    if (deal.financialHold) throw invalidState('الصفقة موقوفة لمراجعة فريق العمليات');
    const holds = await tx.select({ id: riskFlags.id }).from(riskFlags).where(and(eq(riskFlags.entityType, 'external_deal'), eq(riskFlags.entityId, deal.id), eq(riskFlags.status, 'OPEN'), inArray(riskFlags.code, HOLD_FLAG_CODES)));
    if (holds.length) throw invalidState('الصفقة قيد مراجعة فريق العمليات');
    const now = new Date();
    await moveDeal(tx, actor, deal, 'BUYER_CONFIRMED_RECEIPT', { buyerConfirmedAt: now });
    await moveDeal(tx, actor, { ...deal, status: 'BUYER_CONFIRMED_RECEIPT' }, 'COMPLETED', { completedAt: now });
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
  // The inspection period starts at the verified handover; the buyer still has to choose explicitly.
  const rows = await db.select().from(externalDeals).where(eq(externalDeals.status, 'DELIVERY_HANDOVER_VERIFIED'));
  let n = 0;
  for (const deal of rows) {
    if (!deal.handoverVerifiedAt || deal.handoverVerifiedAt.getTime() + deal.inspectionDays * 86400_000 > now.getTime()) continue;
    await db.transaction(async (tx) => {
      const [d] = await tx.select().from(externalDeals).where(eq(externalDeals.id, deal.id)).for('update');
      if (d.status !== 'DELIVERY_HANDOVER_VERIFIED') return;
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
  const role = deal.buyerId === userId ? 'BUYER' : deal.sellerUserId === userId ? 'SELLER' : hasPermission(actor, 'deals.view') ? 'ADMIN' : null;
  if (!role) throw forbidden();
  const [payment] = await db.select().from(payments).where(eq(payments.dealId, deal.id));
  const evidence = await db.select().from(dealEvidence).where(eq(dealEvidence.dealId, deal.id));
  const [payout] = await db.select().from(dealPayouts).where(eq(dealPayouts.dealId, deal.id));
  const [buyer] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, deal.buyerId));
  // Location privacy: each party always sees their own location; the counterparty's location only
  // once the buyer's payment is confirmed (ACTIVE onwards); staff with deals.view see both.
  const paidStage = ['ACTIVE', 'DELIVERED', 'DELIVERY_HANDOVER_VERIFIED', 'BUYER_CONFIRMATION_PENDING', 'BUYER_CONFIRMED_RECEIPT', 'COMPLETED', 'DISPUTED', 'REFUNDED'].includes(deal.status);
  const buyerLocation = role === 'BUYER' || role === 'ADMIN' || (role === 'SELLER' && paidStage) ? decryptLocation(deal.buyerLocationEnc) : null;
  const sellerLocation = role === 'SELLER' || role === 'ADMIN' || (role === 'BUYER' && paidStage) ? decryptLocation(deal.sellerLocationEnc) : null;
  // Never hand encrypted blobs or payout ciphertext to the page layer.
  const safeDeal = { ...deal, buyerLocationEnc: null, sellerLocationEnc: null, sellerPayoutEnc: null };
  // Before payment the seller only sees the buyer's first name (no unnecessary PII).
  const buyerName = role === 'SELLER' && !paidStage ? (buyer.fullName.split(/\s+/)[0] ?? 'المشتري') : buyer.fullName;
  return { deal: safeDeal, role, ref: dealRef(deal.number), payment: payment ?? null, evidence, payout: payout ?? null, buyerName, buyerLocation, sellerLocation };
}
