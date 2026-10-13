import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { SYSTEM_ACTOR } from '@/server/core/actor';
import { logger } from '@/server/core/logger';
import { db, type DbOrTx } from '@/server/db/client';
import { outboundMessages, providerEvents } from '@/server/db/schema';
import { recordProviderResult } from '@/server/ops/provider-health';

/**
 * EMAIL DELIVERY EVENTS (production infrastructure batch).
 *
 * SMTP sending is unchanged: the outbox records SENT (accepted by the provider) with a provider message id.
 * A provider delivery webhook — authenticated and replay-protected — is the ONLY way a message becomes
 * DELIVERED or BOUNCED; DEFERRED and COMPLAINED are recorded as evidence (a complaint is also audited).
 *
 *   adapters   resend   Svix-signed webhooks (svix-id / svix-timestamp / svix-signature, secret `whsec_…`)
 *              generic  EDMN HMAC-SHA256 over `${timestamp}.${rawBody}` (x-edmn-timestamp / x-edmn-signature),
 *                       for any provider bridged through a small relay — same scheme as payment callbacks
 *   secret     EMAIL_WEBHOOK_SECRET; absent → 503 NOT_CONNECTED, nothing is read or written
 *   replay     timestamp within ±5 minutes, AND (provider, event id) is unique in provider_events
 *   idempotent a duplicate delivery is acknowledged (200 DUPLICATE) and never re-applied
 *   correlate  provider message id, or the outbox id carried in our Message-ID header `<outbox-id@domain>`
 *   unknown    an event for an unknown message is recorded (UNKNOWN_MESSAGE) and acknowledged — never an error loop
 *   safety     the raw body is never stored (sha256 + minimal summary only); an email event never changes an
 *              order, payment, balance, refund or payout.
 */
export type DeliveryEventType = 'DELIVERED' | 'BOUNCED' | 'DEFERRED' | 'COMPLAINED';
export interface ParsedDeliveryEvent {
  eventId: string;
  type: DeliveryEventType | null; // null = a type we do not act on (e.g. "sent", "opened")
  rawType: string;
  providerMessageId: string | null;
  reference: string | null;
  occurredAt: Date | null;
}
export type VerifyResult = { ok: true } | { ok: false; reason: 'SIGNATURE' | 'STALE' };

export interface DeliveryAdapter {
  name: 'resend' | 'generic';
  verify(headers: Headers, rawBody: string, secret: string, now: Date): VerifyResult;
  parse(rawBody: string, headers: Headers): ParsedDeliveryEvent[] | null;
}

export const TOLERANCE_MS = 5 * 60_000;
const DUPLICATE = Symbol('duplicate');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function fresh(tsSeconds: string, now: Date) {
  const ms = Number(tsSeconds) * 1000;
  return /^\d{9,11}$/.test(tsSeconds) && Number.isFinite(ms) && Math.abs(now.getTime() - ms) <= TOLERANCE_MS;
}
/** Outbox id from our own Message-ID (`<uuid@domain>`) when a provider echoes it. */
function referenceFrom(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(UUID);
  return m ? m[0].toLowerCase() : null;
}
const str = (v: unknown, max = 200) => (typeof v === 'string' && v ? v.slice(0, max) : null);

