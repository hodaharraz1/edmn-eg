import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStorageDriver, storage } from '@/server/storage/storage';
import { storeUpload } from '@/server/storage/uploads';
import { db } from '@/server/db/client';
import { customerActor } from '@/server/auth/actors';
import { eq } from 'drizzle-orm';
import { files, storedObjects } from '@/server/db/schema';
import { makeUser, png } from '../helpers/factory';

describe('database storage driver (hosts without persistent disk)', () => {
  const prev = process.env.STORAGE_DRIVER;
  beforeAll(() => {
    process.env.STORAGE_DRIVER = 'database';
    setStorageDriver(null);
  });
  afterAll(() => {
    process.env.STORAGE_DRIVER = prev;
    setStorageDriver(null);
  });

  it('stores, reads and removes bytes with the public/private split', async () => {
    const key = `test/${randomUUID()}.webp`;
    const bytes = Buffer.from([1, 2, 3, 4, 250]);
    await storage().put('PRIVATE', key, bytes);
    expect(await storage().exists('PRIVATE', key)).toBe(true);
    expect(await storage().exists('PUBLIC', key)).toBe(false);
    expect(Buffer.compare((await storage().get('PRIVATE', key))!, bytes)).toBe(0);
    expect(await storage().get('PUBLIC', key)).toBeNull();
    await storage().remove('PRIVATE', key);
    expect(await storage().get('PRIVATE', key)).toBeNull();
  });

  it('never overwrites an existing object and rejects unsafe keys', async () => {
    const key = `test/${randomUUID()}.pdf`;
    await storage().put('PUBLIC', key, Buffer.from('a'));
    await expect(storage().put('PUBLIC', key, Buffer.from('b'))).rejects.toThrow();
    expect((await storage().get('PUBLIC', key))!.toString()).toBe('a');
    await expect(storage().put('PUBLIC', '../etc/passwd', Buffer.from('x'))).rejects.toThrow('unsafe storage key');
  });

  it('rolls back the bytes with metadata after a later database failure, and keeps a committed retry private', async () => {
    const user = await makeUser({ identity: false });
    const actor = customerActor(user.id);
    const data = await png('rollback');
    let failedKey = '';
    await expect(db.transaction(async (tx) => {
      const uploaded = await storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data, originalName: 'photo.png' });
      failedKey = uploaded.storageKey;
      throw new Error('simulated later database failure');
    })).rejects.toThrow('simulated later database failure');
    expect(failedKey).toBeTruthy();
    expect(await storage().get('PRIVATE', failedKey)).toBeNull();
    expect(await db.select().from(files).where(eq(files.storageKey, failedKey))).toHaveLength(0);
    expect(await db.select().from(storedObjects).where(eq(storedObjects.key, failedKey))).toHaveLength(0);

    const saved = await db.transaction((tx) => storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data, originalName: 'photo.png' }));
    expect(saved.storageKey).not.toBe(failedKey);
    expect(await storage().get('PRIVATE', saved.storageKey)).not.toBeNull();
    expect(await storage().get('PUBLIC', saved.storageKey)).toBeNull();
    expect(await db.select().from(files).where(eq(files.storageKey, saved.storageKey))).toHaveLength(1);
  });

  it('rolls back the whole database transaction when object storage fails', async () => {
    const key = `test/${randomUUID()}.pdf`;
    await storage().put('PRIVATE', key, Buffer.from('original'));
    await expect(db.transaction(async (tx) => {
      await storage().put('PRIVATE', key, Buffer.from('replacement'), tx);
    })).rejects.toThrow();
    expect((await storage().get('PRIVATE', key))?.toString()).toBe('original');
  });
});
