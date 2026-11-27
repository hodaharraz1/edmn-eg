import { sql } from 'drizzle-orm';
import { logger } from '@/server/core/logger';
import { db } from '@/server/db/client';
import { getSetting } from '@/server/modules/settings';

/**
 * NOTIFICATION CIRCUIT BREAKER (PKG-SEC-069). Sits in front of the EXISTING outbox (outbox.ts) and reuses its
 * provider-health evidence; it is not a second send system. One breaker per outbound channel (EMAIL, SMS); In-App
 * notifications never go through the outbox and are not affected.
 *
 *   CLOSED     normal sending. `failureThreshold` consecutive PROVIDER failures open the channel.
 *   OPEN       sends are DEFERRED (row back to PENDING, attempts untouched, never SENT, never deleted) until
 *              `next_probe_at` (cooldown elapsed).
 *   HALF_OPEN  exactly one worker wins the probe lease (atomic UPDATE) and sends one message; success closes the
 *              channel, failure re-opens it for another cooldown. A probe that crashes releases the slot when
 *              `probe_lease_until` passes.
 *
 * All state lives in notification_breakers and every transition is a single atomic SQL statement, so any number
 * of workers agree. DISABLED by default (setting notifications.circuitBreaker.enabled = false): with the flag off
 * nothing in this file touches the database and outbox behaviour is unchanged.
 *
 * Failure policy: the breaker never makes sending worse. If its own state cannot be read or written it FAILS OPEN
 * (the message is sent through the normal path) and logs a warning. Logs and snapshots carry channel / state /
 * counters only: never recipients, bodies, codes or provider error text.
 */
export const BREAKER_CHANNELS = ['EMAIL', 'SMS'] as const;
export type BreakerChannel = (typeof BREAKER_CHANNELS)[number];
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  cooldownSeconds: number;
  probeLeaseSeconds: number;
}

export interface Admission {
  allow: boolean;
  /** true when this send is the single HALF_OPEN probe. */
  probe: boolean;
  /** When denied: earliest time the channel may be tried again. */
  retryAt: Date | null;
}

export function isBreakerChannel(channel: string): channel is BreakerChannel {
  return (BREAKER_CHANNELS as readonly string[]).includes(channel);
}

export async function breakerConfig(): Promise<BreakerConfig> {
  try {
    return await getSetting('notifications.circuitBreaker');
  } catch (e) {
    logger.warn('notifications.breaker_config_unreadable', { reason: e instanceof Error ? e.name : 'error' });
    return { enabled: false, failureThreshold: 5, cooldownSeconds: 300, probeLeaseSeconds: 60 };
  }
}

const ALLOW: Admission = { allow: true, probe: false, retryAt: null };

/** Decides whether ONE send on this channel may go to the provider now. Atomic; never throws. */
export async function admitSend(channel: BreakerChannel, cfg: BreakerConfig): Promise<Admission> {
  if (!cfg.enabled) return ALLOW;
  try {
    await db.execute(sql`insert into notification_breakers (channel) values (${channel}) on conflict (channel) do nothing`);
    const cur = await db.execute<{ state: BreakerState; next_probe_at: Date | null; probe_lease_until: Date | null }>(
      sql`select state, next_probe_at, probe_lease_until from notification_breakers where channel = ${channel}`,
    );
    const row = cur.rows[0];
    if (!row || row.state === 'CLOSED') return ALLOW;
    // OPEN past its cooldown, or HALF_OPEN whose probe never reported (lease expired): one caller wins the slot.
    const won = await db.execute(sql`update notification_breakers
      set state = 'HALF_OPEN', probe_lease_until = now() + make_interval(secs => ${cfg.probeLeaseSeconds}), updated_at = now()
      where channel = ${channel}
        and ((state = 'OPEN' and next_probe_at <= now()) or (state = 'HALF_OPEN' and probe_lease_until <= now()))
      returning channel`);
    if (won.rows.length) {
      logger.info('notifications.breaker_probe', { channel });
      return { allow: true, probe: true, retryAt: null };
    }
    const after = await db.execute<{ state: BreakerState; next_probe_at: Date | null; probe_lease_until: Date | null }>(
      sql`select state, next_probe_at, probe_lease_until from notification_breakers where channel = ${channel}`,
    );
    const a = after.rows[0];
    if (!a || a.state === 'CLOSED') return ALLOW; // closed by a concurrent probe between the two statements
    const retry = a.state === 'HALF_OPEN' ? a.probe_lease_until : a.next_probe_at;
    return { allow: false, probe: false, retryAt: retry ? new Date(retry) : null };
  } catch (e) {
    logger.warn('notifications.breaker_unavailable', { channel, op: 'admit', reason: e instanceof Error ? e.name : 'error' });
    return ALLOW; // fail open: the existing outbox behaviour applies
  }
}

