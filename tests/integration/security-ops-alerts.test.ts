import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, like, notLike, or } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  alertStates,
  auditLogs,
  jobLeases,
  ledgerHealthChecks,
  notifications,
  rateLimits,
  systemSettings,
} from '@/server/db/schema';
import { runAlertSweep } from '@/server/modules/alerts/engine';
import { ALERT_RULES } from '@/server/modules/alerts/rules';
import { ADMIN_BURST_MIN_ACTIONS, LOGIN_SPIKE_MIN_ATTEMPTS, spikeEntityId } from '@/server/modules/alerts/security-rules';
import { makeAdmin, makeUser } from '../helpers/factory';

/**
 * PKG-SEC-OPS-01 — security/ops alert rules against a real seeded database.
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 * Covers: alert on seeded condition, dedupe on repeat sweep, cooldown repeat, auto-RESOLVED when the
 * condition clears, recipient permission scoping, settings override (enabled:false), and the rule that
 * no phone / IP / user id ever appears in a notification.
 */

const staff = () => makeAdmin(['SUPER_ADMIN']); // holds finance.view, settings.manage, audit.view
const secRules = ['SEC_LEDGER_HEALTH', 'SEC_JOB_FAILED', 'SEC_JOB_STALE', 'SEC_LOGIN_FAILURE_SPIKE', 'SEC_ADMIN_ACTION_BURST'];
const alertsTo = async (userId: string | null) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId!), eq(notifications.event, 'OPS_ALERT')));
const statesOf = async (rule: string) => db.select().from(alertStates).where(eq(alertStates.rule, rule));

// These rules read GLOBAL state. Other test files leave failing job leases and login rate-limit counters in the shared
// test database, which would add their own alerts here: neutralize those (test fixtures only; the append-only
// financial and audit tables are never touched).
beforeEach(async () => {
  await db.update(jobLeases).set({ consecutiveFailures: 0 }).where(notLike(jobLeases.jobName, 'pkgsecops-%'));
  await db.delete(rateLimits).where(or(like(rateLimits.key, 'login-id:%'), like(rateLimits.key, 'login-ip:%')));
});

afterEach(async () => {
  await db.delete(systemSettings).where(eq(systemSettings.key, 'alerts.rules'));
  await db.delete(alertStates).where(like(alertStates.rule, 'SEC_%'));
  // ledger_health_checks and audit_logs are append-only (DB triggers): they are never cleaned up.
  // Isolation comes from fresh rows being the latest and from random actor ids instead.
  await db.delete(jobLeases).where(like(jobLeases.jobName, 'pkgsecops-%'));
  await db.delete(rateLimits).where(like(rateLimits.key, 'login-id:pkgsecops-%'));
});

describe('SEC_LEDGER_HEALTH — latest non-OK health check alerts finance staff, resolves on clean check', () => {
  it('alerts once, dedupes, resolves when the next check is OK', async () => {
    const s = await staff();
    await db.insert(ledgerHealthChecks).values({ status: 'CRITICAL', debits: 100, credits: 101, difference: 1, trigger: 'TEST_PKG_SECOPS' });
    await runAlertSweep({ only: ['SEC_LEDGER_HEALTH'] });
    expect(await alertsTo(s.userId)).toHaveLength(1);
    await runAlertSweep({ only: ['SEC_LEDGER_HEALTH'] }); // dedupe
    expect(await alertsTo(s.userId)).toHaveLength(1);
    expect((await statesOf('SEC_LEDGER_HEALTH'))[0].stage).toBe('DUE');
    // a clean check clears the condition → RESOLVED, kept as history, no new notification
    await db.insert(ledgerHealthChecks).values({ status: 'OK', debits: 101, credits: 101, difference: 0, trigger: 'TEST_PKG_SECOPS' });
    await runAlertSweep({ only: ['SEC_LEDGER_HEALTH'] });
    const [st] = await statesOf('SEC_LEDGER_HEALTH');
    expect(st.stage).toBe('RESOLVED');
    expect(st.resolvedAt).not.toBeNull();
    expect(await alertsTo(s.userId)).toHaveLength(1);
  });
});

