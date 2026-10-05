import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { RETURN_CONDITION_KEYS, RETURN_SHIPPING_PAYERS } from '@/domain/return-policy';
import { sellerMachine, type SellerStatus, type SellerType, type SellerDocumentKind } from '@/domain/machines';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireSeller, requireUser, type Actor, requireStepUp } from '@/server/core/actor';
import { decryptJson, encrypt, encryptJson, mask } from '@/server/core/crypto';
import { DomainError, forbidden, invalidState, notFound, validation } from '@/server/core/errors';
import { isValidEgyptNationalId, normalizeEgyptMobile, slugify } from '@/server/core/text';
import { db, type DbOrTx } from '@/server/db/client';
import {
  governorates,
  legalAcceptances,
  legalDocuments,
  sellerDocuments,
  sellerMembers,
  sellerPayoutMethods,
  sellerShippingRates,
  sellers,
  stores,
  users,
  files,
} from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { getSetting } from '@/server/modules/settings';
import { storeUpload } from '@/server/storage/uploads';
import { parse, requireReason, transition } from '../_shared';
import { assertNotSelfDealing } from '@/server/modules/finance/self-dealing';
import { SELLER_ROLE_PERMISSIONS, type SellerPermission } from '@/server/rbac/permissions';

export type Seller = typeof sellers.$inferSelect;

/* ─────────────────────────── Seller context (for Seller Center authorization) ─────────────────────────── */

export interface SellerContext {
  seller: Seller;
  role: string;
  permissions: ReadonlySet<SellerPermission>;
}

export async function sellerContextForUser(userId: string, conn: DbOrTx = db): Promise<SellerContext | null> {
  const [owned] = await conn.select().from(sellers).where(eq(sellers.ownerUserId, userId));
  if (owned) return { seller: owned, role: 'STORE_OWNER', permissions: new Set(SELLER_ROLE_PERMISSIONS.STORE_OWNER) };
  const [m] = await conn
    .select({ seller: sellers, role: sellerMembers.role })
    .from(sellerMembers)
    .innerJoin(sellers, eq(sellers.id, sellerMembers.sellerId))
    .where(and(eq(sellerMembers.userId, userId), eq(sellerMembers.isActive, true)));
  if (!m) return null;
  return { seller: m.seller, role: m.role, permissions: new Set(SELLER_ROLE_PERMISSIONS[m.role] ?? []) };
}

/** Throws unless the seller is APPROVED (RESTRICTED sellers may fulfil but not list new products). */
export async function requireActiveSeller(conn: DbOrTx, sellerId: string, opts: { allowRestricted?: boolean } = {}): Promise<Seller> {
  const [s] = await conn.select().from(sellers).where(eq(sellers.id, sellerId));
  if (!s) throw notFound('البائع');
  const ok = s.status === 'APPROVED' || (opts.allowRestricted && s.status === 'RESTRICTED');
  if (!ok) throw new DomainError('FORBIDDEN', 'حساب البائع غير مفعّل لهذا الإجراء');
  return s;
}

/* ─────────────────────────── Onboarding ─────────────────────────── */

export async function startApplication(actor: Actor, type: SellerType): Promise<Seller> {
  const userId = requireUser(actor);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(sellers).where(eq(sellers.ownerUserId, userId));
    if (existing) return existing;
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    const [s] = await tx
      .insert(sellers)
      .values({
        ownerUserId: userId,
        type,
        legalName: u.fullName,
        mobile: u.phone,
        mobileVerifiedAt: u.phoneVerifiedAt,
        email: u.email,
        emailVerifiedAt: u.emailVerifiedAt,
      })
      .returning();
    await audit(tx, actor, { action: 'seller.application_started', entityType: 'seller', entityId: s.id, newValues: { type } });
    return s;
  });
}

async function loadEditable(tx: DbOrTx, actor: Actor): Promise<Seller> {
  const userId = requireUser(actor);
  const [s] = await tx.select().from(sellers).where(eq(sellers.ownerUserId, userId)).for('update');
  if (!s) throw notFound('طلب البائع');
  if (!['DRAFT', 'MORE_INFO_REQUIRED'].includes(s.status)) throw invalidState('لا يمكن تعديل الطلب بعد إرساله للمراجعة');
  return s;
}

