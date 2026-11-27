import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db/client';
import { notifications, outboundMessages, systemSettings } from '@/server/db/schema';
import { admitSend, breakerSnapshot, type BreakerConfig } from '@/server/modules/notifications/circuit-breaker';
import { notify } from '@/server/modules/notifications/notify';
import { flushOutbound, REDACTED_BODY } from '@/server/modules/notifications/outbox';
import { setProviderOverride, type OutboundProvider } from '@/server/modules/notifications/providers';
import { makeCustomer } from '../helpers/factory';

vi.mock('server-only', () => ({}));

/**
 * PKG-SEC-069 — notification circuit breaker in front of the existing outbox: failure → OPEN, deferral without
 * touching attempts / SENT / deletion, HALF_OPEN single probe under concurrency, recovery, per-channel isolation,
 * In-App unaffected, flag OFF = unchanged behaviour, no sensitive data in state.
 * NOT RUN — REQUIRES EXECUTION BY INTEGRATOR.
 */
const KEY = 'notifications.circuitBreaker';
const cfg = (over: Partial<BreakerConfig> = {}): BreakerConfig => ({ enabled: true, failureThreshold: 3, cooldownSeconds: 30, probeLeaseSeconds: 30, ...over });

async function setBreaker(c: BreakerConfig | null) {
  if (c === null) {
    await db.delete(systemSettings).where(eq(systemSettings.key, KEY));
    return;
  }
  await db.insert(systemSettings).values({ key: KEY, value: c }).onConflictDoUpdate({ target: systemSettings.key, set: { value: c } });
}
async function resetBreakerState() {
  await db.execute(sql`delete from notification_breakers`);
}
async function breakerRow(channel: string) {
  const r = await db.execute<{ state: string; consecutive_failures: number }>(sql`select state, consecutive_failures from notification_breakers where channel = ${channel}`);
  return r.rows[0] ?? null;
}
async function forceState(channel: string, state: 'OPEN' | 'HALF_OPEN', opts: { probeDue?: boolean; leaseExpired?: boolean } = {}) {
  await db.execute(sql`insert into notification_breakers (channel) values (${channel}) on conflict (channel) do nothing`);
  await db.execute(sql`update notification_breakers set state = ${state}, consecutive_failures = 3, opened_at = now(),
    next_probe_at = ${opts.probeDue ? sql`now() - interval '1 second'` : sql`now() + interval '10 minutes'`},
    probe_lease_until = ${state === 'HALF_OPEN' ? (opts.leaseExpired ? sql`now() - interval '1 second'` : sql`now() + interval '5 minutes'`) : null}
    where channel = ${channel}`);
}
function provider(calls: { n: number; bodies: string[]; recipients?: string[] }, mode: 'ok' | 'fail'): (channel: string) => OutboundProvider {
  return (channel) => ({
    name: `test-${channel.toLowerCase()}`,
    async send(msg) {
      calls.n++;
      calls.recipients?.push(msg.recipient);
      if (mode === 'fail') throw new Error('provider 421 try later for someone@example.com code 123456');
      calls.bodies.push(msg.body);
      return { providerMessageId: `pm-${msg.reference}` };
    },
  });
}
async function queue(channel: 'EMAIL' | 'SMS', n: number, extra: Partial<typeof outboundMessages.$inferInsert> = {}) {
  return db
    .insert(outboundMessages)
    .values(Array.from({ length: n }, (_, i) => ({ channel, recipient: `brk${i}-${randomUUID().slice(0, 6)}@x.test`, subject: 's', body: `b${i}`, event: 'ORDER_PLACED', ...extra })))
    .returning();
}
const byIds = (rows: { id: string }[]) => db.select().from(outboundMessages).where(inArray(outboundMessages.id, rows.map((r) => r.id)));

