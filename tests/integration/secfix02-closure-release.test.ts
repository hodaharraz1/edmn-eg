import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { customerActor } from '@/server/auth/actors';
import { encrypt } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import { auditLogs, devicePushTokens, files, mobileDevices, pushSubscriptions, sellers } from '@/server/db/schema';
import { completeAccountClosure, requestAccountClosure, requestClosureExecution } from '@/server/modules/customers/closure';
import { storage } from '@/server/storage/storage';
import { makeAdmin, makeCustomer, makeSeller } from '../helpers/factory';

/**
 * PKG-SEC-FIX-02 (SEC-165): closing an account removes what the published deletion page promises: device push tokens and
 * web-push subscriptions are deleted, mobile devices are revoked, and the account's own national-ID photos are LOCKED (nothing
 * can open them) and KEPT: no automatic deletion, ever, until the owner decides (owner decision 2026-11-25).
 * Seller verification documents, evidence files and receipts are kept.
 */
async function addDevice(userId: string) {
  const [d] = await db.insert(mobileDevices).values({ userId, app: 'CUSTOMER', installationId: randomUUID().replaceAll('-', '') + 'abcdefgh', platform: 'ANDROID' }).returning();
  await db.insert(devicePushTokens).values({ deviceId: d.id, userId, tokenEnc: encrypt('fcm-token-' + randomUUID()), provider: 'FCM' });
  await db.insert(pushSubscriptions).values({ userId, endpointHash: randomUUID(), secretEnc: encrypt('{"endpoint":"x"}') });
  return d.id;
}
async function close(userId: string) {
  const req = await requestAccountClosure(customerActor(userId), 'إغلاق');
  expect(req.status).toBe('PENDING');
  await requestClosureExecution(await makeAdmin(), req.requestId!);
  const done = await completeAccountClosure(await makeAdmin(), req.requestId!);
  expect(done.closed).toBe(true);
}
const idFiles = (userId: string) => db.select().from(files).where(and(eq(files.ownerUserId, userId), eq(files.purpose, 'IDENTITY_DOCUMENT')));

describe('SEC-165: closing an account releases personal data', () => {
  it('push tokens and subscriptions are deleted, devices revoked, ID photos locked and kept', async () => {
    const c = await makeCustomer();
    const deviceId = await addDevice(c.user.id);
    const before = await idFiles(c.user.id);
    expect(before.length).toBeGreaterThanOrEqual(2);
    for (const f of before) expect(await storage().exists(f.visibility, f.storageKey)).toBe(true);

    await close(c.user.id);

    expect(await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, c.user.id))).toHaveLength(0);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, c.user.id))).toHaveLength(0);
    const [d] = await db.select().from(mobileDevices).where(eq(mobileDevices.id, deviceId));
    expect(d.revokedAt).not.toBeNull();
    const after = await idFiles(c.user.id);
    expect(after).toHaveLength(before.length);
    for (const f of after) {
      expect(f.deletedAt).not.toBeNull(); // locked: /api/files refuses a deleted file
      expect(f.purgedAt).toBeNull();
      expect(await storage().exists(f.visibility, f.storageKey)).toBe(true); // kept until the owner decides
    }
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, c.user.id), eq(auditLogs.action, 'account.closed')));
    expect(JSON.stringify(log.newValues)).toContain('identityPhotosLocked');
  });

  it('nothing removes a closed account\'s locked ID photos later: no scheduled purge exists', async () => {
    const { SCHEDULE } = await import('@/server/jobs/worker');
    expect(SCHEDULE.map((x) => x.name).filter((n) => /purge|identity/i.test(n))).toEqual([]);
  });

  it('receipts and other evidence files are kept', async () => {
    const c = await makeCustomer();
    const bytes = Buffer.from('receipt-' + randomUUID());
    const key = `secfix02/${randomUUID()}.pdf`;
    await storage().put('PRIVATE', key, bytes);
    const [proof] = await db.insert(files).values({ visibility: 'PRIVATE', purpose: 'PAYMENT_PROOF', storageKey: key, mimeType: 'image/png', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ownerUserId: c.user.id }).returning();
    await close(c.user.id);
    const [after] = await db.select().from(files).where(eq(files.id, proof.id));
    expect(after.deletedAt).toBeNull();
    expect(await storage().exists('PRIVATE', key)).toBe(true);
  });

  it('an account that ever owned a store keeps its verification photos', async () => {
    const admin = await makeAdmin();
    const s = await makeSeller(admin);
    await db.update(sellers).set({ status: 'DRAFT' }).where(eq(sellers.ownerUserId, s.user.id)); // no open store obligation
    const ids = await idFiles(s.user.id);
    await close(s.user.id);
    const after = await idFiles(s.user.id);
    expect(after).toHaveLength(ids.length);
    for (const f of after) {
      expect(f.deletedAt).toBeNull();
      expect(await storage().exists(f.visibility, f.storageKey)).toBe(true);
    }
  });
});
