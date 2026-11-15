import { z } from 'zod';
import {
  sellerFunds,
  sellerHome,
  sellerMembership,
  sellerOrdersPage,
  sellerOrderStep,
  sellerOrderView,
  sellerProductsPage,
  sellerSaveShipment,
  sellerSetStock,
} from '@/server/modules/mobile/seller';
import { defineRoute } from '../http';
import { isoDateTime, piastres, uuid } from '../schemas';

/**
 * Seller Center in the Customer App. The store is ALWAYS the session user's membership (auth mode `seller`); each
 * service checks the role's store permission (orders.manage, inventory.manage, finance.view…). Fulfilment steps run
 * only when the server lists them in allowedActions. Funds are read-only here.
 */
const base = { api: 'mobile' as const, auth: 'seller' as const, tags: ['Seller'] };

const SELLER_STEPS = ['CONFIRM_ORDER', 'START_PROCESSING', 'MARK_READY_TO_SHIP', 'MARK_SHIPPED', 'ACCEPT_CANCELLATION'] as const;

export const myStore = defineRoute({
  id: 'getMySellerMembership',
  api: 'mobile',
  method: 'GET',
  path: '/api/v1/me/seller',
  summary: 'My store membership (null when I am not a seller) — drives the buyer ⇄ seller switch',
  tags: ['Seller'],
  auth: 'customer',
  rate: 'read',
  response: z.object({
    membership: z
      .object({
        status: z.string(),
        type: z.string(),
        role: z.string(),
        permissions: z.array(z.string()),
        store: z.object({ name: z.string(), slug: z.string() }).nullable(),
        canOperate: z.boolean(),
      })
      .nullable(),
  }),
  handler: ({ actor }) => sellerMembership(actor!),
});

export const sellerDashboardRoute = defineRoute({
  ...base,
  id: 'getSellerHome',
  method: 'GET',
  path: '/api/v1/seller/home',
  summary: 'Seller Center dashboard (sales figures only for finance.view members)',
  rate: 'read',
  response: z.object({
    orders: z.object({ pendingConfirmation: z.number().int(), processing: z.number().int(), readyToShip: z.number().int(), shipped: z.number().int(), openReturns: z.number().int(), last30Days: z.number().int() }),
    products: z.object({ live: z.number().int(), outOfStock: z.number().int(), lowStock: z.number().int() }),
    rating: z.object({ average: z.number(), count: z.number().int() }),
    sales: z.object({ todayPiastres: piastres, last30DaysGrossPiastres: piastres, last30DaysNetPiastres: piastres }).nullable(),
    onTimeRate: z.number().nullable(),
  }),
  handler: ({ actor }) => sellerHome(actor!),
});

const sellerOrderSummary = z.object({
  id: uuid,
  number: z.string(),
  status: z.string(),
  paidAt: isoDateTime,
  itemCount: z.number().int(),
  thumbnails: z.array(z.string()),
  merchandiseSubtotalPiastres: piastres,
});

const sellerOrder = z
  .object({
    id: uuid,
    number: z.string(),
    status: z.string(),
    paidAt: isoDateTime.nullable(),
    processingDays: z.number().int().nullable(),
    shipTo: z.object({
      recipientName: z.string().nullable(),
      phone: z.string().nullable(),
      governorate: z.string().nullable(),
      city: z.string().nullable(),
      district: z.string().nullable(),
      street: z.string().nullable(),
      building: z.string().nullable(),
      floor: z.string().nullable(),
      apartment: z.string().nullable(),
      landmark: z.string().nullable(),
    }),
    items: z.array(
      z.object({
        id: uuid,
        title: z.string(),
        variantLabel: z.string(),
        condition: z.string(),
        imageUrl: z.string().nullable(),
        quantity: z.number().int(),
        unitPricePiastres: piastres,
        lineTotalPiastres: piastres,
      }),
    ),
    merchandiseSubtotalPiastres: piastres,
    shippingFeePiastres: piastres,
    economics: z.object({ commissionPiastres: piastres, sellerNetPiastres: piastres }).nullable(),
    shipment: z
      .object({
        status: z.string(),
        carrierName: z.string(),
        trackingNumber: z.string().nullable(),
        shippedAt: isoDateTime.nullable(),
        expectedDeliveryAt: isoDateTime.nullable(),
        hasWaybill: z.boolean(),
      })
      .nullable(),
    cancellationRequest: z.object({ id: uuid, note: z.string().nullable(), createdAt: isoDateTime }).nullable(),
    openDispute: z.boolean(),
    allowedActions: z.array(z.string()),
  })
  .meta({ id: 'SellerOrder' });

export const listSellerOrders = defineRoute({
  ...base,
  id: 'listSellerOrders',
  method: 'GET',
  path: '/api/v1/seller/orders',
  summary: "My store's paid orders (orders.manage)",
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({ status: z.string().max(40).optional(), page: z.coerce.number().int().min(1).max(500).optional() }),
  response: z.object({ page: z.number().int(), pageSize: z.number().int(), items: z.array(sellerOrderSummary) }),
  handler: ({ actor, query }) => sellerOrdersPage(actor!, query.status ?? null, query.page ?? 1),
});

const soParams = z.object({ sellerOrderId: uuid });

