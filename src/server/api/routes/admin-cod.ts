import { z } from 'zod';
import { codMonitor } from '@/server/modules/admin-mobile/cod';
import { defineRoute } from '../http';
import { isoDateTime } from '../schemas';

/**
 * Admin App: COD remittance MONITOR (PKG-ADMIN-03). Read-only by design: the courier-statement remittance and the
 * shortfall settlement are two-person money movements that stay on the web console. One GET, no mutations.
 */
const piastres = z.number().int();

const item = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  orderNumber: z.string().nullable(),
  customer: z.string().nullable(),
  status: z.string(),
  expectedAmount: piastres,
  actualAmount: piastres.nullable(),
  shortfallAmount: piastres.nullable(),
  statementRef: z.string().nullable(),
  at: isoDateTime.nullable(),
});

export const adminCodMonitor = defineRoute({
  id: 'adminCodMonitor',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/cod',
  summary: 'COD monitor by tab (payments.view): orders awaiting the courier remittance, or open remittance shortfalls. Masked customer names; read-only',
  tags: ['Admin COD'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({
    tab: z.enum(['awaiting', 'shortfalls']).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
  }),
  response: z.object({ tab: z.enum(['awaiting', 'shortfalls']), items: z.array(item), page: z.number().int(), hasMore: z.boolean() }),
  handler: async ({ actor, query }) => codMonitor(actor!, { tab: query.tab ?? 'awaiting', page: query.page ?? 1 }),
});

export const adminCodRoutes = [adminCodMonitor];
