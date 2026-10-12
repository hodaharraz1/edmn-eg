import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db/client';
import { alertStates } from '@/server/db/schema';
import { notify } from '@/server/modules/notifications/notify';
import { getSetting } from '@/server/modules/settings';
import { ALERT_RULES, type AlertRule } from './rules';

/**
 * PROACTIVE ALERT ENGINE (Batch 1.5). Pure notification: it reads rule candidates (authoritative DB state, server
 * time) and writes ONLY `alert_states` + in-app/email notifications (event OPS_ALERT). It never changes an order,
 * deal, refund, withdrawal, ledger account or any other business record — a deadline or SLA can inform people,
 * it can never move money.
 *
 * Stages per (rule, entity, recipient):
 *   PRE_DEADLINE  now ≥ deadline − preHours (and before the deadline)
 *   DUE           deadline ≤ now < deadline + cooldownHours
 *   OVERDUE       now ≥ deadline + cooldownHours (re-sent every cooldownHours while still open)
 *   RESOLVED      the condition disappeared (no notification; the history row is kept)
 * A candidate without a deadline is DUE immediately (queues that exist "now").
 * Dedupe: one notification per stage transition; OVERDUE repeats only after `nextEligibleAt`.
 */

export type AlertStage = 'PRE_DEADLINE' | 'DUE' | 'OVERDUE' | 'RESOLVED';

const HOUR = 3_600_000;

export function stageFor(now: Date, deadline: Date | null, preHours: number, cooldownHours: number): AlertStage | null {
  if (!deadline) return 'DUE';
  const t = now.getTime();
  const d = deadline.getTime();
  if (t < d - preHours * HOUR) return null;
  if (t < d) return 'PRE_DEADLINE';
  if (t < d + cooldownHours * HOUR) return 'DUE';
  return 'OVERDUE';
}

const STAGE_PREFIX: Record<Exclude<AlertStage, 'RESOLVED'>, string> = {
  PRE_DEADLINE: 'تذكير',
  DUE: 'مطلوب الآن',
  OVERDUE: 'متأخر',
};

/** Active staff holding a permission (SUPER_ADMIN holds every permission through its seeded role). */
export async function staffWithPermission(conn: DbOrTx, permission: string): Promise<string[]> {
  const r = await conn.execute<{ id: string }>(sql`
    select distinct u.id from users u
      join user_roles ur on ur.user_id = u.id
      join role_permissions rp on rp.role_code = ur.role_code
     where u.is_staff and u.status = 'ACTIVE' and rp.permission = ${permission}`);
  return r.rows.map((x) => x.id);
}

export interface SweepResult {
  rules: number;
  candidates: number;
  sent: number;
  resolved: number;
  errors: { rule: string; error: string }[];
}

export async function runAlertSweep(opts: { now?: Date; only?: string[]; conn?: DbOrTx } = {}): Promise<SweepResult> {
  const conn = opts.conn ?? db;
  const now = opts.now ?? new Date();
  const overrides = await getSetting('alerts.rules', conn);
  const result: SweepResult = { rules: 0, candidates: 0, sent: 0, resolved: 0, errors: [] };
  const staffCache = new Map<string, string[]>();

  for (const rule of ALERT_RULES) {
    if (opts.only && !opts.only.includes(rule.code)) continue;
    const o = overrides[rule.code] ?? {};
    if (o.enabled === false) continue;
    result.rules++;
    try {
      const r = await sweepRule(conn, rule, now, {
        preHours: o.preHours ?? rule.defaults.preHours,
        cooldownHours: o.cooldownHours ?? rule.defaults.cooldownHours,
        agingHours: o.agingHours ?? rule.defaults.agingHours ?? 0,
      }, staffCache);
      result.candidates += r.candidates;
      result.sent += r.sent;
      result.resolved += r.resolved;
    } catch (e) {
      // One broken rule never blocks the others; the error text is internal (no PII is ever selected).
      result.errors.push({ rule: rule.code, error: e instanceof Error ? e.message.slice(0, 200) : 'error' });
    }
  }
  return result;
}

async function sweepRule(
  conn: DbOrTx,
  rule: AlertRule,
  now: Date,
  cfg: { preHours: number; cooldownHours: number; agingHours: number },
  staffCache: Map<string, string[]>,
) {
  const candidates = await rule.candidates(conn, { agingHours: cfg.agingHours });
  let staff: string[] = [];
  if (rule.staffPermission) {
    if (!staffCache.has(rule.staffPermission)) staffCache.set(rule.staffPermission, await staffWithPermission(conn, rule.staffPermission));
    staff = staffCache.get(rule.staffPermission)!;
  }
  const open = await conn.select().from(alertStates).where(and(eq(alertStates.rule, rule.code), isNull(alertStates.resolvedAt)));
  const openByKey = new Map(open.map((s) => [`${s.entityId}|${s.recipientUserId}`, s]));
  const seen = new Set<string>();
  let sent = 0;

  for (const c of candidates) {
    const stage = stageFor(now, c.deadlineAt, cfg.preHours, cfg.cooldownHours);
    const recipients = [...new Set([...(c.userIds ?? []), ...staff])];
    for (const userId of recipients) {
      const key = `${c.entityId}|${userId}`;
      seen.add(key);
      if (!stage || stage === 'RESOLVED') continue;
      const prev = openByKey.get(key);
      const changed = !prev || prev.stage !== stage;
      const repeat = !changed && stage === 'OVERDUE' && (!prev!.nextEligibleAt || prev!.nextEligibleAt <= now);
      if (!changed && !repeat) continue;
      const sentCount = (prev?.sentCount ?? 0) + 1;
      const nextEligibleAt = new Date(now.getTime() + cfg.cooldownHours * HOUR);
      await (conn as typeof db).transaction(async (tx) => {
        await tx
          .insert(alertStates)
          .values({
            rule: rule.code,
            entityType: c.entityType,
            entityId: c.entityId,
            recipientUserId: userId,
            deadlineAt: c.deadlineAt,
            stage,
            severity: rule.severity,
            sentCount,
            lastSentAt: now,
            nextEligibleAt,
            metadata: { ref: c.ref, category: rule.category },
          })
          .onConflictDoUpdate({
            target: [alertStates.rule, alertStates.entityId, alertStates.recipientUserId],
            set: { stage, deadlineAt: c.deadlineAt, sentCount, lastSentAt: now, nextEligibleAt, resolvedAt: null, metadata: { ref: c.ref, category: rule.category }, updatedAt: now },
          });
        await notify(tx, {
          event: 'OPS_ALERT',
          userIds: [userId],
          vars: { title: `${STAGE_PREFIX[stage]}: ${rule.title}`, body: rule.body.replaceAll('{{ref}}', c.ref) },
          link: c.link,
          dedupeKey: `alert:${rule.code}:${c.entityId}:${userId}:${stage}:${sentCount}`,
        });
      });
      sent++;
    }
  }

  // Conditions that disappeared → RESOLVED (kept as history; no notification).
  let resolved = 0;
  for (const s of open) {
    if (seen.has(`${s.entityId}|${s.recipientUserId}`)) continue;
    await conn.update(alertStates).set({ stage: 'RESOLVED', resolvedAt: now, updatedAt: now }).where(eq(alertStates.id, s.id));
    resolved++;
  }
  return { candidates: candidates.length, sent, resolved };
}

/** Catalogue for the admin inventory page / report (no data access). */
export function alertInventory() {
  return ALERT_RULES.map((r) => ({ code: r.code, category: r.category, title: r.title, staffPermission: r.staffPermission ?? null, severity: r.severity, defaults: r.defaults }));
}
