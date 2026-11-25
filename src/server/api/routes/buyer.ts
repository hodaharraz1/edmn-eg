import { z } from 'zod';
import { mobileChangePassword, updateMyProfile } from '@/server/auth/mobile';
import { confirmVerificationCode, requestPasswordReset, resetPassword, sendVerificationCode } from '@/server/auth/service';
import { addToCart, updateCartItem } from '@/server/modules/commerce/cart';
import { confirmReceipt, reportOrderProblem, requestCancellation } from '@/server/modules/commerce/fulfilment';
import { cancelUnpaidOrder, placeOrder } from '@/server/modules/commerce/orders';
import { archiveAddress, saveAddress } from '@/server/modules/customers/addresses';
import { acknowledgeCartPrices, buyerAddresses, buyerCart, buyerCheckout, buyerOrder, buyerOrders, buyerPayment, downloadMyFile } from '@/server/modules/mobile/buyer';
import { submitProof } from '@/server/modules/payments/service';
import { ApiError } from '../errors';
import { defineRoute } from '../http';
import { isoDateTime, ok, piastres, profile, tokenPair, uuid } from '../schemas';
import { PAYMENT_METHOD_CODES } from '@/domain/machines';

/**
 * Customer App — buyer account, cart, checkout, orders and manual payment. Thin transport over the existing domain
 * services: prices, fees, shipping, totals, stock checks, ownership and allowed actions are all decided there.
 * The buyer is ALWAYS the session's user; no route accepts a user id.
 */
const SELLER_ORDER_ACTIONS = z.enum(['REQUEST_CANCELLATION', 'CONFIRM_RECEIPT', 'REPORT_PROBLEM', 'OPEN_DISPUTE', 'CONFIRM_ORDER', 'START_PROCESSING', 'MARK_READY_TO_SHIP', 'SAVE_SHIPMENT', 'MARK_SHIPPED', 'ADD_TRACKING_EVENT', 'SUBMIT_DELIVERY_EVIDENCE', 'ACCEPT_CANCELLATION', 'MESSAGE_SELLER', 'REQUEST_RETURN', 'WRITE_REVIEW']);

const returnPolicy = z
  .object({ type: z.enum(['VOLUNTARY', 'NONE']), windowDays: z.number().int().nullable(), conditions: z.array(z.string()), shippingPayer: z.string(), notes: z.string(), summaryAr: z.string() })
  .meta({ id: 'ReturnPolicy' });

const cart = z
  .object({
    groups: z.array(
      z.object({
        store: z.object({ name: z.string(), slug: z.string(), verified: z.boolean() }),
        lines: z.array(
          z.object({
            variantId: uuid,
            productSlug: z.string(),
            title: z.string(),
            variantLabel: z.string(),
            condition: z.string(),
            imageUrl: z.string().nullable(),
            unitPricePiastres: piastres,
            compareAtPricePiastres: piastres.nullable(),
            priceSeenPiastres: piastres.nullable(),
            quantity: z.number().int(),
            lineTotalPiastres: piastres,
            buyerFeePiastres: piastres,
            issues: z.array(z.enum(['UNAVAILABLE', 'INSUFFICIENT_STOCK', 'PRICE_CHANGED', 'SELLER_UNAVAILABLE', 'NO_SHIPPING'])),
            returnPolicy: returnPolicy.nullable(),
          }),
        ),
        merchandiseSubtotalPiastres: piastres,
        shippingFeePiastres: piastres.nullable().meta({ description: 'null = not priced yet (no governorate) or the seller does not ship there' }),
        freeShippingApplied: z.boolean(),
        etaMinDays: z.number().int().nullable(),
        etaMaxDays: z.number().int().nullable(),
        processingDays: z.number().int(),
        buyerFeePiastres: piastres,
        totalPiastres: piastres,
      }),
    ),
    merchandiseTotalPiastres: piastres,
    shippingTotalPiastres: piastres,
    discountTotalPiastres: piastres,
    buyerFeeTotalPiastres: piastres,
    grandTotalPiastres: piastres,
    itemCount: z.number().int(),
    hasIssues: z.boolean(),
    shippingResolved: z.boolean(),
    pricingVersionId: uuid.nullable(),
    pricingUnavailableAr: z.string().nullable(),
    canCheckout: z.boolean().meta({ description: 'Server verdict. The app never decides this itself.' }),
  })
  .meta({ id: 'Cart' });

