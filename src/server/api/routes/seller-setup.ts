import { z } from 'zod';
import { SELLER_DOCUMENT_KINDS } from '@/domain/machines';
import { detailsSchema, logisticsSchema, variantSchema } from '@/server/modules/catalog/products';
import {
  addProductImages,
  addSellerPayout,
  cancelPayoutRequest,
  categoryAttributes,
  createProduct,
  deleteProductImage,
  identityView,
  payoutPreview,
  payoutRequests,
  productEditor,
  requestPayout,
  saveProductDetails,
  saveProductLogistics,
  saveProductVariants,
  saveSellerBusiness,
  saveSellerIdentity,
  saveSellerStore,
  saveShippingRates,
  archiveMyProduct,
  markMyProductOutOfStock,
  saveStoreMedia,
  saveStoreSettings,
  sellerApplication,
  setProductVisible,
  shippingRates,
  startSellerApplication,
  storeSettings,
  submitMyIdentity,
  submitProduct,
  submitSellerApplication,
  uploadSellerDoc,
} from '@/server/modules/mobile/seller-setup';
import { businessSchema, identitySchema, payoutSchema, storeSettingsSchema } from '@/server/modules/sellers/service';
import { defineRoute } from '../http';
import { isoDateTime, piastres, uuid } from '../schemas';

/**
 * Seller registration, products, shipping, store settings and payout REQUESTS for the Customer App. Thin transport
 * over the existing services (validation, permissions, state machines, audit live there). Sensitive inputs (National
 * ID, payout numbers) are never echoed back.
 */
const tags = ['Seller setup'];

/* ───────────────────────── Identity (KYC) ───────────────────────── */

const identity = z
  .object({ status: z.string(), legalName: z.string().nullable(), last4: z.string().nullable(), hasFront: z.boolean(), hasBack: z.boolean(), reason: z.string().nullable() })
  .meta({ id: 'IdentityStatus' });

export const getMyIdentity = defineRoute({
  id: 'getMyIdentity',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/me/identity',
  summary: 'My identity verification status (no ID number is returned)',
  tags,
  auth: 'customer',
  rate: 'read',
  response: identity,
  handler: ({ actor }) => identityView(actor!),
});

export const submitMyIdentityRoute = defineRoute({
  id: 'submitMyIdentity',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/me/identity',
  summary: 'Submit the National ID (number + front and back photos) for EDMN staff review',
  tags,
  auth: 'customer',
  rate: 'sensitive',
  idempotency: 'required',
  errors: ['invalid_state'],
  multipart: { files: { front: { max: 1 }, back: { max: 1 } } },
  body: z.object({ legalName: z.string().trim().min(6).max(150), nationalId: z.string().trim().min(14).max(20) }),
  response: identity,
  handler: ({ actor, body, files }) => submitMyIdentity(actor!, body, files.front?.[0] ?? null, files.back?.[0] ?? null),
});

/* ───────────────────────── Seller application ───────────────────────── */

const application = z
  .object({
    seller: z
      .object({
        status: z.string(),
        type: z.string(),
        statusReason: z.string().nullable(),
        editable: z.boolean(),
        legalName: z.string().nullable(),
        mobile: z.string().nullable(),
        email: z.string().nullable(),
        addressLine: z.string().nullable(),
        city: z.string().nullable(),
        governorateId: z.number().int().nullable(),
        hasNationalId: z.boolean(),
        businessLegalName: z.string().nullable(),
        businessAddress: z.string().nullable(),
        authorizedRepresentative: z.string().nullable(),
        store: z.object({ name: z.string(), slug: z.string(), description: z.string().nullable(), returnAddress: z.string().nullable(), returnGovernorateId: z.number().int().nullable(), supportPhone: z.string().nullable() }).nullable(),
        documents: z.array(z.string()),
        payout: z.object({ type: z.string(), status: z.string(), masked: z.string() }).nullable(),
      })
      .nullable(),
    checklist: z.array(z.object({ key: z.string(), label: z.string(), ok: z.boolean() })),
    identity,
  })
  .meta({ id: 'SellerApplication' });

const app = { api: 'mobile' as const, auth: 'customer' as const, tags, response: application };

export const getSellerApplication = defineRoute({ ...app, id: 'getSellerApplication', method: 'GET', path: '/api/v1/seller/application', summary: 'My seller application with its checklist', rate: 'read', handler: ({ actor }) => sellerApplication(actor!) });

