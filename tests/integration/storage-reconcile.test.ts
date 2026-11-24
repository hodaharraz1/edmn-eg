import { mkdtemp, rm, utimes, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { customerActor } from '@/server/auth/actors';
import { closeDb, db } from '@/server/db/client';
import { auditLogs } from '@/server/db/schema';
import { sha256 } from '@/server/core/crypto';
import { LocalDiskStorage, setStorageDriver } from '@/server/storage/storage';
import { reconcilePrivateOrphans, writeLockName } from '@/server/storage/reconcile';
import { storeUpload } from '@/server/storage/uploads';
import { makeUser, png } from '../helpers/factory';

describe('private local upload reconciliation', () => {
  let root: string;
  let driver: LocalDiskStorage;
  let actor: ReturnType<typeof customerActor>;
  const old = new Date(Date.now() - 48 * 60 * 60_000);
  const key = () => `deal_evidence/2026/01/${randomUUID()}.webp`;
  const age = (k: string) => utimes(path.join(root, 'private', k), old, old);

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'edmn-reconcile-test-'));
    driver = new LocalDiskStorage(root);
    setStorageDriver(driver);
    actor = customerActor((await makeUser({ identity: false })).id);
  });
  afterAll(async () => {
    setStorageDriver(null);
    await rm(root, { recursive: true, force: true });
  });

  it('cleans an aged rolled-back upload, preserves committed and recent objects, and is idempotent', async () => {
    const data = await png('rollback-local');
    let orphan = '';
    await expect(db.transaction(async (tx) => {
      orphan = (await storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data, originalName: 'a.png' })).storageKey;
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const kept = await db.transaction((tx) => storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data, originalName: 'a.png' }));
    const recent = key();
    await driver.put('PRIVATE', recent, Buffer.from('synthetic'));
    await age(orphan); await age(kept.storageKey);
    const result = await reconcilePrivateOrphans();
    expect(result.removed).toBe(1);
    expect(await driver.exists('PRIVATE', orphan)).toBe(false);
    expect(await driver.exists('PRIVATE', kept.storageKey)).toBe(true);
    expect(await driver.exists('PRIVATE', recent)).toBe(true);
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'storage.private_orphan_delete_attempt'), eq(auditLogs.entityId, sha256(orphan))));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(orphan);
    expect((await reconcilePrivateOrphans()).removed).toBe(0);
  });

  it('skips an active upload transaction and retains the committed retry', async () => {
    let ready!: (k: string) => void;
    let release!: () => void;
    const staged = new Promise<string>((resolve) => { ready = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const data = await png('active-local');
    const upload = db.transaction(async (tx) => {
      const f = await storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data, originalName: 'a.png' });
      await age(f.storageKey);
      ready(f.storageKey);
      await wait;
      return f;
    });
    try {
      const k = await staged;
      expect((await reconcilePrivateOrphans()).busy).toBeGreaterThanOrEqual(1);
      expect(await driver.exists('PRIVATE', k)).toBe(true);
      release(); await upload;
      expect((await reconcilePrivateOrphans()).removed).toBe(0);
      expect(await driver.exists('PRIVATE', k)).toBe(true);
    } finally { release(); await upload; }
  });

  it('respects the separate writer lock after a metadata transaction has ended', async () => {
    const k = key();
    await driver.put('PRIVATE', k, Buffer.from('synthetic')); await age(k);
    let ready!: () => void; let release!: () => void;
    const staged = new Promise<void>((resolve) => { ready = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const writer = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${writeLockName(k)}, 0))`);
      ready(); await wait;
    });
    try {
      await staged;
      expect((await reconcilePrivateOrphans()).busy).toBeGreaterThanOrEqual(1);
      expect(await driver.exists('PRIVATE', k)).toBe(true);
      release(); await writer;
      expect((await reconcilePrivateOrphans()).removed).toBe(1);
    } finally { release(); await writer; }
  });

  it('cleans a rolled-back upload without touching a concurrent committed retry', async () => {
    const data = await png('parallel-local');
    let ready!: () => void; let release!: () => void; let failedKey = '';
    const staged = new Promise<void>((resolve) => { ready = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const rollback = db.transaction(async (tx) => {
      failedKey = (await storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data, originalName: 'a.png' })).storageKey;
      ready(); await wait; throw new Error('simulated rollback');
    }).catch((e: Error) => e);
    try {
      await staged;
      const committed = await db.transaction((tx) => storeUpload(tx, actor, { purpose: 'DEAL_EVIDENCE', data, originalName: 'a.png' }));
      release(); expect((await rollback).message).toContain('simulated rollback');
      await age(failedKey); await age(committed.storageKey);
      expect((await reconcilePrivateOrphans()).removed).toBe(1);
      expect(await driver.exists('PRIVATE', failedKey)).toBe(false);
      expect(await driver.exists('PRIVATE', committed.storageKey)).toBe(true);
    } finally { release(); await rollback; }
  });

  it('recovers after a storage failure and concurrent reconciliation never deletes a referenced object', async () => {
    const k = key();
    await driver.put('PRIVATE', k, Buffer.from('synthetic')); await age(k);
    const remove = vi.spyOn(driver, 'remove').mockRejectedValueOnce(new Error('simulated storage outage'));
    await expect(reconcilePrivateOrphans()).rejects.toThrow('simulated storage outage');
    expect(await driver.exists('PRIVATE', k)).toBe(true);
    remove.mockRestore();
    await Promise.all([reconcilePrivateOrphans(), reconcilePrivateOrphans()]);
    expect(await driver.exists('PRIVATE', k)).toBe(false);
  });

  it('recovers an abandoned upload after the writer process crashes', async () => {
    const k = key();
    await driver.put('PRIVATE', k, Buffer.from('synthetic')); await age(k);
    const child = spawn(process.execPath, ['-e', `
      const { Client } = require('pg');
      (async () => {
        const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
        await c.connect(); await c.query('BEGIN');
        await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [process.env.TEST_FILE_LOCK]);
        process.stdout.write('ready\\n');
        setInterval(() => {}, 1000);
      })().catch(() => process.exit(1));
    `], { env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL, TEST_FILE_LOCK: writeLockName(k) }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once('data', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`test writer exited early: ${code}`)));
      });
      expect((await reconcilePrivateOrphans()).busy).toBeGreaterThanOrEqual(1);
      expect(await driver.exists('PRIVATE', k)).toBe(true);
    } finally {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
    // PostgreSQL releases the dead process's transaction lock, allowing a later retry.
    expect((await reconcilePrivateOrphans()).removed).toBe(1);
    expect(await driver.exists('PRIVATE', k)).toBe(false);
  });

  it('does not remove objects when the database cannot be read', async () => {
    const k = key();
    await driver.put('PRIVATE', k, Buffer.from('synthetic')); await age(k);
    const originalUrl = process.env.DATABASE_URL;
    const originalTimeout = process.env.DATABASE_CONNECT_TIMEOUT_MS;
    await closeDb();
    try {
      process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/edmn_test';
      process.env.DATABASE_CONNECT_TIMEOUT_MS = '500';
      await expect(reconcilePrivateOrphans()).rejects.toThrow();
      expect(await driver.exists('PRIVATE', k)).toBe(true);
    } finally {
      await closeDb();
      process.env.DATABASE_URL = originalUrl;
      if (originalTimeout === undefined) delete process.env.DATABASE_CONNECT_TIMEOUT_MS;
      else process.env.DATABASE_CONNECT_TIMEOUT_MS = originalTimeout;
    }
    expect((await reconcilePrivateOrphans()).removed).toBe(1);
  });

  it('ignores unsafe paths, links, and public objects', async () => {
    const publicKey = key();
    await driver.put('PUBLIC', publicKey, Buffer.from('public'));
    const outside = path.join(root, 'outside');
    await writeFile(outside, 'test');
    const link = path.join(root, 'private', 'linked');
    await symlink(outside, link);
    expect((await reconcilePrivateOrphans()).removed).toBe(0);
    expect(await driver.exists('PUBLIC', publicKey)).toBe(true);
  });
});
