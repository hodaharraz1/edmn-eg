import { and, eq, isNull, sql } from 'drizzle-orm';
import { env } from '@/server/core/env';
import { decryptJson, encryptJson, sha256 } from '@/server/core/crypto';
import { logger } from '@/server/core/logger';
import { notFound, validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { pushSubscriptions } from '@/server/db/schema';

/**
 * Web Push (standard W3C Push API + VAPID). Subscriptions are per browser/device and stored encrypted.
 * Sending is provider-agnostic from the caller's point of view: the browser vendor's push service named in
 * the subscription endpoint delivers it. When VAPID keys are not configured the channel reports
 * NOT_CONFIGURED — nothing is ever reported as sent.
 */

export interface PushSecret {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** same-origin path only (re-authorized server-side when opened) */
  url: string;
  tag: string;
  deliveryId: string;
}

export function pushConfigured(): boolean {
  const e = env();
  return !!(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? env().VAPID_PUBLIC_KEY! : null;
}

const MAX_FAILURES = 5;
const ALLOWED_PUSH_HOST = /(^|\.)((googleapis\.com)|(mozilla\.com)|(mozaws\.net)|(push\.apple\.com)|(notify\.windows\.com)|(windows\.com))$/i;

/** Only HTTPS endpoints on known browser push services (prevents using push as an SSRF primitive). */
export function validEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (process.env.PUSH_ALLOW_ANY_ENDPOINT === 'true' && process.env.NODE_ENV !== 'production') return true; // tests only
    return ALLOWED_PUSH_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? '';
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'متصفح';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' — ');
}

/** Create or refresh a subscription for this user (a re-subscribe of the same endpoint just refreshes it). */
export async function saveSubscription(userId: string, input: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; expirationTime?: unknown }, userAgent: string | null) {
  const endpoint = String(input.endpoint ?? '');
  const p256dh = String(input.keys?.p256dh ?? '');
  const auth = String(input.keys?.auth ?? '');
  if (!validEndpoint(endpoint) || endpoint.length > 2048) throw validation('اشتراك الإشعارات غير صالح');
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,64}$/.test(auth)) throw validation('اشتراك الإشعارات غير صالح');
  const exp = typeof input.expirationTime === 'number' && input.expirationTime > 0 ? new Date(input.expirationTime) : null;
  const endpointHash = sha256(endpoint);
  const secretEnc = encryptJson({ endpoint, p256dh, auth } satisfies PushSecret);
  // An endpoint belongs to one browser profile: if another account signs in there, the subscription moves to it.
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ userId, endpointHash, secretEnc, deviceLabel: deviceLabel(userAgent), expiresAt: exp, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpointHash,
      set: { userId, secretEnc, deviceLabel: deviceLabel(userAgent), expiresAt: exp, lastSeenAt: new Date(), revokedAt: null, revokedReason: null, failureCount: 0 },
    })
    .returning({ id: pushSubscriptions.id });
  return row.id;
}

/** The user removes one device, or the browser unsubscribed (endpoint given). */
export async function revokeSubscription(userId: string, by: { id?: string; endpoint?: string }, reason = 'USER_REMOVED') {
  const where = by.id
    ? and(eq(pushSubscriptions.id, by.id), eq(pushSubscriptions.userId, userId))
    : by.endpoint
      ? and(eq(pushSubscriptions.endpointHash, sha256(by.endpoint)), eq(pushSubscriptions.userId, userId))
      : null;
  if (!where) throw validation('حدد الجهاز');
  const res = await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(where, isNull(pushSubscriptions.revokedAt)))
    .returning({ id: pushSubscriptions.id });
  if (!res.length && by.id) throw notFound('الجهاز');
}

/** Devices for the preferences page (no endpoint/keys ever leave the server). */
export async function listDevices(userId: string) {
  return db
    .select({ id: pushSubscriptions.id, label: pushSubscriptions.deviceLabel, createdAt: pushSubscriptions.createdAt, lastSuccessAt: pushSubscriptions.lastSuccessAt, failureCount: pushSubscriptions.failureCount })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)))
    .orderBy(pushSubscriptions.createdAt);
}

export async function activeSubscriptionCount(conn: DbOrTx, userId: string): Promise<number> {
  const r = await conn.execute<{ n: number }>(sql`select count(*)::int n from push_subscriptions where user_id = ${userId} and revoked_at is null and (expires_at is null or expires_at > now())`);
  return Number(r.rows[0]?.n ?? 0);
}

type Sender = (secret: PushSecret, payload: string) => Promise<{ statusCode: number }>;

let sender: Sender | null = null;
/** Test seam: integration tests replace the network sender to simulate push-service responses. */
export function setPushSender(fn: Sender | null) {
  sender = fn;
}

/** VAPID configured (or, in tests, a simulated push service installed). */
export function pushReady(): boolean {
  return pushConfigured() || sender !== null;
}

async function defaultSender(secret: PushSecret, payload: string) {
  const e = env();
  const webpush = (await import('web-push')).default;
  const res = await webpush.sendNotification({ endpoint: secret.endpoint, keys: { p256dh: secret.p256dh, auth: secret.auth } }, payload, {
    TTL: 6 * 3600,
    urgency: 'normal',
    vapidDetails: { subject: e.VAPID_SUBJECT ?? 'mailto:support@edmneg.com', publicKey: e.VAPID_PUBLIC_KEY!, privateKey: e.VAPID_PRIVATE_KEY! },
  });
  return { statusCode: res.statusCode };
}

/**
 * Send one payload to every active device of the user. Expired endpoints (404/410) are revoked; repeated
 * failures revoke the device after MAX_FAILURES. Returns how many devices accepted it.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ accepted: number; failed: number; lastError: string | null }> {
  if (!pushConfigured() && !sender) return { accepted: 0, failed: 0, lastError: 'NOT_CONFIGURED' };
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt), sql`(${pushSubscriptions.expiresAt} is null or ${pushSubscriptions.expiresAt} > now())`));
  let accepted = 0;
  let failed = 0;
  let lastError: string | null = null;
  const body = JSON.stringify(payload);
  for (const s of subs) {
    let secret: PushSecret;
    try {
      secret = decryptJson<PushSecret>(s.secretEnc);
    } catch {
      await db.update(pushSubscriptions).set({ revokedAt: new Date(), revokedReason: 'UNREADABLE' }).where(eq(pushSubscriptions.id, s.id));
      continue;
    }
    try {
      const res = await (sender ?? defaultSender)(secret, body);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        accepted++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failureCount: 0 }).where(eq(pushSubscriptions.id, s.id));
      } else throw Object.assign(new Error(`push service responded ${res.statusCode}`), { statusCode: res.statusCode });
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      lastError = code ? `HTTP_${code}` : 'NETWORK';
      if (code === 404 || code === 410) {
        await db.update(pushSubscriptions).set({ revokedAt: new Date(), revokedReason: 'EXPIRED', lastFailureAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
      } else {
        const n = s.failureCount + 1;
        await db
          .update(pushSubscriptions)
          .set({ failureCount: n, lastFailureAt: new Date(), ...(n >= MAX_FAILURES ? { revokedAt: new Date(), revokedReason: 'FAILING' } : {}) })
          .where(eq(pushSubscriptions.id, s.id));
      }
      logger.warn('push.send_failed', { subscription: s.id, status: code ?? null });
    }
  }
  return { accepted, failed, lastError };
}
