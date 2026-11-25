import { and, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireStepUp, requireUser, type Actor } from '@/server/core/actor';
import { decrypt, decryptJson, encrypt, encryptJson } from '@/server/core/crypto';
import { validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { devicePushCredentials, devicePushTokens, mobileDevices, users } from '@/server/db/schema';
import { getSetting } from '@/server/modules/settings';
import { logger } from '@/server/core/logger';
import type { SenderDeps } from './device-push-senders';

/**
 * MOBILE device push tokens (PKG-PUSH-01) — parallel to the existing encrypted WEB-push subscriptions (./push.ts):
 * this module is for the Flutter apps' FCM/APNs-style tokens. Registration only: the app binds a token to ITS OWN
 * installation (the session's mobile device — never to a client-supplied device id). Sending is behind
 * notifications.devicePushEnabled (default OFF) and the ONLY sender driver is the log driver: no FCM/APNs keys exist
 * anywhere in this codebase, and nothing is sent while the flag is off. Staff see counts per platform only — tokens
 * are never read back to any UI.
 */

export interface DevicePushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Sender interface. A real FCM/APNs driver implements this later; the contract is already enforced by tests. */
export interface DevicePushSender {
  readonly driver: string;
  send(target: { token: string; platform: string }, message: DevicePushMessage): Promise<void>;
}

/**
 * The only driver today: writes the send intent to the server log. The token is never logged (length and platform
 * only) so a log drain can never leak a device token.
 */
export class LogDevicePushSender implements DevicePushSender {
  readonly driver = 'log';
  readonly sent: { platform: string; tokenLength: number; title: string; body: string }[] = [];
  async send(target: { token: string; platform: string }, message: DevicePushMessage): Promise<void> {
    const entry = { platform: target.platform, tokenLength: target.token.length, title: message.title, body: message.body };
    this.sent.push(entry);
    console.log(`[push:log] platform=${entry.platform} tokenLength=${entry.tokenLength} title=${JSON.stringify(entry.title)}`);
  }
}

let sender: DevicePushSender = new LogDevicePushSender();
/** Test/driver hook. The production default is (and stays) the log driver until the owner provisions FCM/APNs keys. */
export function setDevicePushSender(next?: DevicePushSender) {
  sender = next ?? new LogDevicePushSender();
}

function ownDevice(actor: Actor) {
  const userId = requireUser(actor);
  if (!actor.deviceId) throw validation('تسجيل إشعارات الجهاز متاح من تطبيق الموبايل فقط');
  return { userId, deviceId: actor.deviceId };
}

export const PUSH_TOKEN_PROVIDERS = ['FCM', 'APNS'] as const;
export type PushTokenProvider = (typeof PUSH_TOKEN_PROVIDERS)[number];

/** Register or refresh the push token of THIS installation (upsert per device). Audited; the token itself is never audited. */
export async function registerPushToken(actor: Actor, token: string, provider?: PushTokenProvider) {
  const { userId, deviceId } = ownDevice(actor);
  const trimmed = token.trim();
  if (trimmed.length < 16 || trimmed.length > 512) throw validation('رمز الإشعارات غير صالح');
  if (provider && !PUSH_TOKEN_PROVIDERS.includes(provider)) throw validation('نوع رمز الإشعارات غير صالح');
  return db.transaction(async (tx) => {
    const [device] = await tx.select().from(mobileDevices).where(and(eq(mobileDevices.id, deviceId), eq(mobileDevices.userId, userId), isNull(mobileDevices.revokedAt)));
    if (!device) throw validation('الجهاز غير مسجل أو تم إلغاؤه — سجّل الدخول من التطبيق مرة أخرى');
    await tx
      .insert(devicePushTokens)
      .values({ deviceId, userId, tokenEnc: encrypt(trimmed), provider: provider ?? null })
      .onConflictDoUpdate({ target: devicePushTokens.deviceId, set: { tokenEnc: encrypt(trimmed), provider: provider ?? null, updatedAt: new Date() } });
    await audit(tx, actor, { action: 'device.push_token_registered', entityType: 'user', entityId: userId, newValues: { deviceId, platform: device.platform } });
    return { registered: true as const, platform: device.platform as string };
  });
}

/** Remove THIS installation's push token (sign-out, opt-out). Idempotent: removing nothing is still ok. */
export async function unregisterPushToken(actor: Actor) {
  const { userId, deviceId } = ownDevice(actor);
  await db.transaction(async (tx) => {
    await tx.delete(devicePushTokens).where(and(eq(devicePushTokens.deviceId, deviceId), eq(devicePushTokens.userId, userId)));
    await audit(tx, actor, { action: 'device.push_token_removed', entityType: 'user', entityId: userId, newValues: { deviceId } });
  });
  return { registered: false as const };
}

/** Whether THIS installation currently has a registered token (for the app's notification settings). */
export async function pushTokenStatus(actor: Actor) {
  const { userId, deviceId } = ownDevice(actor);
  const [row] = await db.select({ id: devicePushTokens.id }).from(devicePushTokens).where(and(eq(devicePushTokens.deviceId, deviceId), eq(devicePushTokens.userId, userId)));
  return { registered: !!row, enabled: await getSetting('notifications.devicePushEnabled') };
}

// ── Live sending (PKG-PUSH-02) ──────────────────────────────────────────────────────────────────────────────

/**
 * Provider credentials live ONLY in device_push_credentials, encrypted with the same AES-GCM envelope as
 * web-push secrets (core/crypto). They are set from the admin notifications screen (settings.manage + step-up),
 * are never returned by any read API, and are never logged. Nothing about them exists in code or env.
 */
export async function saveDevicePushCredentials(actor: Actor, provider: PushTokenProvider, credentials: unknown) {
  requirePermission(actor, 'settings.manage');
  requireStepUp(actor);
  if (!PUSH_TOKEN_PROVIDERS.includes(provider)) throw validation('مزوّد إشعارات غير معروف');
  const { parseFcmCredentials, parseApnsCredentials } = await import('./device-push-senders');
  let parsed: unknown;
  try {
    parsed = provider === 'FCM' ? parseFcmCredentials(credentials) : parseApnsCredentials(credentials);
  } catch (e) {
    throw validation(e instanceof Error ? e.message : 'بيانات المزوّد غير مكتملة');
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(devicePushCredentials)
      .values({ provider, secretEnc: encryptJson(parsed), updatedBy: actor.userId! })
      .onConflictDoUpdate({ target: devicePushCredentials.provider, set: { secretEnc: encryptJson(parsed), updatedBy: actor.userId!, updatedAt: new Date() } });
    await audit(tx, actor, { action: 'device.push_credentials_saved', entityType: 'device_push_credentials', entityId: provider });
  });
  return { saved: true as const, provider };
}

