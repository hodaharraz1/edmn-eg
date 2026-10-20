import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { env } from '@/server/core/env';
import { db } from '@/server/db/client';
import { storedObjects } from '@/server/db/schema/files';

/**
 * Object storage abstraction. V1 ships a local-disk driver with physically separated
 * public/ and private/ roots. An S3-compatible driver can implement the same interface
 * (see docs/ARCHITECTURE.md → Storage) without touching callers.
 */
export interface StorageDriver {
  put(visibility: 'PUBLIC' | 'PRIVATE', key: string, data: Buffer): Promise<void>;
  get(visibility: 'PUBLIC' | 'PRIVATE', key: string): Promise<Buffer | null>;
  remove(visibility: 'PUBLIC' | 'PRIVATE', key: string): Promise<void>;
  exists(visibility: 'PUBLIC' | 'PRIVATE', key: string): Promise<boolean>;
}

const KEY_RE = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*\/[a-f0-9-]{36}(_[a-z0-9]+)?\.(webp|jpg|png|pdf)$/;

export function isSafeKey(key: string): boolean {
  return KEY_RE.test(key) && !key.includes('..');
}

class LocalDiskStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  private resolve(visibility: 'PUBLIC' | 'PRIVATE', key: string): string {
    if (!isSafeKey(key)) throw new Error('unsafe storage key');
    const base = path.resolve(this.root, visibility === 'PUBLIC' ? 'public' : 'private');
    const full = path.resolve(base, key);
    if (!full.startsWith(base + path.sep)) throw new Error('path traversal blocked');
    return full;
  }

  async put(visibility: 'PUBLIC' | 'PRIVATE', key: string, data: Buffer) {
    const full = this.resolve(visibility, key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
    await writeFile(full, data, { mode: 0o640, flag: 'wx' });
  }

  async get(visibility: 'PUBLIC' | 'PRIVATE', key: string) {
    try {
      return await readFile(this.resolve(visibility, key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async remove(visibility: 'PUBLIC' | 'PRIVATE', key: string) {
    await rm(this.resolve(visibility, key), { force: true });
  }

  async exists(visibility: 'PUBLIC' | 'PRIVATE', key: string) {
    try {
      await stat(this.resolve(visibility, key));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Stores object bytes in PostgreSQL (`stored_objects`). For hosts with an ephemeral filesystem
 * (e.g. free tiers): files survive restarts and redeploys together with the database.
 */
class DatabaseStorage implements StorageDriver {
  private check(key: string) {
    if (!isSafeKey(key)) throw new Error('unsafe storage key');
  }

  async put(visibility: 'PUBLIC' | 'PRIVATE', key: string, data: Buffer) {
    this.check(key);
    // Plain insert: like the disk driver's exclusive create, an existing key is an error, never an overwrite.
    await db.insert(storedObjects).values({ visibility, key, data, size: data.length });
  }

  async get(visibility: 'PUBLIC' | 'PRIVATE', key: string) {
    this.check(key);
    const [row] = await db.select({ data: storedObjects.data }).from(storedObjects).where(and(eq(storedObjects.visibility, visibility), eq(storedObjects.key, key)));
    return row ? Buffer.from(row.data) : null;
  }

  async remove(visibility: 'PUBLIC' | 'PRIVATE', key: string) {
    this.check(key);
    await db.delete(storedObjects).where(and(eq(storedObjects.visibility, visibility), eq(storedObjects.key, key)));
  }

  async exists(visibility: 'PUBLIC' | 'PRIVATE', key: string) {
    this.check(key);
    const [row] = await db.select({ key: storedObjects.key }).from(storedObjects).where(and(eq(storedObjects.visibility, visibility), eq(storedObjects.key, key)));
    return !!row;
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) {
    driver =
      (process.env.STORAGE_DRIVER || env().STORAGE_DRIVER) === 'database'
        ? new DatabaseStorage()
        : new LocalDiskStorage(path.resolve(process.env.STORAGE_LOCAL_ROOT || env().STORAGE_LOCAL_ROOT));
  }
  return driver;
}
export function setStorageDriver(d: StorageDriver | null) {
  driver = d;
}