export const identitySchema = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']),
  legalName: z.string().trim().min(5, 'الاسم القانوني الكامل مطلوب').max(150),
  nationalId: z.string().trim().refine(isValidEgyptNationalId, 'الرقم القومي يجب أن يتكون من 14 رقماً صحيحاً'),
  mobile: z.string().trim().min(8),
  email: z.string().trim().toLowerCase().email('البريد الإلكتروني غير صحيح'),
  addressLine: z.string().trim().min(5, 'العنوان مطلوب').max(300),
  city: z.string().trim().min(2, 'المدينة مطلوبة').max(100),
  governorateId: z.coerce.number().int().positive('اختر المحافظة'),
});

export async function saveIdentity(actor: Actor, input: z.input<typeof identitySchema>) {
  const d = parse(identitySchema, input);
  const mobile = normalizeEgyptMobile(d.mobile);
  if (!mobile) throw validation('رقم الموبايل غير صحيح', { mobile: ['رقم الموبايل غير صحيح'] });
  await db.transaction(async (tx) => {
    const s = await loadEditable(tx, actor);
    const [u] = await tx.select().from(users).where(eq(users.id, s.ownerUserId));
    await tx
      .update(sellers)
      .set({
        type: d.type,
        legalName: d.legalName,
        nationalIdEnc: encrypt(d.nationalId),
        nationalIdLast4: d.nationalId.slice(-4),
        mobile,
        // Mobile/email count as verified only if they match the account's verified contact.
        mobileVerifiedAt: u.phone === mobile ? u.phoneVerifiedAt : null,
        email: d.email,
        emailVerifiedAt: u.email === d.email ? u.emailVerifiedAt : null,
        addressLine: d.addressLine,
        city: d.city,
        governorateId: d.governorateId,
        onboardingStep: Math.max(s.onboardingStep, 2),
      })
      .where(eq(sellers.id, s.id));
    await audit(tx, actor, { action: 'seller.identity_saved', entityType: 'seller', entityId: s.id, newValues: { nationalIdLast4: d.nationalId.slice(-4), type: d.type } });
  });
}

export const businessSchema = z.object({
  businessLegalName: z.string().trim().min(3, 'الاسم القانوني للنشاط مطلوب').max(200),
  commercialRegistrationNo: z.string().trim().max(50).optional().default(''),
  taxRegistrationNo: z.string().trim().max(50).optional().default(''),
  businessAddress: z.string().trim().min(5, 'عنوان النشاط مطلوب').max(300),
  authorizedRepresentative: z.string().trim().min(3, 'اسم الممثل القانوني مطلوب').max(150),
});

export async function saveBusiness(actor: Actor, input: z.input<typeof businessSchema>) {
  const d = parse(businessSchema, input);
  await db.transaction(async (tx) => {
    const s = await loadEditable(tx, actor);
    if (s.type !== 'BUSINESS') throw invalidState('هذه الخطوة خاصة بالشركات فقط');
    await tx.update(sellers).set({ ...d, onboardingStep: Math.max(s.onboardingStep, 3) }).where(eq(sellers.id, s.id));
    await audit(tx, actor, { action: 'seller.business_saved', entityType: 'seller', entityId: s.id });
  });
}

export const storeSchema = z.object({
  name: z.string().trim().min(3, 'اسم المتجر مطلوب').max(80),
  description: z.string().trim().max(2000).optional().default(''),
  returnAddress: z.string().trim().min(5, 'عنوان الإرجاع مطلوب').max(300),
  returnGovernorateId: z.coerce.number().int().positive('اختر محافظة عنوان الإرجاع'),
  supportPhone: z.string().trim().max(20).optional().default(''),
});

async function uniqueStoreSlug(tx: DbOrTx, name: string, sellerId: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [hit] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.slug, slug), ne(stores.sellerId, sellerId)));
    if (!hit) return slug;
  }
  return `${base}-${sellerId.slice(0, 8)}`;
}

