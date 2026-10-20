import { eq, inArray, sql } from 'drizzle-orm';
import { logger, safeErrorMessage } from '@/server/core/logger';
import { runtimeEnvironment } from '@/server/core/runtime-env';
import { db } from '@/server/db/client';
import { files, type FilePurpose } from '@/server/db/schema';
import { storage } from './storage';
import { recordProviderResult } from '@/server/ops/provider-health';

/* ═══════════════ Storage classification (Batch 2) ═══════════════ */

export type StorageClass = 'PUBLIC' | 'PRIVATE' | 'HIGHLY_SENSITIVE';

/** Identity, payment and payout documents: private, staff access needs permission (+2FA for IDs) and is audited. */
export const HIGHLY_SENSITIVE_PURPOSES: ReadonlySet<FilePurpose> = new Set(['IDENTITY_DOCUMENT', 'SELLER_DOCUMENT', 'PAYMENT_PROOF', 'WITHDRAWAL_PROOF', 'REFUND_PROOF']);
export const PUBLIC_FILE_PURPOSES: ReadonlySet<FilePurpose> = new Set(['PRODUCT_IMAGE', 'STORE_LOGO', 'STORE_BANNER', 'CATEGORY_IMAGE', 'BRAND_LOGO', 'CMS_IMAGE', 'REVIEW_PHOTO']);

export function storageClass(purpose: FilePurpose): StorageClass {
  if (PUBLIC_FILE_PURPOSES.has(purpose)) return 'PUBLIC';
  return HIGHLY_SENSITIVE_PURPOSES.has(purpose) ? 'HIGHLY_SENSITIVE' : 'PRIVATE';
}

/* ═══════════════ Malware scanning ═══════════════
 * UPLOAD → QUARANTINED → SCANNING → CLEAN | INFECTED | REJECTED | SCAN_FAILED
 * There is NO built-in or fake scanner: with no MALWARE_SCANNER_URL every new file is recorded UNSCANNED (or
 * QUARANTINED where scanning is required) and the system reports "MALWARE SCANNER ACTIVE: NO".
 * Public images are always re-encoded by sharp (EXIF/polyglot neutralised) and are not gated; PRIVATE documents
 * (PDF evidence, proofs, ID scans) are the gated class.
 */
export interface ScanVerdict {
  verdict: 'CLEAN' | 'INFECTED' | 'REJECTED';
  engine: string;
  detail?: string;
}
export interface MalwareScanner {
  name: string;
  scan(data: Buffer, meta: { fileId: string; mimeType: string }): Promise<ScanVerdict>;
}

/**
 * HTTP scanner adapter for a PRIVATE scanner service we operate (e.g. ClamAV behind `ops/scanner/clamd-http.mjs`).
 * Contract: POST the raw bytes (application/octet-stream, Bearer MALWARE_SCANNER_TOKEN) → 200 JSON
 *   {"result":"CLEAN"} | {"result":"INFECTED","signature":"…"} | {"result":"REJECTED","reason":"…"}
 * FAIL CLOSED: a non-200 status, a timeout, an unreachable scanner, a non-JSON body or any other "result" is a
 * scan FAILURE (the file stays unavailable) — never CLEAN. Files are never sent to a public multi-engine service.
 */
export class ScannerError extends Error {}

export function parseScannerResponse(status: number, text: string): ScanVerdict {
  if (status !== 200) throw new ScannerError(`scanner responded ${status}`);
  let j: { result?: unknown; signature?: unknown; reason?: unknown };
  try {
    j = JSON.parse(text);
  } catch {
    throw new ScannerError('scanner returned a malformed response');
  }
  if (!j || typeof j !== 'object') throw new ScannerError('scanner returned a malformed response');
  if (j.result === 'CLEAN') return { verdict: 'CLEAN', engine: 'http-scanner' };
  if (j.result === 'INFECTED') return { verdict: 'INFECTED', engine: 'http-scanner', detail: String(j.signature ?? 'unknown').replace(/[^\w.:/-]/g, '').slice(0, 120) || 'unknown' };
  if (j.result === 'REJECTED') return { verdict: 'REJECTED', engine: 'http-scanner', detail: String(j.reason ?? 'rejected').replace(/[^\w .:/-]/g, '').slice(0, 120) };
  throw new ScannerError('scanner returned no verdict');
}

export function httpScanner(url: string, token?: string, timeoutMs = Number(process.env.MALWARE_SCANNER_TIMEOUT_MS ?? 30_000)): MalwareScanner {
  return {
    name: 'http-scanner',
    async scan(data, meta) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-file-id': meta.fileId, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return parseScannerResponse(res.status, await res.text());
    },
  };
}

let override: MalwareScanner | null | undefined;
/** Tests only: inject a scanner (or null to force "none"). */
export function setScannerForTests(s: MalwareScanner | null | undefined) {
  override = s;
}

