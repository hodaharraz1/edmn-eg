import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/server/core/env';

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

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) driver = new LocalDiskStorage(path.resolve(process.env.STORAGE_LOCAL_ROOT || env().STORAGE_LOCAL_ROOT));
  return driver;
}
export function setStorageDriver(d: StorageDriver | null) {
  driver = d;
}
