import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { requireSeller, requireUser, type Actor } from '@/server/core/actor';
import { forbidden, notFound } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { files, sellerDocuments, sellerPayoutMethods, sellerShippingRates, sellers, stores, withdrawalRequests } from '@/server/db/schema';
import type { SellerDocumentKind } from '@/domain/machines';
import { publicMediaUrl } from '@/server/modules/catalog/public-read';
import {
  addImages,
  archiveProduct,
  createDraft,
  markOutOfStock,
  productForSellerEdit,
  removeImage,
  saveVariants,
  setListingActive,
  submissionProblems,
  submitForReview,
  updateDetails,
  updateLogistics,
  type DetailsInput,
} from '@/server/modules/catalog/products';
import { effectiveAttributes } from '@/server/modules/catalog/taxonomy';
import { cancelWithdrawal, previewWithdrawal, requestWithdrawal } from '@/server/modules/finance/withdrawals';
import { myIdentity, submitIdentity } from '@/server/modules/identity/service';
import {
  addPayoutMethod,
  applicationChecklist,
  saveBusiness,
  saveIdentity,
  saveStore,
  setShippingRates,
  startApplication,
  submitApplication,
  updateStoreMedia,
  updateStoreSettings,
  uploadSellerDocument,
  type PayoutInput,
} from '@/server/modules/sellers/service';

type Upload = { data: Buffer; name: string };

/**
 * Seller setup for the Customer App: application (registration, KYC, store, documents, payout account, terms),
 * products (draft → details → images → prices/stock → shipping & returns → submit for review), shipping rates,
 * store settings and payout REQUESTS. Every call delegates to the existing domain service, which owns validation,
 * permissions, state machines and audit. Sensitive values (National ID, full payout numbers) are accepted as input
 * only and never returned.
 */

/* ───────────────────────── Personal identity (KYC, required before a seller application) ───────────────────────── */

export async function identityView(actor: Actor) {
  const i = await myIdentity(actor);
  return { status: i.status, legalName: i.legalName, last4: i.last4, hasFront: i.hasFront, hasBack: i.hasBack, reason: i.reason };
}

export async function submitMyIdentity(actor: Actor, input: { legalName: string; nationalId: string }, front: Upload | null, back: Upload | null) {
  await submitIdentity(actor, input, { front, back });
  return identityView(actor);
}

/* ───────────────────────── Seller application ───────────────────────── */

async function ownSeller(userId: string) {
  const [s] = await db.select().from(sellers).where(eq(sellers.ownerUserId, userId));
  return s ?? null;
}

export async function sellerApplication(actor: Actor) {
  const userId = requireUser(actor);
  const s = await ownSeller(userId);
  const identity = await identityView(actor);
  if (!s) return { seller: null, checklist: [], identity };
  const [store] = await db.select().from(stores).where(eq(stores.sellerId, s.id));
  const docs = await db
    .select({ kind: sellerDocuments.kind })
    .from(sellerDocuments)
    .where(and(eq(sellerDocuments.sellerId, s.id), isNull(sellerDocuments.supersededAt)));
  const [payout] = await db
    .select({ type: sellerPayoutMethods.type, status: sellerPayoutMethods.status, masked: sellerPayoutMethods.maskedLabel })
    .from(sellerPayoutMethods)
    .where(eq(sellerPayoutMethods.sellerId, s.id))
    .orderBy(desc(sellerPayoutMethods.createdAt))
    .limit(1);
  return {
    seller: {
      status: s.status,
      type: s.type,
      statusReason: s.statusReason,
      editable: s.status === 'DRAFT' || s.status === 'MORE_INFO_REQUIRED',
      legalName: s.legalName,
      mobile: s.mobile,
      email: s.email,
      addressLine: s.addressLine,
      city: s.city,
      governorateId: s.governorateId,
      hasNationalId: !!s.nationalIdEnc,
      businessLegalName: s.businessLegalName,
      businessAddress: s.businessAddress,
      authorizedRepresentative: s.authorizedRepresentative,
      store: store ? { name: store.name, slug: store.slug, description: store.description, returnAddress: store.returnAddress, returnGovernorateId: store.returnGovernorateId, supportPhone: store.supportPhone } : null,
      documents: docs.map((d) => d.kind),
      payout: payout ? { type: payout.type, status: payout.status, masked: payout.masked } : null,
    },
    checklist: (await applicationChecklist(db, s)).map((c) => ({ key: c.key, label: c.label, ok: c.ok })),
    identity,
  };
}

export async function startSellerApplication(actor: Actor, type: 'INDIVIDUAL' | 'BUSINESS') {
  await startApplication(actor, type);
  return sellerApplication(actor);
}

export async function saveSellerIdentity(actor: Actor, input: Parameters<typeof saveIdentity>[1]) {
  await saveIdentity(actor, input);
  return sellerApplication(actor);
}

export async function saveSellerBusiness(actor: Actor, input: Parameters<typeof saveBusiness>[1]) {
  await saveBusiness(actor, input);
  return sellerApplication(actor);
}