export function activeScanner(): MalwareScanner | null {
  if (override !== undefined) return override;
  const url = process.env.MALWARE_SCANNER_URL;
  return url ? httpScanner(url, process.env.MALWARE_SCANNER_TOKEN) : null;
}

/** Whether private files must be scanned before they are served (PRODUCTION by default; never weaker there). */
export function scanRequired(raw: Record<string, string | undefined> = process.env): boolean {
  if (runtimeEnvironment(raw) === 'PRODUCTION') return true;
  return raw.MALWARE_SCAN_REQUIRED === 'true';
}

/**
 * Public uploads must also be scanned in PRODUCTION (fail closed): without a CLEAN verdict a public file is never
 * served there. Outside production public images stay visible unscanned (re-encoded, staging/dev convenience).
 */
export function publicScanRequired(raw: Record<string, string | undefined> = process.env): boolean {
  return runtimeEnvironment(raw) === 'PRODUCTION';
}

/** Initial status for a new upload. */
export function initialScanStatus(visibility: 'PUBLIC' | 'PRIVATE'): 'UNSCANNED' | 'QUARANTINED' {
  if (visibility === 'PUBLIC') return activeScanner() || publicScanRequired() ? 'QUARANTINED' : 'UNSCANNED';
  return activeScanner() || scanRequired() ? 'QUARANTINED' : 'UNSCANNED';
}

/** May this file's bytes be served? Only CLEAN, or UNSCANNED where scanning is not required. */
export function servable(f: { visibility: string; scanStatus: string }): boolean {
  if (f.scanStatus === 'CLEAN') return true;
  if (f.scanStatus === 'UNSCANNED') return f.visibility === 'PUBLIC' ? !publicScanRequired() : !scanRequired();
  // A public image waiting for a scanner verdict stays visible only where scanning is not required.
  if (f.visibility === 'PUBLIC' && f.scanStatus === 'QUARANTINED') return !scanRequired();
  return false;
}

/** Scans quarantined files (job files.scan). No scanner → nothing happens (files stay quarantined, honestly). */
export async function scanPendingFiles(limit = 20) {
  const scanner = activeScanner();
  if (!scanner) return { processed: 0, scanner: 'NONE' };
  // A failed scan (scanner down, timeout, malformed reply) is retried after 15 minutes; the file stays unavailable
  // meanwhile. Retried files queue behind new uploads (ordered by last attempt), so failures never starve the queue.
  await db.execute(sql`update files set scan_status = 'QUARANTINED' where scan_status = 'SCAN_FAILED' and deleted_at is null and scanned_at < now() - interval '15 minutes'`);
  const claimed = await db.execute<{ id: string }>(sql`update files set scan_status = 'SCANNING'
    where id in (select id from files where scan_status = 'QUARANTINED' and deleted_at is null order by coalesce(scanned_at, created_at) limit ${limit} for update skip locked)
    returning id`);
  // A SCANNING row older than 30 minutes (crashed scan) goes back to the queue.
  await db.execute(sql`update files set scan_status = 'QUARANTINED' where scan_status = 'SCANNING' and coalesce(scanned_at, created_at) < now() - interval '30 minutes' and id not in (${claimed.rows.length ? sql.join(claimed.rows.map((r) => sql`${r.id}::uuid`), sql`, `) : sql`null`})`);
  let processed = 0;
  let failed = 0;
  const ids = claimed.rows.map((r) => r.id);
  const rows = ids.length ? await db.select().from(files).where(inArray(files.id, ids)) : [];
  for (const f of rows) {
    try {
      const data = await storage().get(f.visibility, f.storageKey);
      if (!data) throw new Error('object missing from storage');
      const v = await scanner.scan(data, { fileId: f.id, mimeType: f.mimeType });
      await db.update(files).set({ scanStatus: v.verdict, scannedAt: new Date(), scanEngine: v.engine, scanDetail: v.detail ?? null }).where(eq(files.id, f.id));
      if (v.verdict !== 'CLEAN') logger.warn('file.scan_blocked', { fileId: f.id, purpose: f.purpose, verdict: v.verdict });
      await recordProviderResult('MALWARE_SCANNER', true);
      processed++;
    } catch (e) {
      failed++;
      if (!(e instanceof Error && e.message === 'object missing from storage')) await recordProviderResult('MALWARE_SCANNER', false, e);
      await db.update(files).set({ scanStatus: 'SCAN_FAILED', scannedAt: new Date(), scanEngine: scanner.name, scanDetail: safeErrorMessage(e).slice(0, 200) }).where(eq(files.id, f.id));
    }
  }
  return { processed, failed, scanner: scanner.name };
}

export async function scannerStatus() {
  const r = await db.execute<{ s: string; n: string }>(sql`select scan_status s, count(*)::text n from files where deleted_at is null group by 1`);
  return { active: !!activeScanner(), required: scanRequired(), counts: Object.fromEntries(r.rows.map((x) => [x.s, Number(x.n)])) as Record<string, number> };
}