export async function saveStore(actor: Actor, input: z.input<typeof storeSchema>, logo?: { data: Buffer; name: string } | null) {
  const d = parse(storeSchema, input);
  await db.transaction(async (tx) => {
    const s = await loadEditable(tx, actor);
    const logoFile = logo ? await storeUpload(tx, actor, { purpose: 'STORE_LOGO', data: logo.data, originalName: logo.name }) : null;
    const [existing] = await tx.select().from(stores).where(eq(stores.sellerId, s.id));
    const values = {
      name: d.name,
      description: d.description || null,
      returnAddress: d.returnAddress,
      returnGovernorateId: d.returnGovernorateId,
      supportPhone: d.supportPhone || null,
      ...(logoFile ? { logoFileId: logoFile.id } : {}),
    };
    if (existing) await tx.update(stores).set(values).where(eq(stores.id, existing.id));
    else await tx.insert(stores).values({ ...values, sellerId: s.id, slug: await uniqueStoreSlug(tx, d.name, s.id) });
    await tx.update(sellers).set({ onboardingStep: Math.max(s.onboardingStep, 4) }).where(eq(sellers.id, s.id));
    await audit(tx, actor, { action: 'seller.store_saved', entityType: 'seller', entityId: s.id, newValues: { store: d.name } });
  });
}

export async function uploadSellerDocument(actor: Actor, kind: SellerDocumentKind, file: { data: Buffer; name: string }) {
  await db.transaction(async (tx) => {
    const s = await loadEditable(tx, actor);
    const stored = await storeUpload(tx, actor, { purpose: 'SELLER_DOCUMENT', data: file.data, originalName: file.name });
    await tx
      .update(sellerDocuments)
      .set({ supersededAt: new Date() })
      .where(and(eq(sellerDocuments.sellerId, s.id), eq(sellerDocuments.kind, kind), isNull(sellerDocuments.supersededAt)));
    await tx.insert(sellerDocuments).values({ sellerId: s.id, kind, fileId: stored.id });
    await audit(tx, actor, { action: 'seller.document_uploaded', entityType: 'seller', entityId: s.id, newValues: { kind } });
  });
}

/* ─────────────────────────── Payout methods ─────────────────────────── */

export const payoutSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BANK_ACCOUNT'),
    holderName: z.string().trim().min(3, 'اسم صاحب الحساب مطلوب'),
    bankName: z.string().trim().min(2, 'اسم البنك مطلوب'),
    accountNumber: z.string().trim().regex(/^\d{6,30}$/, 'رقم الحساب غير صحيح'),
    iban: z.string().trim().toUpperCase().regex(/^(EG\d{27})?$/, 'رقم IBAN المصري يبدأ بـ EG ويتكون من 29 حرفاً').optional().default(''),
  }),
  z.object({
    type: z.literal('INSTAPAY'),
    holderName: z.string().trim().min(3, 'الاسم مطلوب'),
    instapayAddress: z.string().trim().min(3, 'عنوان إنستاباي مطلوب').max(100),
  }),
  z.object({
    type: z.literal('MOBILE_WALLET'),
    holderName: z.string().trim().min(3, 'الاسم مطلوب'),
    walletProvider: z.string().trim().min(2, 'مزود المحفظة مطلوب'),
    walletNumber: z.string().trim().min(8, 'رقم المحفظة مطلوب'),
  }),
]);
export type PayoutInput = z.input<typeof payoutSchema>;

export function payoutMask(p: z.infer<typeof payoutSchema>): string {
  switch (p.type) {
    case 'BANK_ACCOUNT':
      return `${p.bankName} ${mask(p.iban || p.accountNumber)}`;
    case 'INSTAPAY':
      return `InstaPay ${mask(p.instapayAddress, 5)}`;
    case 'MOBILE_WALLET':
      return `${p.walletProvider} ${mask(p.walletNumber)}`;
  }
}

/**
 * Add a payout destination. During onboarding it is verified together with the application.
 * For an approved seller, a change is audited, notified and (per settings) held for review
 * and a withdrawal hold is applied — the classic account-takeover defence.
 */
