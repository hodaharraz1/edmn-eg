import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { requireUser, type Actor } from '@/server/core/actor';
import { sha256 } from '@/server/core/crypto';
import { env } from '@/server/core/env';
import { validation } from '@/server/core/errors';
import { logger, safeErrorMessage } from '@/server/core/logger';
import { db, type DbOrTx } from '@/server/db/client';
import { sql } from 'drizzle-orm';
import { files, type FilePurpose } from '@/server/db/schema';
import { getSetting } from '@/server/modules/settings';
import { initialScanStatus } from './scanning';
import { enforce } from '@/server/auth/rate-limit';
import { LocalDiskStorage, storage } from './storage';
import { metadataLockName, writeLockName } from './reconcile';

type Kind = 'jpeg' | 'png' | 'webp' | 'pdf';

/** Detect the real file type from magic bytes — the client-declared MIME type and filename are never trusted. */
export function sniff(buf: Buffer): Kind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  return null;
}

const PUBLIC_PURPOSES: ReadonlySet<FilePurpose> = new Set([
  'PRODUCT_IMAGE',
  'STORE_LOGO',
  'STORE_BANNER',
  'CATEGORY_IMAGE',
  'BRAND_LOGO',
  'CMS_IMAGE',
  'REVIEW_PHOTO',
]);
const IMAGE_ONLY: ReadonlySet<FilePurpose> = new Set([...PUBLIC_PURPOSES, 'IDENTITY_DOCUMENT']);
const ALLOWED_EXT = /\.(jpe?g|png|webp|pdf)$/i;

export interface UploadInput {
  purpose: FilePurpose;
  data: Buffer;
  originalName?: string | null;
}

export interface StoredFile {
  id: string;
  storageKey: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  mimeType: string;
  /** sha256 of the bytes as uploaded (before any re-encoding) — used for duplicate-proof signals. */
  sourceSha256: string;
}

export async function fileFromForm(value: FormDataEntryValue | null): Promise<{ data: Buffer; name: string } | null> {
  if (!value || typeof value === 'string') return null;
  if (value.size === 0) return null;
  return { data: Buffer.from(await value.arrayBuffer()), name: value.name };
}

/**
 * Validate + normalize + store an upload, returning the `files` row id.
 * Images are re-encoded with sharp (auto-orient, metadata/EXIF/GPS stripped), which also
 * neutralizes polyglot payloads. PDFs are accepted only for document purposes.
 */
/**
 * SEC-04 L10: a basic PDF content gate that runs before the bytes are stored.
 * It rejects a file that is not a PDF, a truncated PDF, and a PDF whose object names include active content
 * (JavaScript, launch actions, auto-actions, embedded files, RichMedia, XFA). It is a content sanity gate that
 * fails closed — NOT a malware scanner: MALWARE_SCANNER_URL remains the real control for private documents.
 */
const PDF_ACTIVE_NAMES = ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'OpenAction', 'AA', 'RichMedia', 'XFA'] as const;
export function pdfContentProblems(data: Buffer): string[] {
  const problems: string[] = [];
  if (data.length < 8) return ['not-a-pdf'];
  if (!data.subarray(0, 1024).toString('latin1').includes('%PDF-')) problems.push('not-a-pdf');
  if (!data.subarray(Math.max(0, data.length - 2048)).toString('latin1').includes('%%EOF')) problems.push('truncated');
  const text = data.toString('latin1');
  for (const name of PDF_ACTIVE_NAMES) {
    // A PDF name object: '/' + name, delimited by a name terminator (never part of a longer word).
    if (new RegExp(`/${name}(?![A-Za-z0-9#])`).test(text)) problems.push(`active-content:${name}`);
  }
  return problems;
}