/** Staff view: which providers are configured and their NON-SECRET metadata only. Never the keys themselves. */
export async function devicePushCredentialsView(actor: Actor) {
  requirePermission(actor, 'settings.manage');
  const rows = await db.select().from(devicePushCredentials);
  return Promise.all(
    rows.map(async (r) => {
      const c = decryptJson<Record<string, unknown>>(r.secretEnc);
      const [by] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, r.updatedBy));
      return {
        provider: r.provider,
        configured: true,
        meta:
          r.provider === 'FCM'
            ? { projectId: String(c.projectId ?? ''), clientEmail: String(c.clientEmail ?? '') }
            : { teamId: String(c.teamId ?? ''), keyId: String(c.keyId ?? ''), bundleId: String(c.bundleId ?? ''), sandbox: c.sandbox === true },
        updatedAt: r.updatedAt,
        updatedBy: by?.fullName ?? null,
      };
    }),
  );
}

type LiveSenders = Partial<Record<PushTokenProvider, { sendOutcome(t: { token: string; platform: string }, m: DevicePushMessage): Promise<import('./device-push-senders').SendOutcome> }>>;

let liveDeps: SenderDeps | undefined;
/** Tests only: inject fetch/http2 doubles into the live senders so no test touches the network. */
export function setLiveSenderDeps(deps?: SenderDeps) {
  liveDeps = deps;
}