export async function addPayoutMethod(actor: Actor, input: PayoutInput) {
  const p = parse(payoutSchema, input);
  if (p.type === 'MOBILE_WALLET' && !normalizeEgyptMobile(p.walletNumber)) throw validation('رقم المحفظة غير صحيح');
  return db.transaction(async (tx) => {
    let sellerId: string;
    if (actor.type === 'SELLER') sellerId = requireSeller(actor, 'payout.manage');
    else sellerId = (await loadEditable(tx, actor)).id;
    const [s] = await tx.select().from(sellers).where(eq(sellers.id, sellerId)).for('update');
    const onboarding = s.status === 'DRAFT' || s.status === 'MORE_INFO_REQUIRED';
    const requiresReview = !onboarding && (await getSetting('payout.changeRequiresReview', tx));
    const holdHours = onboarding ? 0 : await getSetting('payout.changeHoldHours', tx);
    const details = p.type === 'MOBILE_WALLET' ? { ...p, walletNumber: normalizeEgyptMobile(p.walletNumber)! } : p;
    const maskedLabel = payoutMask(details);
    if (onboarding) {
      await tx.update(sellerPayoutMethods).set({ status: 'ARCHIVED', isDefault: false }).where(eq(sellerPayoutMethods.sellerId, sellerId));
    }
    const [pm] = await tx
      .insert(sellerPayoutMethods)
      .values({
        sellerId,
        type: p.type,
        detailsEnc: encryptJson(details),
        maskedLabel,
        holderName: p.holderName,
        status: onboarding || requiresReview ? 'PENDING_VERIFICATION' : 'ACTIVE',
        isDefault: onboarding || !requiresReview,
        createdBy: actor.userId,
      })
      .returning();
    if (!onboarding && !requiresReview) {
      await tx.update(sellerPayoutMethods).set({ isDefault: false }).where(and(eq(sellerPayoutMethods.sellerId, sellerId), ne(sellerPayoutMethods.id, pm.id)));
    }
    const sets: Partial<Seller> = {};
    if (holdHours > 0) sets.payoutHoldUntil = new Date(Date.now() + holdHours * 3600_000);
    if (onboarding) sets.onboardingStep = Math.max(s.onboardingStep, 6);
    if (Object.keys(sets).length) await tx.update(sellers).set(sets).where(eq(sellers.id, sellerId));
    await audit(tx, actor, {
      action: 'seller.payout_method_added',
      entityType: 'seller',
      entityId: sellerId,
      newValues: { payoutMethodId: pm.id, type: p.type, masked: maskedLabel, status: pm.status, holdHours },
    });
    if (!onboarding) await notify(tx, { event: 'PAYOUT_METHOD_CHANGED', userIds: [s.ownerUserId], link: '/seller/settings' });
    return pm;
  });
}

export async function verifyPayoutMethod(actor: Actor, payoutMethodId: string, approve: boolean, reason?: string) {
  requirePermission(actor, 'sellers.payout.verify');
  requireStepUp(actor); // decides where seller money is sent
  if (!approve) requireReason(reason);
  await db.transaction(async (tx) => {
    const [pm] = await tx.select().from(sellerPayoutMethods).where(eq(sellerPayoutMethods.id, payoutMethodId)).for('update');
    if (!pm) throw notFound('وسيلة السحب');
    const [owner] = await tx.select({ ownerUserId: sellers.ownerUserId }).from(sellers).where(eq(sellers.id, pm.sellerId));
    if (owner?.ownerUserId === actor.userId) throw forbidden('لا يمكنك اعتماد وسيلة سحب خاصة بمتجرك');
    await assertNotSelfDealing(tx, actor, pm.sellerId);
    if (pm.status !== 'PENDING_VERIFICATION') throw invalidState('تمت مراجعة وسيلة السحب بالفعل');
    if (approve) {
      await tx.update(sellerPayoutMethods).set({ isDefault: false }).where(eq(sellerPayoutMethods.sellerId, pm.sellerId));
      await tx.update(sellerPayoutMethods).set({ status: 'ACTIVE', isDefault: true, verifiedBy: actor.userId, verifiedAt: new Date() }).where(eq(sellerPayoutMethods.id, pm.id));
    } else {
      await tx.update(sellerPayoutMethods).set({ status: 'REJECTED' }).where(eq(sellerPayoutMethods.id, pm.id));
    }
    await audit(tx, actor, {
      action: approve ? 'seller.payout_method_verified' : 'seller.payout_method_rejected',
      entityType: 'seller',
      entityId: pm.sellerId,
      newValues: { payoutMethodId: pm.id },
      reason: reason ?? null,
    });
  });
}