export const startSellerApplicationRoute = defineRoute({
  ...app,
  id: 'startSellerApplication',
  method: 'POST',
  path: '/api/v1/seller/application',
  summary: 'Start a seller application (idempotent: returns the existing one)',
  rate: 'write',
  body: z.object({ type: z.enum(['INDIVIDUAL', 'BUSINESS']) }),
  handler: ({ actor, body }) => startSellerApplication(actor!, body.type),
});

export const saveSellerIdentityRoute = defineRoute({
  ...app,
  id: 'saveSellerApplicationIdentity',
  method: 'PUT',
  path: '/api/v1/seller/application/identity',
  summary: 'Owner identity and address on the application (National ID is encrypted; never returned)',
  rate: 'sensitive',
  errors: ['invalid_state', 'not_found'],
  body: identitySchema,
  handler: ({ actor, body }) => saveSellerIdentity(actor!, body),
});

export const saveSellerBusinessRoute = defineRoute({
  ...app,
  id: 'saveSellerApplicationBusiness',
  method: 'PUT',
  path: '/api/v1/seller/application/business',
  summary: 'Business details (companies only)',
  rate: 'write',
  errors: ['invalid_state', 'not_found'],
  body: businessSchema,
  handler: ({ actor, body }) => saveSellerBusiness(actor!, body),
});

export const saveSellerStoreRoute = defineRoute({
  ...app,
  id: 'saveSellerApplicationStore',
  method: 'POST',
  path: '/api/v1/seller/application/store',
  summary: 'Store name, description, return address and optional logo',
  rate: 'write',
  idempotency: 'required',
  errors: ['invalid_state', 'not_found'],
  multipart: { files: { logo: { max: 1 } } },
  body: z.object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().max(2000).optional(),
    returnAddress: z.string().trim().min(5).max(300),
    returnGovernorateId: z.coerce.number().int().positive(),
    supportPhone: z.string().trim().max(20).optional(),
  }),
  handler: ({ actor, body, files }) => saveSellerStore(actor!, body, files.logo?.[0] ?? null),
});

export const uploadSellerDocumentRoute = defineRoute({
  ...app,
  id: 'uploadSellerApplicationDocument',
  method: 'POST',
  path: '/api/v1/seller/application/documents',
  summary: 'Upload one application document (replaces the previous one of the same kind)',
  rate: 'write',
  idempotency: 'required',
  errors: ['invalid_state', 'not_found'],
  multipart: { files: { file: { max: 1, required: true } } },
  body: z.object({ kind: z.enum(SELLER_DOCUMENT_KINDS) }),
  handler: ({ actor, body, files }) => uploadSellerDoc(actor!, body.kind, files.file![0]),
});

export const addSellerPayoutAccountRoute = defineRoute({
  ...app,
  id: 'addSellerPayoutAccount',
  method: 'POST',
  path: '/api/v1/seller/application/payout-account',
  summary: 'Payout account (bank / InstaPay / mobile wallet) — verified by EDMN staff before any payout',
  rate: 'sensitive',
  idempotency: 'required',
  errors: ['invalid_state', 'not_found', 'forbidden'],
  body: payoutSchema,
  handler: ({ actor, body }) => addSellerPayout(actor!, body),
});

export const submitSellerApplicationRoute = defineRoute({
  ...app,
  id: 'submitSellerApplication',
  method: 'POST',
  path: '/api/v1/seller/application/submit',
  summary: 'Accept the seller agreement and submit the application for review',
  rate: 'write',
  idempotency: 'required',
  errors: ['invalid_state', 'identity_required', 'not_found'],
  body: z.object({ acceptAgreement: z.literal(true) }),
  handler: ({ actor, body }) => submitSellerApplication(actor!, body.acceptAgreement),
});

/* ───────────────────────── Products ───────────────────────── */

export const getCategoryAttributes = defineRoute({
  id: 'getCategoryAttributes',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/catalog/categories/{categoryId}/attributes',
  summary: 'Attributes a category expects (for the product form)',
  tags: ['Catalog'],
  auth: 'none',
  rate: 'read',
  params: z.object({ categoryId: uuid }),
  response: z.object({
    items: z.array(
      z.object({ code: z.string(), nameAr: z.string(), type: z.string(), required: z.boolean(), variantAxis: z.boolean(), options: z.array(z.object({ value: z.string(), labelAr: z.string() })) }),
    ),
  }),
  handler: ({ params }) => categoryAttributes(params.categoryId),
});