const address = z
  .object({
    id: uuid,
    label: z.string().nullable(),
    recipientName: z.string(),
    phone: z.string(),
    governorateId: z.number().int(),
    city: z.string(),
    district: z.string().nullable(),
    street: z.string(),
    building: z.string().nullable(),
    floor: z.string().nullable(),
    apartment: z.string().nullable(),
    landmark: z.string().nullable(),
    isDefault: z.boolean(),
  })
  .meta({ id: 'Address' });

const addressInput = z.object({
  label: z.string().max(40).optional(),
  recipientName: z.string().min(3).max(120),
  phone: z.string().min(8).max(20),
  governorateId: z.number().int().positive(),
  city: z.string().min(2).max(100),
  district: z.string().max(100).optional(),
  street: z.string().min(3).max(200),
  building: z.string().max(40).optional(),
  floor: z.string().max(20).optional(),
  apartment: z.string().max(20).optional(),
  landmark: z.string().max(200).optional(),
  isDefault: z.boolean().optional(),
});

const payment = z
  .object({
    id: uuid,
    method: z.enum(PAYMENT_METHOD_CODES),
    status: z.string(),
    amountDuePiastres: piastres,
    dueAt: isoDateTime,
    isTest: z.boolean().meta({ description: 'true while Real Money is OFF: a TEST payment, never a real transfer.' }),
    confirmedAt: isoDateTime.nullable(),
    destinations: z.array(z.object({ label: z.string(), details: z.record(z.string(), z.string()), instructionsAr: z.string().nullable(), isTest: z.boolean() })),
    submissions: z.array(
      z.object({ id: uuid, status: z.string(), claimedAmountPiastres: piastres, reference: z.string().nullable(), submittedAt: isoDateTime, reviewReasonAr: z.string().nullable(), proofFileId: uuid }),
    ),
    lastRejectionReasonAr: z.string().nullable(),
    allowedActions: z.array(z.enum(['SUBMIT_PROOF'])),
  })
  .meta({ id: 'Payment' });

const orderSummary = z.object({
  id: uuid,
  number: z.string(),
  status: z.string(),
  grandTotalPiastres: piastres,
  placedAt: isoDateTime,
  paymentStatus: z.string().nullable(),
  paymentDueAt: isoDateTime,
  itemCount: z.number().int(),
  thumbnails: z.array(z.string()).max(3),
});

const order = z
  .object({
    id: uuid,
    number: z.string(),
    status: z.string(),
    placedAt: isoDateTime,
    paymentMethod: z.string(),
    shippingAddress: z.record(z.string(), z.unknown()),
    customerNote: z.string().nullable(),
    merchandiseTotalPiastres: piastres,
    shippingTotalPiastres: piastres,
    discountTotalPiastres: piastres,
    buyerFeeTotalPiastres: piastres,
    grandTotalPiastres: piastres,
    cancelReasonAr: z.string().nullable(),
    allowedActions: z.array(z.enum(['CANCEL_UNPAID'])),
    payment: payment.nullable(),
    sellerOrders: z.array(
      z.object({
        id: uuid,
        number: z.string(),
        status: z.string(),
        store: z.object({ name: z.string(), slug: z.string() }),
        merchandiseSubtotalPiastres: piastres,
        shippingFeePiastres: piastres,
        buyerFeePiastres: piastres,
        grossTotalPiastres: piastres,
        refundedTotalPiastres: piastres,
        shippingEtaMinDays: z.number().int().nullable(),
        shippingEtaMaxDays: z.number().int().nullable(),
        shippedAt: isoDateTime.nullable(),
        deliveredAt: isoDateTime.nullable(),
        buyerResponseDueAt: isoDateTime.nullable(),
        receiptBasis: z.string().nullable(),
        cancelledAt: isoDateTime.nullable(),
        cancelReasonAr: z.string().nullable(),
        cancellationPending: z.boolean(),
        openDispute: z.boolean(),
        items: z.array(
          z.object({
            id: uuid,
            productId: uuid,
            productSlug: z.string().nullable().meta({ description: 'Current product slug (the product may no longer be listed; then the detail route answers 404).' }),
            variantId: uuid.meta({ description: 'For "order again": the server re-prices it when added to the cart.' }),
            title: z.string(),
            variantLabel: z.string(),
            condition: z.string(),
            imageUrl: z.string().nullable(),
            unitPricePiastres: piastres,
            quantity: z.number().int(),
            lineTotalPiastres: piastres,
            refundedQuantity: z.number().int(),
            returnedQuantity: z.number().int(),
            returnPolicy: returnPolicy.nullable(),
          }),
        ),
        shipment: z
          .object({
            status: z.string(),
            carrierName: z.string(),
            trackingNumber: z.string().nullable(),
            shippedAt: isoDateTime.nullable(),
            expectedDeliveryAt: isoDateTime.nullable(),
            events: z.array(z.object({ status: z.string(), description: z.string().nullable(), occurredAt: isoDateTime })),
          })
          .nullable(),
        disputes: z.array(z.object({ id: uuid, number: z.number().int(), status: z.string() })),
        returns: z.array(z.object({ id: uuid, number: z.number().int(), status: z.string() })),
        refunds: z.array(z.object({ id: uuid, status: z.string().meta({ description: 'Includes TRANSFER_UNCERTAIN: neither paid nor failed — shown as "being verified".' }), amountPiastres: piastres })),
        allowedActions: z.array(SELLER_ORDER_ACTIONS),
      }),
    ),
  })
  .meta({ id: 'Order' });