export async function activePayoutMethod(conn: DbOrTx, sellerId: string) {
  const [pm] = await conn
    .select()
    .from(sellerPayoutMethods)
    .where(and(eq(sellerPayoutMethods.sellerId, sellerId), eq(sellerPayoutMethods.status, 'ACTIVE'), eq(sellerPayoutMethods.isDefault, true)));
  return pm ?? null;
}

/** Full payout details are decrypted only for finance staff executing a payment (audited by caller). */
export function decryptPayout(pm: { detailsEnc: string }) {
  return decryptJson<Record<string, string>>(pm.detailsEnc);
}

/* ─────────────────────────── Submission ─────────────────────────── */

export async function currentLegalVersion(conn: DbOrTx, code: string): Promise<string> {
  const [doc] = await conn
    .select({ version: legalDocuments.version })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.code, code), eq(legalDocuments.isCurrent, true)));
  return doc?.version ?? 'unversioned-draft';
}

export async function applicationChecklist(conn: DbOrTx, seller: Seller) {
  const docs = await conn
    .select({ kind: sellerDocuments.kind })
    .from(sellerDocuments)
    .where(and(eq(sellerDocuments.sellerId, seller.id), isNull(sellerDocuments.supersededAt)));
  const kinds = new Set(docs.map((d) => d.kind));
  const [store] = await conn.select().from(stores).where(eq(stores.sellerId, seller.id));
  const [payout] = await conn
    .select({ id: sellerPayoutMethods.id })
    .from(sellerPayoutMethods)
    .where(and(eq(sellerPayoutMethods.sellerId, seller.id), inArray(sellerPayoutMethods.status, ['PENDING_VERIFICATION', 'ACTIVE'])));
  const businessDocs = seller.type === 'BUSINESS' ? await getSetting('sellers.businessRequiredDocuments', conn) : [];
  const requireEmail = await getSetting('sellers.requireEmailVerification', conn);
  const items = [
    { key: 'identity', label: 'بيانات الهوية والعنوان', ok: !!(seller.legalName && seller.nationalIdEnc && seller.mobile && seller.addressLine && seller.governorateId) },
    { key: 'mobile', label: 'رقم موبايل مؤكد', ok: !!seller.mobileVerifiedAt },
    ...(requireEmail ? [{ key: 'email', label: 'بريد إلكتروني مؤكد', ok: !!seller.emailVerifiedAt }] : []),
    ...(seller.type === 'BUSINESS'
      ? [{ key: 'business', label: 'بيانات النشاط التجاري', ok: !!(seller.businessLegalName && seller.businessAddress && seller.authorizedRepresentative) }]
      : []),
    { key: 'store', label: 'بيانات المتجر وعنوان الإرجاع', ok: !!(store && store.returnAddress) },
    { key: 'id_front', label: 'صورة البطاقة (الوجه)', ok: kinds.has('NATIONAL_ID_FRONT') },
    { key: 'id_back', label: 'صورة البطاقة (الظهر)', ok: kinds.has('NATIONAL_ID_BACK') },
    ...businessDocs.map((k) => ({ key: k, label: k === 'COMMERCIAL_REGISTRATION' ? 'السجل التجاري' : k === 'TAX_CARD' ? 'البطاقة الضريبية' : 'خطاب التفويض', ok: kinds.has(k) })),
    { key: 'payout', label: 'وسيلة استلام الأرباح', ok: !!payout },
  ];
  return items;
}