const editor = z
  .object({
    id: uuid,
    slug: z.string(),
    status: z.string(),
    isListed: z.boolean(),
    categoryId: uuid.nullable(),
    titleAr: z.string(),
    titleEn: z.string().nullable(),
    description: z.string().nullable(),
    keyFeatures: z.array(z.string()),
    condition: z.string(),
    usedGrade: z.string().nullable(),
    conditionNotes: z.string().nullable(),
    defects: z.string().nullable(),
    includedAccessories: z.string().nullable(),
    warrantyInfo: z.string().nullable(),
    processingDays: z.number().int().nullable(),
    returnPolicyConfirmed: z.boolean(),
    returnPolicyOverride: z.boolean(),
    acceptsVoluntaryReturns: z.boolean().nullable(),
    voluntaryReturnDays: z.number().int().nullable(),
    attributes: z.record(z.string(), z.array(z.string())),
    images: z.array(z.object({ fileId: uuid, url: z.string().nullable(), isActualItem: z.boolean() })),
    variants: z.array(
      z.object({
        id: uuid,
        sku: z.string(),
        options: z.record(z.string(), z.string()),
        pricePiastres: piastres,
        compareAtPricePiastres: piastres.nullable(),
        stockOnHand: z.number().int(),
        reserved: z.number().int(),
        lowStockThreshold: z.number().int(),
        isActive: z.boolean(),
      }),
    ),
    pendingRevision: z.boolean(),
    moderationNote: z.string().nullable(),
    submissionProblems: z.array(z.string()),
  })
  .meta({ id: 'SellerProductEditor' });

const sp = { api: 'mobile' as const, auth: 'seller' as const, tags, response: editor, errors: ['forbidden' as const, 'not_found' as const, 'invalid_state' as const] };
const pid = z.object({ productId: uuid });

export const getSellerProduct = defineRoute({ ...sp, id: 'getSellerProduct', method: 'GET', path: '/api/v1/seller/products/{productId}', summary: 'One of my products for editing (with submission problems and moderation note)', rate: 'read', params: pid, handler: ({ actor, params }) => productEditor(actor!, params.productId) });

export const createSellerProduct = defineRoute({
  ...sp,
  id: 'createSellerProduct',
  method: 'POST',
  path: '/api/v1/seller/products',
  summary: 'Create a product draft (category, title, new/used)',
  rate: 'write',
  idempotency: 'required',
  status: 201,
  body: z.object({ categoryId: uuid, titleAr: z.string().trim().min(5).max(200), condition: z.enum(['NEW', 'USED']) }),
  handler: ({ actor, body }) => createProduct(actor!, body),
});

export const saveSellerProductDetails = defineRoute({ ...sp, id: 'saveSellerProductDetails', method: 'PUT', path: '/api/v1/seller/products/{productId}/details', summary: 'Title, description, condition, attributes', rate: 'write', params: pid, body: detailsSchema, handler: ({ actor, params, body }) => saveProductDetails(actor!, params.productId, body) });

export const saveSellerProductLogistics = defineRoute({
  ...sp,
  id: 'saveSellerProductLogistics',
  method: 'PUT',
  path: '/api/v1/seller/products/{productId}/logistics',
  summary: 'Processing time, dimensions and the product return policy',
  rate: 'write',
  params: pid,
  body: logisticsSchema,
  handler: ({ actor, params, body }) => saveProductLogistics(actor!, params.productId, body),
});

export const addSellerProductImages = defineRoute({
  ...sp,
  id: 'addSellerProductImages',
  method: 'POST',
  path: '/api/v1/seller/products/{productId}/images',
  summary: 'Upload up to 10 photos (isActualItem = photos of the actual used item)',
  rate: 'write',
  idempotency: 'required',
  params: pid,
  multipart: { files: { images: { max: 10, required: true } } },
  body: z.object({ isActualItem: z.enum(['true', 'false']).optional() }),
  handler: ({ actor, params, body, files }) => addProductImages(actor!, params.productId, files.images!, body.isActualItem === 'true'),
});

export const deleteSellerProductImage = defineRoute({
  ...sp,
  id: 'deleteSellerProductImage',
  method: 'DELETE',
  path: '/api/v1/seller/products/{productId}/images/{fileId}',
  summary: 'Remove a photo',
  rate: 'write',
  idempotency: 'required',
  params: z.object({ productId: uuid, fileId: uuid }),
  handler: ({ actor, params }) => deleteProductImage(actor!, params.productId, params.fileId),
});

export const saveSellerProductVariants = defineRoute({
  ...sp,
  id: 'saveSellerProductVariants',
  method: 'PUT',
  path: '/api/v1/seller/products/{productId}/variants',
  summary: 'Prices (piastres), stock and options of every variant',
  rate: 'write',
  params: pid,
  body: z.object({ variants: z.array(variantSchema).min(1).max(100) }),
  handler: ({ actor, params, body }) => saveProductVariants(actor!, params.productId, body.variants),
});