const base = { api: 'mobile' as const, auth: 'customer' as const };

/* ───────── Account ───────── */

export const updateProfile = defineRoute({
  ...base,
  id: 'updateMe',
  method: 'PATCH',
  path: '/api/v1/me',
  summary: 'Update my display name',
  tags: ['Account'],
  rate: 'write',
  body: z.object({ fullName: z.string().trim().min(3).max(120) }),
  response: profile,
  handler: ({ actor, body }) => updateMyProfile(actor!, body),
});

export const changePassword = defineRoute({
  ...base,
  id: 'changePassword',
  method: 'POST',
  path: '/api/v1/me/password',
  summary: 'Change my password (signs out every other device; this device gets new tokens)',
  tags: ['Account'],
  rate: 'sensitive',
  body: z.object({ current: z.string().min(1).max(256), next: z.string().min(1).max(256) }),
  response: tokenPair,
  handler: ({ actor, body, meta }) => mobileChangePassword(actor!, body.current, body.next, meta),
});

export const forgotPassword = defineRoute({
  id: 'forgotPassword',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/auth/password/forgot',
  summary: 'Request a password-reset link (always answers the same, whether or not the account exists)',
  tags: ['Auth'],
  auth: 'none',
  rate: 'sensitive',
  body: z.object({ identifier: z.string().trim().min(3).max(200) }),
  response: ok,
  handler: async ({ body, meta }) => {
    await requestPasswordReset(body.identifier, meta);
    return { ok: true as const };
  },
});

export const resetPasswordRoute = defineRoute({
  id: 'resetPassword',
  api: 'mobile',
  method: 'POST',
  path: '/api/v1/auth/password/reset',
  summary: 'Set a new password with the token from the reset link (every session is signed out)',
  tags: ['Auth'],
  auth: 'none',
  rate: 'sensitive',
  body: z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(1).max(256) }),
  response: ok,
  handler: async ({ body, meta }) => {
    await resetPassword(body.token, body.newPassword, meta);
    return { ok: true as const };
  },
});

export const sendVerification = defineRoute({
  ...base,
  id: 'sendVerificationCode',
  method: 'POST',
  path: '/api/v1/me/verification/send',
  summary: 'Send a 6-digit verification code to my email or phone',
  description: 'Phone codes need an SMS provider; when none can deliver, the request is refused instead of pretending a code was sent.',
  tags: ['Account'],
  rate: 'sensitive',
  body: z.object({ channel: z.enum(['EMAIL', 'PHONE']) }),
  response: ok,
  handler: async ({ actor, body }) => {
    await sendVerificationCode(actor!.userId!, body.channel);
    return { ok: true as const };
  },
});

export const confirmVerification = defineRoute({
  ...base,
  id: 'confirmVerificationCode',
  method: 'POST',
  path: '/api/v1/me/verification/confirm',
  summary: 'Confirm my email or phone with the code',
  tags: ['Account'],
  rate: 'sensitive',
  body: z.object({ channel: z.enum(['EMAIL', 'PHONE']), code: z.string().regex(/^\d{6}$/) }),
  response: profile,
  handler: async ({ actor, body }) => {
    if (!(await confirmVerificationCode(actor!.userId!, body.channel, body.code))) throw new ApiError('validation_failed', 'الرمز غلط أو صلاحيته خلصت', { issues: [{ path: 'code', code: 'invalid_or_expired' }] });
    const { myProfile } = await import('@/server/auth/mobile');
    return myProfile(actor!);
  },
});