export async function submitApplication(actor: Actor, acceptAgreement: boolean) {
  if (!acceptAgreement) throw validation('يجب الموافقة على اتفاقية البائع');
  return db.transaction(async (tx) => {
    const s = await loadEditable(tx, actor);
    const checklist = await applicationChecklist(tx, s);
    const missing = checklist.filter((c) => !c.ok);
    if (missing.length) throw validation(`الطلب غير مكتمل: ${missing.map((m) => m.label).join('، ')}`);
    const version = await currentLegalVersion(tx, 'SELLER_AGREEMENT');
    await transition(tx, actor, sellerMachine, s.id, s.status, 'PENDING_REVIEW');
    await tx
      .update(sellers)
      .set({ status: 'PENDING_REVIEW', statusReason: null, submittedAt: new Date(), agreementVersion: version, agreementAcceptedAt: new Date() })
      .where(eq(sellers.id, s.id));
    await tx.insert(legalAcceptances).values({ userId: actor.userId!, documentCode: 'SELLER_AGREEMENT', version, context: `seller:${s.id}`, ip: actor.ip ?? null });
    await audit(tx, actor, { action: 'seller.application_submitted', entityType: 'seller', entityId: s.id, newValues: { agreementVersion: version } });
    const [store] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.sellerId, s.id));
    await notify(tx, { event: 'SELLER_APPLICATION_SUBMITTED', userIds: [s.ownerUserId], vars: { store: store?.name }, link: '/seller' });
  });
}

/* ─────────────────────────── Admin decisions ─────────────────────────── */

export type SellerDecision = 'APPROVE' | 'REJECT' | 'REQUEST_MORE_INFORMATION' | 'SUSPEND' | 'RESTRICT' | 'REINSTATE';
const DECISION_TARGET: Record<SellerDecision, SellerStatus> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_MORE_INFORMATION: 'MORE_INFO_REQUIRED',
  SUSPEND: 'SUSPENDED',
  RESTRICT: 'RESTRICTED',
  REINSTATE: 'APPROVED',
};

export async function decideSeller(actor: Actor, sellerId: string, decision: SellerDecision, reason?: string | null) {
  requirePermission(actor, decision === 'SUSPEND' || decision === 'RESTRICT' || decision === 'REINSTATE' ? 'sellers.suspend' : 'sellers.review');
  // Every decision except a plain approval is "sensitive" and requires a recorded reason.
  const why = decision === 'APPROVE' ? (reason?.trim() || null) : requireReason(reason);
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sellers).where(eq(sellers.id, sellerId)).for('update');
    if (!s) throw notFound('البائع');
    if (s.ownerUserId === actor.userId) throw forbidden('لا يمكنك اتخاذ قرار على طلب بائع خاص بك');
    const to = DECISION_TARGET[decision];
    if (decision === 'APPROVE' && s.status !== 'PENDING_REVIEW') throw invalidState('يمكن الموافقة فقط على الطلبات قيد المراجعة');
    await transition(tx, actor, sellerMachine, s.id, s.status, to, why);
    const sets: Partial<Seller> = { status: to, statusReason: why };
    if (decision === 'APPROVE') {
      sets.approvedAt = new Date();
      sets.approvedBy = actor.userId;
      await tx.update(stores).set({ isVerified: true }).where(eq(stores.sellerId, s.id));
      // Onboarding payout destination is verified as part of the application review.
      const [pm] = await tx
        .select()
        .from(sellerPayoutMethods)
        .where(and(eq(sellerPayoutMethods.sellerId, s.id), eq(sellerPayoutMethods.status, 'PENDING_VERIFICATION')))
        .orderBy(desc(sellerPayoutMethods.createdAt))
        .limit(1);
      if (pm) {
        await tx.update(sellerPayoutMethods).set({ status: 'ACTIVE', isDefault: true, verifiedBy: actor.userId, verifiedAt: new Date() }).where(eq(sellerPayoutMethods.id, pm.id));
      }
      await tx.update(sellerDocuments).set({ status: 'ACCEPTED' }).where(and(eq(sellerDocuments.sellerId, s.id), isNull(sellerDocuments.supersededAt)));
      await ensureDefaultShippingRows(tx, s.id);
    }
    await tx.update(sellers).set(sets).where(eq(sellers.id, s.id));
    await audit(tx, actor, {
      action: `seller.${decision.toLowerCase()}`,
      entityType: 'seller',
      entityId: s.id,
      oldValues: { status: s.status },
      newValues: { status: to },
      reason: why,
    });
    const [store] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.sellerId, s.id));
    const event =
      decision === 'APPROVE' ? 'SELLER_APPROVED' : decision === 'REJECT' ? 'SELLER_REJECTED' : decision === 'REQUEST_MORE_INFORMATION' ? 'SELLER_MORE_INFO_REQUIRED' : 'SELLER_STATUS_CHANGED';
    await notify(tx, { event, userIds: [s.ownerUserId], vars: { store: store?.name, reason: why, status: to }, link: '/seller' });
    return to;
  });
}