/* ───────── Resend (Svix signature scheme) ───────── */
export function svixSign(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

const RESEND_TYPES: Record<string, DeliveryEventType> = {
  'email.delivered': 'DELIVERED',
  'email.bounced': 'BOUNCED',
  'email.delivery_delayed': 'DEFERRED',
  'email.complained': 'COMPLAINED',
};

export const resendAdapter: DeliveryAdapter = {
  name: 'resend',
  verify(headers, body, secret, now) {
    const id = headers.get('svix-id') ?? '';
    const ts = headers.get('svix-timestamp') ?? '';
    const sigs = (headers.get('svix-signature') ?? '').split(' ').map((s) => s.split(',')[1] ?? '').filter(Boolean);
    if (!id || !ts || !sigs.length) return { ok: false, reason: 'SIGNATURE' };
    const expected = svixSign(secret, id, ts, body);
    if (!sigs.some((s) => safeEqual(s, expected))) return { ok: false, reason: 'SIGNATURE' };
    return fresh(ts, now) ? { ok: true } : { ok: false, reason: 'STALE' };
  },
  parse(body, headers) {
    let j: { type?: unknown; created_at?: unknown; data?: { email_id?: unknown; headers?: unknown; created_at?: unknown } };
    try {
      j = JSON.parse(body);
    } catch {
      return null;
    }
    const rawType = str(j?.type, 80);
    const id = str(headers.get('svix-id'), 200);
    if (!rawType || !id || !j.data || typeof j.data !== 'object') return null;
    const hdrs = Array.isArray(j.data.headers) ? (j.data.headers as { name?: unknown; value?: unknown }[]) : [];
    const msgIdHeader = hdrs.find((h) => typeof h?.name === 'string' && h.name.toLowerCase() === 'message-id')?.value;
    const at = str(j.created_at) ?? str(j.data.created_at);
    return [
      {
        eventId: id,
        type: RESEND_TYPES[rawType] ?? null,
        rawType,
        providerMessageId: str(j.data.email_id),
        reference: referenceFrom(msgIdHeader),
        occurredAt: at && !Number.isNaN(Date.parse(at)) ? new Date(at) : null,
      },
    ];
  },
};

/* ───────── Generic EDMN-signed relay ───────── */
export function genericSign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
const GENERIC_TYPES: Record<string, DeliveryEventType> = { delivered: 'DELIVERED', bounced: 'BOUNCED', deferred: 'DEFERRED', complained: 'COMPLAINED' };

export const genericAdapter: DeliveryAdapter = {
  name: 'generic',
  verify(headers, body, secret, now) {
    const ts = headers.get('x-edmn-timestamp') ?? '';
    const sig = headers.get('x-edmn-signature') ?? '';
    if (!ts || !sig || !safeEqual(sig, genericSign(secret, ts, body))) return { ok: false, reason: 'SIGNATURE' };
    return fresh(ts, now) ? { ok: true } : { ok: false, reason: 'STALE' };
  },
  parse(body) {
    let j: { events?: unknown };
    try {
      j = JSON.parse(body);
    } catch {
      return null;
    }
    if (!Array.isArray(j?.events) || j.events.length === 0 || j.events.length > 100) return null;
    const out: ParsedDeliveryEvent[] = [];
    for (const e of j.events as Record<string, unknown>[]) {
      const eventId = str(e?.id);
      const rawType = str(e?.type, 80);
      if (!eventId || !rawType) return null;
      const at = str(e.occurredAt);
      out.push({
        eventId,
        type: GENERIC_TYPES[rawType] ?? null,
        rawType,
        providerMessageId: str(e.providerMessageId),
        reference: referenceFrom(e.messageId) ?? referenceFrom(e.reference),
        occurredAt: at && !Number.isNaN(Date.parse(at)) ? new Date(at) : null,
      });
    }
    return out;
  },
};

export const DELIVERY_ADAPTERS: Record<string, DeliveryAdapter> = { resend: resendAdapter, generic: genericAdapter };

export interface DeliveryWebhookResult {
  httpStatus: number;
  status: 'NOT_CONNECTED' | 'UNKNOWN_PROVIDER' | 'REJECTED_SIGNATURE' | 'REJECTED_STALE' | 'BAD_REQUEST' | 'PROCESSED';
  results?: { eventId: string; outcome: 'APPLIED' | 'DUPLICATE' | 'UNKNOWN_MESSAGE' | 'NO_TRANSITION' | 'IGNORED_TYPE' | 'RECORDED' }[];
}

/** Applies one verified event to the outbox. Status only moves forward from SENT; never backwards. */
async function applyEvent(tx: DbOrTx, ev: ParsedDeliveryEvent): Promise<'APPLIED' | 'UNKNOWN_MESSAGE' | 'NO_TRANSITION' | 'IGNORED_TYPE' | 'RECORDED'> {
  if (!ev.type) return 'IGNORED_TYPE';
  const keys = [ev.providerMessageId, ev.reference].filter((k): k is string => !!k);
  const conds = [];
  if (ev.providerMessageId) conds.push(eq(outboundMessages.providerMessageId, ev.providerMessageId));
  if (ev.reference) conds.push(sql`${outboundMessages.id} = ${ev.reference}::uuid`, sql`${outboundMessages.providerMessageId} like ${`<${ev.reference}@%`}`);
  if (!keys.length) return 'UNKNOWN_MESSAGE';
  const [m] = await db
    .select({ id: outboundMessages.id, status: outboundMessages.status, channel: outboundMessages.channel})
    .from(outboundMessages)
    .where(and(eq(outboundMessages.channel, 'EMAIL'), sql`(${sql.join(conds, sql` or `)})`))
    .limit(1);
  if (!m) return 'UNKNOWN_MESSAGE';
  if (ev.type === 'DEFERRED') return 'RECORDED';
  if (ev.type === 'COMPLAINED') {
    await audit(tx, SYSTEM_ACTOR, { action: 'email.complaint_received', entityType: 'outbound_message', entityId: m.id });
    logger.warn('email.complaint', { messageId: m.id });
    return 'RECORDED';
  }
  const set = ev.type === 'DELIVERED' ? { status: 'DELIVERED' as const, deliveredAt: ev.occurredAt ?? new Date() } : { status: 'BOUNCED' as const, bouncedAt: ev.occurredAt ?? new Date() };
  const r = await tx
    .update(outboundMessages)
    .set(set)
    .where(and(eq(outboundMessages.id, m.id), inArray(outboundMessages.status, ['SENT'])))
    .returning({ id: outboundMessages.id });
  if (r.length && ev.type === 'BOUNCED') logger.warn('email.bounced', { messageId: m.id });
  return r.length ? 'APPLIED' : 'NO_TRANSITION';
}

export async function handleDeliveryWebhook(provider: string, headers: Headers, rawBody: string, now = new Date(), secret = process.env.EMAIL_WEBHOOK_SECRET): Promise<DeliveryWebhookResult> {
  const adapter = DELIVERY_ADAPTERS[provider];
  if (!adapter) return { httpStatus: 404, status: 'UNKNOWN_PROVIDER' };
  // Not connected: refuse everything (no unauthenticated reads or writes).
  if (!secret) return { httpStatus: 503, status: 'NOT_CONNECTED' };
  const v = adapter.verify(headers, rawBody, secret, now);
  if (!v.ok) return v.reason === 'STALE' ? { httpStatus: 400, status: 'REJECTED_STALE' } : { httpStatus: 401, status: 'REJECTED_SIGNATURE' };
  const events = adapter.parse(rawBody, headers);
  if (!events) return { httpStatus: 400, status: 'BAD_REQUEST' };
  await recordProviderResult('EMAIL_WEBHOOK', true);
  const bodySha256 = createHash('sha256').update(rawBody).digest('hex');
  const results: NonNullable<DeliveryWebhookResult['results']> = [];
  for (const ev of events) {
    // provider_events is append-only: the outcome is applied and the event recorded in ONE transaction; a duplicate
    // (same provider + event id, including a concurrent replay) rolls the whole thing back and is acknowledged.
    const outcome = await db
      .transaction(async (tx) => {
        const o = await applyEvent(tx, ev);
        const [row] = await tx
          .insert(providerEvents)
          .values({ provider: `email-${adapter.name}`, eventId: ev.eventId, eventType: ev.rawType, signatureValid: true, occurredAt: ev.occurredAt, bodySha256, payloadSummary: { type: ev.type, providerMessageId: ev.providerMessageId, reference: ev.reference }, status: o })
          .onConflictDoNothing()
          .returning({ id: providerEvents.id });
        if (!row) throw DUPLICATE;
        return o;
      })
      .catch((e) => {
        if (e === DUPLICATE) return 'DUPLICATE' as const;
        throw e;
      });
    results.push({ eventId: ev.eventId, outcome });
  }
  return { httpStatus: 200, status: 'PROCESSED', results };
}