/* ───────── Addresses ───────── */

export const listAddresses = defineRoute({
  ...base,
  id: 'listAddresses',
  method: 'GET',
  path: '/api/v1/me/addresses',
  summary: 'My saved addresses',
  tags: ['Addresses'],
  rate: 'read',
  response: z.object({ items: z.array(address) }),
  handler: async ({ actor }) => ({ items: await buyerAddresses(actor!) }),
});

export const createAddress = defineRoute({
  ...base,
  id: 'createAddress',
  method: 'POST',
  path: '/api/v1/me/addresses',
  summary: 'Save a new address',
  tags: ['Addresses'],
  rate: 'write',
  idempotency: 'required',
  status: 201,
  body: addressInput,
  response: z.object({ id: uuid }),
  handler: async ({ actor, body }) => ({ id: await saveAddress(actor!, null, body) }),
});

export const updateAddress = defineRoute({
  ...base,
  id: 'updateAddress',
  method: 'PUT',
  path: '/api/v1/me/addresses/{addressId}',
  summary: 'Update one of my addresses (past orders keep their own snapshot)',
  tags: ['Addresses'],
  rate: 'write',
  errors: ['forbidden', 'not_found'],
  params: z.object({ addressId: uuid }),
  body: addressInput,
  response: z.object({ id: uuid }),
  handler: async ({ actor, params, body }) => ({ id: await saveAddress(actor!, params.addressId, body) }),
});

export const deleteAddress = defineRoute({
  ...base,
  id: 'deleteAddress',
  method: 'DELETE',
  path: '/api/v1/me/addresses/{addressId}',
  summary: 'Remove one of my addresses',
  tags: ['Addresses'],
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden'],
  params: z.object({ addressId: uuid }),
  response: ok,
  handler: async ({ actor, params }) => {
    await archiveAddress(actor!, params.addressId);
    return { ok: true as const };
  },
});

/* ───────── Cart (multi-seller) ───────── */

export const getCart = defineRoute({
  ...base,
  id: 'getCart',
  method: 'GET',
  path: '/api/v1/cart',
  summary: 'My cart, grouped by seller and priced by the server',
  tags: ['Cart'],
  rate: 'read',
  query: z.object({ governorateId: z.coerce.number().int().min(1).max(1000).optional() }),
  response: cart,
  handler: ({ actor, query }) => buyerCart(actor!, query.governorateId ?? null),
});

export const addCartItem = defineRoute({
  ...base,
  id: 'addCartItem',
  method: 'POST',
  path: '/api/v1/cart/items',
  summary: 'Add a product variant to my cart (quantity is added to what is already there)',
  tags: ['Cart'],
  rate: 'write',
  idempotency: 'required',
  errors: ['invalid_state', 'insufficient_stock'],
  body: z.object({ variantId: uuid, quantity: z.number().int().min(1).max(99) }),
  response: z.object({ quantity: z.number().int() }),
  handler: async ({ actor, body }) => ({ quantity: await addToCart({ userId: actor!.userId! }, body.variantId, body.quantity) }),
});

export const setCartItem = defineRoute({
  ...base,
  id: 'setCartItemQuantity',
  method: 'PUT',
  path: '/api/v1/cart/items/{variantId}',
  summary: 'Set the quantity of a cart line (0 removes it)',
  tags: ['Cart'],
  rate: 'write',
  errors: ['insufficient_stock', 'not_found'],
  params: z.object({ variantId: uuid }),
  body: z.object({ quantity: z.number().int().min(0).max(99) }),
  response: ok,
  handler: async ({ actor, params, body }) => {
    await updateCartItem({ userId: actor!.userId! }, params.variantId, body.quantity);
    return { ok: true as const };
  },
});

export const ackCartPrices = defineRoute({
  ...base,
  id: 'acknowledgeCartPrices',
  method: 'POST',
  path: '/api/v1/cart/acknowledge-prices',
  summary: 'I have seen the changed prices (clears PRICE_CHANGED so checkout can continue)',
  tags: ['Cart'],
  rate: 'write',
  response: ok,
  handler: async ({ actor }) => {
    await acknowledgeCartPrices(actor!);
    return { ok: true as const };
  },
});

/* ───────── Checkout and orders ───────── */