/** Creates disabled shipping rows for every governorate so the seller only has to enable + price them. */
export async function ensureDefaultShippingRows(tx: DbOrTx, sellerId: string) {
  const govs = await tx.select({ id: governorates.id }).from(governorates);
  if (!govs.length) return;
  await tx
    .insert(sellerShippingRates)
    .values(govs.map((g) => ({ sellerId, governorateId: g.id, enabled: false, fee: 0, etaMinDays: 2, etaMaxDays: 5 })))
    .onConflictDoNothing();
}

/* ─────────────────────────── Seller settings ─────────────────────────── */

export const shippingRateSchema = z.object({
  governorateId: z.number().int().positive(),
  enabled: z.boolean(),
  fee: z.number().int().min(0).max(10_000_00),
  etaMinDays: z.number().int().min(0).max(60),
  etaMaxDays: z.number().int().min(0).max(60),
});

export async function setShippingRates(actor: Actor, rates: z.input<typeof shippingRateSchema>[]) {
  const sellerId = requireSeller(actor, 'store.manage');
  const parsed = rates.map((r) => parse(shippingRateSchema, r));
  for (const r of parsed) if (r.etaMaxDays < r.etaMinDays) throw validation('مدة التوصيل القصوى يجب أن تكون أكبر من أو تساوي الدنيا');
  await db.transaction(async (tx) => {
    for (const r of parsed) {
      await tx
        .insert(sellerShippingRates)
        .values({ sellerId, ...r })
        .onConflictDoUpdate({
          target: [sellerShippingRates.sellerId, sellerShippingRates.governorateId],
          set: { enabled: r.enabled, fee: r.fee, etaMinDays: r.etaMinDays, etaMaxDays: r.etaMaxDays, updatedAt: new Date() },
        });
    }
    await audit(tx, actor, { action: 'seller.shipping_rates_updated', entityType: 'seller', entityId: sellerId, newValues: { count: parsed.length, enabled: parsed.filter((r) => r.enabled).length } });
  });
}

export const storeSettingsSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(2000).optional().default(''),
  returnAddress: z.string().trim().min(5).max(300),
  supportPhone: z.string().trim().max(20).optional().default(''),
  acceptsVoluntaryReturns: z.boolean(),
  voluntaryReturnDays: z.number().int().min(1).max(365).nullable(),
  returnConditions: z.string().trim().max(2000).optional().default(''),
  returnConditionKeys: z.array(z.enum(RETURN_CONDITION_KEYS)).max(RETURN_CONDITION_KEYS.length).optional().default([]),
  returnShippingPayer: z.enum(RETURN_SHIPPING_PAYERS).optional().default('BY_REASON'),
  shippingPolicy: z.string().trim().max(2000).optional().default(''),
  defaultProcessingDays: z.number().int().min(0).max(30),
  freeShippingThreshold: z.number().int().min(0).nullable(),
});