export async function saveSellerStore(actor: Actor, input: Parameters<typeof saveStore>[1], logo: Upload | null) {
  await saveStore(actor, input, logo);
  return sellerApplication(actor);
}

export async function uploadSellerDoc(actor: Actor, kind: SellerDocumentKind, file: Upload) {
  await uploadSellerDocument(actor, kind, file);
  return sellerApplication(actor);
}

export async function addSellerPayout(actor: Actor, input: PayoutInput) {
  // During the application the owner acts as a customer; once approved, payout.manage applies.
  await addPayoutMethod(actor, input);
  return sellerApplication(actor);
}

export async function submitSellerApplication(actor: Actor, acceptAgreement: boolean) {
  await submitApplication(actor, acceptAgreement);
  return sellerApplication(actor);
}

/* ───────────────────────── Products ───────────────────────── */

export async function categoryAttributes(categoryId: string) {
  const list = await effectiveAttributes(db, categoryId);
  return {
    items: list.map((a) => ({
      code: a.attr.code,
      nameAr: a.attr.nameAr,
      type: a.attr.type,
      required: a.ca.isRequired,
      variantAxis: a.ca.isVariantAxis,
      options: a.options.map((o) => ({ value: o.value, labelAr: o.labelAr })),
    })),
  };
}

export async function productEditor(actor: Actor, productId: string) {
  const e = await productForSellerEdit(actor, productId);
  const p = e.product;
  const lastRejection = e.events.find((ev) => ev.action === 'REJECT' || ev.action === 'REQUEST_CHANGES' || ev.action === 'REVISION_REJECT' || ev.action === 'SUSPEND');
  return {
    id: p.id,
    slug: p.slug,
    status: p.status,
    /** LIVE = visible to buyers; APPROVED = approved but hidden by the seller. */
    isListed: p.status === 'LIVE',
    categoryId: p.categoryId,
    titleAr: p.titleAr,
    titleEn: p.titleEn,
    description: p.description,
    keyFeatures: p.keyFeatures ?? [],
    condition: p.condition,
    usedGrade: p.usedGrade,
    conditionNotes: p.conditionNotes,
    defects: p.defects,
    includedAccessories: p.includedAccessories,
    warrantyInfo: p.warrantyInfo,
    processingDays: p.processingDays,
    returnPolicyConfirmed: p.returnPolicyConfirmed,
    returnPolicyOverride: p.returnPolicyOverride,
    acceptsVoluntaryReturns: p.acceptsVoluntaryReturns,
    voluntaryReturnDays: p.voluntaryReturnDays,
    attributes: e.attributes,
    images: e.images.map((i) => ({ fileId: i.img.fileId, url: publicMediaUrl(i.key, 'md'), isActualItem: i.img.isActualItem })),
    variants: e.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      options: (v.options ?? {}) as Record<string, string>,
      pricePiastres: v.price,
      compareAtPricePiastres: v.compareAtPrice,
      stockOnHand: v.stockOnHand,
      reserved: v.reserved,
      lowStockThreshold: v.lowStockThreshold,
      isActive: v.isActive,
    })),
    pendingRevision: !!e.openRevision,
    moderationNote: lastRejection?.reason ?? null,
    submissionProblems: p.status === 'DRAFT' || p.status === 'REJECTED' ? await submissionProblems(db, p) : [],
  };
}

export async function createProduct(actor: Actor, input: { categoryId: string; titleAr: string; condition: 'NEW' | 'USED' }) {
  const p = await createDraft(actor, input);
  return productEditor(actor, p.id);
}

export async function saveProductDetails(actor: Actor, productId: string, input: DetailsInput) {
  await updateDetails(actor, productId, input);
  return productEditor(actor, productId);
}

export async function saveProductLogistics(actor: Actor, productId: string, input: Parameters<typeof updateLogistics>[2]) {
  await updateLogistics(actor, productId, input);
  return productEditor(actor, productId);
}

export async function addProductImages(actor: Actor, productId: string, images: Upload[], isActualItem: boolean) {
  await addImages(actor, productId, images, isActualItem);
  return productEditor(actor, productId);
}

export async function deleteProductImage(actor: Actor, productId: string, fileId: string) {
  await removeImage(actor, productId, fileId);
  return productEditor(actor, productId);
}

export async function saveProductVariants(actor: Actor, productId: string, input: Parameters<typeof saveVariants>[2]) {
  await saveVariants(actor, productId, input);
  return productEditor(actor, productId);
}

export async function submitProduct(actor: Actor, productId: string) {
  await submitForReview(actor, productId);
  return productEditor(actor, productId);
}

export async function setProductVisible(actor: Actor, productId: string, active: boolean) {
  await setListingActive(actor, productId, active);
  return productEditor(actor, productId);
}