/** A message was accepted by the provider. Closes the channel (also ends a HALF_OPEN probe). */
export async function recordBreakerSuccess(channel: BreakerChannel, cfg: BreakerConfig): Promise<void> {
  if (!cfg.enabled) return;
  try {
    const r = await db.execute<{ prev: BreakerState | null }>(sql`with cur as (select state from notification_breakers where channel = ${channel})
      update notification_breakers
      set state = 'CLOSED', consecutive_failures = 0, opened_at = null, next_probe_at = null, probe_lease_until = null,
          last_success_at = now(), updated_at = now()
      where channel = ${channel} and (state <> 'CLOSED' or consecutive_failures > 0)
      returning (select state from cur) as prev`);
    if (r.rows[0]?.prev && r.rows[0].prev !== 'CLOSED') logger.info('notifications.breaker_closed', { channel, from: r.rows[0].prev });
  } catch (e) {
    logger.warn('notifications.breaker_unavailable', { channel, op: 'success', reason: e instanceof Error ? e.name : 'error' });
  }
}

/** The PROVIDER rejected / failed a send (not an expired-secret or configuration skip). */
export async function recordBreakerFailure(channel: BreakerChannel, cfg: BreakerConfig): Promise<void> {
  if (!cfg.enabled) return;
  try {
    const r = await db.execute<{ prev: BreakerState; state: BreakerState; consecutive_failures: number }>(sql`with cur as (select state from notification_breakers where channel = ${channel} for update)
      update notification_breakers
      set consecutive_failures = consecutive_failures + 1,
          last_failure_at = now(),
          opened_at = case when state = 'HALF_OPEN' or (state = 'CLOSED' and consecutive_failures + 1 >= ${cfg.failureThreshold}) then now() else opened_at end,
          next_probe_at = case when state = 'HALF_OPEN' or (state = 'CLOSED' and consecutive_failures + 1 >= ${cfg.failureThreshold})
                               then now() + make_interval(secs => ${cfg.cooldownSeconds}) else next_probe_at end,
          probe_lease_until = case when state = 'HALF_OPEN' or (state = 'CLOSED' and consecutive_failures + 1 >= ${cfg.failureThreshold}) then null else probe_lease_until end,
          state = case when state = 'HALF_OPEN' then 'OPEN'
                       when state = 'CLOSED' and consecutive_failures + 1 >= ${cfg.failureThreshold} then 'OPEN'
                       else state end,
          updated_at = now()
      where channel = ${channel}
      returning (select state from cur) as prev, state, consecutive_failures`);
    const x = r.rows[0];
    if (x && x.prev !== 'OPEN' && x.state === 'OPEN') {
      logger.warn('notifications.breaker_opened', { channel, from: x.prev, consecutiveFailures: x.consecutive_failures, cooldownSeconds: cfg.cooldownSeconds });
    }
  } catch (e) {
    logger.warn('notifications.breaker_unavailable', { channel, op: 'failure', reason: e instanceof Error ? e.name : 'error' });
  }
}

/**
 * Puts a claimed (SENDING) outbox row back to PENDING for a later flush. attempts is NOT touched (an outage does not
 * burn the retry budget or dead-letter the message), the status never becomes SENT, nothing is deleted.
 */
export async function deferOutboxRow(id: string, retryAt: Date | null): Promise<void> {
  const floor = Date.now() + 15_000;
  const at = new Date(Math.max(retryAt?.getTime() ?? 0, floor));
  await db.execute(sql`update outbound_messages set status = 'PENDING', locked_at = null, next_attempt_at = ${at.toISOString()}::timestamptz
    where id = ${id}::uuid and status = 'SENDING'`);
}

/** Ops read: channel, state and counters only (no message data). */
export async function breakerSnapshot() {
  const r = await db.execute<{ channel: string; state: BreakerState; consecutive_failures: number; opened_at: Date | null; next_probe_at: Date | null; last_success_at: Date | null; last_failure_at: Date | null }>(
    sql`select channel, state, consecutive_failures, opened_at, next_probe_at, last_success_at, last_failure_at from notification_breakers order by channel`,
  );
  return r.rows.map((x) => ({
    channel: x.channel,
    state: x.state,
    consecutiveFailures: x.consecutive_failures,
    openedAt: x.opened_at,
    nextProbeAt: x.next_probe_at,
    lastSuccessAt: x.last_success_at,
    lastFailureAt: x.last_failure_at,
  }));
}