/** Build the live senders from the encrypted credentials. Missing/invalid credentials FAIL CLOSED (no sender, no send). */
async function liveSenders(conn: DbOrTx): Promise<LiveSenders> {
  const rows = await conn.select().from(devicePushCredentials);
  const out: LiveSenders = {};
  const mod = await import('./device-push-senders');
  for (const r of rows) {
    try {
      const c = decryptJson<unknown>(r.secretEnc);
      out[r.provider as PushTokenProvider] = r.provider === 'FCM' ? new mod.FcmDevicePushSender(mod.parseFcmCredentials(c), liveDeps) : new mod.ApnsDevicePushSender(mod.parseApnsCredentials(c), liveDeps);
    } catch {
      logger.warn('push.credentials_invalid', { provider: r.provider });
    }
  }
  return out;
}

/** Token without an explicit provider: firebase_messaging issues FCM tokens on BOTH platforms, so FCM is the safe default. */
function providerOf(row: { provider: string | null }): PushTokenProvider {
  return row.provider === 'APNS' ? 'APNS' : 'FCM';
}

/**
 * Send a push to every registered device of a user. The master switch is read on EVERY call: while
 * notifications.devicePushEnabled is false (the default) this is a no-op that sends nothing. The DRIVER is read
 * on every call too: 'log' (default) keeps the log driver; 'live' uses the real FCM/APNs senders built from the
 * encrypted server-side credentials, and a provider without valid credentials fails closed (no send, counted).
 */
export async function sendPushToUser(conn: DbOrTx, userId: string, message: DevicePushMessage) {
  if (!(await getSetting('notifications.devicePushEnabled', conn))) return { sent: 0, failed: 0, disabled: true as const };
  const driver = await getSetting('notifications.devicePushDriver', conn);
  const live = driver === 'live' ? await liveSenders(conn) : null;
  const rows = await conn
    .select({ id: devicePushTokens.id, tokenEnc: devicePushTokens.tokenEnc, provider: devicePushTokens.provider, platform: mobileDevices.platform })
    .from(devicePushTokens)
    .innerJoin(mobileDevices, and(eq(mobileDevices.id, devicePushTokens.deviceId), isNull(mobileDevices.revokedAt)))
    .where(eq(devicePushTokens.userId, userId));
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const target = { token: decrypt(r.tokenEnc), platform: r.platform as string };
    try {
      if (!live) {
        await sender.send(target, message);
      } else {
        const s = live[providerOf(r)];
        if (!s) {
          // Fail closed: live mode without this provider's credentials sends nothing.
          failed += 1;
          logger.warn('push.no_credentials', { provider: providerOf(r) });
          continue;
        }
        const out = await s.sendOutcome(target, message);
        if (!out.ok) {
          if (out.invalidToken) {
            // The provider says the token is dead: remove it so it is never tried again.
            await conn.delete(devicePushTokens).where(eq(devicePushTokens.id, r.id));
            logger.info('push.token_pruned', { platform: target.platform });
          }
          failed += 1;
          continue;
        }
      }
      sent += 1;
    } catch (e) {
      failed += 1;
      logger.warn('push.send_failed', { driver: live ? 'live' : 'log', error: e instanceof Error ? e.message.slice(0, 40) : 'unknown' });
    }
  }
  return { sent, failed, disabled: false as const };
}

/** Staff view: registered-device counts per platform+app (notifications.manage, like the notifications page). NEVER returns tokens. */
export async function pushDeviceCounts(actor: Actor) {
  requirePermission(actor, 'notifications.manage');
  const rows = await db
    .select({ platform: mobileDevices.platform, app: mobileDevices.app, n: sql<number>`count(*)::int` })
    .from(devicePushTokens)
    .innerJoin(mobileDevices, and(eq(mobileDevices.id, devicePushTokens.deviceId), isNull(mobileDevices.revokedAt)))
    .groupBy(mobileDevices.platform, mobileDevices.app);
  return {
    enabled: await getSetting('notifications.devicePushEnabled'),
    total: rows.reduce((a, r) => a + r.n, 0),
    byPlatform: rows.map((r) => ({ platform: r.platform as string, app: r.app as string, count: r.n })),
  };
}