export async function storeUpload(tx: DbOrTx, actor: Actor, input: UploadInput): Promise<StoredFile> {
  const userId = requireUser(actor);
  // Per-user upload budget (F-13): catalog images are numerous by nature, every other purpose is occasional.
  // Counted on the shared connection (a rate-limit row is not part of the business transaction).
  if (actor.type !== 'SYSTEM') {
    const catalog = PUBLIC_PURPOSES.has(input.purpose);
    await enforce(`upload:${catalog ? 'catalog' : 'private'}:${userId}`, catalog ? 400 : 60, 3600);
  }
  const kind = sniff(input.data);
  if (!kind) throw validation('نوع الملف غير مدعوم. الأنواع المسموح بها: JPG, PNG, WEBP, PDF');
  if (input.originalName && !ALLOWED_EXT.test(input.originalName)) throw validation('امتداد الملف غير مسموح');
  if (kind === 'pdf' && IMAGE_ONLY.has(input.purpose)) throw validation('يجب رفع صورة (JPG / PNG / WEBP)');

  // The admin setting can only lower the deployment's hard cap (UPLOAD_MAX_*_MB), never raise it.
  const maxMb =
    kind === 'pdf'
      ? Math.min(await getSetting('uploads.maxDocumentMb', tx), env().UPLOAD_MAX_DOCUMENT_MB)
      : Math.min(await getSetting('uploads.maxImageMb', tx), env().UPLOAD_MAX_IMAGE_MB);
  if (input.data.length > maxMb * 1024 * 1024) throw validation(`حجم الملف يتجاوز الحد المسموح (${maxMb} ميجابايت)`);

  const visibility = PUBLIC_PURPOSES.has(input.purpose) ? 'PUBLIC' : 'PRIVATE';
  const id = randomUUID();
  const now = new Date();
  const prefix = `${input.purpose.toLowerCase()}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let body: Buffer;
  let ext: 'webp' | 'jpg' | 'pdf';
  let mime: string;
  let width: number | null = null;
  let height: number | null = null;
  const variantKeys: string[] = [];

  if (kind === 'pdf') {
    const pdfProblems = pdfContentProblems(input.data);
    if (pdfProblems.length) {
      logger.warn('upload.pdf_rejected', { purpose: input.purpose, problems: pdfProblems });
      throw validation('ملف الـPDF فيه محتوى غير مسموح. ارفع نسخة PDF عادية من غير JavaScript أو ملفات مدمجة أو أوامر تلقائية');
    }
    body = input.data;
    ext = 'pdf';
    mime = 'application/pdf';
  } else {
    try {
      const img = sharp(input.data, { failOn: 'error', limitInputPixels: 25_000_000 }).rotate();
      const meta = await img.metadata();
      if (!meta.width || !meta.height || meta.width < 50 || meta.height < 50) throw validation('أبعاد الصورة صغيرة جداً');
      const out = await img
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer({ resolveWithObject: true });
      body = out.data;
      width = out.info.width;
      height = out.info.height;
      ext = 'webp';
      mime = 'image/webp';
    } catch (e) {
      if (e instanceof Error && e.name === 'DomainError') throw e;
      logger.warn('upload.image_decode_failed', { purpose: input.purpose, error: safeErrorMessage(e) });
      throw validation('تعذّر قراءة الصورة. تأكد من أن الملف صورة سليمة');
    }
  }

  const storageKey = `${prefix}/${id}.${ext}`;
  const driver = storage();
  if (visibility === 'PRIVATE' && driver instanceof LocalDiskStorage) {
    // The metadata lock survives until the business transaction commits or rolls back.
    // A second lock covers the disk write even if that transaction is aborted meanwhile.
    if (!('rollback' in tx)) throw new Error('private local upload requires a transaction');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${metadataLockName(storageKey)}, 0))`);
    await db.transaction(async (lease) => {
      await lease.execute(sql`select set_config('idle_in_transaction_session_timeout', '0', true)`);
      await lease.execute(sql`select pg_advisory_xact_lock(hashtextextended(${writeLockName(storageKey)}, 0))`);
      await driver.put(visibility, storageKey, body);
    });
  } else {
    await driver.put(visibility, storageKey, body, tx);
  }

  if (visibility === 'PUBLIC' && kind !== 'pdf') {
    for (const [suffix, size] of [
      ['thumb', 320],
      ['md', 800],
    ] as const) {
      const v = await sharp(body).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const k = `${prefix}/${id}_${suffix}.webp`;
      await storage().put(visibility, k, v, tx);
      variantKeys.push(k);
    }
  }

  await tx.insert(files).values({
    id,
    visibility,
    purpose: input.purpose,
    storageKey,
    mimeType: mime,
    sizeBytes: body.length,
    sha256: sha256(body),
    width,
    height,
    variantKeys,
    originalName: input.originalName ? input.originalName.slice(0, 120) : null,
    ownerUserId: userId,
    scanStatus: initialScanStatus(visibility),
  });
  return { id, storageKey, visibility, mimeType: mime, sourceSha256: sha256(input.data) };
}

/** Public URL for a PUBLIC file (optionally a resized rendition). */
export function publicUrl(storageKey: string | null | undefined, size?: 'thumb' | 'md'): string | null {
  if (!storageKey) return null;
  const key = size ? storageKey.replace(/\.webp$/, `_${size}.webp`) : storageKey;
  return `/media/${key}`;
}