export const submitSellerProduct = defineRoute({ ...sp, id: 'submitSellerProduct', method: 'POST', path: '/api/v1/seller/products/{productId}/submit', summary: 'Submit for EDMN moderation', rate: 'write', idempotency: 'required', params: pid, handler: ({ actor, params }) => submitProduct(actor!, params.productId) });

export const setSellerProductVisibility = defineRoute({
  ...sp,
  id: 'setSellerProductVisibility',
  method: 'POST',
  path: '/api/v1/seller/products/{productId}/visibility',
  summary: 'Show / hide an approved product to buyers',
  rate: 'write',
  idempotency: 'required',
  params: pid,
  body: z.object({ listed: z.boolean() }),
  handler: ({ actor, params, body }) => setProductVisible(actor!, params.productId, body.listed),
});

export const archiveSellerProduct = defineRoute({ ...sp, id: 'archiveSellerProduct', method: 'POST', path: '/api/v1/seller/products/{productId}/archive', summary: 'Archive (soft) one of my products; order history is kept', rate: 'write', idempotency: 'required', params: pid, handler: ({ actor, params }) => archiveMyProduct(actor!, params.productId) });

export const markSellerProductOutOfStock = defineRoute({ ...sp, id: 'markSellerProductOutOfStock', method: 'POST', path: '/api/v1/seller/products/{productId}/out-of-stock', summary: 'Stop sales now: stock down to what is already reserved', rate: 'write', idempotency: 'required', params: pid, handler: ({ actor, params }) => markMyProductOutOfStock(actor!, params.productId) });

/* ───────────────────────── Shipping & store ───────────────────────── */

const rates = z.object({ items: z.array(z.object({ governorateId: z.number().int(), enabled: z.boolean(), feePiastres: piastres, etaMinDays: z.number().int(), etaMaxDays: z.number().int() })) });

export const getSellerShippingRates = defineRoute({ api: 'mobile', auth: 'seller', tags, id: 'getSellerShippingRates', method: 'GET', path: '/api/v1/seller/shipping-rates', summary: 'Delivery fee and ETA per governorate', rate: 'read', errors: ['forbidden'], response: rates, handler: ({ actor }) => shippingRates(actor!) });

export const saveSellerShippingRates = defineRoute({
  api: 'mobile',
  auth: 'seller',
  tags,
  id: 'saveSellerShippingRates',
  method: 'PUT',
  path: '/api/v1/seller/shipping-rates',
  summary: 'Set delivery fee / ETA / enabled per governorate (store.manage)',
  rate: 'write',
  errors: ['forbidden'],
  body: z.object({ items: z.array(z.object({ governorateId: z.number().int().positive(), enabled: z.boolean(), feePiastres: z.number().int().min(0).max(10_000_00), etaMinDays: z.number().int().min(0).max(60), etaMaxDays: z.number().int().min(0).max(60) })).max(40) }),
  response: rates,
  handler: ({ actor, body }) => saveShippingRates(actor!, body.items),
});

const store = z
  .object({
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    returnAddress: z.string().nullable(),
    supportPhone: z.string().nullable(),
    acceptsVoluntaryReturns: z.boolean(),
    voluntaryReturnDays: z.number().int().nullable(),
    returnConditions: z.string().nullable(),
    returnConditionKeys: z.array(z.string()),
    returnShippingPayer: z.string().nullable(),
    shippingPolicy: z.string().nullable(),
    defaultProcessingDays: z.number().int().nullable(),
    freeShippingThresholdPiastres: piastres.nullable(),
    logoUrl: z.string().nullable(),
    bannerUrl: z.string().nullable(),
  })
  .meta({ id: 'SellerStoreSettings' });

export const getSellerStore = defineRoute({ api: 'mobile', auth: 'seller', tags, id: 'getSellerStoreSettings', method: 'GET', path: '/api/v1/seller/store', summary: 'Store profile, return policy and shipping policy', rate: 'read', errors: ['forbidden'], response: store, handler: ({ actor }) => storeSettings(actor!) });

export const saveSellerStoreSettingsRoute = defineRoute({
  api: 'mobile',
  auth: 'seller',
  tags,
  id: 'saveSellerStoreSettings',
  method: 'PUT',
  path: '/api/v1/seller/store',
  summary: 'Update store profile and policies (store.manage)',
  rate: 'write',
  errors: ['forbidden'],
  body: storeSettingsSchema,
  response: store,
  handler: ({ actor, body }) => saveStoreSettings(actor!, body, null, null),
});