describe('PKG-SEC-069 notification circuit breaker', () => {
  beforeAll(async () => {
    // Isolate from rows other suites left behind: defer them (never fake SENT, never skip redaction).
    await db.execute(sql`update outbound_messages set next_attempt_at = now() + interval '1 day' where status = 'PENDING'`);
  });
  afterEach(async () => {
    setProviderOverride(null);
    await setBreaker(null);
    await resetBreakerState();
    // Messages this file queued and left deferred would otherwise be sent by the NEXT test's flush and skew its
    // provider-call counts: settle them (only this file's synthetic recipients).
    await db.update(outboundMessages).set({ status: 'FAILED' }).where(and(like(outboundMessages.recipient, 'brk%@x.test'), eq(outboundMessages.status, 'PENDING')));
  });

  it('DISABLED by default: failures follow the existing retry path and no breaker state is written', async () => {
    await setBreaker(null);
    const calls = { n: 0, bodies: [] as string[] };
    setProviderOverride(provider(calls, 'fail'));
    const rows = await queue('EMAIL', 5);
    const out = await flushOutbound(50);
    expect(out.deferred).toBe(0);
    const after = await byIds(rows);
    expect(after.every((m) => m.status === 'PENDING' && m.attempts === 1)).toBe(true); // existing retry accounting
    expect((await breakerSnapshot()).length).toBe(0);
  });

  it('threshold failures OPEN the channel; further rows are deferred: not sent, attempts untouched, not deleted, provider not called', async () => {
    await setBreaker(cfg());
    const calls = { n: 0, bodies: [] as string[] };
    setProviderOverride(provider(calls, 'fail'));
    const first = await queue('EMAIL', 3);
    await flushOutbound(50);
    expect(await breakerRow('EMAIL')).toMatchObject({ state: 'OPEN', consecutive_failures: 3 });
    const callsAtOpen = calls.n;

    const later = await queue('EMAIL', 2);
    const out = await flushOutbound(50);
    expect(out.deferred).toBeGreaterThanOrEqual(2);
    expect(calls.n).toBe(callsAtOpen); // the failing provider is no longer hammered
    const after = await byIds(later);
    expect(after).toHaveLength(2); // nothing deleted
    for (const m of after) {
      expect(m.status).toBe('PENDING');
      expect(m.attempts).toBe(0); // outage does not burn the retry budget
      expect(m.sentAt).toBeNull();
      expect(m.deadLetteredAt).toBeNull();
      expect(m.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    }
    expect((await byIds(first)).every((m) => m.status === 'PENDING')).toBe(true);
  });

  it('in-flight state is shared through the DB: ten concurrent workers on a due OPEN channel produce exactly ONE probe', async () => {
    await forceState('EMAIL', 'OPEN', { probeDue: true });
    const results = await Promise.all(Array.from({ length: 10 }, () => admitSend('EMAIL', cfg())));
    expect(results.filter((r) => r.allow && r.probe)).toHaveLength(1);
    expect(results.filter((r) => !r.allow)).toHaveLength(9);
    expect((await breakerRow('EMAIL'))!.state).toBe('HALF_OPEN');
    // While the probe holds the slot nobody else is admitted…
    expect((await admitSend('EMAIL', cfg())).allow).toBe(false);
    // …and a probe that never reported frees the slot when its lease expires.
    await forceState('EMAIL', 'HALF_OPEN', { leaseExpired: true });
    expect((await admitSend('EMAIL', cfg())).probe).toBe(true);
  });

  it('HALF_OPEN probe that FAILS re-opens the channel; the other waiting rows stay deferred', async () => {
    await setBreaker(cfg());
    await forceState('EMAIL', 'OPEN', { probeDue: true });
    const calls = { n: 0, bodies: [] as string[] };
    setProviderOverride(provider(calls, 'fail'));
    const rows = await queue('EMAIL', 3);
    const out = await flushOutbound(50);
    expect(calls.n).toBe(1); // exactly the probe reached the provider
    expect(out.deferred).toBeGreaterThanOrEqual(2);
    expect((await breakerRow('EMAIL'))!.state).toBe('OPEN');
    const after = await byIds(rows);
    expect(after.filter((m) => m.attempts === 1)).toHaveLength(1);
    expect(after.filter((m) => m.attempts === 0)).toHaveLength(2);
    expect(after.every((m) => m.status === 'PENDING')).toBe(true);
  });

  it('HALF_OPEN probe that SUCCEEDS closes the channel and delivery resumes with normal idempotency references', async () => {
    await setBreaker(cfg());
    await forceState('EMAIL', 'OPEN', { probeDue: true });
    const calls = { n: 0, bodies: [] as string[] };
    setProviderOverride(provider(calls, 'ok'));
    const rows = await queue('EMAIL', 3);
    const out = await flushOutbound(50);
    expect(out.sent).toBeGreaterThanOrEqual(3);
    expect(await breakerRow('EMAIL')).toMatchObject({ state: 'CLOSED', consecutive_failures: 0 });
    const after = await byIds(rows);
    expect(after.every((m) => m.status === 'SENT' && m.attempts === 1 && m.providerMessageId === `pm-${m.id}`)).toBe(true);
  });

  it('breakers are per channel: an OPEN EMAIL channel never blocks SMS or In-App notifications', async () => {
    await setBreaker(cfg());
    await forceState('EMAIL', 'OPEN');
    const calls = { n: 0, bodies: [] as string[] };
    setProviderOverride(provider(calls, 'ok'));
    const sms = await queue('SMS', 1);
    const email = await queue('EMAIL', 1);
    await flushOutbound(50);
    expect((await byIds(sms))[0].status).toBe('SENT');
    expect((await byIds(email))[0].status).toBe('PENDING');
    // In-App never goes through the outbox.
    const c = await makeCustomer();
    await notify(db, { event: 'SUPPORT_REPLY', userIds: [c.user.id], vars: { ticket: '1' }, link: '/account/support/x' });
    expect((await db.select().from(notifications).where(eq(notifications.userId, c.user.id))).length).toBeGreaterThanOrEqual(1);
  });

  it('only PROVIDER failures count: an expired secret dead-letters as before and does not open the channel; state holds no sensitive data', async () => {
    await setBreaker(cfg({ failureThreshold: 2 }));
    const calls = { n: 0, bodies: [] as string[], recipients: [] as string[] };
    setProviderOverride(provider(calls, 'ok'));
    const [m] = await queue('EMAIL', 1, { event: 'ACCOUNT_SECURITY', body: REDACTED_BODY });
    await flushOutbound(50);
    const [after] = await byIds([m]);
    expect(after.status).toBe('FAILED');
    // The flush may also send other pending messages of the shared test database: only THIS message matters.
    expect(calls.recipients).not.toContain(m.recipient);
    expect((await breakerRow('EMAIL'))?.consecutive_failures ?? 0).toBe(0);

    setProviderOverride(provider({ n: 0, bodies: [] }, 'fail'));
    await queue('EMAIL', 2);
    await flushOutbound(50);
    const snap = JSON.stringify(await breakerSnapshot());
    expect(snap).not.toMatch(/someone@example\.com|123456|@x\.test/);
    expect((await breakerRow('EMAIL'))!.state).toBe('OPEN');
  });
});
