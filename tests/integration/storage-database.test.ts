import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStorageDriver, storage } from '@/server/storage/storage';

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
});