export const saveSellerStoreMediaRoute = defineRoute({
  api: 'mobile',
  auth: 'seller',
  tags,
  id: 'saveSellerStoreMedia',
  method: 'POST',
  path: '/api/v1/seller/store/media',
  summary: 'Replace the store logo and/or banner (store.manage). Images only; validated and re-encoded by the server',
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'validation_failed', 'not_found'],
  multipart: { files: { logo: { max: 1 }, banner: { max: 1 } } },
  body: z.object({}),
  response: store,
  handler: ({ actor, files }) => saveStoreMedia(actor!, files.logo?.[0] ?? null, files.banner?.[0] ?? null),
});

/* ───────────────────────── Payout REQUESTS (no transfer, no release from the app) ───────────────────────── */

const payoutRequest = z.object({
  id: uuid,
  amountPiastres: piastres,
  status: z.string().meta({ description: 'TRANSFER_UNCERTAIN = transfer not confirmed either way; never retried by the app.' }),
  createdAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
  reference: z.string().nullable(),
  reasonAr: z.string().nullable(),
  cancellable: z.boolean(),
});

export const listSellerPayoutRequests = defineRoute({
  api: 'mobile',
  auth: 'seller',
  tags,
  id: 'listSellerPayoutRequests',
  method: 'GET',
  path: '/api/v1/seller/payout-requests',
  summary: 'My store payout requests and their review / transfer status (finance.view)',
  rate: 'read',
  errors: ['forbidden'],
  response: z.object({ items: z.array(payoutRequest) }),
  handler: ({ actor }) => payoutRequests(actor!),
});

export const previewSellerPayoutRequest = defineRoute({
  api: 'mobile',
  auth: 'seller',
  tags,
  id: 'previewSellerPayoutRequest',
  method: 'POST',
  path: '/api/v1/seller/payout-requests/preview',
  summary: 'Transfer cost and net for an amount (no state change; finance.withdraw)',
  rate: 'read',
  errors: ['forbidden', 'invalid_state'],
  body: z.object({ amountPiastres: z.number().int().positive() }),
  response: z.object({ amountPiastres: piastres, transferCostPiastres: piastres, netPiastres: piastres, warnings: z.array(z.string()), violations: z.array(z.string()) }),
  handler: ({ actor, body }) => payoutPreview(actor!, body.amountPiastres),
});

export const createSellerPayoutRequest = defineRoute({
  api: 'mobile',
  auth: 'seller',
  tags,
  id: 'createSellerPayoutRequest',
  method: 'POST',
  path: '/api/v1/seller/payout-requests',
  summary: 'Request a payout of withdrawable funds — REQUEST ONLY (EDMN two-person review and transfer follow)',
  description: 'clientKey identifies this request: a retry with the same key returns the same request. The server re-checks withdrawable funds, holds and debts.',
  rate: 'sensitive',
  status: 201,
  errors: ['forbidden', 'invalid_state', 'insufficient_balance'],
  body: z.object({ amountPiastres: z.number().int().positive(), clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) }),
  response: z.object({ created: z.boolean(), request: payoutRequest }),
  handler: ({ actor, body }) => requestPayout(actor!, body.amountPiastres, body.clientKey),
});

export const cancelSellerPayoutRequest = defineRoute({
  api: 'mobile',
  auth: 'seller',
  tags,
  id: 'cancelSellerPayoutRequest',
  method: 'POST',
  path: '/api/v1/seller/payout-requests/{requestId}/cancel',
  summary: 'Cancel my payout request before EDMN approves it',
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'invalid_state'],
  params: z.object({ requestId: uuid }),
  response: z.object({ items: z.array(payoutRequest) }),
  handler: ({ actor, params }) => cancelPayoutRequest(actor!, params.requestId),
});

export const sellerSetupRoutes = [
  getMyIdentity, submitMyIdentityRoute,
  getSellerApplication, startSellerApplicationRoute, saveSellerIdentityRoute, saveSellerBusinessRoute, saveSellerStoreRoute, uploadSellerDocumentRoute, addSellerPayoutAccountRoute, submitSellerApplicationRoute,
  getCategoryAttributes, getSellerProduct, createSellerProduct, saveSellerProductDetails, saveSellerProductLogistics, addSellerProductImages, deleteSellerProductImage, saveSellerProductVariants, submitSellerProduct, setSellerProductVisibility, archiveSellerProduct, markSellerProductOutOfStock,
  getSellerShippingRates, saveSellerShippingRates, getSellerStore, saveSellerStoreSettingsRoute, saveSellerStoreMediaRoute,
  listSellerPayoutRequests, previewSellerPayoutRequest, createSellerPayoutRequest, cancelSellerPayoutRequest,
];
