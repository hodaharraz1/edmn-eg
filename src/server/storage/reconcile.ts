import { eq, sql } from 'drizzle-orm';
import { sha256 } from '@/server/core/crypto';
import { logger } from '@/server/core/logger';
import { db } from '@/server/db/client';
import { auditLogs, files } from '@/server/db/schema';
import { LocalDiskStorage, storage } from './storage';

// Separate namespaces let the business transaction and the disk writer hold
// independent locks, including when the former aborts during filesystem I/O.
export const metadataLockName = (key: string) => `private-file-metadata:${key}`;
export const writeLockName = (key: string) => `private-file-write:${key}`;
export const PRIVATE_ORPHAN_GRACE_MS = 24 * 60 * 60_000;

/**
 * Reconcile local private objects only. Roll out the upload locks to every writer,
 * wait at least the grace period, then explicitly enable this job. Existing file
 * records (including soft-deleted records) always win; an unreadable database or
 * storage error aborts the run. A failed/interrupted run is safe to repeat.
 */
export async function reconcilePrivateOrphans(): Promise<{ examined: number; removed: number; busy: number }> {
  const driver = storage();
  if (!(driver instanceof LocalDiskStorage)) return { examined: 0, removed: 0, busy: 0 };
  const before = new Date(Date.now() - PRIVATE_ORPHAN_GRACE_MS);
  const result = { examined: 0, removed: 0, busy: 0 };
  for await (const key of driver.oldPrivateKeys(before)) {
    result.examined++;
    await db.transaction(async (tx) => {
      const [w] = (await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${writeLockName(key)}, 0)) as locked`)).rows;
      if (!w?.locked) { result.busy++; return; }
      const [m] = (await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${metadataLockName(key)}, 0)) as locked`)).rows;
      if (!m?.locked) { result.busy++; return; }
      const [reference] = await tx.select({ id: files.id }).from(files).where(eq(files.storageKey, key)).limit(1);
      if (reference || !(await driver.privateKeyStillOld(key, before))) return;
      // Emit before unlink so an interruption after deletion leaves evidence. Never log bytes or the path.
      const objectHash = sha256(key);
      // This commits independently before the unlink: if the worker or its locking
      // transaction dies after deletion, the append-only attempt still survives.
      await db.insert(auditLogs).values({ actorType: 'SYSTEM', channel: 'SYSTEM', action: 'storage.private_orphan_delete_attempt', entityType: 'PRIVATE_UPLOAD_HASH', entityId: objectHash });
      logger.info('storage.private_orphan_delete_attempt', { objectHash });
      await driver.remove('PRIVATE', key);
      logger.info('storage.private_orphan_deleted', { objectHash });
      result.removed++;
    });
  }
  return result;
}