export const getCheckout = defineRoute({
  ...base,
  id: 'getCheckout',
  method: 'GET',
  path: '/api/v1/checkout',
  summary: 'Checkout quote for one of my addresses: priced cart, payment methods, payment window',
  tags: ['Checkout'],
  rate: 'read',
  errors: ['not_found'],
  query: z.object({ addressId: uuid.optional() }),
  response: z
    .object({
      selectedAddressId: uuid.nullable(),
      addresses: z.array(address),
      cart,
      paymentMethods: z.array(z.object({ code: z.enum(PAYMENT_METHOD_CODES), nameAr: z.string(), nameEn: z.string(), instructionsAr: z.string().nullable() })),
      /** COD collection fee (piasters) added to the total when the buyer chooses COD; 0 when COD is off. */
      codFeePiastres: z.number().int(),
      paymentWindowHours: z.number().int(),
      realMoneyEnabled: z.boolean(),
      mandatoryRightsNoticeAr: z.string(),
    })
    .meta({ id: 'Checkout' }),
  handler: ({ actor, query }) => buyerCheckout(actor!, query.addressId ?? null),
});

export const createOrder = defineRoute({
  ...base,
  id: 'placeOrder',
  method: 'POST',
  path: '/api/v1/orders',
  summary: 'Place the order for my cart (one order, one sub-order per seller)',
  description:
    'checkoutKey is the idempotency key of THIS checkout: retrying with the same key returns the same order. expectedTotal / expectedPricingVersionId are the values the buyer saw; if the server now computes something else the order is refused (conflict) and the app must show the new quote.',
  tags: ['Checkout'],
  rate: 'write',
  status: 201,
  errors: ['conflict', 'invalid_state', 'insufficient_stock', 'identity_required', 'forbidden'],
  body: z.object({
    addressId: uuid,
    paymentMethod: z.enum(PAYMENT_METHOD_CODES),
    checkoutKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
    expectedTotalPiastres: z.number().int().min(0),
    expectedPricingVersionId: uuid.optional(),
    note: z.string().max(500).optional(),
  }),
  response: z.object({ orderId: uuid, created: z.boolean().meta({ description: 'false = this checkoutKey already produced this order (retry)' }) }),
  handler: async ({ actor, body }) => {
    const r = await placeOrder(actor!, {
      addressId: body.addressId,
      paymentMethod: body.paymentMethod,
      checkoutKey: body.checkoutKey,
      expectedTotal: body.expectedTotalPiastres,
      expectedPricingVersionId: body.expectedPricingVersionId,
      note: body.note ?? '',
    });
    return { orderId: r.order.id, created: r.created };
  },
});

export const listOrders = defineRoute({
  ...base,
  id: 'listOrders',
  method: 'GET',
  path: '/api/v1/orders',
  summary: 'My orders (newest first)',
  tags: ['Orders'],
  rate: 'read',
  query: z.object({ page: z.coerce.number().int().min(1).max(500).optional() }),
  response: z.object({ page: z.number().int(), pageSize: z.number().int(), items: z.array(orderSummary) }),
  handler: ({ actor, query }) => buyerOrders(actor!, query.page ?? 1),
});

export const getOrder = defineRoute({
  ...base,
  id: 'getOrder',
  method: 'GET',
  path: '/api/v1/orders/{orderId}',
  summary: 'One of my orders with its seller sub-orders, shipment tracking, payment and allowed actions',
  tags: ['Orders'],
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ orderId: uuid }),
  response: order,
  handler: ({ actor, params }) => buyerOrder(actor!, params.orderId),
});

export const cancelOrder = defineRoute({
  ...base,
  id: 'cancelUnpaidOrder',
  method: 'POST',
  path: '/api/v1/orders/{orderId}/cancel',
  summary: 'Cancel my order before any payment proof was sent',
  tags: ['Orders'],
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'invalid_state'],
  params: z.object({ orderId: uuid }),
  response: ok,
  handler: async ({ actor, params }) => {
    await cancelUnpaidOrder(actor!, params.orderId);
    return { ok: true as const };
  },
});

const soParams = z.object({ sellerOrderId: uuid });

export const confirmSellerOrderReceipt = defineRoute({
  ...base,
  id: 'confirmReceipt',
  method: 'POST',
  path: '/api/v1/seller-orders/{sellerOrderId}/confirm-receipt',
  summary: 'I received this shipment (establishes the seller entitlement; moves no money by itself)',
  tags: ['Orders'],
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'invalid_state'],
  params: soParams,
  response: z.object({ alreadyConfirmed: z.boolean() }),
  handler: async ({ actor, params }) => {
    const r = await confirmReceipt(actor!, params.sellerOrderId);
    return { alreadyConfirmed: !!(r as { alreadyConfirmed?: boolean }).alreadyConfirmed };
  },
});

