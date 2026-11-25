import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { alertStates } from '@/server/db/schema';
import { requireAnyPermission, type Actor } from '@/server/core/actor';
import { alertInventory } from '@/server/modules/alerts/engine';
import { getSetting } from '@/server/modules/settings';

/**
 * Admin App — proactive alerts inbox (PKG-I02-03, read-only). Mobile mirror of the web console
 * /admin/alerts page: the rule inventory (with enable overrides and open counts) and the open alert
 * feed. Same access rule as the console page (notifications.manage OR settings.manage). Alert text
 * carries references only — the schema forbids PII in metadata; entity ids and recipient ids are not
 * exposed here either. Alerts never change business state; this endpoint only reads.
 */

export const ALERT_STAGES = ['PRE_DEADLINE', 'DUE', 'OVERDUE'] as const;
export type AlertInboxStage = (typeof ALERT_STAGES)[number];

export async function alertsInbox(actor: Actor, opts: { stage?: AlertInboxStage; rule?: string; page: number }) {
  requireAnyPermission(actor, ['notifications.manage', 'settings.manage']);
  const pageSize = 30;
  const conds: SQL[] = [isNull(alertStates.resolvedAt)];
  if (opts.stage) conds.push(eq(alertStates.stage, opts.stage));
  if (opts.rule) conds.push(eq(alertStates.rule, opts.rule));
  const rows = await db
    .select()
    .from(alertStates)
    .where(and(...conds))
    .orderBy(desc(alertStates.updatedAt))
    .limit(pageSize)
    .offset((opts.page - 1) * pageSize);
  const openRules = await db.select({ rule: alertStates.rule }).from(alertStates).where(isNull(alertStates.resolvedAt));
  const byRule = new Map<string, number>();
  for (const a of openRules) byRule.set(a.rule, (byRule.get(a.rule) ?? 0) + 1);
  const overrides = await getSetting('alerts.rules');
  const rules = alertInventory().map((r) => ({
    code: r.code,
    title: r.title,
    category: r.category as string,
    severity: r.severity as string,
    staffPermission: r.staffPermission,
    enabled: overrides[r.code]?.enabled !== false,
    openCount: byRule.get(r.code) ?? 0,
  }));
  return {
    rules,
    items: rows.map((a) => ({
      id: a.id,
      rule: a.rule,
      stage: a.stage as string,
      severity: a.severity,
      ref: (a.metadata as { ref?: string }).ref ?? null,
      sentCount: a.sentCount,
      deadlineAt: a.deadlineAt?.toISOString() ?? null,
      lastSentAt: a.lastSentAt?.toISOString() ?? null,
      updatedAt: a.updatedAt?.toISOString() ?? null,
    })),
    page: opts.page,
    hasMore: rows.length === pageSize,
  };
}