/** Soft archive (the console's rule: not while under review, not while unpaid orders reserve stock). History is kept. */
export async function archiveMyProduct(actor: Actor, productId: string) {
  await archiveProduct(actor, productId);
  return productEditor(actor, productId);
}

/** Sets on-hand stock down to what is already reserved, so nothing more can be sold; reserved orders are untouched. */
export async function markMyProductOutOfStock(actor: Actor, productId: string) {
  await markOutOfStock(actor, productId);
  return productEditor(actor, productId);
}

/* ───────────────────────── Shipping rates & store settings ───────────────────────── */

export async function shippingRates(actor: Actor) {
  const sellerId = requireSeller(actor, 'store.manage');
  const rows = await db.select().from(sellerShippingRates).where(eq(sellerShippingRates.sellerId, sellerId)).orderBy(asc(sellerShippingRates.governorateId));
  return { items: rows.map((r) => ({ governorateId: r.governorateId, enabled: r.enabled, feePiastres: r.fee, etaMinDays: r.etaMinDays, etaMaxDays: r.etaMaxDays })) };
}

export async function saveShippingRates(actor: Actor, items: { governorateId: number; enabled: boolean; feePiastres: number; etaMinDays: number; etaMaxDays: number }[]) {
  await setShippingRates(
    actor,
    items.map((i) => ({ governorateId: i.governorateId, enabled: i.enabled, fee: i.feePiastres, etaMinDays: i.etaMinDays, etaMaxDays: i.etaMaxDays })),
  );
  return shippingRates(actor);
}

export async function storeSettings(actor: Actor) {
  const sellerId = requireSeller(actor, 'store.manage');
  const [s] = await db.select().from(stores).where(eq(stores.sellerId, sellerId));
  if (!s) throw notFound('المتجر');
  const keyOf = async (id: string | null) => (id ? ((await db.select({ k: files.storageKey }).from(files).where(eq(files.id, id)))[0]?.k ?? null) : null);
  return {
    name: s.name,
    slug: s.slug,
    description: s.description,
    returnAddress: s.returnAddress,
    supportPhone: s.supportPhone,
    acceptsVoluntaryReturns: s.acceptsVoluntaryReturns,
    voluntaryReturnDays: s.voluntaryReturnDays,
    returnConditions: s.returnConditions,
    returnConditionKeys: (s.returnConditionKeys ?? []) as string[],
    returnShippingPayer: s.returnShippingPayer,
    shippingPolicy: s.shippingPolicy,
    defaultProcessingDays: s.defaultProcessingDays,
    freeShippingThresholdPiastres: s.freeShippingThreshold,
    logoUrl: publicMediaUrl(await keyOf(s.logoFileId), 'thumb'),
    bannerUrl: publicMediaUrl(await keyOf(s.bannerFileId), 'md'),
  };
}

export async function saveStoreMedia(actor: Actor, logo: Upload | null, banner: Upload | null) {
  await updateStoreMedia(actor, { logo, banner });
  return storeSettings(actor);
}

export async function saveStoreSettings(actor: Actor, input: Parameters<typeof updateStoreSettings>[1], logo: Upload | null, banner: Upload | null) {
  await updateStoreSettings(actor, input, { logo, banner });
  return storeSettings(actor);
}

/* ───────────────────────── Payout requests (REQUEST ONLY; Maker/Checker + transfer stay with EDMN staff) ───────────────────────── */

function withdrawalOut(w: typeof withdrawalRequests.$inferSelect) {
  return {
    id: w.id,
    amountPiastres: w.amount,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
    paidAt: w.paidAt?.toISOString() ?? null,
    reference: w.status === 'PAID' ? (w.paidReference ?? null) : null,
    reasonAr: w.status === 'REJECTED' ? (w.rejectReason ?? null) : null,
    /** A reserved (approved) request can no longer be cancelled by the seller. */
    cancellable: w.status === 'REQUESTED' && !w.reservedAt,
  };
}

export async function payoutRequests(actor: Actor) {
  const sellerId = requireSeller(actor, 'finance.view');
  const rows = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.sellerId, sellerId)).orderBy(desc(withdrawalRequests.createdAt)).limit(100);
  return { items: rows.map(withdrawalOut) };
}

export async function payoutPreview(actor: Actor, amountPiastres: number) {
  const q = await previewWithdrawal(actor, amountPiastres);
  return { amountPiastres: q.amount, transferCostPiastres: q.transferCost, netPiastres: q.net, warnings: q.warnings, violations: q.violations };
}

export async function requestPayout(actor: Actor, amountPiastres: number, clientKey: string) {
  const r = await requestWithdrawal(actor, { amount: amountPiastres, clientKey });
  return { created: r.created, request: withdrawalOut(r.withdrawal) };
}

export async function cancelPayoutRequest(actor: Actor, id: string) {
  const sellerId = requireSeller(actor, 'finance.withdraw');
  const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id));
  if (!w || w.sellerId !== sellerId) throw forbidden();
  await cancelWithdrawal(actor, id);
  return payoutRequests(actor);
}

