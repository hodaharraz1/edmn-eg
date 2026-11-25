import { z } from 'zod';
import { alertsInbox } from '@/server/modules/admin-mobile/alerts';
import { defineRoute } from '../http';
import { isoDateTime } from '../schemas';

/**
 * Admin App — proactive alerts inbox (PKG-I02-03, read-only). Same access rule as the web console
 * /admin/alerts page (notifications.manage OR settings.manage). No mutation exists here: alert rules
 * are authored in code and tuned through the existing alerts.rules setting on the web console.
 */
const nullableIso = isoDateTime.nullable();

export const adminListAlerts = defineRoute({
  id: 'adminListAlerts',
  api: 'admin',
  method: 'GET',
  path: '/api/v1/admin/alerts',
  summary: 'Proactive alerts inbox (notifications.manage or settings.manage): rule inventory with open counts + open alert feed. Read-only; references only, no PII',
  tags: ['Admin Alerts'],
  auth: 'admin',
  rate: 'read',
  errors: ['forbidden'],
  query: z.object({
    stage: z.enum(['PRE_DEADLINE', 'DUE', 'OVERDUE']).optional(),
    rule: z.string().trim().max(64).optional(),
    page: z.coerce.number().int().min(1).max(500).optional(),
  }),
  response: z.object({
    rules: z.array(
      z.object({
        code: z.string(),
        title: z.string(),
        category: z.string(),
        severity: z.string(),
        staffPermission: z.string().nullable(),
        enabled: z.boolean(),
        openCount: z.number().int(),
      }),
    ),
    items: z.array(
      z.object({
        id: z.uuid(),
        rule: z.string(),
        stage: z.string(),
        severity: z.string(),
        ref: z.string().nullable(),
        sentCount: z.number().int(),
        deadlineAt: nullableIso,
        lastSentAt: nullableIso,
        updatedAt: nullableIso,
      }),
    ),
    page: z.number().int(),
    hasMore: z.boolean(),
  }),
  handler: async ({ actor, query }) => alertsInbox(actor!, { stage: query.stage, rule: query.rule, page: query.page ?? 1 }),
});

export const adminAlertsRoutes = [adminListAlerts];