export const requestSellerOrderCancellation = defineRoute({
  ...base,
  id: 'requestCancellation',
  method: 'POST',
  path: '/api/v1/seller-orders/{sellerOrderId}/cancellation-request',
  summary: 'Ask to cancel a sub-order before it ships',
  tags: ['Orders'],
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'invalid_state'],
  params: soParams,
  body: z.object({ note: z.string().trim().min(3).max(500) }),
  response: z.object({ status: z.enum(['CANCELLED', 'PENDING']) }),
  handler: async ({ actor, params, body }) => ({ status: (await requestCancellation(actor!, params.sellerOrderId, body.note)).status }),
});

export const reportSellerOrderProblem = defineRoute({
  ...base,
  id: 'reportOrderProblem',
  method: 'POST',
  path: '/api/v1/seller-orders/{sellerOrderId}/problem',
  summary: 'Report that the shipment did not arrive or has a problem (opens a protective hold and a case)',
  tags: ['Orders'],
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'invalid_state'],
  params: soParams,
  body: z.object({ kind: z.enum(['NOT_RECEIVED', 'PRODUCT_PROBLEM']), description: z.string().trim().min(10).max(2000) }),
  response: ok,
  handler: async ({ actor, params, body }) => {
    await reportOrderProblem(actor!, params.sellerOrderId, body.kind, body.description);
    return { ok: true as const };
  },
});

/* ───────── Manual payment ───────── */

export const getPayment = defineRoute({
  ...base,
  id: 'getPayment',
  method: 'GET',
  path: '/api/v1/payments/{paymentId}',
  summary: 'Transfer instructions, due time and proof history of one of my payments',
  tags: ['Payments'],
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ paymentId: uuid }),
  response: payment.extend({ orderId: uuid.nullable(), dealId: uuid.nullable(), orderNumber: z.string().nullable() }),
  handler: ({ actor, params }) => buyerPayment(actor!, params.paymentId),
});

export const submitPaymentProof = defineRoute({
  ...base,
  id: 'submitPaymentProof',
  method: 'POST',
  path: '/api/v1/payments/{paymentId}/proof',
  summary: 'Upload the transfer receipt (queues the payment for staff verification; never marks it paid)',
  description: 'multipart/form-data. clientKey is the idempotency key of this submission: a retry with the same key is accepted once.',
  tags: ['Payments'],
  rate: 'write',
  status: 201,
  errors: ['forbidden', 'not_found', 'invalid_state', 'conflict'],
  params: z.object({ paymentId: uuid }),
  multipart: { files: { proof: { max: 1, required: true } } },
  body: z.object({
    claimedAmount: z.string().trim().min(1).max(20).meta({ description: 'Amount transferred in EGP as typed by the buyer, e.g. "1250.50" (parsed and checked by the server).' }),
    reference: z.string().trim().max(100).optional(),
    payerName: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
    clientKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  }),
  response: ok,
  handler: async ({ actor, params, body, files }) => {
    await submitProof(actor!, params.paymentId, { claimedAmount: body.claimedAmount, reference: body.reference ?? '', payerName: body.payerName ?? '', notes: body.notes ?? '', clientKey: body.clientKey }, files.proof?.[0] ?? null);
    return { ok: true as const };
  },
});

/* ───────── Private files (payment proofs, evidence, waybills I am allowed to see) ───────── */

export const getFile = defineRoute({
  ...base,
  id: 'getFile',
  method: 'GET',
  path: '/api/v1/files/{fileId}',
  summary: 'Download a private file I am authorized to read (uniform 404 otherwise)',
  tags: ['Files'],
  rate: 'read',
  binary: true,
  errors: ['not_found'],
  params: z.object({ fileId: uuid }),
  response: z.any(),
  handler: ({ actor, params }) => downloadMyFile(actor!, params.fileId),
});

export const buyerRoutes = [
  updateProfile, changePassword, forgotPassword, resetPasswordRoute, sendVerification, confirmVerification,
  listAddresses, createAddress, updateAddress, deleteAddress,
  getCart, addCartItem, setCartItem, ackCartPrices,
  getCheckout, createOrder, listOrders, getOrder, cancelOrder, confirmSellerOrderReceipt, requestSellerOrderCancellation, reportSellerOrderProblem,
  getPayment, submitPaymentProof, getFile,
];