export const getSellerOrder = defineRoute({
  ...base,
  id: 'getSellerOrder',
  method: 'GET',
  path: '/api/v1/seller/orders/{sellerOrderId}',
  summary: 'One paid order of my store with the server-allowed fulfilment actions',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: soParams,
  response: sellerOrder,
  handler: ({ actor, params }) => sellerOrderView(actor!, params.sellerOrderId),
});

export const sellerOrderStepRoute = defineRoute({
  ...base,
  id: 'runSellerOrderStep',
  method: 'POST',
  path: '/api/v1/seller/orders/{sellerOrderId}/steps',
  summary: 'Run one fulfilment step (confirm, processing, ready, shipped, accept cancellation) if currently allowed',
  description: 'The step must be in the order\'s allowedActions; the seller-order state machine is enforced by the fulfilment service. Moves no money.',
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'invalid_state'],
  params: soParams,
  body: z.object({ step: z.enum(SELLER_STEPS), note: z.string().trim().max(500).optional() }),
  response: sellerOrder,
  handler: ({ actor, params, body }) => sellerOrderStep(actor!, params.sellerOrderId, body.step, body.note ?? null),
});

export const sellerShipmentRoute = defineRoute({
  ...base,
  id: 'saveSellerShipment',
  method: 'POST',
  path: '/api/v1/seller/orders/{sellerOrderId}/shipment',
  summary: 'Save carrier / tracking details and an optional waybill (proof of shipping)',
  description: 'multipart/form-data. A seller can never record a delivery; delivery is an authoritative carrier/operations event.',
  rate: 'write',
  idempotency: 'required',
  errors: ['forbidden', 'not_found', 'invalid_state'],
  params: soParams,
  multipart: { files: { waybill: { max: 1 } } },
  body: z.object({
    carrierName: z.string().trim().min(2).max(80),
    trackingNumber: z.string().trim().max(80).optional(),
    shippedAt: z.string().min(8).max(40),
    expectedDeliveryAt: z.string().min(8).max(40).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  response: sellerOrder,
  handler: ({ actor, params, body, files }) => sellerSaveShipment(actor!, params.sellerOrderId, body, files.waybill?.[0] ?? null),
});

export const listSellerProducts = defineRoute({
  ...base,
  id: 'listSellerProducts',
  method: 'GET',
  path: '/api/v1/seller/products',
  summary: "My store's products with stock per variant (products.manage or inventory.manage)",
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({ status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'LIVE', 'REJECTED', 'SUSPENDED', 'ARCHIVED']).optional(), page: z.coerce.number().int().min(1).max(500).optional() }),
  response: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    items: z.array(
      z.object({
        id: uuid,
        slug: z.string(),
        titleAr: z.string(),
        status: z.string(),
        condition: z.string(),
        imageUrl: z.string().nullable(),
        variants: z.array(
          z.object({
            id: uuid,
            label: z.string(),
            pricePiastres: piastres,
            stockOnHand: z.number().int(),
            reserved: z.number().int(),
            available: z.number().int(),
            lowStockThreshold: z.number().int(),
            active: z.boolean(),
          }),
        ),
      }),
    ),
  }),
  handler: ({ actor, query }) => sellerProductsPage(actor!, query.status ?? null, query.page ?? 1),
});

export const setVariantStock = defineRoute({
  ...base,
  id: 'setSellerVariantStock',
  method: 'PUT',
  path: '/api/v1/seller/variants/{variantId}/stock',
  summary: 'Set stock on hand of one of my variants (never below units reserved by open orders)',
  rate: 'write',
  errors: ['forbidden', 'not_found'],
  params: z.object({ variantId: uuid }),
  body: z.object({ stockOnHand: z.number().int().min(0).max(1_000_000) }),
  response: z.object({ id: uuid, stockOnHand: z.number().int(), reserved: z.number().int(), available: z.number().int() }),
  handler: ({ actor, params, body }) => sellerSetStock(actor!, params.variantId, body.stockOnHand),
});

export const sellerFundsRoute = defineRoute({
  ...base,
  id: 'getSellerFunds',
  method: 'GET',
  path: '/api/v1/seller/funds',
  summary: "My store's funds position — read only (finance.view)",
  description:
    'Holds, booked debt and uncovered claims are reported separately and are never withdrawable; withdrawablePiastres = available − held (never negative). Payout requests stay on the web Seller Center (Maker/Checker on the EDMN side).',
  rate: 'read',
  errors: ['forbidden'],
  response: z.object({
    pendingPiastres: piastres,
    availablePiastres: z.number().int().meta({ description: 'Ledger available balance; negative = booked debt.' }),
    heldPiastres: piastres,
    reservedForPayoutPiastres: piastres,
    bookedDebtPiastres: piastres,
    unsecuredClaimsPiastres: piastres,
    withdrawablePiastres: piastres,
    openPayoutRequests: z.number().int(),
    blockReasonAr: z.string().nullable(),
  }),
  handler: ({ actor }) => sellerFunds(actor!),
});

export const sellerRoutes = [myStore, sellerDashboardRoute, listSellerOrders, getSellerOrder, sellerOrderStepRoute, sellerShipmentRoute, listSellerProducts, setVariantStock, sellerFundsRoute];