export async function updateStoreSettings(
  actor: Actor,
  input: z.input<typeof storeSettingsSchema>,
  uploads: { logo?: { data: Buffer; name: string } | null; banner?: { data: Buffer; name: string } | null } = {},
) {
  const sellerId = requireSeller(actor, 'store.manage');
  const d = parse(storeSettingsSchema, input);
  if (d.acceptsVoluntaryReturns && !d.voluntaryReturnDays) throw validation('حدد مدة الإرجاع الاختياري بالأيام');
  await db.transaction(async (tx) => {
    const [store] = await tx.select().from(stores).where(eq(stores.sellerId, sellerId)).for('update');
    if (!store) throw notFound('المتجر');
    const logo = uploads.logo ? await storeUpload(tx, actor, { purpose: 'STORE_LOGO', data: uploads.logo.data, originalName: uploads.logo.name }) : null;
    const banner = uploads.banner ? await storeUpload(tx, actor, { purpose: 'STORE_BANNER', data: uploads.banner.data, originalName: uploads.banner.name }) : null;
    await tx
      .update(stores)
      .set({
        name: d.name,
        description: d.description || null,
        returnAddress: d.returnAddress,
        supportPhone: d.supportPhone || null,
        acceptsVoluntaryReturns: d.acceptsVoluntaryReturns,
        voluntaryReturnDays: d.acceptsVoluntaryReturns ? d.voluntaryReturnDays : null,
        returnConditions: d.returnConditions || null,
        returnConditionKeys: d.acceptsVoluntaryReturns ? d.returnConditionKeys : [],
        returnShippingPayer: d.returnShippingPayer,
        shippingPolicy: d.shippingPolicy || null,
        defaultProcessingDays: d.defaultProcessingDays,
        freeShippingThreshold: d.freeShippingThreshold,
        ...(logo ? { logoFileId: logo.id } : {}),
        ...(banner ? { bannerFileId: banner.id } : {}),
      })
      .where(eq(stores.id, store.id));
    await audit(tx, actor, { action: 'seller.store_updated', entityType: 'store', entityId: store.id, oldValues: { name: store.name }, newValues: { name: d.name } });
  });
}

/* ─────────────────────────── Seller staff ─────────────────────────── */

export async function addStaffMember(actor: Actor, email: string, role: string) {
  const sellerId = requireSeller(actor, 'staff.manage');
  if (!(role in SELLER_ROLE_PERMISSIONS) || role === 'STORE_OWNER') throw validation('دور غير صالح');
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
    if (!u) throw validation('لا يوجد مستخدم مسجل بهذا البريد. اطلب منه إنشاء حساب أولاً');
    const [owner] = await tx.select().from(sellers).where(eq(sellers.ownerUserId, u.id));
    if (owner) throw validation('هذا المستخدم يملك متجراً بالفعل');
    await tx
      .insert(sellerMembers)
      .values({ sellerId, userId: u.id, role: role as 'STORE_MANAGER' })
      .onConflictDoUpdate({ target: [sellerMembers.sellerId, sellerMembers.userId], set: { role: role as 'STORE_MANAGER', isActive: true } });
    await audit(tx, actor, { action: 'seller.staff_added', entityType: 'seller', entityId: sellerId, newValues: { userId: u.id, role } });
  });
}

export async function removeStaffMember(actor: Actor, userId: string) {
  const sellerId = requireSeller(actor, 'staff.manage');
  await db.transaction(async (tx) => {
    await tx.update(sellerMembers).set({ isActive: false }).where(and(eq(sellerMembers.sellerId, sellerId), eq(sellerMembers.userId, userId)));
    await audit(tx, actor, { action: 'seller.staff_removed', entityType: 'seller', entityId: sellerId, newValues: { userId } });
  });
}

/* ─────────────────────────── Admin reads ─────────────────────────── */

/** Reveal a seller's national ID to an authorized reviewer. Every reveal is audited. */
export async function revealNationalId(actor: Actor, sellerId: string): Promise<string> {
  requirePermission(actor, 'sellers.documents.view');
  requireStepUp(actor);
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sellers).where(eq(sellers.id, sellerId));
    if (!s?.nationalIdEnc) throw notFound('الرقم القومي');
    await audit(tx, actor, { action: 'seller.national_id_revealed', entityType: 'seller', entityId: sellerId });
    const { decrypt } = await import('@/server/core/crypto');
    return decrypt(s.nationalIdEnc);
  });
}

export async function sellerDocumentsFor(actor: Actor, sellerId: string) {
  requirePermission(actor, 'sellers.documents.view');
  return db
    .select({ doc: sellerDocuments, file: { id: files.id, mimeType: files.mimeType, sizeBytes: files.sizeBytes } })
    .from(sellerDocuments)
    .innerJoin(files, eq(files.id, sellerDocuments.fileId))
    .where(and(eq(sellerDocuments.sellerId, sellerId), isNull(sellerDocuments.supersededAt)));
}

export function assertSellerOwns(actor: Actor, sellerId: string) {
  if (actor.type !== 'SELLER' || actor.sellerId !== sellerId) throw forbidden();
}