describe('SEC_JOB_FAILED — failing scheduled job alerts ops staff, respects cooldown and the enabled override', () => {
  it('alerts, dedupes within cooldown, repeats after it, and stays silent when disabled', async () => {
    const s = await staff();
    await db.insert(jobLeases).values({ jobName: 'pkgsecops-failed', leaseUntil: new Date(Date.now() - 60_000), lastFailedAt: new Date(), consecutiveFailures: 2 });
    const rule = ALERT_RULES.find((r) => r.code === 'SEC_JOB_FAILED')!;
    await runAlertSweep({ only: ['SEC_JOB_FAILED'] });
    expect(await alertsTo(s.userId)).toHaveLength(1);
    await runAlertSweep({ only: ['SEC_JOB_FAILED'] }); // dedupe
    expect(await alertsTo(s.userId)).toHaveLength(1);
    // still failing after the cooldown → one more notification
    await runAlertSweep({ only: ['SEC_JOB_FAILED'], now: new Date(Date.now() + (rule.defaults.cooldownHours + 0.1) * 3600_000) });
    expect(await alertsTo(s.userId)).toHaveLength(2);
    // recovery (a success reset the counter) → RESOLVED
    await db.update(jobLeases).set({ consecutiveFailures: 0, lastSucceededAt: new Date() }).where(eq(jobLeases.jobName, 'pkgsecops-failed'));
    await runAlertSweep({ only: ['SEC_JOB_FAILED'], now: new Date(Date.now() + (rule.defaults.cooldownHours + 0.2) * 3600_000) });
    expect((await statesOf('SEC_JOB_FAILED'))[0].stage).toBe('RESOLVED');
    // settings override disables the rule
    await db.update(jobLeases).set({ consecutiveFailures: 3, lastFailedAt: new Date() }).where(eq(jobLeases.jobName, 'pkgsecops-failed'));
    await db.insert(systemSettings).values({ key: 'alerts.rules', value: { SEC_JOB_FAILED: { enabled: false } } });
    const before = (await alertsTo(s.userId)).length;
    await runAlertSweep({ only: ['SEC_JOB_FAILED'] });
    expect(await alertsTo(s.userId)).toHaveLength(before);
  });
});

describe('SEC_JOB_STALE — a job past its expected run with no live lease alerts as overdue', () => {
  it('alerts for a missed schedule', async () => {
    const s = await staff();
    await db.insert(jobLeases).values({
      jobName: 'pkgsecops-stale',
      leaseUntil: new Date(Date.now() - 3600_000),
      lastSucceededAt: new Date(Date.now() - 24 * 3600_000),
      consecutiveFailures: 0,
      nextExpectedAt: new Date(Date.now() - 13 * 3600_000),
    });
    await runAlertSweep({ only: ['SEC_JOB_STALE'] });
    expect(await alertsTo(s.userId)).toHaveLength(1);
    const [st] = await statesOf('SEC_JOB_STALE');
    expect(['DUE', 'OVERDUE']).toContain(st.stage);
  });
});

describe('SEC_LOGIN_FAILURE_SPIKE — rate-limit hammering alerts without leaking the source', () => {
  it('alerts with a fingerprinted source only', async () => {
    const s = await staff();
    const key = 'login-id:pkgsecops-+201000000000';
    await db.insert(rateLimits).values({ key, windowStart: new Date(), count: LOGIN_SPIKE_MIN_ATTEMPTS + 5 });
    await runAlertSweep({ only: ['SEC_LOGIN_FAILURE_SPIKE'] });
    const mine = await alertsTo(s.userId);
    expect(mine).toHaveLength(1);
    const body = `${mine[0].title} ${mine[0].body}`;
    expect(body).not.toContain('+201000000000'); // phone never leaves the database
    expect(body).not.toContain(key);
    const [st] = await statesOf('SEC_LOGIN_FAILURE_SPIKE');
    expect(st.entityId).toBe(spikeEntityId('login', key));
    // below threshold → no candidate
    await db.delete(rateLimits).where(eq(rateLimits.key, key));
    await db.insert(rateLimits).values({ key, windowStart: new Date(), count: LOGIN_SPIKE_MIN_ATTEMPTS - 1 });
    await runAlertSweep({ only: ['SEC_LOGIN_FAILURE_SPIKE'] });
    expect((await statesOf('SEC_LOGIN_FAILURE_SPIKE'))[0].stage).toBe('RESOLVED');
  });
});

describe('SEC_ADMIN_ACTION_BURST — an admin audit-row burst alerts security reviewers', () => {
  it('alerts on a burst and fingerprints the actor', async () => {
    const s = await staff();
    const actorId = randomUUID();
    await db.insert(auditLogs).values(
      Array.from({ length: ADMIN_BURST_MIN_ACTIONS }, () => ({ actorUserId: actorId, actorType: 'ADMIN', action: 'test.pkgsecops.burst', entityType: 'test' })),
    );
    await runAlertSweep({ only: ['SEC_ADMIN_ACTION_BURST'] });
    const mine = await alertsTo(s.userId);
    expect(mine).toHaveLength(1);
    expect(`${mine[0].title} ${mine[0].body}`).not.toContain(actorId);
    const [st] = await statesOf('SEC_ADMIN_ACTION_BURST');
    expect(st.entityId).toBe(spikeEntityId('admin', actorId));
  });
});

describe('engine integration — recipients, full sweep, regression', () => {
  it('staff without the rule permission receive nothing', async () => {
    const plain = await makeUser({ staff: true }); // staff flag, no roles → no permissions
    await db.insert(jobLeases).values({ jobName: 'pkgsecops-perm', leaseUntil: new Date(Date.now() - 60_000), lastFailedAt: new Date(), consecutiveFailures: 1 });
    await runAlertSweep({ only: ['SEC_JOB_FAILED'] });
    expect(await alertsTo(plain.id)).toHaveLength(0);
  });

  it('a full sweep including the five new rules runs against the real schema without errors', async () => {
    const res = await runAlertSweep();
    expect(res.errors).toEqual([]);
    expect(res.rules).toBe(ALERT_RULES.length);
    expect(secRules.every((c) => ALERT_RULES.some((r) => r.code === c))).toBe(true);
  });
});
