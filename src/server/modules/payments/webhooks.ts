import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@/server/db/client';
import { providerEvents } from '@/server/db/schema';

/**
 * Payment / payout provider callbacks. NO provider is connected; real providers stay OFF.
 * The architecture is in place and fail-closed:
 *  - HMAC-SHA256 signature over `${timestamp}.${rawBody}` with PAYMENT_WEBHOOK_SECRET (constant-time compare)
 *  - timestamp must be within ±5 minutes (stale / replayed captures rejected)
 *  - replay protection: (provider, eventId) is unique — a duplicate delivery is acknowledged, not re-processed
 *  - out-of-order / unknown / delayed events are recorded and ignored
 *  - the raw body is never stored (only its sha256 and a minimal summary): no personal data / secrets at rest
 * A callback is EVIDENCE ONLY. It never confirms a payment, releases, refunds or pays out: those require
 * an authenticated Admin approval through the normal state machines and ledger guards.
 */
export const KNOWN_EVENT_TYPES = ['payment.received', 'payment.failed', 'payout.completed', 'payout.failed'] as const;
const TOLERANCE_MS = 5 * 60_000;

export interface WebhookResult {
  httpStatus: number;
  status: 'NOT_CONNECTED' | 'REJECTED_SIGNATURE' | 'REJECTED_STALE' | 'DUPLICATE' | 'UNKNOWN_TYPE' | 'RECORDED_AS_EVIDENCE' | 'BAD_REQUEST';
}

export function signWebhook(secret: string, timestamp: string, rawBody: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export async function handleProviderCallback(
  provider: string,
  headers: { signature?: string | null; timestamp?: string | null },
  rawBody: string,
  now = new Date(),
  secret = process.env.PAYMENT_WEBHOOK_SECRET,
): Promise<WebhookResult> {
  if (!/^[a-z0-9-]{2,40}$/.test(provider)) return { httpStatus: 400, status: 'BAD_REQUEST' };
  // Not connected: refuse everything (no unauthenticated writes, nothing to record).
  if (!secret) return { httpStatus: 503, status: 'NOT_CONNECTED' };
  const ts = headers.timestamp ?? '';
  const sig = headers.signature ?? '';
  const expected = signWebhook(secret, ts, rawBody);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { httpStatus: 401, status: 'REJECTED_SIGNATURE' };
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(now.getTime() - tsMs) > TOLERANCE_MS) return { httpStatus: 400, status: 'REJECTED_STALE' };
  let body: { id?: unknown; type?: unknown; occurredAt?: unknown; reference?: unknown; amount?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { httpStatus: 400, status: 'BAD_REQUEST' };
  }
  const eventId = typeof body.id === 'string' ? body.id.slice(0, 200) : '';
  const eventType = typeof body.type === 'string' ? body.type.slice(0, 100) : '';
  if (!eventId || !eventType) return { httpStatus: 400, status: 'BAD_REQUEST' };
  const known = (KNOWN_EVENT_TYPES as readonly string[]).includes(eventType);
  const occurred = typeof body.occurredAt === 'string' && !Number.isNaN(Date.parse(body.occurredAt)) ? new Date(body.occurredAt) : null;
  const status: WebhookResult['status'] = known ? 'RECORDED_AS_EVIDENCE' : 'UNKNOWN_TYPE';
  const inserted = await db
    .insert(providerEvents)
    .values({
      provider,
      eventId,
      eventType,
      signatureValid: true,
      occurredAt: occurred,
      bodySha256: createHash('sha256').update(rawBody).digest('hex'),
      payloadSummary: { reference: typeof body.reference === 'string' ? body.reference.slice(0, 120) : null, amount: typeof body.amount === 'number' ? body.amount : null },
      status,
    })
    .onConflictDoNothing()
    .returning({ id: providerEvents.id });
  if (!inserted.length) return { httpStatus: 200, status: 'DUPLICATE' };
  return { httpStatus: 200, status };
}
