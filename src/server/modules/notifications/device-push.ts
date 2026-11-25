import { and, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '@/server/audit/audit';
import { requirePermission, requireUser, type Actor } from '@/server/core/actor';
import { validation } from '@/server/core/errors';
import { db, type DbOrTx } from '@/server/db/client';
import { devicePushTokens, mobileDevices } from '@/server/db/schema';
import { getSetting } from '@/server/modules/settings';

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

/** Register or refresh the push token of THIS installation (upsert per device). Audited; the token itself is never audited. */
export async function registerPushToken(actor: Actor, token: string) {
  const { userId, deviceId } = ownDevice(actor);
  const trimmed = token.trim();
  if (trimmed.length < 16 || trimmed.length > 512) throw validation('رمز الإشعارات غير صالح');
  return db.transaction(async (tx) => {
    const [device] = await tx.select().from(mobileDevices).where(and(eq(mobileDevices.id, deviceId), eq(mobileDevices.userId, userId), isNull(mobileDevices.revokedAt)));
    if (!device) throw validation('الجهاز غير مسجل أو تم إلغاؤه — سجّل الدخول من التطبيق مرة أخرى');
    await tx
      .insert(devicePushTokens)
      .values({ deviceId, userId, token: trimmed })
      .onConflictDoUpdate({ target: devicePushTokens.deviceId, set: { token: trimmed, updatedAt: new Date() } });
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

/**
 * Send a push to every registered device of a user. The master switch is read on EVERY call: while
 * notifications.devicePushEnabled is false (the default) this is a no-op that sends nothing.
 */
export async function sendPushToUser(conn: DbOrTx, userId: string, message: DevicePushMessage) {
  if (!(await getSetting('notifications.devicePushEnabled', conn))) return { sent: 0, disabled: true as const };
  const rows = await conn
    .select({ token: devicePushTokens.token, platform: mobileDevices.platform })
    .from(devicePushTokens)
    .innerJoin(mobileDevices, and(eq(mobileDevices.id, devicePushTokens.deviceId), isNull(mobileDevices.revokedAt)))
    .where(eq(devicePushTokens.userId, userId));
  for (const r of rows) await sender.send({ token: r.token, platform: r.platform }, message);
  return { sent: rows.length, disabled: false as const };
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
