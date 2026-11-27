import { z } from 'zod';
import { customer360ForStaff, customersSearch } from '@/server/modules/admin-mobile/customers';
import { defineRoute } from '../http';
import { isoDateTime } from '../schemas';

/**
 * Admin App — customer search and 360 (PKG-I02-04, READ-ONLY). Permission customers.view, same as the
 * console pages. Contact data is masked on mobile; status changes stay on the web console.
 */
const id = z.uuid();
const nullableIso = isoDateTime.nullable();
const piastres = z.number().int();

export const adminListCustomers = defineRoute({
  id: 'adminListCustomers',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/customers',
  summary: 'Customer search by name/email/phone (customers.view). Masked contact data; read-only',
  tags: ['Admin Customers'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({
    q: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
  }),
  response: z.object({
    items: z.array(
      z.object({
        id,
        name: z.string(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
        status: z.string(),
        orderCount: z.number().int(),
        createdAt: nullableIso,
      }),
    ),
    page: z.number().int(),
    hasMore: z.boolean(),
  }),
  handler: async ({ actor, query }) => customersSearch(actor!, { q: query.q, page: query.page ?? 1 }),
});

export const adminCustomerDetail = defineRoute({
  id: 'adminCustomerDetail',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/customers/{userId}',
  summary: 'Customer 360 for staff (customers.view): profile with masked contact data, counts, recent orders. Read-only',
  tags: ['Admin Customers'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden', 'not_found'],
  params: z.object({ userId: id }),
  response: z.object({
    id,
    name: z.string(),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    phone: z.string().nullable(),
    phoneVerified: z.boolean(),
    status: z.string(),
    lastLoginAt: nullableIso,
    addresses: z.array(z.string()),
    counts: z.object({
      orders: z.number().int(),
      returns: z.number().int(),
      disputes: z.number().int(),
      supportTickets: z.number().int(),
      deals: z.number().int(),
      reviews: z.number().int(),
    }),
    recentOrders: z.array(z.object({ id, number: z.string(), status: z.string(), grandTotal: piastres, placedAt: nullableIso })),
    createdAt: nullableIso,
  }),
  handler: ({ actor, params }) => customer360ForStaff(actor!, params.userId),
});

export const adminCustomersRoutes = [adminListCustomers, adminCustomerDetail];
